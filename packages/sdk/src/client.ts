import { createHttp, type CreateHttpOptions, type Http } from "./http";
import {
  buildPresignedUrl,
  deriveKeyId,
  hashToken,
  sign,
  type PresignOptions,
} from "./lib/presign";
import { createAdmin } from "./planes/admin";
import { bindBucket, createObjects } from "./planes/objects";
import { createPresigned } from "./planes/presigned";
import { createSelf } from "./planes/self";

/**
 * What both clients share: the `/_self` plane, which any valid key can reach,
 * and `presigned`, which needs no credentials at all.
 *
 * Usually you want {@link Buns3Client} or {@link Buns3AdminClient}; this on its
 * own is a working but limited client. It is also the type to reach for when
 * you accept either of them.
 *
 * They are separate because no single key works on both planes: an admin key
 * cannot touch objects, and a data key cannot touch `/_admin`, so a combined
 * client would always be half unusable.
 */
export class Buns3BaseClient {
  /** Operations on the key you are authenticating with. */
  readonly self;
  /** Follow a presigned URL. Sends no credentials, so any client can use it. */
  readonly presigned;

  readonly #baseUrl: string;
  readonly #http: Http;

  protected get baseUrl() {
    return this.#baseUrl;
  }
  protected get http() {
    return this.#http;
  }

  constructor(baseUrl: string, opts: CreateHttpOptions = {}) {
    this.#baseUrl = baseUrl.replace(/\/+$/, "");
    this.#http = createHttp(this.#baseUrl, opts);
    this.self = createSelf(this.#http);
    this.presigned = createPresigned(this.#http);
  }
}

/**
 * Data-plane client: objects, plus offline presigning.
 *
 * The token is optional — without one you can still read public buckets and
 * follow presigned URLs.
 *
 * ```ts
 * const client = new Buns3Client("https://buns3.example.com", { token });
 * const res = await client.objects.get("photos", "cat.jpg");
 * if (res.success) console.log(await res.data.blob());
 * ```
 */
export class Buns3Client extends Buns3BaseClient {
  /** Read, write, list and delete objects. */
  readonly objects;

  readonly #token?: string;

  constructor(baseUrl: string, opts: CreateHttpOptions = {}) {
    super(baseUrl, opts);
    this.#token = opts.token;
    this.objects = createObjects(this.http);
  }

  /**
   * The object methods with one bucket already applied, for when you're
   * working in a single bucket.
   *
   * ```ts
   * const photos = client.bucket("photos");
   * await photos.put("cat.jpg", file);
   * await photos.list({ prefix: "2026/" });
   * ```
   *
   * A convenience only: keys stay bucket-scoped on the server, but a token
   * carries no bucket the SDK could read, and global data keys are a planned
   * addition. `objects.*` remains the full surface.
   */
  readonly bucket = (name: string) => bindBucket(this.objects, name);

  /**
   * Mint a presigned URL locally. No network, no server involvement — just the
   * token and WebCrypto. Throws if the client has no token.
   *
   * Signing this way is blind: a key that lacks the capability still produces a
   * valid-looking URL that fails when someone follows it. Use
   * `self.presign()` to have the server check first.
   */
  readonly presign = async (opts: PresignOptions) => {
    const { bucket, key, method, ttl } = opts;

    if (!this.#token) throw new Error("presign requires a token");
    const expires = Math.floor(Date.now() / 1000) + ttl;
    const tokenHash = await hashToken(this.#token);
    const keyId = await deriveKeyId(tokenHash);
    const sig = await sign({
      tokenHash,
      bucket,
      key,
      method,
      expires,
    });

    return {
      url: buildPresignedUrl(this.baseUrl, bucket, key, {
        expires,
        keyId,
        sig,
      }),
      expires,
    };
  };
}

/**
 * Control-plane client: buckets and API keys.
 *
 * Requires an admin token — the admin routes have no anonymous path, so a
 * client without one could only ever get 401s. Admin keys cannot read or write
 * objects, and cannot presign.
 *
 * ```ts
 * const client = new Buns3AdminClient("https://buns3.example.com", { token });
 * await client.admin.buckets.create("photos");
 * ```
 */
export class Buns3AdminClient extends Buns3BaseClient {
  /** Bucket and API-key management, under `admin.buckets` and `admin.keys`. */
  readonly admin;

  constructor(
    baseUrl: string,
    opts: Omit<CreateHttpOptions, "token"> & { token: string },
  ) {
    super(baseUrl, opts);
    this.admin = createAdmin(this.http);
  }
}
