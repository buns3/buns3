import { extractKey } from "$/lib/route";

export function bucketKeyMiddleware(req: {
  url: string;
  params: { bucket: string };
}) {
  const result = extractKey(req.url);
  if (!result.success) return new Response(null, { status: 400 });
  return { ...req.params, key: result.key };
}
