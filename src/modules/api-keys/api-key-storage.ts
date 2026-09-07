import { type } from "arktype";
import { db } from "../prisma/db";
import { bucketStorage } from "../storage/bucket";
import { isFkViolation } from "../storage/errors";
import { ApiKeyToken } from "../validation/api-key";
import { TOKEN_PREFIX } from "./constants";
import { toApiKey } from "./mapping";
import type { Buns3ApiKeyStorage } from "./types";
import {
  deriveKeyId,
  hashToken,
  sign,
  verify,
  verifyUpload,
} from "$/lib/presign";
import { logger } from "$/lib/logger";

const log = logger.child({ module: "api-keys" });

export const apiKeyStorage: Buns3ApiKeyStorage = {
  async verify(token) {
    const validation = ApiKeyToken(token);
    if (validation instanceof type.errors) {
      log.debug("malformed bearer token");
      return {
        success: false,
        code: "INVALID_API_KEY",
      };
    }

    const providedHash = hashToken(token);
    const apiKey = await db.orm.ApiKey.where({
      tokenHash: providedHash,
    }).update({
      lastUsedAt: new Date(),
    });

    if (apiKey === null) {
      log.debug("unknown or revoked bearer token");
      return {
        success: false,
        code: "INVALID_API_KEY",
      };
    }

    return {
      success: true,
      data: toApiKey(apiKey),
    };
  },

  async verifyPresigned(opts) {
    const { keyId, ...rest } = opts;

    // O(n) scan, keyId isn't stored, maybe add an indexed derived column if key count ever matters...
    const rows = await db.orm.ApiKey.all();
    const row = rows.find((k) => deriveKeyId(k.tokenHash) === opts.keyId);
    if (!row) {
      log.debug({ keyId }, "presign keyId matches no key");
      return {
        success: false,
        code: "INVALID_API_KEY",
      };
    }

    const verifyResult = verify({ tokenHash: row.tokenHash, ...rest });
    if (!verifyResult.valid) {
      log.debug(
        { keyId, failure: verifyResult.reason },
        "presigned signature rejected",
      );
      switch (verifyResult.reason) {
        case "expired":
          return {
            success: false,
            code: "PRESIGNED_EXPIRED",
          };

        case "mismatch":
        default:
          return {
            success: false,
            code: "INVALID_API_KEY",
          };
      }
    }

    const apiKey = await db.orm.ApiKey.where({
      id: row.id,
    }).update({
      lastUsedAt: new Date(),
    });

    if (apiKey === null) {
      return {
        success: false,
        code: "INVALID_API_KEY",
      };
    }

    return {
      success: true,
      data: toApiKey(apiKey),
    };
  },

  async verifyUploadPresigned(opts) {
    const { keyId, ...rest } = opts;

    // O(n) scan, keyId isn't stored, maybe add an indexed derived column if key count ever matters...
    const rows = await db.orm.ApiKey.all();
    const row = rows.find((k) => deriveKeyId(k.tokenHash) === opts.keyId);
    if (!row) {
      log.debug({ keyId }, "presign keyId matches no key");
      return {
        success: false,
        code: "INVALID_API_KEY",
      };
    }

    const verifyResult = verifyUpload({ tokenHash: row.tokenHash, ...rest });
    if (!verifyResult.valid) {
      log.debug(
        { keyId, uploadId: opts.uploadId, failure: verifyResult.reason },
        "presigned upload signature rejected",
      );
      switch (verifyResult.reason) {
        case "expired":
          return {
            success: false,
            code: "PRESIGNED_EXPIRED",
          };

        case "mismatch":
        default:
          return {
            success: false,
            code: "INVALID_API_KEY",
          };
      }
    }

    const apiKey = await db.orm.ApiKey.where({
      id: row.id,
    }).update({
      lastUsedAt: new Date(),
    });

    if (apiKey === null) {
      return {
        success: false,
        code: "INVALID_API_KEY",
      };
    }

    return {
      success: true,
      data: toApiKey(apiKey),
    };
  },

  async presign(opts) {
    const { id, bucket, key, method, ttl } = opts;

    const apiKey = await db.orm.ApiKey.select("tokenHash")
      .where({ id })
      .first();

    if (!apiKey) {
      return {
        success: false,
        code: "INVALID_API_KEY",
      };
    }

    const keyId = deriveKeyId(apiKey.tokenHash);
    const expires = Math.floor(Date.now() / 1000) + ttl;
    const sig = sign({
      tokenHash: apiKey.tokenHash,
      bucket,
      key,
      method,
      expires,
    });

    return {
      success: true,
      data: {
        expires,
        keyId,
        sig,
      },
    };
  },

  async create(input) {
    if (input.bucketName) {
      const bucketResult = await bucketStorage.get(input.bucketName);
      if (!bucketResult.success) {
        if (bucketResult.code === "BUCKET_NOT_FOUND") {
          return {
            success: false,
            code: "BUCKET_NOT_FOUND",
          };
        }
        return {
          success: false,
          code: "UNKNOWN",
        };
      }
    }

    const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
    const token = TOKEN_PREFIX + Buffer.from(tokenBytes).toString("base64url");
    const tokenHint = token.substring(0, TOKEN_PREFIX.length + 5);
    const tokenHash = hashToken(token);

    try {
      const createdApiKey = await db.orm.ApiKey.create({
        ...input,
        id: crypto.randomUUID(),
        canRead: input.canRead ? 1 : 0,
        canWrite: input.canWrite ? 1 : 0,
        isAdmin: input.isAdmin ? 1 : 0,
        tokenHash,
        tokenHint,
        createdAt: new Date(),
        lastUsedAt: null,
      });

      const apiKey = toApiKey(createdApiKey);
      log.info(
        {
          keyId: apiKey.id,
          name: apiKey.name,
          bucket: apiKey.bucketName,
          isAdmin: apiKey.isAdmin,
          canRead: apiKey.canRead,
          canWrite: apiKey.canWrite,
        },
        "api key created",
      );
      return {
        success: true,
        data: {
          apiKey,
          token,
        },
      };
    } catch (err) {
      if (isFkViolation(err)) {
        return {
          success: false,
          code: "BUCKET_NOT_FOUND",
        };
      }

      log.error({ err }, "api key create failed");
      return {
        success: false,
        code: "UNKNOWN",
      };
    }
  },

  async delete(id) {
    const deletedKey = await db.orm.ApiKey.where({ id }).delete();
    if (!deletedKey) {
      return {
        success: false,
        code: "API_KEY_NOT_FOUND",
      };
    }

    log.info({ keyId: id }, "api key deleted");
    return {
      success: true,
      data: toApiKey(deletedKey),
    };
  },

  async getAll() {
    const apiKeys = await db.orm.ApiKey.orderBy((key) =>
      key.createdAt.asc(),
    ).all();

    return {
      success: true,
      data: apiKeys.map(toApiKey),
    };
  },
};
