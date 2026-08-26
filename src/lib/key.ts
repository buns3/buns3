export function keyToFilename(key: string) {
  const keyParts = key.split("/").filter(Boolean);
  return keyParts.at(-1) ?? key;
}
