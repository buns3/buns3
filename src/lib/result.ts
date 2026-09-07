import type { Buns3AnyErrorCode } from "./error-codes";

export type Result<T, C extends Buns3AnyErrorCode = Buns3AnyErrorCode> =
  | {
      success: true;
      data: T;
    }
  | {
      success: false;
      code: C;
    };
