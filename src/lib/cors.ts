const LABEL = String.raw`[a-z0-9](?:[a-z0-9-]*[a-z0-9])?`;
const GLOB = new RegExp(
  `^(https?)://((?:\\*\\.)*${LABEL}(?:\\.${LABEL})*)(?::(\\d{1,5}|\\*))?$`,
);

export function globToRegExp(glob: string): RegExp | null {
  const m = GLOB.exec(glob);
  if (!m) return null;
  const [, scheme, host, port] = m;
  const body = host!
    .split(".")
    .map((s) => (s === "*" ? LABEL : s))
    .join(String.raw`\.`);
  const tail =
    port === undefined ? "" : port === "*" ? String.raw`:\d{1,5}` : `:${port}`;
  return new RegExp(`^${scheme}://${body}${tail}$`);
}

export function corsOrigin(v: string[] | "*"): "*" | RegExp[] {
  return v === "*" ? "*" : v.map((g) => globToRegExp(g)!);
}
