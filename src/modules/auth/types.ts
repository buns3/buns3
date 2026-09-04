import type {
  Buns3ApiKeyErrorCode,
  Buns3PresignErrorCode,
} from "$/lib/error-codes";
import type { ApiKey } from "../api-keys/types";
import type { PresignParams } from "../validation/presign";

export type Credentials =
  | {
      kind: "bearer";
      token: string;
    }
  | {
      kind: "presign";
      params: PresignParams;
    }
  | {
      kind: "anonymous";
    };

export type ResolvedCredentialsResult =
  | {
      success: true;
      credentials: Credentials;
    }
  | {
      success: false;
      code: "INVALID_API_KEY";
    };

export type AuthorizeResult =
  | {
      success: true;
    }
  | {
      success: false;
      code: Buns3ApiKeyErrorCode | Buns3PresignErrorCode;
    };

export type AuthorizeCapability = "read" | "list" | "write" | "admin" | true;

export type AuthState =
  | { kind: "key"; apiKey: ApiKey }
  | { kind: "presign"; params: PresignParams }
  | { kind: "anonymous" };

export type AuthKind = AuthState["kind"];

export type AuthorizeOptions = {
  state: AuthState;
  capability?: AuthorizeCapability;
  bucket?: string;
  key?: string;
  method: string;
};
