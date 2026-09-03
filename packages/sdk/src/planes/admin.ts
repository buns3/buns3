import type { Http } from "../http";
import { route } from "../lib/params";
import { ok } from "../result";
import type {
  ApiKeysResponse,
  BucketListResponse,
  BucketResponse,
  PostApiKeyResponse,
  Result,
} from "../types";

const bucketsPaths = {
  list: "/_admin/buckets",
  get: "/_admin/buckets/:bucket",
  create: "/_admin/buckets/:bucket",
  update: "/_admin/buckets/:bucket",
  delete: "/_admin/buckets/:bucket",
} as const;

const keysPaths = {
  list: "/_admin/keys",
  create: "/_admin/keys",
  delete: "/_admin/keys/:id",
} as const;

export interface UpdateBucketOptions {
  publicRead: boolean;
}

export type CreateApiKeyOptions =
  | {
      name: string;
      bucketName: null;
      canRead: false;
      canWrite: false;
      isAdmin: true;
    }
  | {
      name: string;
      bucketName: string;
      canRead: boolean;
      canWrite: boolean;
      isAdmin: false;
    };

export function createAdminBuckets(http: Http) {
  async function list(): Promise<Result<BucketListResponse>> {
    const path = route(bucketsPaths.list, {});
    return await http.requestJson<BucketListResponse>(path);
  }

  async function get(bucket: string): Promise<Result<BucketResponse>> {
    const path = route(bucketsPaths.get, { bucket });
    return await http.requestJson<BucketResponse>(path);
  }

  async function create(
    bucket: string,
  ): Promise<Result<BucketResponse & { location: string | null }>> {
    const path = route(bucketsPaths.create, { bucket });
    const result = await http.request(path, { method: "PUT" });
    if (!result.success) return result;
    const json = (await result.data.json()) as BucketResponse;
    return ok({
      ...json,
      location: result.data.headers.get("Location"),
    });
  }

  async function update(
    bucket: string,
    opts: Partial<UpdateBucketOptions>,
  ): Promise<Result<BucketResponse>> {
    const path = route(bucketsPaths.update, { bucket });
    return await http.requestJson<BucketResponse>(path, {
      method: "PATCH",
      body: JSON.stringify(opts),
      headers: { "Content-Type": "application/json" },
    });
  }

  async function deleteBucket(bucket: string): Promise<Result<void>> {
    const path = route(bucketsPaths.delete, { bucket });
    const result = await http.request(path, { method: "DELETE" });
    if (!result.success) return result;
    return ok(undefined);
  }

  return {
    list,
    get,
    create,
    update,
    delete: deleteBucket,
  };
}

export function createAdminKeys(http: Http) {
  async function list(): Promise<Result<ApiKeysResponse>> {
    const path = route(keysPaths.list, {});
    return await http.requestJson<ApiKeysResponse>(path);
  }

  async function create(
    opts: CreateApiKeyOptions,
  ): Promise<Result<PostApiKeyResponse>> {
    const path = route(keysPaths.create, {});
    return http.requestJson<PostApiKeyResponse>(path, {
      method: "POST",
      body: JSON.stringify(opts),
      headers: { "Content-Type": "application/json" },
    });
  }

  async function deleteKey(id: string): Promise<Result<void>> {
    const path = route(keysPaths.delete, { id });
    const result = await http.request(path, {
      method: "DELETE",
    });
    if (!result.success) return result;
    return ok(undefined);
  }

  return {
    list,
    create,
    delete: deleteKey,
  };
}

export function createAdmin(http: Http) {
  return {
    buckets: createAdminBuckets(http),
    keys: createAdminKeys(http),
  };
}
