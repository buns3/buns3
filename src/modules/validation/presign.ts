import { PRESIGN_METHODS } from "$/lib/presign";
import { type } from "arktype";
import { BucketName } from "./bucket";
import { Key } from "./object";

const SEVEN_DAYS_SECONDS = 604_800;

export const PresignParams = type({
  keyId: /^[0-9a-f]{64}$/,
  expires: type("string.integer.parse").to(
    "0 <= number.integer <= 999999999999",
  ),
  sig: /^[0-9a-f]{64}$/,
});

export type PresignParams = typeof PresignParams.infer;

export const PresignRequest = type({
  method: type.enumerated(...PRESIGN_METHODS),
  bucket: BucketName,
  key: Key,
  ttl: `0 <= number.integer <= ${SEVEN_DAYS_SECONDS}`,
});

export type PresignRequest = typeof PresignRequest.infer;
