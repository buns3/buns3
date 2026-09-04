import type { Http } from "../http";
import { route } from "../lib/params";
import type { Result } from "../result";
import type { ServerResponse } from "../types";

const paths = {
  get: "/_server",
} as const;

export function createServer(http: Http) {
  async function get(): Promise<Result<ServerResponse>> {
    const path = route(paths.get, {});
    return await http.requestJson<ServerResponse>(path);
  }

  return { get };
}
