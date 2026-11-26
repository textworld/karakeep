import type { ParseSubprocessOutput } from "../../utils/parseHtmlSubprocessIpc";
import type { CrawlContext } from "../common";

/**
 * The content and metadata of a page, as fetched by a site-specific API
 * instead of by crawling the page with the browser.
 */
export interface SiteApiPage {
  /** The page's metadata, in the shape the parse subprocess produces. */
  metadata: ParseSubprocessOutput["metadata"];
  /** The raw HTML of the page's main content. */
  content: string;
}

/**
 * Fetches the content of a site through a third-party API. Used for sites
 * that can't be crawled directly (e.g. Zhihu, which only serves its content
 * to logged-in users).
 */
export interface SiteHandler {
  /** A human readable name, used in the logs. */
  readonly name: string;
  /** Whether this handler knows how to fetch the given URL. */
  matches(url: URL): boolean;
  /**
   * Fetches the page's content and metadata. Throws when the API fails, in
   * which case the caller falls back to the regular browser crawl.
   */
  fetch(ctx: CrawlContext): Promise<SiteApiPage>;
}
