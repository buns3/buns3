import type { AuthKind } from "../auth/types";

// Short because object keys are MUTABLE — an overwrite changes content at the
// same URL, so this is exactly how long a stale copy can be served. `no-cache`
// (revalidate every time) would be better, but the server does not answer
// If-None-Match with a 304 (probed), so revalidation would re-send the body.
export const PUBLIC_MAX_AGE = 60;

export const CACHE_CONTROL = {
  anonymous: `public, max-age=${PUBLIC_MAX_AGE}`,
  key: "private, no-store",
  presign: "private, no-store",
} as const satisfies Record<AuthKind, string>;
