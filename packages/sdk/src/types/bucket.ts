/** A bucket. */
export interface Bucket {
  name: string;
  publicRead: boolean;
  /** ISO-8601, as sent. */
  createdAt: string;
}

/** A bucket with its object count. Every bucket response uses this shape. */
export interface BucketWithCount extends Bucket {
  objects: number;
}

/** GET, PUT and PATCH `/_admin/buckets/:bucket`. */
export interface BucketResponse {
  bucket: BucketWithCount;
}

/** GET `/_admin/buckets`. */
export interface BucketListResponse {
  buckets: BucketWithCount[];
}

/** PATCH body. Empty is allowed here; the server rejects it with 422. */
export interface UpdateBucketOptions {
  publicRead?: boolean;
}
