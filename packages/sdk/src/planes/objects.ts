import type { Http, RequestOptions } from "../http";
import { route } from "../lib/params";
import { fail, ok, type Result } from "../result";
import type {
  BatchDeleteResponse,
  ObjectListResponse,
  ObjectMeta,
  PutObjectResponse,
  ReadObjectOptions,
  PutObjectOptions,
  ListObjectsOptions,
} from "../types";

const paths = {
  get: "/:bucket/:key*",
  head: "/:bucket/:key*",
  put: "/:bucket/:key*",
  delete: "/:bucket/:key*",
  list: "/:bucket",
  deleteMany: "/:bucket",
} as const;

export function parseObjectMeta(
  response: Pick<Response, "headers" | "status">,
): Result<ObjectMeta> {
  const contentType = response.headers.get("Content-Type");
  const sizeStr = response.headers.get("Content-Length");
  const lastModified = response.headers.get("Last-Modified");
  const etag = /^(?:W\/)?"(.+)"$/.exec(response.headers.get("ETag") ?? "");

  if (!contentType) {
    return fail(
      response.status,
      "UNKNOWN",
      'response missing "Content-Type" header',
    );
  }

  if (!sizeStr || !/^\d+$/.test(sizeStr)) {
    return fail(
      response.status,
      "UNKNOWN",
      'response missing "Content-Length" header',
    );
  }

  if (!lastModified) {
    return fail(
      response.status,
      "UNKNOWN",
      'response missing "Last-Modified" header',
    );
  }

  if (!etag) {
    return fail(response.status, "UNKNOWN", 'malformed "ETag" header');
  }

  return ok({
    contentType,
    size: Number(sizeStr),
    lastModified,
    // group 1 is guaranteed by the regex (.+)
    etag: etag[1]!,
  });
}

export function putInit(body: BodyInit, contentType?: string) {
  const headers = new Headers();
  headers.set(
    "Content-Type",
    (contentType ?? (body instanceof Blob ? body.type : "")) ||
      "application/octet-stream",
  );

  return {
    method: "PUT",
    body,
    headers,
    ...(body instanceof ReadableStream ? { duplex: "half" } : {}),
  } as RequestOptions;
}

export function createObjects(http: Http) {
  async function get(
    bucket: string,
    key: string,
    opts: ReadObjectOptions = {},
  ): Promise<Result<Response>> {
    const { anonymous = false } = opts;
    const path = route(paths.get, { bucket, key });
    return await http.request(path, { anonymous });
  }

  async function head(
    bucket: string,
    key: string,
    opts: ReadObjectOptions = {},
  ): Promise<Result<ObjectMeta>> {
    const { anonymous = false } = opts;
    const path = route(paths.head, { bucket, key });
    const result = await http.request(path, { anonymous, method: "HEAD" });
    if (!result.success) return result;
    return parseObjectMeta(result.data);
  }

  async function put(
    bucket: string,
    key: string,
    body: BodyInit,
    opts: PutObjectOptions = {},
  ): Promise<Result<PutObjectResponse & { location: string | null }>> {
    const { contentType } = opts;
    const path = route(paths.put, { bucket, key });

    const result = await http.request(path, putInit(body, contentType));

    if (!result.success) return result;
    const json = (await result.data.json()) as PutObjectResponse;
    return ok({
      ...json,
      location: result.data.headers.get("Location"),
    });
  }

  async function list(
    bucket: string,
    filters: ListObjectsOptions = {},
  ): Promise<Result<ObjectListResponse>> {
    const path = route(paths.list, { bucket });
    const searchParams = new URLSearchParams();

    if (filters.prefix !== undefined) {
      searchParams.set("prefix", filters.prefix);
    }

    if (filters.after !== undefined) {
      searchParams.set("after", filters.after);
    }

    if (filters.limit !== undefined) {
      searchParams.set("limit", filters.limit.toString());
    }

    const qs = searchParams.toString();
    return await http.requestJson<ObjectListResponse>(qs ? `${path}?${qs}` : path);
  }

  async function deleteObject(
    bucket: string,
    key: string,
  ): Promise<Result<void>> {
    const path = route(paths.delete, { bucket, key });
    const result = await http.request(path, { method: "DELETE" });
    if (!result.success) return result;
    return ok(undefined);
  }

  async function deleteMany(
    bucket: string,
    keys: string[],
  ): Promise<Result<BatchDeleteResponse>> {
    const path = route(paths.deleteMany, { bucket });
    return await http.requestJson<BatchDeleteResponse>(path, {
      method: "DELETE",
      body: JSON.stringify({ keys }),
      headers: { "Content-Type": "application/json" },
    });
  }

  return {
    get,
    head,
    put,
    list,
    delete: deleteObject,
    deleteMany,
  };
}
