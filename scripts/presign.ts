import {
  buildPresignedUrl,
  deriveKeyId,
  hashToken,
  PRESIGN_METHODS,
  sign,
} from "$/lib/presign";
import { ApiKeyToken } from "$/modules/validation/api-key";
import { BucketName } from "$/modules/validation/bucket";
import { Key } from "$/modules/validation/object";
import { type } from "arktype";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  strict: true,
  options: {
    help: {
      type: "boolean",
      short: "h",
    },
    token: {
      type: "string",
      short: "t",
    },
    method: {
      type: "string",
      short: "m",
      default: "GET",
    },
    bucket: {
      type: "string",
      short: "b",
    },
    key: {
      type: "string",
      short: "k",
    },
    ttl: {
      type: "string",
      default: "3600",
    },
  },
});

if (values.help) {
  console.log(`Usage:
      --token  -t   API key token
      --method -m   GET | HEAD | PUT | DELETE (default GET)
      --bucket -b   Bucket name
      --key    -k   Object key (raw, decoded form)
      --ttl         Seconds until expiry (default 3600)
  `);
  process.exit(0);
}

const validated = type({
  token: ApiKeyToken,
  key: Key,
  bucket: BucketName,
  method: type.enumerated(...PRESIGN_METHODS),
  ttl: type("string.integer.parse").to("0 <= number.integer <= 604800"),
})(values);

if (validated instanceof type.errors) {
  console.warn(validated.summary);
  process.exit(2);
}

const expires = Math.floor(Date.now() / 1000) + validated.ttl;
const tokenHash = hashToken(validated.token);
const keyId = deriveKeyId(tokenHash);
const sig = sign({
  tokenHash,
  bucket: validated.bucket,
  key: validated.key,
  method: validated.method,
  expires,
});

const url = buildPresignedUrl(
  process.env.BASE_URL ?? "http://localhost:8000",
  validated.bucket,
  validated.key,
  {
    expires,
    keyId,
    sig,
  },
);

console.log(url);
console.log(
  "expires:",
  new Date(expires * 1000).toISOString(),
  `(in ${validated.ttl}s)`,
);
