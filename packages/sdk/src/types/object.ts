/** An object as it appears in a listing. */
export interface ObjectSummary {
  key: string;
  size: number;
  contentType: string;
  createdAt: string;
  /** Blob id, unquoted. */
  etag: string;
}

/** Object metadata read from response headers. */
export interface ObjectMeta {
  contentType: string;
  size: number;
  /** RFC-7231 date string, as sent. */
  lastModified: string;
  /** Blob id, unquoted — matches the etag a listing reports. */
  etag: string;
}

/** The filters the server applied, echoed back. */
export interface ObjectListFilters {
  prefix: string | null;
  after: string | null;
  /** Always set; defaults to 100. */
  limit: number;
}

/** GET `/:bucket`. */
export interface ObjectListResponse {
  bucket: string;
  filters: ObjectListFilters;
  count: number;
  /** Pass back as `after` for the next page. null on the last one. */
  nextAfter: string | null;
  objects: ObjectSummary[];
}

/** PUT `/:bucket/:key`. */
export interface PutObjectResponse {
  bucket: string;
  key: string;
}

/** One result per requested key, in request order. */
export type BatchDeleteItem =
  | { success: true; key: string }
  | { success: false; key: string; code: "KEY_NOT_FOUND" };

/** DELETE `/:bucket`. Keys that were already gone are reported, not fatal. */
export interface BatchDeleteResponse {
  bucket: string;
  results: BatchDeleteItem[];
  summary: { deleted: number; missing: number };
}

/** Options for reading an object, shared by `get` and `head`. */
export interface ReadObjectOptions {
  /** Send no Authorization header, for public-read buckets. */
  anonymous?: boolean;
}

export interface PutObjectOptions {
  /**
   * Stored verbatim; the server does not sniff. Defaults to a Blob's own type,
   * otherwise application/octet-stream. Note `blob.stream()` drops the type.
   */
  contentType?: string;
}

/** Keyset pagination. Only the filters you set are sent. */
export interface ListObjectsOptions {
  prefix?: string;
  after?: string;
  /** 1..1000, enforced by the server. */
  limit?: number;
}
