/** An API key, minus its token. */
export interface ApiKey {
  id: string;
  name: string;
  /** null for admin keys, which are global; data keys name their bucket. */
  bucketName: string | null;
  canRead: boolean;
  canWrite: boolean;
  isAdmin: boolean;
  /** Leading characters of the token, enough to recognise it in a list. */
  tokenHint: string | null;
  createdAt: string;
  /** null until first use. */
  lastUsedAt: string | null;
}

/** GET `/_self`. */
export interface WhoamiResponse {
  apiKey: ApiKey | null;
}

/** GET `/_admin/keys`. */
export interface ApiKeyListResponse {
  apiKeys: ApiKey[];
}

/** POST `/_admin/keys`. The only response that carries a token. */
export interface CreateApiKeyResponse {
  apiKey: ApiKey;
  /** Shown once. The server keeps only a hash. */
  token: string;
}

/**
 * POST `/_admin/keys` body. Admin keys are global and cannot touch objects;
 * data keys are bucket-scoped. A data key also needs at least one of
 * canRead/canWrite, which only the server can check.
 */
export type CreateApiKeyOptions =
  | {
      name: string;
      bucketName: null;
      canRead: false;
      canWrite: false;
      isAdmin: true;
    }
  | {
      name: string;
      bucketName: string;
      canRead: boolean;
      canWrite: boolean;
      isAdmin: false;
    };
