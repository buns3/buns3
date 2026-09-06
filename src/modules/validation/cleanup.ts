import { type } from "arktype";

export const Cleanup = type({
  dryRun: "boolean = false",
});

export type Cleanup = typeof Cleanup.infer;
