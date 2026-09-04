# buns3

A small S3-like object storage server, and a TypeScript client for it.
Buckets, objects, API keys, presigned URLs, listing — streamed to disk,
metadata in SQLite, one process.

Pronounced "bun-ess-three". Other pronunciations exist and are wrong, which
has never stopped anyone.

This is a learning project. S3 is the reference point, not the requirement:
its ideas are kept where they're independently good and dropped where they're
baggage. Every behavior below was decided on purpose, and the interesting
decisions are written down at the bottom, including the ones where buns3
deliberately does the opposite of S3.

Built on [Bun](https://bun.com), [Elysia](https://elysiajs.com) 2.0 (beta),
Prisma Next (RC) and [arktype](https://arktype.io). The stack is intentionally
bleeding-edge; version pins matter and `latest` tags lie.

## The client

If you just want to talk to a buns3 server, install
[`@buns3/sdk`](packages/sdk) and skip the rest of this page:

```bash
npm install @buns3/sdk
# or: bun add / pnpm add / yarn add
```

```ts
import { Buns3Client } from "@buns3/sdk";

const client = new Buns3Client("https://buns3.example.com", { token });
const res = await client.objects.put("photos", "cat.jpg", file);

if (res.success) console.log(res.data.location);
```

Only the server needs Bun. The client runs on Node, Deno, Bun, in browsers and
in edge runtimes — it uses `fetch` and WebCrypto and has no dependencies. That
includes signing presigned URLs offline, with no server round trip.

Nothing throws; every call returns a result you narrow on `success`. There are
two clients, because no key works on both planes. Full docs in
[`packages/sdk/README.md`](packages/sdk/README.md).

## Running a server

```bash
bun install
```

Create a `.env`:

```
PORT=8000
SQLITE_PATH=./data/db.sqlite
BASE_URL=http://localhost:8000
```

Apply migrations, mint the first admin key, start the server:

```bash
bunx prisma db migrate --advance-ref db
bun scripts/create-key.ts --name admin --admin
bun run dev
```

Tokens are shown once at mint time and never again — the server stores only a
SHA-256 hash. Buckets are created over the API: `PUT /_admin/buckets/:bucket`
with the admin key.

`tools/upload-tester.html` and `tools/admin-tester.html` are self-contained
browser consoles for the data plane and the control plane. Upload them into a
public bucket with `Content-Type: text/html` and they serve themselves.

## Deploying

There's a multi-stage `Dockerfile` and a `docker-compose.yml`. Set `BASE_URL`
and bring it up:

```bash
echo "BASE_URL=https://buns3.example.com" > .env
docker compose up -d
```

Two images come out of the one Dockerfile. `migrate` carries the Prisma CLI and
exits; `runtime` serves and doesn't. That split is worth the extra target: a
full install is 964 MB because the CLI pulls in Prisma's cloud tooling, against
131 MB for the server's actual dependencies.

Migrations run as a one-shot before the server starts, and the server waits for
them to succeed. They can't run at build time — the database lives on the
volume, which doesn't exist yet — and running them after the server is up would
mean serving on a schema that isn't there. Re-running is safe; the database's
marker table decides what's pending.

One volume, mounted at `/data` by both services. The database, the blobs and
the `.tmp` staging directory have to share a filesystem, because uploads are
written to `.tmp` and renamed into place, and rename is only atomic within one
filesystem. Splitting them would corrupt uploads rather than produce an error.

Both containers run as the unprivileged `bun` user. Ownership of a named volume
is inherited from the image at creation time, so a volume created before this
was true stays root-owned and has to be recreated.

Mint the first admin key inside the container:

```bash
docker compose exec server bun scripts/create-key.ts --name admin --admin
```

### Things to get right

**`BASE_URL` must be the public origin** — scheme and host, no trailing path.
Presigned URLs are minted against it by string concatenation, so a path-prefixed
deployment produces URLs that 404. There's no default on purpose: a wrong value
fails quietly, so an unset one fails loudly instead.

**Don't publish the container's port** if a reverse proxy fronts it. A published
port bypasses the proxy entirely — no TLS, and API tokens travel in cleartext.
Note that a published port also bypasses `ufw`, since Docker writes its own
iptables rules. Local port publishing belongs in a gitignored
`docker-compose.override.yml`.

**Raise the proxy's body limit to 5 GB**, or large uploads fail at the proxy
with an error that looks like it came from buns3. Note that a CDN may impose
its own limit you can't raise: Cloudflare caps request bodies at 100 MB on its
Free and Pro plans, which is a ceiling on uploads regardless of what buns3 and
your proxy allow. Downloads aren't affected — response size is unlimited.

**A CDN in front will cache public objects, which is intended.** buns3 sends
`Cache-Control` on every object response, chosen by how the request was
authorized: `public, max-age=60` when the read was anonymous — which is only
possible on a public-read bucket — and `private, no-store` whenever a key or a
signature was involved. So a CDN caches exactly the content that has no access
control, and never holds a response that required credentials. Sixty seconds is
short deliberately, because keys are mutable: it's how long an overwrite stays
invisible. Revalidation is cheap, since a matching `If-None-Match` gets a 304
of about 200 bytes rather than the object.

**One instance.** SQLite and local blobs mean a second replica corrupts the
first. That's a property of the design, not an oversight — see the decisions
below.

## The three planes

Every route belongs to exactly one plane, and each plane has one auth rule.

**Data plane — `/:bucket` and `/:bucket/*`.** Object operations, authorized by
key capability (read or write) scoped to the bucket.

**Admin plane — `/_admin/...`.** Bucket lifecycle and key management. Requires
an admin key, no exceptions. Admin keys cannot touch object data at all — an
admin that needs to read or write mints itself a data key.

**Credential plane — `/_self`.** Operations on whatever key the request
presented: any valid key may introspect itself, revoke itself, or presign for
itself.

Bucket names match `^[a-z][a-z0-9-]*$` (max 20 chars), which structurally
reserves the `_` prefix for non-bucket routes. Object keys are any non-control
characters up to 1024, defined after percent-decoding — clients must encode.

## API

### Objects

| | |
|---|---|
| `PUT /:bucket/:key` | Store an object. 201 with a `Location` header; overwrite is also 201. Empty bodies allowed. `Content-Type` is stored verbatim — no sniffing. Max 5 GB. |
| `GET /:bucket/:key` | The object, with stored content type, `Last-Modified`, `ETag`, range support and conditional requests — a matching `If-None-Match` gets a 304. |
| `HEAD /:bucket/:key` | Metadata headers only. |
| `DELETE /:bucket/:key` | 204, or 404 if absent. |
| `GET /:bucket` | List objects. `?prefix=`, `?after=<key>`, `?limit=` (1–1000, default 100). Keyset pagination: follow `nextAfter` until it's null. |
| `DELETE /:bucket` + `{"keys": [...]}` | Batch delete, 1–1000 keys. Per-key results; missing keys are reported, not fatal. A missing body is a 422, never "delete everything". |

### Admin

| | |
|---|---|
| `GET /_admin/buckets` | All buckets with object counts. |
| `PUT /_admin/buckets/:bucket` | Create. 201. |
| `GET /_admin/buckets/:bucket` | One bucket. |
| `PATCH /_admin/buckets/:bucket` | Update. Currently one flag: `{"publicRead": bool}`. At least one property required. |
| `DELETE /_admin/buckets/:bucket` | 204. Refuses non-empty buckets (409). Keys scoped to the bucket are deleted with it. |
| `GET /_admin/keys` | All keys — names, hints, capabilities, last-used. Never hashes. |
| `POST /_admin/keys` | Mint a key. Either a global admin key or a bucket-scoped data key with at least one of read/write. The token appears in this response and nowhere else. |
| `DELETE /_admin/keys/:id` | Revoke. The bearer gets 401 on its very next request. |

### Self

| | |
|---|---|
| `GET /_self` | Who am I — the presented key, mapped, no secrets. |
| `DELETE /_self` | Revoke the presented key. Any key may destroy itself. |
| `POST /_self/presign` | `{"method", "bucket", "key", "ttl"}` → a presigned URL. A key can only presign operations it could perform itself. |

Errors are RFC 9457 problem+json with a machine-readable `code` field.
401 means missing, malformed, or unknown credentials; 403 means authenticated
but not allowed; 422 means the request itself is invalid — and validation runs
before auth, so a malformed bucket name is a 422 even with no credentials
(S3 does the reverse).

## Auth

Keys carry three independent capabilities — `canRead`, `canWrite`, `isAdmin` —
with no hierarchy. Write does not imply read. Admin implies nothing about
object data. Data keys are always scoped to one bucket; admin keys are always
global. Keys are immutable: rotation means minting a new key and deleting the
old one, never editing a live credential.

Tokens are `buns3_` plus 32 random bytes, base64url. Presented as
`Authorization: Bearer <token>`.

**Public-read buckets** (`publicRead`, off by default) allow anonymous GETs of
objects. Only truly anonymous requests qualify: present any credential and you
are judged as that credential, so an admin key gets 403 on a bucket where
anonymous gets 200. Drop the header to read publicly. Anonymous requests to
private and nonexistent buckets both get the same 401 — there is no way to
probe which bucket names exist. Public-read never grants listing: public
objects, private index.

## Presigned URLs

A presigned URL grants one method on one object until an expiry:

```
/:bucket/:key?keyId=...&expires=...&sig=...
```

The signature is HMAC-SHA256 over `method|bucket|key|expires`, keyed by the
SHA-256 of the signing token. Since the client holds the token, it can compute
everything offline — no server round-trip, which is what `scripts/presign.ts`
does. `POST /_self/presign` does the same thing server-side for convenience.

Properties worth knowing:

- The verified signer goes through normal authorization, so a URL signed by a
  key that couldn't perform the operation itself is refused. Admin keys can't
  presign anything.
- TTL is capped at 7 days (S3 parity, kept for its own sake: presigned URLs
  can't be revoked individually, so the cap bounds how long a leaked link
  lives). A URL also dies the moment its signing key is revoked — and unlike
  S3, that's the *only* early death; there is no session-expiry surprise.
- Expiry is inclusive (`now <= expires`, unix seconds). `ttl: 0` is legal and
  means "this second only".
- The host is not part of the signature — a URL minted against localhost works
  through a tunnel unchanged. S3 signs the host; buns3 deliberately doesn't.
- Every failure except expiry collapses to the same 401. Expiry gets its own
  code (`PRESIGNED_EXPIRED`) because it's the one failure an honest client
  hits and can fix.

## Decisions

The ledger. Each of these was chosen over the alternative on purpose.

**Validation before auth.** A request that could never be valid is a 422
regardless of credentials. S3 authenticates first; buns3 prefers telling the
truth about the request over hiding route shapes, and reserves 401 for
credentials.

**No existence oracles.** Anonymous callers can't distinguish a private bucket
from a missing one (both 401). A wrong-scope key gets 403 without the server
consulting whether the target exists. Stray requests under `_`-prefixed paths
fail bucket-name validation (422) without any lookup — real S3 answers the
same probe with 404 `NoSuchBucket`, existence disclosed.

**`/favicon.ico` is the one un-prefixed root route.** Every non-bucket route
takes a `_` prefix so a bucket name can never shadow it — but browsers ask for
`/favicon.ico` by that exact name, and it would otherwise be read as a bucket
and rejected with a 422. It answers 204. The exception is safe rather than
convenient: `favicon.ico` contains a dot, so it can never be a valid bucket
name and cannot collide with one.

**HEAD exists only for objects.** It's the one endpoint where the body is
expensive to send; everything else returns small JSON, so GET is the answer.
HEAD on an object agrees with GET about existence — if GET would 404, so does
HEAD.

**Deletes are honest, not idempotent.** Deleting something that isn't there is
a 404 (or a per-key `KEY_NOT_FOUND` in a batch), not S3's cheerful 204. If you
thought it existed and it didn't, that's information.

**`createdAt` is the current version's write time.** Overwriting an object
moves it, together with the ETag. It answers "when was this content written",
not "when did this key first appear".

**Cacheability follows the credential, not the bucket.** An object read
anonymously is `public, max-age=60`; the same object read with a key or a
presigned signature is `private, no-store`. A public bucket read with a key is
still private, because the response was authenticated — the same reasoning that
makes a presented key always judged as that key. `Vary: Authorization` goes out
with both, since one URL serves both callers. The window is short because keys
are mutable, and conditional requests keep revalidation to a few hundred bytes.

**Content types are stored verbatim.** Whatever `Content-Type` came with the
PUT is what GET serves — default `application/octet-stream`, no sniffing.
Upload HTML as `text/plain` and it downloads as text; that's considered
correct.

**Timestamps are stamped in JS, never by the database.** SQLite's
`datetime('now')` writes a string that round-trips through the ORM's codec as
local time — a two-hour bug on this timezone. Database defaults exist only
where they can solely fail closed (`publicRead 0`).

**Listing never knows the total.** Keyset pagination is stable under
concurrent writes precisely because it doesn't count; a `total` field would
cost an extra racing query to be stale on arrival. Bucket object counts live
on the admin plane. There's also no folder emulation — `prefix` is a filter,
not a hierarchy.

**Batch delete deletes the versions it saw.** The batch resolves keys to
object versions first and deletes by id, so a concurrent overwrite survives.
Duplicates in the request are deduped silently. Blob file cleanup is
best-effort after the pointers are gone — a failed unlink is a logged orphan,
never a client error.

**One bug, one lesson.** Every gotcha this project has hit — beta framework
lies, ORM codec surprises, timezone skews — is written into `CLAUDE.md` with
the probe that proved it. The wire is the source of truth; the docs (including
this one) are claims about it.

## Development

```bash
bun test              # 453 tests, ~1.2s, server and SDK
bun x tsc --noEmit    # Bun does not type-check; this does
bun run dev           # watch mode on :8000
```

A Bun workspace: the server at the root, the client in `packages/sdk`. `bun
test` from the root runs both. Server tests come in two tiers — pure functions,
and a real SQLite database and filesystem in a throwaway directory per run.

Auth changes additionally get a curl matrix — 47 request/response cases
pinning every status and error code — before they're believed. The data
directory (`data/`) is gitignored: databases and blobs don't travel, and
neither do tokens, which are unrecoverable hashes on any other machine.
