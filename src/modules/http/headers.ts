import type { HTTPHeaders } from "elysia";
import type { ObjectRow } from "../storage/types";
import { uriEncodedFilename } from "$/lib/request";
import { keyToFilename } from "$/lib/key";

export function applyObjectHeaders(headers: HTTPHeaders, object: ObjectRow) {
  const filename = uriEncodedFilename(keyToFilename(object.key));
  headers["content-type"] = object.contentType;
  headers["last-modified"] = object.createdAt.toUTCString();
  headers["content-disposition"] = `inline; filename*=UTF-8''${filename}`;
  headers["ETag"] = `"${object.id}"`;
}
