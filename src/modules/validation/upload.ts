import { type } from "arktype";
import { BucketName } from "./bucket";
import { Key } from "./object";

const TWENTY_FOUR_HOURS_SECONDS = 60 * 24;

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

export const UploadPresignRequest = type({
  ttl: `0 <= number.integer <= ${TWENTY_FOUR_HOURS_SECONDS}`,
});

export type UploadPresignRequest = typeof UploadPresignRequest.infer;
