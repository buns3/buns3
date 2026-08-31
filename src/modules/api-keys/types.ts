import type { DefaultModelRow } from "@prisma/orm-sqlite/orm-client";
import type {
  Buns3ApiKeyErrorCode,
  Buns3PresignErrorCode,
} from "$/lib/error-codes";
import type { Contract } from "../prisma/contract";
import type { CreateApiKey } from "../validation/api-key";
import type { PresignMethod } from "$/lib/presign";

export type ApiKeyRow = DefaultModelRow<Contract, "ApiKey">;
export type ApiKey = Omit<
  DefaultModelRow<Contract, "ApiKey">,
  "tokenHash" | "canRead" | "canWrite" | "isAdmin"
> & {
  canRead: boolean;
  canWrite: boolean;
  isAdmin: boolean;
};

export type Buns3ApiKeyResult<TData> = Promise<
  | {
      success: true;
      data: TData;
    }
  | {
      success: false;
      code: Buns3ApiKeyErrorCode;
    }
>;

export type Buns3ApiKeyPresignResult<TData> = Promise<
  | {
      success: true;
      data: TData;
    }
  | {
      success: false;
      code: Buns3PresignErrorCode;
    }
>;

export type VerifyPresignedOpts = {
  keyId: string;
  method: PresignMethod;
  bucket: string;
  key: string;
  expires: number;
  sig: string;
  now: number;
};

export type PresignOpts = {
  id: string;
  ttl: number;
  bucket: string;
  key: string;
  method: PresignMethod;
};

export type PresignData = { keyId: string; expires: number; sig: string };

export interface Buns3ApiKeyStorage {
  verify(token: string): Buns3ApiKeyResult<ApiKey>;

  verifyPresigned(opts: VerifyPresignedOpts): Buns3ApiKeyPresignResult<ApiKey>;

  presign(opts: PresignOpts): Buns3ApiKeyResult<PresignData>;

  create(
    input: CreateApiKey,
  ): Buns3ApiKeyResult<{ apiKey: ApiKey; token: string }>;

  delete(id: string): Buns3ApiKeyResult<ApiKey>;

  getAll(): Buns3ApiKeyResult<ApiKey[]>;
}
