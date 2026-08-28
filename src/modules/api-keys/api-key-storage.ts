import { type } from "arktype";
import { db } from "../prisma/db";
import { bucketStorage } from "../storage/bucket";
import { isFkViolation } from "../storage/errors";
import { ApiKeyToken } from "../validation/api-key";
import { TOKEN_PREFIX } from "./constants";
import { toApiKey } from "./mapping";
import type { Buns3ApiKeyStorage } from "./types";

function hashToken(token: string) {
  return new Bun.CryptoHasher("sha256").update(token).digest("hex");
}

export const apiKeyStorage: Buns3ApiKeyStorage = {
  async verify(token) {
    const validation = ApiKeyToken(token);
    if (validation instanceof type.errors) {
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
      });

      return {
        success: true,
        data: {
          apiKey: toApiKey(createdApiKey),
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

      console.dir(err, { depth: null });
      return {
        success: false,
        code: "UNKNOWN",
      };
    }
  },

  async delete() {
    return {
      success: false,
      code: "UNKNOWN",
    };
  },

  async list() {
    return {
      success: false,
      code: "UNKNOWN",
    };
  },
};
