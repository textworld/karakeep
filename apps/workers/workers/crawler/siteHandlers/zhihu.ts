// Fetches the content of Zhihu (知乎) links through the TikHub API.
//
// Zhihu serves most of its content only to logged-in users, so a browser
// crawl of a Zhihu link usually ends up with a login wall or an empty page.
// TikHub proxies Zhihu's public API instead, which returns the rendered
// content of questions, answers and column articles.

import { decode as decodeHtmlEntities } from "html-entities";

import type { SiteApiPage, SiteHandler } from "./types";
import type { CrawlContext } from "../common";
import { escapeHtml } from "./utils";
import { TikHubClient } from "./tikhub";

const ZHIHU_PUBLISHER = "知乎";
const ZHIHU_FAVICON = "https://www.zhihu.com/favicon.ico";

export type ZhihuTarget =
  | { type: "question"; questionId: string }
  | { type: "answer"; questionId: string; answerId: string }
  | { type: "article"; articleId: string };

interface ZhihuAuthor {
  name: string;
  avatar_url?: string;
  headline?: string;
}

interface ZhihuTopic {
  id: string;
  name: string;
  avatar_url?: string;
}

interface ZhihuQuestionDetail {
  id: string;
  title: string;
  created?: number;
  updated_time?: number;
  answer_count?: number;
  comment_count?: number;
  follower_count?: number;
  excerpt?: string;
  detail?: string;
  topics?: ZhihuTopic[];
}

interface ZhihuAnswer {
  id: string;
  content?: string;
  excerpt?: string;
  voteup_count?: number | null;
  comment_count?: number | null;
  created_time?: number;
  updated_time?: number;
  question?: { id: string; title: string };
  author?: ZhihuAuthor;
}

interface ZhihuArticle {
  id: string;
  title: string;
  content?: string;
  excerpt?: string;
  voteup_count?: number | null;
  comment_count?: number | null;
  created?: number;
  updated?: number;
  author?: ZhihuAuthor;
  image_url?: string;
}

interface ZhihuQuestionAnswers {
  data?: { type?: string; target?: ZhihuAnswer }[];
}

/**
 * Extracts the id of the Zhihu entity a URL points to, or null when the URL
 * isn't one this handler can serve.
 */
export function parseZhihuUrl(rawUrl: string): ZhihuTarget | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  const hostname = url.hostname.toLowerCase();
  if (hostname !== "zhihu.com" && !hostname.endsWith(".zhihu.com")) {
    return null;
  }

  const path = url.pathname;

  // /question/<question id> and /question/<question id>/answer/<answer id>
  const questionMatch = /^\/question\/(\d+)(?:\/answer\/(\d+))?/.exec(path);
  if (questionMatch) {
    const [, questionId, answerId] = questionMatch;
    return answerId
      ? { type: "answer", questionId, answerId }
      : { type: "question", questionId };
  }

  // /p/<article id> is the short link of a column article. It's served by
  // both www.zhihu.com and zhuanlan.zhihu.com.
  const articleMatch = /^\/p\/(\d+)/.exec(path);
  if (articleMatch) {
    return { type: "article", articleId: articleMatch[1] };
  }

  return null;
}

/** Strips the HTML tags off a snippet of HTML, leaving plain text. */
function textFromHtml(html: string | null | undefined): string {
  if (!html) {
    return "";
  }
  return decodeHtmlEntities(html.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The maximum length of a bookmark's description. Zhihu's excerpts are
 * sometimes the whole beginning of the article, which is too long for a
 * preview.
 */
const MAX_DESCRIPTION_LENGTH = 500;

function truncate(text: string, maxLength = MAX_DESCRIPTION_LENGTH): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength).trimEnd()}…`;
}

/**
 * The URL of the first image in a chunk of HTML. Zhihu's images carry the
 * full size version in `data-original` and a resized one in `src`.
 */
export function firstImageUrl(html: string | null | undefined): string | null {
  if (!html) {
    return null;
  }
  for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
    const original = /data-original\s*=\s*"([^"]+)"/i.exec(tag)?.[1];
    if (original?.startsWith("http")) {
      return original;
    }
    const src = /\bsrc\s*=\s*"([^"]+)"/i.exec(tag)?.[1];
    if (src?.startsWith("http")) {
      return src;
    }
  }
  return null;
}

/** Converts a Unix timestamp (in seconds) to an ISO date. */
function toIsoDate(seconds: number | null | undefined): string | null {
  if (!seconds) {
    return null;
  }
  const date = new Date(seconds * 1000);
  return isNaN(date.getTime()) ? null : date.toISOString();
}

/** Renders the byline of an answer (author and stats). */
function renderAnswerMeta(answer: ZhihuAnswer): string | null {
  const bits: string[] = [];
  if (answer.author?.name) {
    bits.push(`<strong>${escapeHtml(answer.author.name)}</strong>`);
  }
  if (answer.voteup_count) {
    bits.push(`${answer.voteup_count} 赞同`);
  }
  if (answer.comment_count) {
    bits.push(`${answer.comment_count} 条评论`);
  }
  if (bits.length === 0) {
    return null;
  }
  return `<p class="zhihu-answer-meta">${bits.join(" · ")}</p>`;
}

/** Renders a single answer as HTML. */
export function renderAnswer(answer: ZhihuAnswer): string {
  const parts: string[] = [];
  const meta = renderAnswerMeta(answer);
  if (meta) {
    parts.push(meta);
  }
  if (answer.content) {
    parts.push(`<div class="zhihu-answer-content">${answer.content}</div>`);
  }
  return parts.join("\n");
}

export class ZhihuSiteHandler implements SiteHandler {
  readonly name = "TikHub (Zhihu)";

  constructor(
    private readonly client: TikHubClient,
    /** How many answers to pull in when a question is bookmarked. */
    private readonly answersLimit: number,
  ) {}

  matches(url: URL): boolean {
    return parseZhihuUrl(url.toString()) !== null;
  }

  async fetch(ctx: CrawlContext): Promise<SiteApiPage> {
    const target = parseZhihuUrl(ctx.url);
    if (!target) {
      throw new Error(`Not a Zhihu URL that can be fetched: ${ctx.url}`);
    }
    const page = await (async () => {
      switch (target.type) {
        case "article":
          return await this.fetchArticle(target.articleId, ctx);
        case "answer":
          return await this.fetchAnswer(target.answerId, ctx);
        case "question":
          return await this.fetchQuestion(target.questionId, ctx);
      }
    })();
    // Zhihu answers a deleted piece of content with a 200 and an empty
    // payload. Without this check the bookmark would end up marked as
    // successfully crawled with nothing in it. A page that still carries a
    // title is kept: it identifies the bookmark even when the body is gone.
    if (!page.content.trim() && !page.metadata.title) {
      throw new Error(
        `Zhihu returned no content for the ${target.type} ${JSON.stringify(target)} (it may have been deleted)`,
      );
    }
    return page;
  }

  private async fetchArticle(
    articleId: string,
    ctx: CrawlContext,
  ): Promise<SiteApiPage> {
    const article = await this.client.get<ZhihuArticle>(
      "/api/v1/zhihu/web/fetch_column_article_detail",
      { article_id: articleId },
      ctx.abortSignal,
    );
    const content = article.content ?? "";
    return {
      metadata: {
        title: article.title ?? null,
        description: truncate(textFromHtml(article.excerpt)) || null,
        image: firstImageUrl(content) || article.image_url || null,
        logo: ZHIHU_FAVICON,
        author: article.author?.name ?? null,
        publisher: ZHIHU_PUBLISHER,
        datePublished: toIsoDate(article.created),
        dateModified: toIsoDate(article.updated),
      },
      content,
    };
  }

  private async fetchAnswer(
    answerId: string,
    ctx: CrawlContext,
  ): Promise<SiteApiPage> {
    const answer = await this.client.get<ZhihuAnswer>(
      "/api/v1/zhihu/web/fetch_answer_detail",
      { answer_id: answerId },
      ctx.abortSignal,
    );
    const content = answer.content ?? "";
    return {
      metadata: {
        // An answer has no title of its own, so the title of the question it
        // answers is used instead.
        title: answer.question?.title ?? null,
        description: truncate(textFromHtml(answer.excerpt)) || null,
        image: firstImageUrl(content),
        logo: ZHIHU_FAVICON,
        author: answer.author?.name ?? null,
        publisher: ZHIHU_PUBLISHER,
        datePublished: toIsoDate(answer.created_time),
        dateModified: toIsoDate(answer.updated_time),
      },
      content: renderAnswer(answer),
    };
  }

  private async fetchQuestion(
    questionId: string,
    ctx: CrawlContext,
  ): Promise<SiteApiPage> {
    const question = await this.client.get<ZhihuQuestionDetail>(
      "/api/v1/zhihu/web/fetch_question_detail",
      { question_id: questionId },
      ctx.abortSignal,
    );

    // The answers are a nice-to-have: a failure to fetch them shouldn't
    // lose the question itself.
    const answers = await this.fetchAnswers(questionId, ctx);

    const parts: string[] = [];
    if (question.detail) {
      parts.push(`<div class="zhihu-question-detail">${question.detail}</div>`);
    }
    if (answers.length > 0) {
      parts.push(`<h2>${answers.length} 个回答</h2>`);
      for (const answer of answers) {
        parts.push(
          `<div class="zhihu-answer" data-answer-id="${escapeHtml(answer.id ?? "")}">${renderAnswer(answer)}</div>`,
        );
      }
    }

    const topics = (question.topics ?? []).map((topic) => topic.name);

    return {
      metadata: {
        title: question.title ?? null,
        description:
          truncate(textFromHtml(question.detail)) ||
          truncate(textFromHtml(question.excerpt)) ||
          (topics.length > 0 ? `话题：${topics.join("、")}` : null),
        image: firstImageUrl(parts.join("\n")),
        logo: ZHIHU_FAVICON,
        author: null,
        publisher: ZHIHU_PUBLISHER,
        datePublished: toIsoDate(question.created),
        dateModified: toIsoDate(question.updated_time),
      },
      content: parts.join("\n"),
    };
  }

  private async fetchAnswers(
    questionId: string,
    ctx: CrawlContext,
  ): Promise<ZhihuAnswer[]> {
    if (this.answersLimit <= 0) {
      return [];
    }
    try {
      const response = await this.client.get<ZhihuQuestionAnswers>(
        "/api/v1/zhihu/web/fetch_question_answers",
        { question_id: questionId, limit: this.answersLimit },
        ctx.abortSignal,
      );
      return (response.data ?? [])
        .map((item) => item.target)
        .filter((answer): answer is ZhihuAnswer => !!answer?.content);
    } catch (e) {
      ctx.log.warn(
        `Failed to fetch the answers of the Zhihu question ${questionId}: ${e}`,
      );
      return [];
    }
  }
}
