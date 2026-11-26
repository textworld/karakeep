// The registry of site-specific content APIs. A handler is picked by the
// crawler worker based on the bookmark's URL, and serves the page's content
// without crawling the site itself.

import serverConfig from "@karakeep/shared/config";

import type { SiteHandler } from "./types";
import { TikHubClient } from "./tikhub";
import { ZhihuSiteHandler } from "./zhihu";

let handlers: SiteHandler[] | null = null;

function buildHandlers(): SiteHandler[] {
  const built: SiteHandler[] = [];
  const { apiKey, baseUrl, timeoutSec, questionAnswersLimit } =
    serverConfig.tikhub;
  if (apiKey) {
    built.push(
      new ZhihuSiteHandler(
        new TikHubClient(apiKey, baseUrl, timeoutSec * 1000),
        questionAnswersLimit,
      ),
    );
  }
  return built;
}

/**
 * The handler that can serve the given URL, or null when no handler applies
 * (either because the URL isn't handled by any of them, or because the
 * integration isn't configured).
 */
export function getSiteHandler(url: string): SiteHandler | null {
  handlers ??= buildHandlers();
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  return handlers.find((handler) => handler.matches(parsed)) ?? null;
}
