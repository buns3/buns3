import { type } from "arktype";

export const Key = type(/^(?!\/+$)[^\u0000-\u001F\u007F]{1,1024}$/);

export const ObjectListQuery = type({
  "prefix?": Key,
  "after?": Key,
  "limit?": type("string.integer.parse").to("0 < number <= 1000"),
});

export type ObjectListQuery = typeof ObjectListQuery.infer;

export const BatchDelete = type({
  keys: Key.array().atLeastLength(1).atMostLength(1000),
});

export type BatchDelete = typeof BatchDelete.infer;
