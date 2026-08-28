import type { DefaultModelRow } from "@prisma/orm-sqlite/orm-client";
import type { Buns3ApiKeyErrorCode } from "./errors";
import type { Contract } from "../prisma/contract";
import type { CreateApiKey } from "../validation/api-key";

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

export interface Buns3ApiKeyStorage {
  verify(token: string): Buns3ApiKeyResult<ApiKey>;

  create(
    input: CreateApiKey,
  ): Buns3ApiKeyResult<{ apiKey: ApiKey; token: string }>;

  delete(): Buns3ApiKeyResult<ApiKey>;

  // head(bucket: string): Buns3ApiKeyResult;

  list(): Buns3ApiKeyResult<ApiKey[]>;
}
