import type { HTTPHeaders } from "elysia";
import type { ObjectRow } from "../storage/types";
import { uriEncodedFilename } from "$/lib/request";
import { keyToFilename } from "$/lib/key";
import type { AuthKind } from "../auth/types";
import { CACHE_CONTROL } from "./cache";

export function applyPayloadHeaders(headers: HTTPHeaders, object: ObjectRow) {
  const filename = uriEncodedFilename(keyToFilename(object.key));
  headers["content-type"] = object.contentType;
  headers["content-disposition"] = `inline; filename*=UTF-8''${filename}`;
}

export function applyValidatorHeaders(
  headers: HTTPHeaders,
  object: ObjectRow,
  authKind: AuthKind,
) {
  headers["last-modified"] = object.createdAt.toUTCString();
  headers["ETag"] = `"${object.id}"`;
  headers["vary"] = "Authorization";
  headers["cache-control"] = CACHE_CONTROL[authKind];
}
