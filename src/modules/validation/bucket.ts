import { type } from "arktype";

export const BucketName = type("0 < /^[a-z]{1}[a-z0-9-]{0,}$/ <= 20");

export const BucketUpdate = type({
  "publicRead?": "boolean",
}).narrow((data, ctx) => {
  if (Object.keys(data).length === 0) {
    return ctx.reject({
      expected: "an object containing at least one property to update",
    });
  }

  return true;
});

export type BucketUpdate = typeof BucketUpdate.infer;
