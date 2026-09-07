import path from "node:path";
import { BASE_PATH } from "./constants";

export function resolveDirPath(dir: string, key: string) {
  return path.resolve(BASE_PATH, dir, key);
}

export function resolveFile(dir: string, key: string) {
  const filePath = resolveDirPath(dir, key);
  return Bun.file(filePath);
}
