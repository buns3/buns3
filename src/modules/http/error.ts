import { Buns3Error, Buns3ValidationError } from "$/lib/error";
import type { Buns3AnyErrorCode } from "$/lib/error-codes";
import Elysia, {
  InternalServerError,
  NotFound,
  ParseError,
  problem,
  status,
  ValidationError,
} from "elysia";

export const ERROR_STATUS = {
  VALIDATION_ERROR: 422,
  KEY_NOT_FOUND: 404,
  INVALID_KEY: 422,
  BUCKET_NOT_FOUND: 404,
  BUCKET_ALREADY_EXIST: 409,
  BUCKET_NOT_EMPTY: 409,
  FS_ERROR: 500,
  INVALID_API_KEY: 401,
  KEY_NOT_CAPABLE: 403,
  KEY_SCOPE_MISMATCH: 403,
  UNKNOWN: 500,
} as const satisfies Record<Buns3AnyErrorCode, number>;

export const useErrorHandler = new Elysia({
  name: "buns3ErrorHandler",
  as: "global",
})
  .error(Buns3Error, ({ set, error }) => {
    if (error.code === "INVALID_API_KEY") {
      set.headers["WWW-Authenticate"] = "Bearer";
    }

    return problem(ERROR_STATUS[error.code], { code: error.code });
  })
  .error(Buns3ValidationError, ({ error }) => {
    return problem(ERROR_STATUS[error.code], {
      code: "VALIDATION_ERROR",
      detail: error.errors.summary,
    });
  })
  .error(ValidationError, ({ error }) => {
    return problem(422, {
      code: "VALIDATION_ERROR",
      detail: error.message,
    });
  })
  .error(ParseError, ({ error }) => {
    return problem(400, {
      code: "MALFORMED_BODY",
      detail:
        (error.cause as Error | undefined)?.message ??
        "Failed to parse request body",
    });
  })
  .error(NotFound, ({ request }) => {
    return problem(404, {
      code: "NOT_FOUND",
      detail: `No route for ${request.method} ${new URL(request.url).pathname}`,
    });
  })
  .error(InternalServerError, ({ error }) => {
    const ref = crypto.randomUUID().substring(0, 8);
    console.error(ref, error);

    return problem(500, {
      code: "UNKNOWN",
      detail: `An unexpected error occurred (ref: ${ref})`,
    });
  })
  .error(({ error }) => {
    const ref = crypto.randomUUID().substring(0, 8);
    console.error(ref, error);

    return problem(500, {
      code: "UNKNOWN",
      detail: `An unexpected error occurred (ref: ${ref})`,
    });
  });
