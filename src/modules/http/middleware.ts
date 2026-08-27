import { extractKey } from "$/lib/route";
import { type } from "arktype";
import { BucketName } from "../validation/bucket";
import { errorResponse, validationErrorResponse } from "./errors";
import { Key } from "../validation/object";

export function bucketKeyMiddleware(req: {
  url: string;
  params: { bucket: string };
}) {
  const result = extractKey(req.url);
  if (!result.success) {
    return errorResponse("INVALID_KEY");
  }

  const keyResult = Key(result.key);
  if (keyResult instanceof type.errors) {
    return validationErrorResponse(keyResult);
  }

  const bucketResult = BucketName(req.params.bucket);
  if (bucketResult instanceof type.errors) {
    return validationErrorResponse(bucketResult);
  }

  return { bucket: bucketResult, key: keyResult };
}

export function bucketMiddleware(req: { params: { name: string } }) {
  const name = BucketName(req.params.name);
  if (name instanceof type.errors) {
    return validationErrorResponse(name);
  }

  return { name };
}
