import { strictEncode, uriEncodedKey } from "./encoding";

type StripStar<N extends string> = N extends `${infer Name}*` ? Name : N;

export type ExtractParams<Path extends string> =
  Path extends `${string}:${infer Param}/${infer Rest}`
    ? { [K in StripStar<Param>]: string } & ExtractParams<`/${Rest}`>
    : Path extends `${string}:${infer Param}`
      ? { [K in StripStar<Param>]: string }
      : {};

// Flatten the intersection into a plain object type for nicer hover output
export type Simplify<T> = { [K in keyof T]: T[K] } & {};

export type Params<Path extends string> = Simplify<ExtractParams<Path>>;

/**
 * Fill a path template with params.
 *
 *   :name   single segment, `/` in the value is escaped to %2F
 *   :name*  multi-segment (S3-style key), `/` in the value is preserved
 */
export function route<P extends string>(path: P, params: Params<P>): string {
  const lookup = params as Record<string, string | undefined>;

  return path.replace(/:(\w+)(\*)?/g, (_, name: string, multi?: string) => {
    const value = lookup[name];
    if (value === undefined) {
      // a missing path param is a programmer error the types already make unreachable
      throw new Error(`Missing param "${name}" for path "${path}"`);
    }
    return multi ? uriEncodedKey(value) : strictEncode(value);
  });
}
