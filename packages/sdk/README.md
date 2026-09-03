# @buns3/sdk

The TypeScript client for [buns3](https://github.com/buns3/buns3). Objects,
buckets, keys, and presigned URLs you can mint offline.

Runs anywhere there's `fetch` and WebCrypto — browsers, Bun, Node, Deno, edge
runtimes. No runtime dependencies, and a test enforces that.

```bash
bun add @buns3/sdk
```

## Getting started

```ts
import { Buns3Client } from "@buns3/sdk";

const client = new Buns3Client("https://buns3.example.com", { token });

const res = await client.objects.put("photos", "cat.jpg", file, {
  contentType: "image/jpeg",
});

if (res.success) {
  console.log(res.data.location); // /photos/cat.jpg
} else {
  console.error(res.status, res.code);
}
```

Nothing throws. Every call returns `{ success: true, data }` or
`{ success: false, status, code, detail? }`. Network failures come back the
same way, as `status: 0` with `code: "NETWORK_ERROR"`.

## Two clients

No key works on both planes. An admin key can't touch objects; a data key
can't touch `/_admin`. So there are two clients.

```ts
const client = new Buns3Client(baseUrl, { token }); // objects, presign
const adminClient = new Buns3AdminClient(baseUrl, { token }); // buckets, keys
```

Both carry `self` (any valid key may introspect or revoke itself) and
`presigned` (following a presigned URL needs no credentials at all). The data
client's token is optional — without one you can still read public buckets and
follow presigned URLs. The admin client requires one, because the admin routes
have no anonymous path.

`baseUrl` must be an origin. Presigned URLs are assembled by concatenation, so
a base path would not survive.

## Objects

```ts
await client.objects.put(bucket, key, body, { contentType });
await client.objects.get(bucket, key, { anonymous });
await client.objects.head(bucket, key);
await client.objects.delete(bucket, key);
await client.objects.list(bucket, { prefix, after, limit });
await client.objects.deleteMany(bucket, keys);
```

`body` is anything `fetch` accepts: a string, `Blob`, `ArrayBuffer`, typed
array, or `ReadableStream`. A `Content-Type` always goes out — yours, else a
`Blob`'s own type, else `application/octet-stream`. The server stores whatever
it's given and never sniffs, so it's worth getting right. `blob.stream()` drops
the type, so streamed uploads should pass one.

`get` hands back the raw `Response`, so streaming, range requests and
cancellation stay available. `head` returns parsed metadata instead, since
with no body the headers are the whole answer.

Listing is keyset-paginated. Pass the previous page's `nextAfter` as `after`;
`null` means you've reached the end.

```ts
let after: string | undefined;
do {
  const page = await client.objects.list("photos", { after, limit: 100 });
  if (!page.success) break;
  for (const object of page.data.objects) console.log(object.key);
  after = page.data.nextAfter ?? undefined;
} while (after);
```

`deleteMany` reports per-key results in request order. Keys that were already
gone come back as `KEY_NOT_FOUND` items rather than failing the batch, so a
teardown racing another delete still finishes.

## Presigned URLs

Two ways to mint one.

```ts
// Offline: no network, just the token and WebCrypto.
const { url, expires } = await client.presign({
  method: "GET",
  bucket: "photos",
  key: "cat.jpg",
  ttl: 900,
});

// Server-validated: one round trip, checked before signing.
const res = await client.self.presign({ ... });
```

Offline signing costs nothing and works from a worker with no server in reach.
It's also blind: a key that lacks the capability still produces a well-formed
URL, which fails when someone follows it. `self.presign()` asks the server
first, so a wrong-bucket key fails at mint time with
`API_KEY_SCOPE_MISMATCH` rather than later.

Both return the same shape. `ttl` is a duration in seconds; `expires` is the
absolute timestamp it produced.

To follow a URL you were handed:

```ts
await client.presigned.get(url);
await client.presigned.put(url, body);
```

These send no credentials. The URL already carries its own, and presenting
both is rejected. There's no `presigned.list()`: a signature covers one method,
bucket, key and expiry, so a URL can't authorize enumeration or a batch.

## Admin

```ts
const { buckets, keys } = adminClient.admin;

await buckets.list();
await buckets.create(name);
await buckets.update(name, { publicRead: true });
await buckets.delete(name);

await keys.list();
await keys.create({ name, bucketName, canRead, canWrite, isAdmin });
await keys.delete(id);
```

Destructuring works because the planes are closures, not methods.

`keys.create` is the only response that carries a token, and it appears once —
the server keeps a hash. Listings return a `tokenHint`, enough to recognise a
key and not enough to use it.

The `CreateApiKeyOptions` union mirrors the server's schema, so an admin key
with a bucket, or a data key claiming `isAdmin`, won't compile. The remaining
rule — a data key needs at least one of `canRead`/`canWrite` — isn't
expressible in TypeScript and comes back as a 422.

## Errors

`code` is a string union covering everything the server can return, plus the
client-only `NETWORK_ERROR`:

```ts
const res = await client.objects.get("photos", "cat.jpg");
if (!res.success) {
  switch (res.code) {
    case "KEY_NOT_FOUND":
      return null;
    case "INVALID_API_KEY":
      return refreshCredentials();
    default:
      throw new Error(`${res.status} ${res.code}`);
  }
}
```

`status` is always the transport status, even when the response body disagrees.
A response the SDK can't parse as a buns3 error — a proxy's HTML, an empty
body, a code from a newer server — becomes `UNKNOWN` with the raw body in
`detail`, so an older SDK degrades instead of lying.

## Retries

On by default: three attempts, exponential backoff with full jitter, capped at
two seconds. Network errors and `502`/`503`/`504`/`429` are retried; a
`Retry-After` header is honored exactly.

```ts
new Buns3Client(baseUrl, { token, retry: { attempts: 5 } });
new Buns3Client(baseUrl, { token, retry: false });
```

`500` is not retried — those are server bugs carrying a correlation ref, not a
condition that improves by asking again. A request with a `ReadableStream` body
is never retried either: the stream is consumed by the first attempt, and a
retry would silently upload nothing.

## Decisions

**Results, not exceptions.** Every failure is a return value, so HTTP errors,
unparseable responses and dead networks are all handled in one place. There's
no path where a missing `try` takes down the caller.

**The SDK never gates on capability.** It won't check whether your key may
read a bucket, whether a TTL is under the cap, or whether a batch fits in 1000
keys. The server owns those rules and answers 422 or 403. A client that
second-guesses authorization eventually disagrees with the server, and the
client is the one that's wrong. Not offering what provably can't work is a
different thing, which is why the admin surface isn't on the data client.

**One encoder per layer.** Path segments are encoded by the route builder,
query values by `URLSearchParams`, and callers always pass raw values.
Encoding twice produces `%2520` and a key that can't be found; the rule is
that the layer writing the URL does the encoding, once.

**Timestamps stay strings.** `createdAt` and `lastModified` come through
exactly as sent. Reviving them to `Date` would invent a type the protocol
doesn't have, and anyone who wanted the string back would have to undo it.

**Zero runtime dependencies.** An SDK's dependencies become its consumers'
dependencies: version conflicts, install size, supply-chain surface. A test
scans every source file and fails on any non-relative import. A stray one
typechecks fine and only turns up in the bundle, which is how 147 kB of
validation library once got in.

**The offline signer is a port, not a reimplementation.** It produces
byte-identical signatures to the server's, pinned by frozen vectors and by an
anchor hash the server's own tests have asserted since before this package
existed. Two implementations of one signature stay honest only if something
compares them.

## Development

```bash
bun test              # 257 tests, ~90ms, all fakes — no server needed
bun x tsc --noEmit    # source
bun x tsc --noEmit -p tsconfig.test.json   # tests (Bun types live here)
bun run build         # tsdown -> dist/, dual ESM + CJS
```

Run the build before believing a change is finished: it's the only thing that
catches an import that resolved through the workspace but wouldn't resolve for
a consumer.

MIT.
