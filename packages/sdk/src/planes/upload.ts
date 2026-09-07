import type { Http } from "../http";
import { route } from "../lib/params";
import { ok, type Result } from "../result";
import type {
  UploadResponse,
  UploadPresignResponse,
  CreateUploadOptions,
  PutObjectResponse,
} from "../types";

const paths = {
  create: "/_uploads",
  get: "/_uploads/:id",
  append: "/_uploads/:id",
  complete: "/_uploads/:id/complete",
  abort: "/_uploads/:id",
  presign: "/_uploads/:id/presign",
} as const;

export function createUpload(http: Http) {
  async function get(id: string): Promise<Result<UploadResponse>> {
    const path = route(paths.get, { id });
    return await http.requestJson<UploadResponse>(path);
  }

  async function complete(
    id: string,
  ): Promise<Result<PutObjectResponse & { location: string | null }>> {
    const path = route(paths.complete, { id });
    const result = await http.request(path, {
      method: "POST",
    });
    if (!result.success) return result;
    const json = (await result.data.json()) as PutObjectResponse;
    return ok({
      ...json,
      location: result.data.headers.get("Location"),
    });
  }

  async function abort(id: string): Promise<Result<void>> {
    const path = route(paths.abort, { id });
    const result = await http.request(path, { method: "DELETE" });
    if (!result.success) return result;
    return ok(undefined);
  }

  async function presign(
    id: string,
    ttl: number,
  ): Promise<Result<UploadPresignResponse>> {
    const path = route(paths.presign, { id });
    return await http.requestJson<UploadPresignResponse>(path, {
      method: "POST",
      body: JSON.stringify({ ttl }),
      headers: { "Content-Type": "application/json" },
    });
  }

  async function create(
    opts: CreateUploadOptions,
  ): Promise<Result<UploadResponse>> {
    const path = route(paths.create, {});
    return await http.requestJson<UploadResponse>(path, {
      method: "POST",
      body: JSON.stringify(opts),
      headers: { "Content-Type": "application/json" },
    });
  }

  async function append(
    id: string,
    chunk: BodyInit,
    offset: number,
  ): Promise<Result<UploadResponse>> {
    const searchParams = new URLSearchParams();
    searchParams.set("offset", offset.toString());
    const path = `${route(paths.append, { id })}?${searchParams.toString()}`;
    return await http.requestJson<UploadResponse>(path, {
      method: "PATCH",
      body: chunk,
      ...(chunk instanceof ReadableStream ? { duplex: "half" } : {}),
    });
  }

  return { get, complete, abort, presign, create, append };
}
