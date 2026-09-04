/**
 * The wire contract, grouped by resource. Hand-written: the OpenAPI document
 * excludes the data plane, so these cannot be generated.
 *
 * `Result` lives in ../result, next to its helpers.
 */
export type * from "./api-key";
export type * from "./bucket";
export type * from "./object";
export type * from "./presign";
export type * from "./server";
