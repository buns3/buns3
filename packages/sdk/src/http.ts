import { fromProblem, networkError, ok } from "./result";
import type { Result } from "./types";

export interface RetryOptions {
  attempts: number;
  baseDelay: number;
  maxDelay: number;
}

export type RequestOptions = RequestInit & { anonymous?: boolean };

export type SleepFn = (ms: number) => Promise<void>;

export interface CreateHttpOptions {
  token?: string;
  retry?: Partial<RetryOptions> | false;
  sleep?: SleepFn;
  fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

export interface Http {
  request: (path: string, init?: RequestOptions) => Promise<Result<Response>>;

  requestJson: <T>(path: string, init?: RequestOptions) => Promise<Result<T>>;
}

export const defaultSleep: SleepFn = (ms) =>
  new Promise((r) => setTimeout(r, ms));

export const defaultRetryPolicy: RetryOptions = {
  attempts: 3,
  baseDelay: 200,
  maxDelay: 2000,
};

function resolveRetryPolicy(retry: CreateHttpOptions["retry"]): RetryOptions {
  if (retry === undefined) return defaultRetryPolicy;
  if (retry === false) return { ...defaultRetryPolicy, attempts: 1 };
  return { ...defaultRetryPolicy, ...retry };
}

function bodyIsReplayable(body: BodyInit | null | undefined) {
  return !(body instanceof ReadableStream);
}

const retryableStatuses = [502, 503, 504, 429];

function isRetryableStatus(status: number) {
  return retryableStatuses.includes(status);
}

function parseRetryAfter(header?: string | null) {
  if (header === null || header === undefined) return null;
  const delaySeconds = /^\d+$/.test(header) ? Number(header) : null;
  if (delaySeconds !== null) {
    return delaySeconds * 1000;
  }

  const unix = Date.parse(header);
  if (Number.isNaN(unix)) return null;

  const ms = unix - Date.now();
  return ms > 0 ? ms : null;
}

export function createHttp(
  baseUrl: string,
  opts: CreateHttpOptions = {},
): Http {
  baseUrl = baseUrl.replace(/\/+$/, "");
  const { token, sleep = defaultSleep, fetch = globalThis.fetch } = opts;
  const policy = resolveRetryPolicy(opts.retry);

  async function backoff(attempt: number, res?: Response) {
    const headerBase = parseRetryAfter(res?.headers?.get("Retry-After"));
    const base = policy.baseDelay * 2 ** attempt;
    await sleep(
      // clamped on purpose; the server's hint is a floor we may undercut.
      headerBase !== null
        ? Math.min(policy.maxDelay, headerBase) // server's hint, exact, clamped
        : Math.random() * Math.min(policy.maxDelay, base), // our own backoff, jittered
    );
  }

  async function request(
    path: string,
    init: Partial<RequestOptions> = {},
  ): Promise<Result<Response>> {
    const { anonymous, ...fetchInit } = init;
    const headers = new Headers(fetchInit.headers);
    if (token && !anonymous) {
      headers.set("Authorization", `Bearer ${token}`);
    }

    const canRetry = policy.attempts > 1 && bodyIsReplayable(fetchInit.body);
    let attempt = 0;
    while (true) {
      let res: Response;
      try {
        res = await fetch(baseUrl + path, { ...fetchInit, headers });
      } catch (error) {
        if (canRetry && attempt < policy.attempts - 1) {
          await backoff(attempt++);
          continue;
        }

        return networkError(error);
      }

      if (res.ok) {
        return ok(res);
      }

      if (
        canRetry &&
        isRetryableStatus(res.status) &&
        attempt < policy.attempts - 1
      ) {
        await res.body?.cancel();
        await backoff(attempt++, res);
        continue;
      }

      return fromProblem(res);
    }
  }

  async function requestJson<T>(
    path: string,
    init: Partial<RequestOptions> = {},
  ): Promise<Result<T>> {
    const result = await request(path, init);
    if (!result.success) return result;
    return ok((await result.data.json()) as T);
  }

  return {
    request,
    requestJson,
  };
}
