import type {
  Bucket,
  BucketRow,
  BucketRowWithCount,
  BucketWithCount,
} from "./types";

export function toBucket(bucket: BucketRow): Bucket {
  return {
    name: bucket.name,
    publicRead: bucket.publicRead !== 0,
    createdAt: bucket.createdAt,
  };
}

export function toBucketWithCount(bucket: BucketRowWithCount): BucketWithCount {
  return {
    name: bucket.name,
    publicRead: bucket.publicRead !== 0,
    createdAt: bucket.createdAt,
    objects: bucket.objects,
  };
}
