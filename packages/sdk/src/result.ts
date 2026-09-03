import { isErrorCode, type ClientErrorCode } from "./error";
import type { Result } from "./types";

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
    const json = JSON.parse(text);
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
