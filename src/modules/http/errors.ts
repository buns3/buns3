import type { Buns3ErrorCode } from "$/modules/storage/errors";
import type { type } from "arktype";
import type { Buns3ApiKeyErrorCode } from "../api-keys/errors";

export type Buns3HTTPErrorCode = "VALIDATION_ERROR";

export function errorResponse(code: Buns3ErrorCode | Buns3ApiKeyErrorCode) {
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

    case "INVALID_API_KEY": {
      const headers = new Headers();
      headers.set("WWW-Authenticate", "Bearer");
      return Response.json({ code }, { status: 401, headers });
    }

    case "KEY_NOT_CAPABLE":
      return Response.json({ code }, { status: 403 });

    case "UNKNOWN":
    default:
      return Response.json({ code: code ?? "UNKNOWN" }, { status: 500 });
  }
}

export function validationErrorResponse(errors: type.errors) {
  const code: Buns3HTTPErrorCode = "VALIDATION_ERROR";
  return Response.json({ code, summary: errors.summary }, { status: 422 });
}
