export function keyToFilename(key: string) {
  const keyParts = key.split("/").filter(Boolean);
  return keyParts.at(-1) ?? key;
}

export function prefixUpperBound(prefix: string) {
  const last = prefix.codePointAt(
    prefix.length -
      (prefix.length > 1 && /[\uD800-\uDBFF]/.test(prefix[prefix.length - 2]!)
        ? 2
        : 1),
  )!;
  const head = prefix.slice(0, -String.fromCodePoint(last).length);
  const next = last === 0xd7ff ? 0xe000 : last + 1;
  return head + String.fromCodePoint(next);
}
