export function keyToFilename(key: string) {
  const keyParts = key.split("/").filter(Boolean);
  return keyParts.at(-1) ?? key;
}

// Smallest string that sorts strictly after every string starting with `prefix`
// — for `key >= prefix AND key < bound` range scans. Returns null when there is
// no such bound (a prefix that is entirely U+10FFFF); the caller then filters by
// the lower bound alone.
export function prefixUpperBound(prefix: string): string | null {
  const chars = [...prefix]; // split by code point (surrogate-safe)
  for (let i = chars.length - 1; i >= 0; i--) {
    const cp = chars[i]!.codePointAt(0)!;
    if (cp === 0x10ffff) continue; // max code point: drop it and carry left
    const next = cp === 0xd7ff ? 0xe000 : cp + 1; // skip the surrogate gap
    return chars.slice(0, i).join("") + String.fromCodePoint(next);
  }
  return null; // prefix was all U+10FFFF — no finite upper bound
}
