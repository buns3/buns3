import { deriveKeyId, hashToken, PRESIGN_METHODS, sign } from "$/lib/presign";
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
  ttl: type("string.integer.parse").to("0 <= number.integer <= 999999999999"),
})(values);

if (validated instanceof type.errors) {
  console.warn(validated.summary);
  process.exit(2);
}

const tokenHash = hashToken(validated.token);
const keyId = deriveKeyId(tokenHash);
const expires = Math.floor(Date.now() / 1000) + validated.ttl;
const sig = sign({
  tokenHash,
  bucket: validated.bucket,
  key: validated.key,
  method: validated.method,
  expires,
});

const keyArr = validated.key.split("/");
const key = keyArr.map(encodeURIComponent).join("/");

const url = new URL(
  `/${validated.bucket}/${key}`,
  process.env.BASE_URL ?? "http://localhost:8000",
);

url.searchParams.set("keyId", keyId);
url.searchParams.set("expires", expires.toString());
url.searchParams.set("sig", sig);

console.log(url.href);
console.log(
  "expires:",
  new Date(expires * 1000).toISOString(),
  `(in ${validated.ttl}s)`,
);
