import type {
  Bucket,
  BucketRow,
  BucketRowWithCount,
  BucketWithCount,
  ObjectRow,
  ObjectSummary,
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

export function toObjectSummary(object: ObjectRow): ObjectSummary {
  return {
    key: object.key,
    size: object.size,
    contentType: object.contentType,
    createdAt: object.createdAt,
    etag: object.id,
  };
}
