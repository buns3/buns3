import {
  isErrorCode,
  type ClientErrorCode,
  type ErrorCode,
} from "./lib/error";

/** The outcome of a call. The SDK does not throw; narrow on `success`. */
export type Result<T> =
  | { success: true; data: T }
  | {
      success: false;
      /** HTTP status, or 0 if the request never got a response. */
      status: number;
      code: ClientErrorCode;
      detail?: string;
    };

/** An RFC 9457 error body. Parsed best-effort — a proxy may answer instead. */
export interface Problem {
  type: "about:blank";
  title: string;
  status: number;
  code: ErrorCode;
  detail?: string;
}

export function ok<T>(data: T): Result<T> {
  return { success: true, data };
}

export function fail(
  status: number,
  code: ClientErrorCode,
  detail?: string,
): Result<never> {
  return { success: false, status, code, detail };
}

export async function fromProblem(response: Response): Promise<Result<never>> {
  const text = await response.text();
  const errorDetail = text || undefined;

  try {
    const json = JSON.parse(text) as Partial<Problem> | null;
    const code = json?.code;
    const detail = typeof json?.detail === "string" ? json.detail : undefined;

    if (isErrorCode(code)) {
      return fail(response.status, code, detail);
    }

    return fail(response.status, "UNKNOWN", errorDetail);
  } catch {
    return fail(response.status, "UNKNOWN", errorDetail);
  }
}

export function networkError(error: unknown): Result<never> {
  return fail(
    0,
    "NETWORK_ERROR",
    error instanceof Error ? error.message : String(error),
  );
}
