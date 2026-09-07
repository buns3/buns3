/** An upload session: one row and one growing file on the server. */
export interface Upload {
  uploadId: string;
  bucket: string;
  /** Raw, unencoded. */
  key: string;
  /** Fixed when the session opens; chunks do not carry one. */
  contentType: string;
  /** Bytes the server has recorded. Resume from here — it is the truth. */
  size: number;
  createdAt: string;
  /** Moves on every append. A session idle past the server's TTL is collected. */
  updatedAt: string;
}

/** Every session response wraps the session: create, append and get alike. */
export interface UploadResponse {
  upload: Upload;
}

/** POST `/_uploads` body. */
export interface CreateUploadOptions {
  bucket: string;
  /** Raw, unencoded. */
  key: string;
  /** Defaults to application/octet-stream, and cannot change afterwards. */
  contentType?: string;
}

/** POST `/_uploads/:id/presign` response. */
export interface UploadPresignResponse {
  /** One URL for every chunk and the completion — but not DELETE. */
  url: string;
  /** Absolute unix timestamp, not the ttl it was built from. */
  expires: number;
}
