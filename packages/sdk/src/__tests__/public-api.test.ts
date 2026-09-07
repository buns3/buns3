import { describe, expect, test } from "bun:test";
import * as sdk from "../index";

// What the index exports IS the package: a function that exists in src but is
// not re-exported here does not exist for a consumer, and nothing else notices.
// `signUpload` and `buildUploadPresignedUrl` shipped missing in 0.2.1 exactly
// this way — the offline session signer was unreachable from npm.

const OFFLINE_SIGNER: string[] = [
  "hashToken",
  "deriveKeyId",
  "sign",
  "signUpload",
  "buildPresignedUrl",
  "buildUploadPresignedUrl",
];

const CLIENTS: string[] = ["Buns3Client", "Buns3AdminClient", "Buns3BaseClient"];

const PLANES: string[] = [
  "createObjects",
  "createUpload",
  "createSelf",
  "createServer",
  "createPresigned",
  "createAdmin",
  "createAdminBuckets",
  "createAdminKeys",
];

describe("public API", () => {
  test.each(OFFLINE_SIGNER)("%s is exported — presigning offline needs all of it", (name) => {
    expect(typeof (sdk as Record<string, unknown>)[name]).toBe("function");
  });

  test.each(CLIENTS)("%s is exported", (name) => {
    expect(typeof (sdk as Record<string, unknown>)[name]).toBe("function");
  });

  test.each(PLANES)("%s is exported, for callers building their own client", (name) => {
    expect(typeof (sdk as Record<string, unknown>)[name]).toBe("function");
  });

  test("a session can be signed end to end using only the public surface", () => {
    // The browser case: mint a URL with nothing but what npm ships.
    const uploadId = "6f1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d";
    const url = sdk.buildUploadPresignedUrl("https://x.example", uploadId, {
      keyId: "k",
      expires: 1_800_000_000,
      sig: "s",
    });
    expect(url).toBe(
      `https://x.example/_uploads/${uploadId}?keyId=k&expires=1800000000&sig=s`,
    );
  });

  test("the error-code tables are exported, since callers narrow on them", () => {
    expect(Array.isArray(sdk.ERROR_CODES)).toBe(true);
    expect(Array.isArray(sdk.CLIENT_ERROR_CODES)).toBe(true);
  });
});
