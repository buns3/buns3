import { logger } from "$/lib/logger";
import { rename, truncate } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { db } from "../prisma/db";
import { TEMP_DIR_NAME, UPLOADS_DIR_NAME } from "./constants";
import { resolveDirPath, resolveFile } from "./paths";
import type { UploadStorage } from "./types";

const log = logger.child({ module: "storage" });

export const uploadStorage: UploadStorage = {
  async create(bucket, key, contentType) {
    contentType = contentType ?? "application/octet-stream";
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
    const createdAt = new Date();
    const updatedAt = new Date();
    const uploadFile = resolveFile(UPLOADS_DIR_NAME, rndKey);

    try {
      await uploadFile.write("");
    } catch (err) {
      log.error({ bucket, key, err }, "could not create upload file");
      await Promise.allSettled([uploadFile.unlink()]);
      return {
        success: false,
        code: "FS_ERROR",
      };
    }

    try {
      const newUpload = await db.orm.Upload.create({
        id: rndKey,
        bucketName: bucket,
        key,
        contentType,
        size: 0,
        createdAt,
        updatedAt,
      });

      return { success: true, data: newUpload };
    } catch (err) {
      log.error({ bucket, key, err }, "could not create upload file");
      await Promise.allSettled([uploadFile.unlink()]);

      return {
        success: false,
        code: "FS_ERROR",
      };
    }
  },

  async append(id, source, offset) {
    const row = await db.orm.Upload.select("id", "size", "bucketName", "key")
      .where({ id })
      .first();
    if (!row) {
      return {
        success: false,
        code: "UPLOAD_NOT_FOUND",
      };
    }

    if (offset !== undefined && row.size !== offset) {
      return {
        success: false,
        code: "OFFSET_MISMATCH",
      };
    }

    const uploadPath = resolveDirPath(UPLOADS_DIR_NAME, row.id);
    try {
      await truncate(uploadPath, row.size);
      const ws = createWriteStream(uploadPath, {
        flags: "r+",
        start: row.size,
      });

      let written = 0;
      for await (const chunk of source) {
        written += chunk.length;
        if (!ws.write(chunk)) await new Promise((r) => ws.once("drain", r));
      }

      await new Promise<void>((res, rej) => {
        ws.on("finish", res);
        ws.on("error", rej);
        ws.end();
      });

      const updatedUpload = await db.orm.Upload.where({ id: row.id }).update({
        size: row.size + written,
        updatedAt: new Date(),
      });

      if (!updatedUpload) {
        log.warn({ uploadId: row.id, written }, "abandoned upload file");
        return {
          success: false,
          code: "UPLOAD_NOT_FOUND",
        };
      }

      log.debug(
        { uploadId: updatedUpload.id, written, size: updatedUpload.size },
        "wrote upload blob",
      );

      return {
        success: true,
        data: updatedUpload,
      };
    } catch (err) {
      log.error(
        { uploadId: id, bucket: row.bucketName, key: row.key, offset, err },
        "could not append upload blob",
      );
      return {
        success: false,
        code: "FS_ERROR",
      };
    }
  },

  async get(id) {
    const row = await db.orm.Upload.where({ id }).first();
    if (!row) {
      return {
        success: false,
        code: "UPLOAD_NOT_FOUND",
      };
    }

    return {
      success: true,
      data: row,
    };
  },

  async complete(id) {
    const row = await db.orm.Upload.where({ id }).first();
    if (!row) {
      return {
        success: false,
        code: "UPLOAD_NOT_FOUND",
      };
    }

    const uploadFilePath = resolveDirPath(UPLOADS_DIR_NAME, row.id);
    const rndKey = crypto.randomUUID();
    const tempFilePath = resolveDirPath(TEMP_DIR_NAME, rndKey);
    const tempFile = resolveFile(TEMP_DIR_NAME, rndKey);

    try {
      await rename(uploadFilePath, tempFilePath);
    } catch (err) {
      log.error(
        {
          target: uploadFilePath,
          destination: tempFilePath,
          uploadId: row.id,
          bucket: row.bucketName,
          key: row.key,
          err,
        },
        "could not complete upload",
      );
      return {
        success: false,
        code: "FS_ERROR",
      };
    }

    const newId = crypto.randomUUID();
    const filePath = resolveDirPath(row.bucketName, newId);
    const file = resolveFile(row.bucketName, newId);

    try {
      const [existingObject, newObject] = await db.transaction(async (tx) => {
        const existing = await tx.orm.Object.select("id")
          .where({
            bucketName: row.bucketName,
            key: row.key,
          })
          .first();

        const updated = await tx.orm.Object.where({
          bucketName: row.bucketName,
          key: row.key,
        }).upsert({
          conflictOn: { bucketName: row.bucketName, key: row.key },
          create: {
            bucketName: row.bucketName,
            key: row.key,
            id: newId,
            contentType: row.contentType,
            size: row.size,
            createdAt: new Date(),
          },
          update: {
            id: newId,
            contentType: row.contentType,
            size: row.size,
            createdAt: new Date(),
          },
        });

        await tx.orm.Upload.where({ id }).delete();

        await rename(tempFilePath, filePath);
        return [existing, updated];
      });

      if (existingObject) {
        try {
          // Unlink old file -> replaced by new one
          await resolveFile(row.bucketName, existingObject.id).unlink();
        } catch (err) {
          log.warn(
            {
              bucket: row.bucketName,
              key: row.key,
              blobId: existingObject.id,
              err,
            },
            "orphaned blob",
          );
        }
      }

      return { success: true, data: { file, object: newObject } };
    } catch (err) {
      log.error(
        { bucket: row.bucketName, key: row.key, err },
        "could not complete upload",
      );
      await Promise.allSettled([tempFile.unlink(), file.unlink()]);

      return {
        success: false,
        code: "FS_ERROR",
      };
    }
  },

  async abort(id) {
    const deleted = await db.orm.Upload.where({ id }).delete();
    if (!deleted) {
      return {
        success: false,
        code: "UPLOAD_NOT_FOUND",
      };
    }

    try {
      const file = resolveFile(UPLOADS_DIR_NAME, deleted.id);
      await file.unlink();
    } catch (err) {
      log.warn(
        {
          uploadId: deleted.id,
          bucket: deleted.bucketName,
          key: deleted.key,
          err,
        },
        "orphaned upload file",
      );
    }

    return {
      success: true,
      data: null,
    };
  },
};
