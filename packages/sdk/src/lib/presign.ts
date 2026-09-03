export const PRESIGN_HTTP_METHODS = ["DELETE", "GET", "HEAD", "PUT"] as const;

export type PresignHTTPMethod = (typeof PRESIGN_HTTP_METHODS)[number];
