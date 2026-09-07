import { type } from "arktype";
import { BucketName } from "./bucket";
import { Key } from "./object";

export const Id = type("string.uuid");

export const CreateUpload = type({
  bucket: BucketName,
  key: Key,
  "contentType?": "string",
});

export type CreateUpload = typeof CreateUpload.infer;

export const AppendQuery = type({
  "offset?": type("string.integer.parse").to("number >= 0"),
});

export type AppendQuery = typeof AppendQuery.infer;
