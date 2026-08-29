import path from "node:path";
import type { Buns3BucketStorage } from "./types";
import { BASE_PATH } from "./constants";
import { db } from "../prisma/db";
import { mkdir } from "node:fs/promises";
import { isFkViolation, isUniqueViolation } from "./errors";
import { rmdir } from "node:fs/promises";
import { toBucketWithCount } from "./mapping";

function resolve(bucket: string) {
  return path.resolve(BASE_PATH, bucket);
}

export const bucketStorage: Buns3BucketStorage = {
  async get(bucket) {
    const existingBucket = await db.orm.Bucket.include("objects", (o) =>
      o.count(),
    ).first({
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
      bucket: toBucketWithCount(existingBucket),
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

    try {
      const bucketPath = resolve(bucket);
      const newBucket = await db.transaction(async (tx) => {
        const created = await tx.orm.Bucket.include("objects", (o) =>
          o.count(),
        ).create({ name: bucket, createdAt: new Date() });

        await mkdir(bucketPath, { recursive: true });
        return created;
      });

      return {
        success: true,
        bucket: toBucketWithCount(newBucket),
      };
    } catch (err) {
      if (isUniqueViolation(err, "buckets.name")) {
        return {
          success: false,
          code: "BUCKET_ALREADY_EXIST",
        };
      }

      console.error(err);
      return {
        success: false,
        code: "UNKNOWN",
      };
    }
  },

  async update(bucket, opts = {}) {
    const updated = await db.orm.Bucket.include("objects", (o) => o.count())
      .where({ name: bucket })
      .update({
        publicRead:
          typeof opts.publicRead === "boolean"
            ? opts.publicRead
              ? 1
              : 0
            : undefined,
      });

    if (updated === null) {
      return {
        success: false,
        code: "BUCKET_NOT_FOUND",
      };
    }

    return {
      success: true,
      bucket: toBucketWithCount(updated),
    };
  },

  async delete(bucket) {
    const existingBucket = await db.orm.Bucket.include("objects", (object) =>
      object.count(),
    ).first({
      name: bucket,
    });

    if (!existingBucket) {
      return {
        success: false,
        code: "BUCKET_NOT_FOUND",
      };
    }

    if (existingBucket.objects) {
      return {
        success: false,
        code: "BUCKET_NOT_EMPTY",
      };
    }

    const bucketPath = resolve(bucket);
    let deleted;
    try {
      deleted = await db.orm.Bucket.include("objects", (o) => o.count())
        .where({ name: bucket })
        .delete();
      if (!deleted) {
        return {
          success: false,
          code: "BUCKET_NOT_FOUND",
        };
      }
    } catch (err) {
      if (isFkViolation(err)) {
        return {
          success: false,
          code: "BUCKET_NOT_EMPTY",
        };
      }

      console.error(err);
      return {
        success: false,
        code: "UNKNOWN",
      };
    }

    try {
      await rmdir(bucketPath);
    } catch (err) {
      console.error("orphaned bucket", bucket, err);
    }

    return {
      success: true,
      bucket: toBucketWithCount(deleted),
    };
  },

  async head(bucket) {
    const existingBucket = await db.orm.Bucket.include("objects", (o) =>
      o.count(),
    ).first({
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
      bucket: toBucketWithCount(existingBucket),
    };
  },

  async list() {
    const buckets = await db.orm.Bucket.include("objects", (o) =>
      o.count(),
    ).all();
    return {
      success: true,
      buckets: buckets.map(toBucketWithCount),
    };
  },
};
