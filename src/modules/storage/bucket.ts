import path from "node:path";
import type { Buns3BucketStorage } from "./types";
import { BASE_PATH } from "./constants";
import { db } from "../prisma/db";
import { mkdir } from "node:fs/promises";
import { isErrnoException } from "./errors";

function resolve(bucket: string) {
  return path.resolve(BASE_PATH, bucket);
}

export const bucketStorage: Buns3BucketStorage = {
  async get(bucket) {
    const existingBucket = await db.orm.Bucket.first({
      name: bucket,
    });

    if (!existingBucket) {
      return {
        success: false,
        code: "BUCKET_NOT_FOUND",
      };
    }

    return {
      success: true,
      bucket: existingBucket,
    };
  },

  async create(bucket) {
    const existingBucket = await db.orm.Bucket.first({
      name: bucket,
    });

    if (existingBucket) {
      return {
        success: false,
        code: "BUCKET_ALREADY_EXIST",
      };
    }

    const bucketPath = resolve(bucket);
    const newBucket = await db.transaction(async (tx) => {
      const created = await tx.orm.Bucket.create({ name: bucket });

      try {
        await mkdir(bucketPath);
      } catch (err) {
        if (isErrnoException(err) && err.code === "EEXIST") {
          // TODO : bucket folder exists - throw error or ignore and mend FS <-> DB bond?
        } else {
          console.error(err);
          throw err;
        }
      }

      return created;
    });

    return {
      success: true,
      bucket: newBucket,
    };
  },

  async delete(bucket) {
    return {
      success: false,
      code: "UNKNOWN",
    };
  },

  async head(bucket) {
    return {
      success: false,
      code: "UNKNOWN",
    };
  },
};
