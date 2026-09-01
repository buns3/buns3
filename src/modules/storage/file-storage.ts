import type { Buns3BatchDeleteItemResult, Buns3Storage } from "./types";
import path from "node:path";
import { rename, mkdir } from "node:fs/promises";
import { db } from "$/modules/prisma/db";
import { BASE_PATH, TEMP_DIR_NAME } from "./constants";
import { toObjectSummary } from "./mapping";
import { prefixUpperBound } from "$/lib/key";

function resolvePath(bucket: string, key: string) {
  return path.resolve(BASE_PATH, bucket, key);
}

function resolve(bucket: string, key: string) {
  const filePath = resolvePath(bucket, key);
  return Bun.file(filePath);
}

export const fileStorage: Buns3Storage = {
  async init() {
    // Init the file system and directories
    const dataDir = path.resolve(BASE_PATH);
    const tempDir = path.resolve(dataDir, TEMP_DIR_NAME);
    await mkdir(tempDir, { recursive: true });
  },

  async get(bucket, key) {
    const existingObject = await db.orm.Object.where({
      bucketName: bucket,
      key,
    }).first();

    if (!existingObject) {
      return {
        success: false,
        code: "KEY_NOT_FOUND",
      };
    }

    const file = resolve(bucket, existingObject.id);
    if (!(await file.exists())) {
      return { success: false, code: "KEY_NOT_FOUND" };
    }

    return {
      success: true,
      file,
      object: existingObject,
    };
  },

  async list(opts) {
    const { bucket, after = null, limit = 100, prefix = null } = opts;
    let query = db.orm.Object.where({ bucketName: bucket });

    if (after) {
      query = query.where((o) => o.key.gt(after));
    }

    if (prefix) {
      query = query
        .where((o) => o.key.gte(prefix))
        .where((o) => o.key.lt(prefixUpperBound(prefix)));
    }

    query = query.orderBy((o) => o.key.asc());

    const objects = await query.limit(limit + 1).all();

    return {
      success: true,
      filters: { limit, prefix, after },
      nextAfter: objects.length > limit ? objects[limit - 1]!.key : null,
      objects: objects.slice(0, limit).map(toObjectSummary),
    };
  },

  async put(bucket, key, source, contentType) {
    const existingBucket = await db.orm.Bucket.select("name").first({
      name: bucket,
    });

    if (!existingBucket) {
      return {
        success: false,
        code: "BUCKET_NOT_FOUND",
      };
    }

    const rndKey = crypto.randomUUID();
    const tempFilePath = resolvePath(TEMP_DIR_NAME, rndKey);
    const tempFile = resolve(TEMP_DIR_NAME, rndKey);
    const sink = tempFile.writer();

    try {
      for await (const chunk of source) {
        await sink.write(chunk);
      }

      await sink.end();
    } catch (err) {
      console.error(err);
      await tempFile.unlink();
      return {
        success: false,
        code: "FS_ERROR",
      };
    }

    const id = crypto.randomUUID();
    const filePath = resolvePath(bucket, id);
    const file = resolve(bucket, id);

    try {
      const [existingObject, newObject] = await db.transaction(async (tx) => {
        const existing = await tx.orm.Object.select("id")
          .where({
            bucketName: bucket,
            key,
          })
          .first();

        const updated = await tx.orm.Object.where({
          bucketName: bucket,
          key,
        }).upsert({
          conflictOn: { bucketName: bucket, key },
          create: {
            bucketName: bucket,
            key,
            id,
            contentType: contentType,
            size: tempFile.size,
            createdAt: new Date(),
          },
          update: {
            id,
            contentType: contentType,
            size: tempFile.size,
            createdAt: new Date(),
          },
        });

        await rename(tempFilePath, filePath);
        return [existing, updated];
      });

      if (existingObject) {
        // Unlink old file -> replaced by new one
        await resolve(bucket, existingObject.id).unlink();
      }

      return { success: true, file, object: newObject };
    } catch (err) {
      console.error(err);
      await Promise.allSettled([tempFile.unlink(), file.unlink()]);

      return {
        success: false,
        code: "FS_ERROR",
      };
    }
  },

  async delete(bucket, key) {
    const deleted = await db.orm.Object.where({
      bucketName: bucket,
      key,
    }).delete();

    if (!deleted) {
      return {
        success: false,
        code: "KEY_NOT_FOUND",
      };
    }

    try {
      const file = resolve(bucket, deleted.id);
      await file.unlink();
    } catch (err) {
      console.error("orphaned blob", bucket, deleted.id, err);
    }

    return { success: true, file: null, object: deleted };
  },

  async deleteMany(bucket, keys) {
    const keySet = new Set(keys);
    const uniqueKeys = [...keySet];
    const rows = await db.orm.Object.select("id", "key")
      .where({ bucketName: bucket })
      .where((o) => o.key.in(uniqueKeys))
      .all();

    if (rows.length === 0) {
      return {
        success: true,
        summary: { deleted: 0, missing: uniqueKeys.length },
        results: uniqueKeys.map((key) => ({
          success: false,
          key,
          code: "KEY_NOT_FOUND",
        })),
      };
    }

    const ids = rows.map((r) => r.id);
    const deletedRows = await db.orm.Object.select("id", "key")
      .where((o) => o.id.in(ids))
      .deleteAll();

    const deletedKeys = new Set(deletedRows.map((row) => row.key));

    await Promise.all(
      deletedRows.map(async (row) => {
        try {
          await resolve(bucket, row.id).unlink();
        } catch (error) {
          console.error(`orphaned blob ${bucket}/${row.id}:`, error);
        }
      }),
    );

    const results: Buns3BatchDeleteItemResult[] = uniqueKeys.map((key) =>
      deletedKeys.has(key)
        ? { success: true, key }
        : { success: false, key, code: "KEY_NOT_FOUND" },
    );

    return {
      success: true,
      summary: {
        deleted: deletedKeys.size,
        missing: uniqueKeys.length - deletedKeys.size,
      },
      results,
    };
  },

  async head(bucket, key) {
    const existingObject = await db.orm.Object.where({
      bucketName: bucket,
      key,
    }).first();

    if (!existingObject) {
      return {
        success: false,
        code: "KEY_NOT_FOUND",
      };
    }

    return {
      success: true,
      file: null,
      object: existingObject,
    };
  },
};
