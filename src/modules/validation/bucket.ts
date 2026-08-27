import { type } from "arktype";

export const BucketName = type("0 < /^[a-z]{1}[a-z0-9-]{0,}$/ <= 20");
