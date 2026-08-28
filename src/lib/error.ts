// Framework-free on purpose: no Elysia imports. Rendering (status table, .error registrations) lives in the HTTP layer.

import type { type } from "arktype";
import type {
  Buns3AnyErrorCode,
  Buns3ValidationErrorCode,
} from "./error-codes";

export type Buns3ResultLike =
  | {
      success: true;
    }
  | { success: false; code: Buns3AnyErrorCode };

export class Buns3Error extends Error {
  code: Buns3AnyErrorCode;

  constructor(code: Buns3AnyErrorCode, options?: ErrorOptions) {
    super(code, options);
    this.name = new.target.name;
    this.code = code;
  }

  static fromResult(
    result: Extract<Buns3ResultLike, { success: false }>,
    options?: ErrorOptions,
  ) {
    return new Buns3Error(result.code, options);
  }
}

export class Buns3ValidationError extends Error {
  code: Buns3ValidationErrorCode;
  errors: type.errors;

  constructor(errors: type.errors, options?: ErrorOptions) {
    super("VALIDATION_ERROR", options);
    this.name = new.target.name;
    this.code = "VALIDATION_ERROR";
    this.errors = errors;
  }
}

export function unwrap<TResult extends Buns3ResultLike>(
  result: TResult,
): Extract<TResult, { success: true }> {
  if (!result.success) throw Buns3Error.fromResult(result);
  return result as Extract<TResult, { success: true }>;
}
