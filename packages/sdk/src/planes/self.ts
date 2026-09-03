import type { Http } from "../http";
import type { PresignHTTPMethod } from "../lib/presign";
import { route } from "../lib/params";
import { ok } from "../result";
import type { PresignResponse, Result, WhoamiResponse } from "../types";

const paths = {
  whoami: "/_self",
  revoke: "/_self",
  presign: "/_self/presign",
} as const;

export interface PresignOptions {
  method: PresignHTTPMethod;
  bucket: string;
  key: string;
  ttl: number;
}

export function createSelf(http: Http) {
  async function whoami(): Promise<Result<WhoamiResponse>> {
    const path = route(paths.whoami, {});
    return await http.requestJson<WhoamiResponse>(path);
  }

  async function revoke(): Promise<Result<void>> {
    const path = route(paths.revoke, {});
    const result = await http.request(path, { method: "DELETE" });
    if (!result.success) return result;
    return ok(undefined);
  }

  async function presign(
    opts: PresignOptions,
  ): Promise<Result<PresignResponse>> {
    const path = route(paths.presign, {});
    return await http.requestJson<PresignResponse>(path, {
      method: "POST",
      body: JSON.stringify(opts),
      headers: { "Content-Type": "application/json" },
    });
  }

  return {
    whoami,
    revoke,
    presign,
  };
}
