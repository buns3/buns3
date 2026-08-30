import type { Buns3ApiKeyErrorCode } from "$/lib/error-codes";
import type { ApiKey } from "../api-keys/types";

export type Credentials =
  | {
      kind: "bearer";
      token: string;
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
      code: Buns3ApiKeyErrorCode;
    };

export type AuthorizeCapability = "read" | "write" | "admin" | true;

export type AuthorizeOptions = {
  apiKey: ApiKey | null;
  capability?: AuthorizeCapability;
  bucket?: string;
};
