import { describe, expect, it, vi } from "vitest";

import type { CrawlContext } from "../common";
import type { TikHubClient } from "./tikhub";
import {
  firstImageUrl,
  parseZhihuUrl,
  renderAnswer,
  ZhihuSiteHandler,
} from "./zhihu";

describe("parseZhihuUrl", () => {
  it("parses a question url", () => {
    expect(parseZhihuUrl("https://www.zhihu.com/question/19550517")).toEqual({
      type: "question",
      questionId: "19550517",
    });
  });

  it("parses an answer url", () => {
    expect(
      parseZhihuUrl(
        "https://www.zhihu.com/question/5721660615/answer/2054145988235880002",
      ),
    ).toEqual({
      type: "answer",
      questionId: "5721660615",
      answerId: "2054145988235880002",
    });
  });

  it("parses a column article url", () => {
    expect(parseZhihuUrl("https://zhuanlan.zhihu.com/p/669214677")).toEqual({
      type: "article",
      articleId: "669214677",
    });
  });

  it("parses a column article url served from the main domain", () => {
    expect(parseZhihuUrl("https://www.zhihu.com/p/669214677")).toEqual({
      type: "article",
      articleId: "669214677",
    });
  });

  it("ignores urls of other zhihu pages", () => {
    expect(parseZhihuUrl("https://www.zhihu.com/column/abc")).toBeNull();
    expect(parseZhihuUrl("https://www.zhihu.com/topic/19550793")).toBeNull();
  });

  it("ignores urls of other sites", () => {
    expect(parseZhihuUrl("https://example.com/question/19550517")).toBeNull();
    expect(parseZhihuUrl("https://notzhihu.com/question/19550517")).toBeNull();
  });

  it("ignores malformed urls", () => {
    expect(parseZhihuUrl("not a url")).toBeNull();
  });
});

describe("firstImageUrl", () => {
  it("prefers the full size image over the resized one", () => {
    expect(
      firstImageUrl(
        '<img src="https://pic1.zhimg.com/v2-abc_200x112.jpg" data-original="https://pic1.zhimg.com/v2-abc_r.jpg">',
      ),
    ).toBe("https://pic1.zhimg.com/v2-abc_r.jpg");
  });

  it("falls back to the src attribute", () => {
    expect(
      firstImageUrl('<img src="https://pic1.zhimg.com/v2-abc_200x112.jpg">'),
    ).toBe("https://pic1.zhimg.com/v2-abc_200x112.jpg");
  });

  it("returns null when there is no image", () => {
    expect(firstImageUrl("<p>no image here</p>")).toBeNull();
    expect(firstImageUrl(null)).toBeNull();
  });
});

describe("renderAnswer", () => {
  it("renders the byline and the content", () => {
    const html = renderAnswer({
      id: "123",
      content: "<p>hello</p>",
      voteup_count: 42,
      comment_count: 3,
      author: { name: "张三" },
    });
    expect(html).toContain("<strong>张三</strong>");
    expect(html).toContain("42 赞同");
    expect(html).toContain("3 条评论");
    expect(html).toContain("<p>hello</p>");
  });

  it("escapes the author's name", () => {
    const html = renderAnswer({
      id: "123",
      content: "<p>hello</p>",
      author: { name: "<script>alert(1)</script>" },
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("ZhihuSiteHandler", () => {
  const ctx = {
    url: "https://www.zhihu.com/question/19550517",
    jobId: "job-1",
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    abortSignal: new AbortController().signal,
  } as unknown as CrawlContext;

  it("fetches a question and its answers", async () => {
    const get = vi.fn(async (path: string) => {
      if (path.endsWith("fetch_question_detail")) {
        return {
          id: "19550517",
          title: "Instagram 有多少用户？",
          created: 1292996146,
          detail: "<p>问题描述</p>",
          topics: [{ id: "1", name: "Instagram" }],
        };
      }
      return {
        data: [
          {
            type: "question_feed_card",
            target: {
              id: "42",
              content: "<p>回答内容</p>",
              voteup_count: 10,
              author: { name: "李四" },
            },
          },
        ],
      };
    });
    const handler = new ZhihuSiteHandler({ get } as unknown as TikHubClient, 5);

    const page = await handler.fetch(ctx);

    expect(page.metadata.title).toBe("Instagram 有多少用户？");
    expect(page.metadata.description).toBe("问题描述");
    expect(page.metadata.publisher).toBe("知乎");
    expect(page.metadata.datePublished).toBe("2010-12-22T05:35:46.000Z");
    expect(page.content).toContain("问题描述");
    expect(page.content).toContain("回答内容");
    expect(page.content).toContain("李四");
  });

  it("keeps the question when the answers can't be fetched", async () => {
    const get = vi.fn(async (path: string) => {
      if (path.endsWith("fetch_question_detail")) {
        return { id: "1", title: "标题" };
      }
      throw new Error("boom");
    });
    const handler = new ZhihuSiteHandler({ get } as unknown as TikHubClient, 5);

    const page = await handler.fetch(ctx);

    expect(page.metadata.title).toBe("标题");
    expect(page.content).toBe("");
    expect(ctx.log.warn).toHaveBeenCalled();
  });

  it("doesn't fetch the answers when the limit is zero", async () => {
    const get = vi.fn(async (path: string) => {
      if (path.endsWith("fetch_question_detail")) {
        return { id: "1", title: "标题" };
      }
      throw new Error("should not be called");
    });
    const handler = new ZhihuSiteHandler({ get } as unknown as TikHubClient, 0);

    const page = await handler.fetch(ctx);

    expect(page.metadata.title).toBe("标题");
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("fetches a column article", async () => {
    const get = vi.fn(async () => ({
      id: "669214677",
      title: "年轻人如何被赶回老家去",
      content: '<p>正文</p><img src="https://pic1.zhimg.com/a.jpg">',
      excerpt: '<img src="https://pic1.zhimg.com/b.jpg">摘要',
      created: 1701146885,
      author: { name: "张佳玮" },
    }));
    const handler = new ZhihuSiteHandler({ get } as unknown as TikHubClient, 5);

    const page = await handler.fetch({
      ...ctx,
      url: "https://zhuanlan.zhihu.com/p/669214677",
    } as CrawlContext);

    expect(page.metadata.title).toBe("年轻人如何被赶回老家去");
    expect(page.metadata.description).toBe("摘要");
    expect(page.metadata.author).toBe("张佳玮");
    expect(page.metadata.image).toBe("https://pic1.zhimg.com/a.jpg");
    expect(page.content).toContain("正文");
  });

  it("fetches an answer", async () => {
    const get = vi.fn(async () => ({
      id: "2054145988235880002",
      content: "<p>回答</p>",
      excerpt: "回答摘要",
      created_time: 1782526567,
      question: { id: "5721660615", title: "问题标题" },
      author: { name: "白泽" },
    }));
    const handler = new ZhihuSiteHandler({ get } as unknown as TikHubClient, 5);

    const page = await handler.fetch({
      ...ctx,
      url: "https://www.zhihu.com/question/5721660615/answer/2054145988235880002",
    } as CrawlContext);

    expect(page.metadata.title).toBe("问题标题");
    expect(page.metadata.description).toBe("回答摘要");
    expect(page.metadata.author).toBe("白泽");
    expect(page.content).toContain("回答");
  });
});
