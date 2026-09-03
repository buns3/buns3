import { ok } from "../result";
import type { Http } from "../http";
import type { ObjectMeta, PutObjectResponse, Result } from "../types";
import { parseObjectMeta, putInit, type PutOptions } from "./objects";

const presignInit = {
  absolute: true,
  anonymous: true,
} as const;

export function createPresigned(http: Http) {
  async function get(url: string): Promise<Result<Response>> {
    return await http.request(url, {
      ...presignInit,
      method: "GET",
    });
  }

  async function head(url: string): Promise<Result<ObjectMeta>> {
    const result = await http.request(url, { ...presignInit, method: "HEAD" });
    if (!result.success) return result;
    return parseObjectMeta(result.data);
  }

  async function put(
    url: string,
    body: BodyInit,
    opts: Partial<PutOptions> = {},
  ): Promise<Result<PutObjectResponse & { location: string | null }>> {
    const { contentType } = opts;
    const result = await http.request(url, {
      ...presignInit,
      ...putInit(body, contentType),
      method: "PUT",
    });

    if (!result.success) return result;
    const json = (await result.data.json()) as PutObjectResponse;
    return ok({
      ...json,
      location: result.data.headers.get("Location"),
    });
  }

  async function deleteObject(url: string): Promise<Result<void>> {
    const result = await http.request(url, {
      ...presignInit,
      method: "DELETE",
    });
    if (!result.success) return result;
    return ok(undefined);
  }

  return {
    get,
    head,
    put,
    delete: deleteObject,
  };
}
