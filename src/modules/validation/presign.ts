import { type } from "arktype";

export const PresignParams = type({
  keyId: /^[0-9a-f]{64}$/,
  expires: type("string.integer.parse").to(
    "0 <= number.integer <= 999999999999",
  ),
  sig: /^[0-9a-f]{64}$/,
});

export type PresignParams = typeof PresignParams.infer;
