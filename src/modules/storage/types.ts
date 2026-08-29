import type { DefaultModelRow } from "@prisma/orm-sqlite/orm-client";
import type { Buns3ErrorCode } from "$/lib/error-codes";
import type { Contract } from "../prisma/contract";

export type Bucket = DefaultModelRow<Contract, "Bucket">;
export type BucketWithCount = Bucket & { objects: number };
export type StorageObject = DefaultModelRow<Contract, "Object">;

export type Buns3FileResult<TFile> = Promise<
  | {
      success: true;
      file: TFile;
      object: StorageObject;
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

export interface Buns3Storage {
  init(): Promise<void>;

  get(bucket: string, key: string): Buns3FileResult<Bun.FileBlob>;

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

  delete(bucket: string): Buns3BucketResult;

  head(bucket: string): Buns3BucketResult;

  list(): Buns3BucketListResult;
}
