export function strictEncode(value: string) {
  return encodeURIComponent(value)
    .replaceAll("'", "%27")
    .replaceAll("(", "%28")
    .replaceAll(")", "%29")
    .replaceAll("*", "%2A");
}

export function uriEncodedKey(key: string) {
  return key.split("/").map(strictEncode).join("/");
}
