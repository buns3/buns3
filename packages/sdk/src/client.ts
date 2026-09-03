import { createHttp, type CreateHttpOptions, type Http } from "./http";
import {
  buildPresignedUrl,
  deriveKeyId,
  hashToken,
  sign,
  type PresignOptions,
} from "./lib/presign";
import { createAdmin } from "./planes/admin";
import { createObjects } from "./planes/objects";
import { createPresigned } from "./planes/presigned";
import { createSelf } from "./planes/self";

export class Buns3BaseClient {
  readonly self;
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

export class Buns3Client extends Buns3BaseClient {
  readonly objects;

  readonly #token?: string;

  constructor(baseUrl: string, opts: CreateHttpOptions = {}) {
    super(baseUrl, opts);
    this.#token = opts.token;
    this.objects = createObjects(this.http);
  }

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

export class Buns3AdminClient extends Buns3BaseClient {
  readonly admin;

  constructor(
    baseUrl: string,
    opts: Omit<CreateHttpOptions, "token"> & { token: string },
  ) {
    super(baseUrl, opts);
    this.admin = createAdmin(this.http);
  }
}
