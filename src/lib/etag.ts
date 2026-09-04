export function etagMatches(ifNoneMatch: string, etag: string) {
  if (ifNoneMatch === "*") {
    return true;
  }

  const etags = ifNoneMatch
    .split(",")
    .map((etag) => etag.trim().replace(/^W\//, ""));
  return etags.includes(etag);
}
