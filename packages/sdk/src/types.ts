import type { ErrorCode, ClientErrorCode } from "./error";

export interface Bucket {
  name: string;
  publicRead: boolean;
  createdAt: string;
}

export interface BucketWithCount extends Bucket {
  objects: number;
}

export interface ApiKey {
  id: string;
  name: string;
  bucketName: string | null;
  canRead: boolean;
  canWrite: boolean;
  isAdmin: boolean;
  tokenHint: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface ObjectSummary {
  key: string;
  size: number;
  contentType: string;
  createdAt: string;
  etag: string;
}

export interface ObjectListFilters {
  prefix: string | null;
  after: string | null;
  limit: number;
}

export interface ObjectList {
  bucket: string;
  filters: ObjectListFilters;
  count: number;
  nextAfter: string | null;
  objects: ObjectSummary[];
}

export type BatchDeleteItem =
  | { success: true; key: string }
  | { success: false; key: string; code: "KEY_NOT_FOUND" };

export interface BatchDelete {
  bucket: string;
  results: BatchDeleteItem[];
  summary: { deleted: number; missing: number };
}

export interface Problem {
  type: "about:blank";
  title: string;
  detail?: string;
  status: number;
  code: ErrorCode;
}

export type Result<T> =
  | { success: true; data: T }
  | { success: false; status: number; code: ClientErrorCode; detail?: string };
