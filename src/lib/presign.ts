const IDENTIFIER = "buns3-presign-v1";

export const PRESIGN_METHODS = ["GET", "HEAD", "PUT", "DELETE"] as const;
export type PresignMethod = (typeof PRESIGN_METHODS)[number];

export type PresignVerifyResultReason = "expired" | "mismatch";
export type PresignVerifyResult =
  { valid: true } | { valid: false; reason: PresignVerifyResultReason };

export type CanonicalStringOptions = {
  method: PresignMethod;
  bucket: string;
  key: string;
  expires: number;
};

export type SignOptions = CanonicalStringOptions & {
  tokenHash: string;
};

export type VerifyOptions = CanonicalStringOptions & {
  sig: string;
  tokenHash: string;
  now: number;
};

export function hashToken(token: string) {
  return new Bun.CryptoHasher("sha256").update(token).digest("hex");
}

export function isPresignMethod(method: string): method is PresignMethod {
  return (PRESIGN_METHODS as readonly string[]).includes(method);
}

export function deriveKeyId(tokenHash: string) {
  return new Bun.CryptoHasher("sha256", tokenHash)
    .update(IDENTIFIER)
    .digest("hex");
}

export function canonicalString(opts: CanonicalStringOptions) {
  // canonical strings -> "buns3-presign-v1\n" + method + "\n" + bucket + "\n" + key + \n + expires
  return `${IDENTIFIER}\n${opts.method}\n${opts.bucket}\n${opts.key}\n${opts.expires}`;
}

export function sign(opts: SignOptions) {
  const { tokenHash, ...canonicalOpts } = opts;
  const canonical = canonicalString(canonicalOpts);

  return new Bun.CryptoHasher("sha256", tokenHash)
    .update(canonical)
    .digest("hex");
}

export function verify(opts: VerifyOptions): PresignVerifyResult {
  const { now, sig, ...rest } = opts;

  if (now > rest.expires) {
    return {
      valid: false,
      reason: "expired",
    };
  }

  // this gates timingSafeEqual from throwing if lengths are mismatched - Buffer.from() truncates silently
  if (!/^[0-9a-f]{64}$/.test(sig)) {
    return {
      valid: false,
      reason: "mismatch",
    };
  }

  const expected = Buffer.from(sign(rest), "hex");
  const provided = Buffer.from(sig, "hex");

  if (!crypto.timingSafeEqual(provided, expected)) {
    return {
      valid: false,
      reason: "mismatch",
    };
  }

  return {
    valid: true,
  };
}

export function buildPresignedUrl(
  base: string,
  bucket: string,
  key: string,
  { keyId, expires, sig }: { keyId: string; expires: number; sig: string },
) {
  const keyArr = key.split("/");
  const encodedKey = keyArr.map(encodeURIComponent).join("/");
  const url = new URL(`/${bucket}/${encodedKey}`, base);
  url.searchParams.set("keyId", keyId);
  url.searchParams.set("expires", expires.toString());
  url.searchParams.set("sig", sig);

  return url.href;
}
