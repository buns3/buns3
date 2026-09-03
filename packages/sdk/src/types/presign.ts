import type { PresignHTTPMethod } from "../lib/presign";

/** What to presign. Used by both the offline signer and POST `/_self/presign`. */
export interface PresignOptions {
  method: PresignHTTPMethod;
  bucket: string;
  /** Raw, unencoded. */
  key: string;
  /** Lifetime in seconds. The server caps it at 604800 (7 days). */
  ttl: number;
}

export interface PresignResponse {
  url: string;
  /** Absolute unix timestamp, not the ttl it was built from. */
  expires: number;
}
