import type { DefaultModelRow } from "@prisma/orm-sqlite/orm-client";
import type { Buns3ErrorCode } from "$/lib/error-codes";
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

export type Buns3FileResult<TFile> = Promise<
  | {
      success: true;
      file: TFile;
      object: ObjectRow;
    }
  | {
      success: false;
      code: Buns3ErrorCode;
    }
>;

export type Buns3BucketResult = Promise<
  | {
      success: true;
      bucket: BucketWithCount;
    }
  | {
      success: false;
      code: Buns3ErrorCode;
    }
>;

export type Buns3BucketListResult = Promise<
  | {
      success: true;
      buckets: BucketWithCount[];
    }
  | {
      success: false;
      code: Buns3ErrorCode;
    }
>;

export type Buns3FileListResult = Promise<
  | {
      success: true;
      filters: {
        [k in keyof Required<ObjectListQuery>]: Exclude<
          ObjectListQuery[k],
          undefined
        > | null;
      };
      nextAfter: string | null;
      objects: ObjectSummary[];
    }
  | {
      success: false;
      code: Buns3ErrorCode;
    }
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

  head(bucket: string, key: string): Buns3FileResult<null>;
}

export interface Buns3BucketStorage {
  get(bucket: string): Buns3BucketResult;

  create(bucket: string): Buns3BucketResult;

  update(bucket: string, opts?: BucketUpdate): Buns3BucketResult;

  delete(bucket: string): Buns3BucketResult;

  head(bucket: string): Buns3BucketResult;

  list(): Buns3BucketListResult;
}
