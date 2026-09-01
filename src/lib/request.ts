import { type ObjectRow } from "$/modules/storage/types";
import { keyToFilename } from "./key";

export function strictEncode(value: string) {
  return encodeURIComponent(value)
    .replaceAll("'", "%27")
    .replaceAll("(", "%28")
    .replaceAll(")", "%29")
    .replaceAll("*", "%2A");
}

export function uriEncodedFilename(filename: string) {
  return strictEncode(filename);
}

export function uriEncodedKey(key: string) {
  return key.split("/").map(strictEncode).join("/");
}

export function objectHeaders(object: ObjectRow) {
  const filename = uriEncodedFilename(keyToFilename(object.key));

  const headers = new Headers();
  headers.set("Content-Type", object.contentType);
  headers.set("Content-Length", String(object.size));
  headers.set("Last-Modified", object.createdAt.toUTCString());
  headers.set("Content-Disposition", `inline; filename*=UTF-8''${filename}`);
  headers.set("ETag", `"${object.id}"`);

  return headers;
}
