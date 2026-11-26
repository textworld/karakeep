// A thin client for the TikHub API (https://docs.tikhub.io), which proxies
// the public APIs of a bunch of social media sites (TikTok, Douyin, YouTube,
// Zhihu, ...) behind a single REST API.
//
// TikHub only ships an official Python SDK, so the REST API is called
// directly here. Every endpoint returns the same envelope:
//
//   { "code": 200, "message": "...", "data": { ... } }
//
// and the actual payload lives in `data`.

const DEFAULT_BASE_URL = "https://api.tikhub.io";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 500;

export interface TikHubEnvelope<T> {
  code: number;
  message: string;
  data: T;
}

export class TikHubError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: number,
  ) {
    super(message);
    this.name = "TikHubError";
  }
}

export type TikHubParams = Record<string, string | number | undefined>;

/**
 * Whether a failed request is worth retrying. Rate limits and server errors
 * are transient, but the errors that come from a bad request (an invalid
 * token, an unknown id, ...) would fail again the same way.
 */
function isRetryableError(error: unknown): boolean {
  if (error instanceof TikHubError) {
    return error.status === 429 || (error.status ?? 0) >= 500;
  }
  // Everything else is a network level failure (a reset connection, a
  // timeout, ...).
  return true;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

export class TikHubClient {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string = DEFAULT_BASE_URL,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
    private readonly maxRetries: number = DEFAULT_MAX_RETRIES,
  ) {}

  /**
   * Performs a GET request against the API and returns the `data` field of
   * the response envelope. Throws a TikHubError when the API reports a
   * failure.
   *
   * Failed requests are retried a couple of times: the API closes its idle
   * keep-alive connections, so reusing a pooled connection surfaces as a
   * connection reset roughly every other request.
   */
  async get<T>(
    path: string,
    params: TikHubParams = {},
    signal?: AbortSignal,
  ): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await this.request<T>(path, params, signal);
      } catch (e) {
        lastError = e;
        if (attempt === this.maxRetries || !isRetryableError(e)) {
          break;
        }
        await delay(RETRY_BASE_DELAY_MS * (attempt + 1), signal);
      }
    }
    throw lastError;
  }

  private async request<T>(
    path: string,
    params: TikHubParams,
    signal?: AbortSignal,
  ): Promise<T> {
    const url = new URL(path, this.baseUrl);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: "application/json",
      },
      signal: signal
        ? AbortSignal.any([AbortSignal.timeout(this.timeoutMs), signal])
        : AbortSignal.timeout(this.timeoutMs),
    });

    const body = await response.text();
    let envelope: TikHubEnvelope<T>;
    try {
      envelope = JSON.parse(body) as TikHubEnvelope<T>;
    } catch {
      throw new TikHubError(
        `TikHub returned a non-JSON response for ${url.pathname} (status ${response.status})`,
        response.status,
      );
    }

    if (!response.ok || envelope.code !== 200) {
      throw new TikHubError(
        `TikHub request to ${url.pathname} failed (status ${response.status}, code ${envelope.code}): ${envelope.message || "unknown error"}`,
        response.status,
        envelope.code,
      );
    }

    return envelope.data;
  }
}
