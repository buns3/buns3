import { toHex, uriEncodedKey } from "./encoding";

const IDENTIFIER = "buns3-presign-v1";

export const PRESIGN_HTTP_METHODS = ["DELETE", "GET", "HEAD", "PUT"] as const;

export type PresignHTTPMethod = (typeof PRESIGN_HTTP_METHODS)[number];

export interface CanonicalStringOptions {
  method: PresignHTTPMethod;
  bucket: string;
  key: string;
  expires: number;
}

export interface SignOptions extends CanonicalStringOptions {
  tokenHash: string;
}

export interface PresignOptions {
  method: PresignHTTPMethod;
  bucket: string;
  key: string;
  ttl: number;
}

async function hmacHex(keyString: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(keyString),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );
  return toHex(new Uint8Array(sig));
}

function canonicalString(opts: CanonicalStringOptions) {
  // canonical strings -> "buns3-presign-v1\n" + method + "\n" + bucket + "\n" + key + \n + expires
  return `${IDENTIFIER}\n${opts.method}\n${opts.bucket}\n${opts.key}\n${opts.expires}`;
}

export async function hashToken(token: string) {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return toHex(new Uint8Array(buf));
}

export async function deriveKeyId(tokenHash: string) {
  return hmacHex(tokenHash, IDENTIFIER);
}

export async function sign(opts: SignOptions) {
  const { tokenHash, ...rest } = opts;
  return await hmacHex(tokenHash, canonicalString(rest));
}

export function buildPresignedUrl(
  base: string,
  bucket: string,
  key: string,
  { keyId, expires, sig }: { keyId: string; expires: number; sig: string },
) {
  const encodedKey = uriEncodedKey(key);

  const searchParams = `keyId=${keyId}&expires=${expires}&sig=${sig}`;

  return `${base}/${bucket}/${encodedKey}?${searchParams}`;
}
