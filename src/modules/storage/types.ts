import type { DefaultModelRow } from "@prisma/orm-sqlite/orm-client";
import type { Buns3AnyErrorCode } from "$/lib/error-codes";
import type { Result } from "$/lib/result";
import type { Contract } from "../prisma/contract";
import type { BucketUpdate } from "../validation/bucket";
import type { ObjectListQuery } from "../validation/object";

export type BucketRow = DefaultModelRow<Contract, "Bucket">;
export type BucketRowWithCount = DefaultModelRow<Contract, "Bucket"> & {
  objects: number;
};
export type Bucket = Omit<BucketRow, "publicRead"> & { publicRead: boolean };
export type BucketWithCount = Bucket & { objects: number };

export type ObjectRow = DefaultModelRow<Contract, "Object">;
export type ObjectSummary = Omit<ObjectRow, "bucketName" | "id"> & {
  etag: string;
};

export type UploadRow = DefaultModelRow<Contract, "Upload">;
export type Upload = Omit<UploadRow, "id" | "bucketName"> & {
  uploadId: string;
  bucket: string;
};

export type Buns3FileResult<TFile> = Promise<
  Result<{ file: TFile; object: ObjectRow }>
>;

export type Buns3BucketResult = Promise<Result<BucketWithCount>>;

export type Buns3BucketListResult = Promise<Result<BucketWithCount[]>>;

export type ObjectListing = {
  filters: {
    [k in keyof Required<ObjectListQuery>]: Exclude<
      ObjectListQuery[k],
      undefined
    > | null;
  };
  nextAfter: string | null;
  objects: ObjectSummary[];
};

export type Buns3FileListResult = Promise<Result<ObjectListing>>;

// The per-key shape is a WIRE contract, not a Result: it carries the key on
// both branches so a caller can match responses to requests.
export type Buns3BatchDeleteItemResult =
  | { success: true; key: string }
  | { success: false; key: string; code: Buns3AnyErrorCode };

export type Buns3BatchDeleteResult = Promise<
  Result<{
    results: Buns3BatchDeleteItemResult[];
    summary: { deleted: number; missing: number };
  }>
>;

export type StorageListOptions = {
  bucket: string;
} & ObjectListQuery;

export interface Buns3Storage {
  init(): Promise<void>;

  get(bucket: string, key: string): Buns3FileResult<Bun.FileBlob>;

  list(opts: StorageListOptions): Buns3FileListResult;

  put(
    bucket: string,
    key: string,
    source: ReadableStream,
    contentType: string,
  ): Buns3FileResult<Bun.FileBlob>;

  delete(bucket: string, key: string): Buns3FileResult<null>;

  deleteMany(bucket: string, keys: string[]): Buns3BatchDeleteResult;
}

export interface Buns3BucketStorage {
  get(bucket: string): Buns3BucketResult;

  create(bucket: string): Buns3BucketResult;

  update(bucket: string, opts?: BucketUpdate): Buns3BucketResult;

  delete(bucket: string): Buns3BucketResult;

  list(): Buns3BucketListResult;
}

export interface UploadStorage {
  create(
    bucket: string,
    key: string,
    contentType?: string,
  ): Promise<Result<UploadRow>>;

  append(
    id: string,
    source: ReadableStream,
    offset?: number,
  ): Promise<Result<UploadRow>>;

  get(id: string): Promise<Result<UploadRow>>;

  complete(
    id: string,
  ): Promise<Result<{ file: Bun.FileBlob; object: ObjectRow }>>;

  abort(id: string): Promise<Result<null>>;
}
