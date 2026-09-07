import { beforeEach, describe, expect, test } from "bun:test";
import { createServer } from "../server";
import {
  resetStorage,
  seedBucket,
  seedKey,
  seedObject,
} from "../../../../test/helpers";

import { createHttp } from "../../../../packages/sdk/src/http";
import { createObjects } from "../../../../packages/sdk/src/planes/objects";
import { createSelf } from "../../../../packages/sdk/src/planes/self";
import { createUpload } from "../../../../packages/sdk/src/planes/upload";
import { createAdmin } from "../../../../packages/sdk/src/planes/admin";
import { createPresigned } from "../../../../packages/sdk/src/planes/presigned";
import {
  buildPresignedUrl,
  buildUploadPresignedUrl,
  signUpload,
  deriveKeyId,
  hashToken,
  sign,
} from "../../../../packages/sdk/src/lib/presign";
import { ERROR_CODES } from "../../../../packages/sdk/src/lib/error";
import { createServer as createServerPlane } from "../../../../packages/sdk/src/planes/server";
import { version as SDK_VERSION } from "../../../../packages/sdk/package.json";

import { ALL_ERROR_CODES } from "$/lib/error-codes";

// The SDK talking to the REAL server, with no socket: createHttp's injected
// fetch hands the Request straight to app.handle(). Everything else in the
// SDK suite is fake-driven, so this is the only thing that can catch the two
// halves disagreeing about the wire.
//
// LIMITATION worth knowing: `new Request(url)` NORMALISES the URL — a raw
// space becomes %20 and ü becomes %C3%BC (probed). So if the SDK stopped
// encoding paths entirely, this harness would silently repair most of it and
// the tests would still pass. Client-side encoding is pinned instead by the
// SDK's frozen anchor table, which was generated from the server's own
// encoder. A real socket would not be so forgiving.

const BASE = "http://buns3.test";
const app = createServer();

const sdk = (token?: string) =>
  createHttp(BASE, {
    token,
    retry: false,
    fetch: (input, init) => app.handle(new Request(input as string, init)),
  });

beforeEach(resetStorage);

describe("error codes agree across the boundary", () => {
  test("the SDK's code set is exactly the server's", () => {
    // The SDK cannot import the server, so it keeps a copy. This is the half
    // that notices when the server grows a code the SDK has never heard of —
    // which would surface to consumers as UNKNOWN.
    // ALL_ERROR_CODES is compiler-checked against Buns3AnyErrorCode, so a new
    // code FAMILY cannot slip past this the way UPLOAD_ERROR_CODES once did.
    expect(new Set(ERROR_CODES)).toEqual(new Set(ALL_ERROR_CODES));
  });
});

describe("objects round-trip through the SDK", () => {
  test("put then get returns the same bytes, with the server's Location", async () => {
    await seedBucket("dev");
    const { token } = await seedKey({
      name: "rw",
      bucketName: "dev",
      canRead: true,
      canWrite: true,
    });
    const objects = createObjects(sdk(token));

    const put = await objects.put("dev", "a.txt", "hello", {
      contentType: "text/plain",
    });
    expect(put.success).toBe(true);
    if (!put.success) return;
    expect(put.data).toMatchObject({ bucket: "dev", key: "a.txt" });
    expect(put.data.location).toBe("/dev/a.txt");

    const got = await objects.get("dev", "a.txt");
    expect(got.success && (await got.data.text())).toBe("hello");
  });

  test("keys with %, spaces and empty segments survive the round trip", async () => {
    // The SDK encodes once for the path; the server decodes once. This is the
    // pair that a frozen anchor table can only half-verify.
    await seedBucket("dev");
    const { token } = await seedKey({
      name: "rw",
      bucketName: "dev",
      canRead: true,
      canWrite: true,
    });
    const objects = createObjects(sdk(token));

    for (const key of ["a/b c/100%.txt", "a//b", "sdk/ü/日本.txt", "trail/"]) {
      const put = await objects.put("dev", key, key, {
        contentType: "text/plain",
      });
      expect(put.success).toBe(true);
      const got = await objects.get("dev", key);
      expect(got.success && (await got.data.text())).toBe(key);
    }
  });

  test("head's etag equals the etag the listing reports", async () => {
    // head unquotes; listings send the bare blob id. They must agree or a
    // consumer comparing them would always see a mismatch.
    await seedBucket("dev");
    await seedObject("dev", "a.txt");
    const { token } = await seedKey({
      name: "r",
      bucketName: "dev",
      canRead: true,
    });
    const objects = createObjects(sdk(token));

    const head = await objects.head("dev", "a.txt");
    const list = await objects.list("dev");
    expect(head.success && list.success).toBe(true);
    if (!head.success || !list.success) return;
    expect(head.data.etag).toBe(list.data.objects[0]!.etag);
    expect(head.data.size).toBe(list.data.objects[0]!.size);
  });

  test("list filters reach the server and come back echoed", async () => {
    await seedBucket("dev");
    for (const key of ["a/1", "a/2", "b/1"]) await seedObject("dev", key);
    const { token } = await seedKey({
      name: "r",
      bucketName: "dev",
      canRead: true,
    });
    const objects = createObjects(sdk(token));

    const res = await objects.list("dev", { prefix: "a/", limit: 10 });
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data.objects.map((o) => o.key)).toEqual(["a/1", "a/2"]);
    expect(res.data.filters).toMatchObject({ prefix: "a/", limit: 10 });
  });

  test("limit: 0 reaches the server and earns its 422", async () => {
    // The SDK deliberately does not validate; this proves the server does.
    await seedBucket("dev");
    const { token } = await seedKey({
      name: "r",
      bucketName: "dev",
      canRead: true,
    });
    const res = await createObjects(sdk(token)).list("dev", { limit: 0 });
    expect(res).toMatchObject({ success: false, status: 422 });
  });

  test("deleteMany reports missing keys per key, in request order", async () => {
    await seedBucket("dev");
    await seedObject("dev", "here.txt");
    const { token } = await seedKey({
      name: "rw",
      bucketName: "dev",
      canRead: true,
      canWrite: true,
    });

    const res = await createObjects(sdk(token)).deleteMany("dev", [
      "gone.txt",
      "here.txt",
    ]);
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data.summary).toEqual({ deleted: 1, missing: 1 });
    expect(res.data.results.map((r) => r.key)).toEqual([
      "gone.txt",
      "here.txt",
    ]);
    expect(res.data.results[0]).toMatchObject({
      success: false,
      code: "KEY_NOT_FOUND",
    });
  });

  test("delete returns void and a repeat delete is an honest 404", async () => {
    await seedBucket("dev");
    await seedObject("dev", "a.txt");
    const { token } = await seedKey({
      name: "rw",
      bucketName: "dev",
      canRead: true,
      canWrite: true,
    });
    const objects = createObjects(sdk(token));

    expect(await objects.delete("dev", "a.txt")).toEqual({
      success: true,
      data: undefined,
    });
    expect(await objects.delete("dev", "a.txt")).toMatchObject({
      success: false,
      status: 404,
      code: "KEY_NOT_FOUND",
    });
  });
});

describe("failures map to the codes the SDK narrows on", () => {
  test.each([
    ["no token", undefined, 401, "INVALID_API_KEY"],
    ["unknown token", "buns3_notarealtokenatall", 401, "INVALID_API_KEY"],
  ] as const)("%s", async (_, token, status, code) => {
    await seedBucket("dev");
    await seedObject("dev", "a.txt");
    const res = await createObjects(sdk(token)).get("dev", "a.txt");
    expect(res).toMatchObject({ success: false, status, code });
  });

  test("a wrong-bucket key is a scope mismatch, without disclosing existence", async () => {
    await seedBucket("dev");
    await seedBucket("other");
    const { token } = await seedKey({
      name: "r",
      bucketName: "other",
      canRead: true,
    });
    const res = await createObjects(sdk(token)).get("dev", "nope.txt");
    expect(res).toMatchObject({
      success: false,
      status: 403,
      code: "API_KEY_SCOPE_MISMATCH",
    });
  });

  test("a malformed bucket name is 422 before auth even runs", async () => {
    const res = await createObjects(sdk()).get("BAD_NAME", "a.txt");
    expect(res).toMatchObject({ success: false, status: 422 });
  });

  test("anonymous reads a public bucket, and is refused on a private one", async () => {
    await seedBucket("pub", { publicRead: true });
    await seedObject("pub", "a.txt", "public bytes");
    await seedBucket("priv");
    await seedObject("priv", "a.txt");
    const objects = createObjects(sdk());

    const ok = await objects.get("pub", "a.txt", { anonymous: true });
    expect(ok.success && (await ok.data.text())).toBe("public bytes");

    const denied = await objects.get("priv", "a.txt", { anonymous: true });
    expect(denied).toMatchObject({ success: false, status: 401 });
  });
});

describe("self plane", () => {
  test("whoami returns the presented key, booleans and all", async () => {
    await seedBucket("dev");
    const { token, apiKey } = await seedKey({
      name: "rw",
      bucketName: "dev",
      canRead: true,
      canWrite: true,
    });

    const res = await createSelf(sdk(token)).whoami();
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data.apiKey).toMatchObject({
      id: apiKey.id,
      name: "rw",
      bucketName: "dev",
      canRead: true,
      canWrite: true,
      isAdmin: false,
    });
  });

  test("server-validated presign refuses what the key could not do itself", async () => {
    await seedBucket("dev");
    await seedBucket("other");
    const { token } = await seedKey({
      name: "r",
      bucketName: "dev",
      canRead: true,
    });

    const res = await createSelf(sdk(token)).presign({
      method: "GET",
      bucket: "other",
      key: "a.txt",
      ttl: 60,
    });
    expect(res).toMatchObject({
      success: false,
      status: 403,
      code: "API_KEY_SCOPE_MISMATCH",
    });
  });
});

describe("the offline signer is accepted by the server", () => {
  test.each(["a.txt", "a b/100%.txt", "sdk/ü/日本.txt"])(
    "a URL signed with WebCrypto for %j, never seen by the server, returns the object",
    async (key) => {
      // The headline SDK feature: signed locally from the token, verified by an
      // independent HMAC on the server. The keys with a space, a percent and
      // non-ASCII are load-bearing — the signature covers the RAW key while the
      // URL carries the encoded one, so signing the encoded form would still
      // produce a valid-looking URL that fails verification.
      await seedBucket("dev");
      await seedObject("dev", key, "signed bytes");
      const { token } = await seedKey({
        name: "r",
        bucketName: "dev",
        canRead: true,
      });

      const tokenHash = await hashToken(token);
      const expires = Math.floor(Date.now() / 1000) + 300;
      const url = buildPresignedUrl(BASE, "dev", key, {
        keyId: await deriveKeyId(tokenHash),
        expires,
        sig: await sign({
          tokenHash,
          method: "GET",
          bucket: "dev",
          key,
          expires,
        }),
      });

      const res = await createPresigned(sdk()).get(url);
      expect(res.success).toBe(true);
      if (!res.success) return;
      expect(await res.data.text()).toBe("signed bytes");
    },
  );

  test("offline and server-validated signing produce the same signature", async () => {
    // Two implementations of one HMAC only stay honest if something compares
    // them for identical inputs.
    await seedBucket("dev");
    await seedObject("dev", "a.txt");
    const { token } = await seedKey({
      name: "r",
      bucketName: "dev",
      canRead: true,
    });

    const server = await createSelf(sdk(token)).presign({
      method: "GET",
      bucket: "dev",
      key: "a.txt",
      ttl: 300,
    });
    expect(server.success).toBe(true);
    if (!server.success) return;

    const tokenHash = await hashToken(token);
    const mine = buildPresignedUrl(BASE, "dev", "a.txt", {
      keyId: await deriveKeyId(tokenHash),
      expires: server.data.expires,
      sig: await sign({
        tokenHash,
        method: "GET",
        bucket: "dev",
        key: "a.txt",
        expires: server.data.expires,
      }),
    });

    // Compare the credential, not the whole URL: the host is deliberately NOT
    // part of the signature, so the server mints against its own BASE_URL
    // while the offline signer uses whatever origin it was given.
    const theirs = new URL(server.data.url).searchParams;
    const ours = new URL(mine).searchParams;
    expect(ours.get("sig")).toBe(theirs.get("sig"));
    expect(ours.get("keyId")).toBe(theirs.get("keyId"));
    expect(ours.get("expires")).toBe(theirs.get("expires"));
  });

  test("a URL minted for one host verifies against another", async () => {
    // The consequence of not signing the host: a URL minted against localhost
    // works through a tunnel or a CDN unchanged. S3 signs the host; buns3
    // deliberately does not.
    await seedBucket("dev");
    await seedObject("dev", "a.txt", "portable");
    const { token } = await seedKey({
      name: "r",
      bucketName: "dev",
      canRead: true,
    });

    const tokenHash = await hashToken(token);
    const expires = Math.floor(Date.now() / 1000) + 300;
    const parts = {
      keyId: await deriveKeyId(tokenHash),
      expires,
      sig: await sign({
        tokenHash,
        method: "GET",
        bucket: "dev",
        key: "a.txt",
        expires,
      }),
    };

    const elsewhere = buildPresignedUrl(
      "https://cdn.example.com",
      "dev",
      "a.txt",
      parts,
    );
    const res = await createPresigned(sdk()).get(
      elsewhere.replace("https://cdn.example.com", BASE),
    );
    expect(res.success && (await res.data.text())).toBe("portable");
  });

  test("an expired signature is refused with its own code", async () => {
    await seedBucket("dev");
    await seedObject("dev", "a.txt");
    const { token } = await seedKey({
      name: "r",
      bucketName: "dev",
      canRead: true,
    });

    const tokenHash = await hashToken(token);
    const expires = Math.floor(Date.now() / 1000) - 10;
    const url = buildPresignedUrl(BASE, "dev", "a.txt", {
      keyId: await deriveKeyId(tokenHash),
      expires,
      sig: await sign({
        tokenHash,
        method: "GET",
        bucket: "dev",
        key: "a.txt",
        expires,
      }),
    });

    expect(await createPresigned(sdk()).get(url)).toMatchObject({
      success: false,
      status: 401,
      code: "PRESIGNED_EXPIRED",
    });
  });

  test("a signature is bound to its method — a GET URL is not a HEAD URL", async () => {
    await seedBucket("dev");
    await seedObject("dev", "a.txt");
    const { token } = await seedKey({
      name: "r",
      bucketName: "dev",
      canRead: true,
    });

    const tokenHash = await hashToken(token);
    const expires = Math.floor(Date.now() / 1000) + 300;
    const url = buildPresignedUrl(BASE, "dev", "a.txt", {
      keyId: await deriveKeyId(tokenHash),
      expires,
      sig: await sign({
        tokenHash,
        method: "GET",
        bucket: "dev",
        key: "a.txt",
        expires,
      }),
    });

    const presigned = createPresigned(sdk());
    expect((await presigned.get(url)).success).toBe(true);
    expect(await presigned.head(url)).toMatchObject({
      success: false,
      status: 401,
    });
  });
});

describe("admin plane", () => {
  test("bucket lifecycle through the SDK", async () => {
    const { token } = await seedKey({ name: "admin", isAdmin: true });
    const admin = createAdmin(sdk(token));

    const created = await admin.buckets.create("made");
    expect(created.success).toBe(true);
    if (!created.success) return;
    expect(created.data.bucket).toMatchObject({
      name: "made",
      publicRead: false,
      objects: 0,
    });
    expect(created.data.location).toBe("/made");

    const patched = await admin.buckets.update("made", { publicRead: true });
    expect(patched.success && patched.data.bucket.publicRead).toBe(true);

    expect(await admin.buckets.delete("made")).toEqual({
      success: true,
      data: undefined,
    });
  });

  test("a non-empty bucket refuses deletion", async () => {
    await seedBucket("full");
    await seedObject("full", "a.txt");
    const { token } = await seedKey({ name: "admin", isAdmin: true });

    expect(await createAdmin(sdk(token)).buckets.delete("full")).toMatchObject({
      success: false,
      status: 409,
      code: "BUCKET_NOT_EMPTY",
    });
  });

  test("key creation returns a token that then authenticates", async () => {
    await seedBucket("dev");
    const { token: adminToken } = await seedKey({
      name: "admin",
      isAdmin: true,
    });

    const created = await createAdmin(sdk(adminToken)).keys.create({
      name: "minted",
      bucketName: "dev",
      canRead: true,
      canWrite: false,
      isAdmin: false,
    });
    expect(created.success).toBe(true);
    if (!created.success) return;

    const who = await createSelf(sdk(created.data.token)).whoami();
    expect(who.success && who.data.apiKey?.name).toBe("minted");
  });

  test("a data key is refused on the admin plane", async () => {
    await seedBucket("dev");
    const { token } = await seedKey({
      name: "r",
      bucketName: "dev",
      canRead: true,
    });

    expect(await createAdmin(sdk(token)).buckets.list()).toMatchObject({
      success: false,
      status: 403,
    });
  });
});

describe("the server plane", () => {
  test("reports the version the SDK itself ships with", async () => {
    // test/version.test.ts pins that the two manifests agree. This is the same
    // invariant from where a consumer stands: what arrives over the wire is
    // what the installed package claims to be.
    const { token } = await seedKey({ name: "admin", isAdmin: true });

    const res = await createServerPlane(sdk(token)).get();
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data.version).toBe(SDK_VERSION);
  });

  test("the response is exactly { version }", async () => {
    // An earlier draft returned { full, major, minor, patch }, where a
    // prerelease tag serialised patch to null. toEqual is exact, so going back
    // to that shape fails here rather than in a consumer.
    const { token } = await seedKey({ name: "admin", isAdmin: true });

    const res = await createServerPlane(sdk(token)).get();
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data).toEqual({ version: expect.any(String) });
  });

  test("any valid key reaches it, not just admin", async () => {
    // It lived on /_admin first. A data key must be able to ask what it is
    // talking to, or the SDK could never use this.
    await seedBucket("dev");
    const { token } = await seedKey({
      name: "reader",
      bucketName: "dev",
      canRead: true,
    });

    expect(await createServerPlane(sdk(token)).get()).toMatchObject({
      success: true,
    });
  });

  test.each([
    ["no token", undefined],
    ["unknown token", "buns3_notarealtokenatall"],
  ])("%s gets 401 INVALID_API_KEY", async (_label, token) => {
    // The build is not advertised to anonymous callers.
    expect(await createServerPlane(sdk(token)).get()).toMatchObject({
      success: false,
      status: 401,
      code: "INVALID_API_KEY",
    });
  });
});

describe("chunked uploads through the SDK", () => {
  test("a multi-chunk file arrives whole, and reads back through the data plane", async () => {
    await seedBucket("dev");
    const { token } = await seedKey({
      name: "rw",
      bucketName: "dev",
      canRead: true,
      canWrite: true,
    });
    const objects = createObjects(sdk(token));

    const body = new Blob(["chunk one|chunk two|chunk three"]);
    const res = await objects.putChunked("dev", "big/file.txt", body, {
      contentType: "text/plain",
      chunkSize: 10,
    });

    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data).toMatchObject({ bucket: "dev", key: "big/file.txt" });
    expect(res.data.location).toBe("/dev/big/file.txt");

    const got = await objects.get("dev", "big/file.txt");
    expect(got.success && (await got.data.text())).toBe("chunk one|chunk two|chunk three");
  });

  test("completing answers the same shape a plain put does", async () => {
    // The whole point: a caller can treat the two paths as one operation.
    await seedBucket("dev");
    const { token } = await seedKey({ name: "rw", bucketName: "dev", canRead: true, canWrite: true });
    const objects = createObjects(sdk(token));

    const chunked = await objects.putChunked("dev", "a.txt", new Blob(["hello"]), { chunkSize: 2 });
    const plain = await objects.put("dev", "b.txt", "hello", { contentType: "text/plain" });

    expect(chunked.success && Object.keys(chunked.data).sort()).toEqual(
      plain.success ? Object.keys(plain.data).sort() : [],
    );
  });

  test("a resumed session continues from the server's recorded size", async () => {
    // The offset the server reports is the truth; a client that lost track
    // asks for it rather than assuming.
    await seedBucket("dev");
    const { token } = await seedKey({ name: "rw", bucketName: "dev", canRead: true, canWrite: true });
    const uploads = createUpload(sdk(token));

    const created = await uploads.create({ bucket: "dev", key: "resumed.txt" });
    expect(created.success).toBe(true);
    if (!created.success) return;
    const { uploadId } = created.data.upload;

    await uploads.append(uploadId, new Blob(["first "]), 0);

    const asked = await uploads.get(uploadId);
    expect(asked.success && asked.data.upload.size).toBe(6);

    await uploads.append(uploadId, new Blob(["second"]), 6);
    expect((await uploads.complete(uploadId)).success).toBe(true);

    const got = await createObjects(sdk(token)).get("dev", "resumed.txt");
    expect(got.success && (await got.data.text())).toBe("first second");
  });

  test("a stale offset is refused, and the SDK reports the server's code", async () => {
    await seedBucket("dev");
    const { token } = await seedKey({ name: "rw", bucketName: "dev", canRead: true, canWrite: true });
    const uploads = createUpload(sdk(token));

    const created = await uploads.create({ bucket: "dev", key: "conflict.txt" });
    if (!created.success) return;
    const { uploadId } = created.data.upload;
    await uploads.append(uploadId, new Blob(["abc"]), 0);

    const stale = await uploads.append(uploadId, new Blob(["xyz"]), 0);
    expect(stale).toMatchObject({ success: false, status: 409, code: "OFFSET_MISMATCH" });
  });

  test("an SDK-signed session URL is accepted by the server", async () => {
    // The offline signer again, this time over a session: one URL carries
    // every chunk, and nothing on the request identifies the key.
    await seedBucket("dev");
    const { token } = await seedKey({ name: "rw", bucketName: "dev", canRead: true, canWrite: true });
    const uploads = createUpload(sdk(token));

    const created = await uploads.create({ bucket: "dev", key: "signed.txt" });
    if (!created.success) return;
    const { uploadId } = created.data.upload;

    const tokenHash = await hashToken(token);
    const expires = Math.floor(Date.now() / 1000) + 600;
    const url = buildUploadPresignedUrl(BASE, uploadId, {
      keyId: await deriveKeyId(tokenHash),
      expires,
      sig: await signUpload({ tokenHash, uploadId, expires }),
    });

    // The plane builds its own paths, so a caller holding a signed URL uses it
    // directly — which is exactly what a browser does.
    const direct = await app.handle(new Request(url, { method: "PATCH", body: "signed bytes" }));
    expect(direct.status).toBe(200);

    const done = await app.handle(new Request(`${url.replace("?", "/complete?")}`, { method: "POST" }));
    expect(done.status).toBe(201);

    const got = await createObjects(sdk(token)).get("dev", "signed.txt");
    expect(got.success && (await got.data.text())).toBe("signed bytes");
  });

  test("the server minted URL and the SDK signed one are the same signature", async () => {
    await seedBucket("dev");
    const { token } = await seedKey({ name: "rw", bucketName: "dev", canRead: true, canWrite: true });
    const uploads = createUpload(sdk(token));

    const created = await uploads.create({ bucket: "dev", key: "same.txt" });
    if (!created.success) return;
    const { uploadId } = created.data.upload;

    const minted = await uploads.presign(uploadId, 600);
    expect(minted.success).toBe(true);
    if (!minted.success) return;

    const serverSig = new URL(minted.data.url).searchParams.get("sig") ?? "";
    const tokenHash = await hashToken(token);
    const ours = await signUpload({ tokenHash, uploadId, expires: minted.data.expires });

    // Compared on the SIGNATURE, not the URL: the host is deliberately unsigned.
    expect(ours).toBe(serverSig);
  });
});
