import type { Buns3ErrorCode } from "$/modules/storage/errors";
import type { type } from "arktype";

export type Buns3HTTPErrorCode = "VALIDATION_ERROR";

export function errorResponse(code: Buns3ErrorCode) {
  switch (code) {
    case "KEY_NOT_FOUND":
      return Response.json({ code }, { status: 404 });

    case "INVALID_KEY":
      return Response.json({ code }, { status: 422 });

    case "BUCKET_NOT_FOUND":
      return Response.json({ code }, { status: 404 });

    case "BUCKET_ALREADY_EXIST":
      return Response.json({ code }, { status: 409 });

    case "BUCKET_NOT_EMPTY":
      return Response.json({ code }, { status: 409 });

    case "FS_ERROR":
      return Response.json({ code }, { status: 500 });

    case "UNKNOWN":
    default:
      return Response.json({ code: code ?? "UNKNOWN" }, { status: 500 });
  }
}

export function validationErrorResponse(errors: type.errors) {
  const code: Buns3HTTPErrorCode = "VALIDATION_ERROR";
  return Response.json({ code, summary: errors.summary }, { status: 422 });
}
