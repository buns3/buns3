# buns3 — project context

Lightweight S3-like object storage server. **Learning project**: Sebastian writes the code; Claude advises, reviews, and runs verification probes — don't write feature code unless explicitly asked. Claude SHOULD run curl probes / scripts / tsc to verify claims empirically ("trust the wire, not the docs" is the house method).

## Philosophy

- **Not an S3 clone.** S3 is a reference point, not a requirement. Simplicity wins. S3 ideas are kept only when independently good (bucket name rules, refuse deleting non-empty buckets, 403-without-existence-check outside key scope).
- Decisions are made deliberately and documented; "decide on purpose, write it down" over accidental behavior.
- Empiricism: every claim gets verified with a probe (curl, scratch scripts, reading node_modules types/dist as ground truth). Betas lie; types lie; the wire decides.

## Stack (deliberately bleeding-edge; pin exact versions)

- **Bun** runtime. `bun run dev` = `bun --watch ./src`. Bun does NOT type-check: run `bun x tsc --noEmit` explicitly (worth doing before believing any refactor).
- **Elysia 2.0 beta** (pinned). Plugins must be their `2.0.0-*` releases — npm `latest` tags still point at 1.4-era builds whose peer ranges falsely allow 2.0. Check dist-tags (`next`) before adding any plugin.
- **Prisma Next (Prisma 8 RC)** — contract-first: `src/modules/prisma/contract.prisma` → `bunx prisma contract emit` → migration plan → apply. READ migration plans before applying (no rename detection; renames render as destructive drop+add). CLI: `--json` gives full error envelopes where `-v` shows nothing.
- **arktype** for validation (Standard Schema). **`@elysia/openapi` is locally patched** (`patches/`) — its dist/gen had broken relative typebox imports; patch reapplies on install via `bun patch`.

## Architecture

- `src/lib/` — framework-free (no Elysia imports; enforced by comment in error.ts): error codes, `Buns3Error`/`Buns3ValidationError`, `unwrap`, key/encoding helpers (`strictEncode`, `uriEncodedKey`, `keyToFilename`).
- `src/modules/storage/` — fileStorage + bucketStorage. **Results-as-values, never throws.** Flat blob layout: `data/<bucket>/<uuid>`, metadata in SQLite; keys are opaque strings that never touch the filesystem. Write-order invariants: blob durable before pointer commit; pointer dropped before blob unlink; temp files in `data/.tmp` then rename (same-fs atomic). Failed unlinks are logged orphans, not client errors.
- `src/modules/api-keys/` — keyStorage. Tokens `buns3_` + 32 bytes base64url; SHA-256 hex digest stored (never the token; hash never leaves the server); `toApiKey` mapping allowlists fields and converts 0/1→boolean (SQLite target has NO boolean codec — capability columns are Int). verify = format regex → hash → single find-and-touch UPDATE (also stamps lastUsedAt).
- `src/modules/http/` — Elysia shell. Handlers `unwrap()` storage results into throws; central error rendering.
- `src/modules/validation/` — arktype schemas. `CreateApiKey` is a discriminated union: global admin (isAdmin true, bucketName null, canRead/canWrite false) | bucket data key (isAdmin false, bucketName required, ≥1 of read/write via narrow). Bucket names: `^[a-z][a-z0-9-]*$` ≤20 — structurally excludes `_admin` (that's why the underscore prefix). Keys: any non-control chars ≤1024, not slash-only.

## Auth model

- Independent capabilities (no hierarchy): canRead, canWrite, isAdmin. **Admin = control plane only** (cannot read/write objects; mints itself a data key when needed). Data keys are always bucket-scoped; admin keys always global. write does NOT imply read.
- Elysia macro `auth: (capability?: "read"|"write"|"admin"|true)` — `true` = any valid key (whoami). derive verifies token (bucket-blind); beforeHandle enforces capability + scope. This split is load-bearing: derives run before beforeHandles, guaranteeing bucketKey validation (422) precedes scope checks (403). Scope mismatch → 403 KEY_SCOPE_MISMATCH without consulting bucket existence (S3-style, no existence oracle).
- 401 (INVALID_API_KEY, with WWW-Authenticate: Bearer) = missing/malformed/unknown credentials; 403 = authenticated but insufficient. Bearer scheme required, case-insensitive prefix.
- Bootstrap: `bun scripts/create-key.ts --name X [--bucket B] [--read] [--write] [--admin]` — prints token ONCE. `/_admin/keys` POST is admin-gated; key zero comes from the script.

## Error handling

- Storage returns `{success, code}` results; HTTP throws `Buns3Error(code)` (via `unwrap`) or `Buns3ValidationError(arkErrors)`.
- `http/error.ts`: `ERROR_STATUS` table `satisfies Record<Buns3AnyErrorCode, number>` (compiler-enforced totality — adding a code without a status breaks the build). Per-class `.error()` registrations render problem+json (RFC 9457) with `code` as extension member; validation errors carry arktype `summary` in `detail`. 500s: generic detail + correlation ref, full error logged server-side. Fallback registration must never throw.
- SQL error translation via structural guards in storage/errors.ts: `isUniqueViolation` (sqlState 23505), `isFkViolation` (23503). SQLite never names FK constraints (`constraint: undefined`) — one Restrict-FK per operation context max, disambiguate by context not constraint.

## Elysia 2.0 gotchas (all learned the hard way)

- Streaming routes need `parse: 'none'` — the parser consumes recognized content-types even without a body schema. Raw stream: destructure `{ request }`, use `request.body`. Never declare body schemas on streaming routes.
- **Params arrive pre-decoded** — do NOT decodeURIComponent again (double-decode aliases keys with literal %).
- `ctx.params` is **undefined** on param-less routes (types claim otherwise) — use `params?.`.
- Wildcard `/:bucket/*` also matches single-segment paths (`/foo` → empty key → NotFound thrown).
- Macros: options-before-handler arg order works; `beforeHandle` isn't suggested by autocomplete but type-checks; macro's own derive output isn't typed in its beforeHandle ctx (cast with comment).
- Returning BunFile gets free HTTP range support (206). Don't set Content-Length on GET (framework computes, range-aware); DO set it manually on HEAD from object.size, and return a raw `new Response(null, {headers})` (returning `{}` serializes to 2-byte body).
- Elysia auto-strips bodies on HEAD responses — no isHead special-casing needed in error handlers.
- Schema-slot validation loses Standard Schema (arktype) issue messages (beta bug) — admin routes validate MANUALLY in handlers (`CreateApiKey(body)` → throw Buns3ValidationError). Revisit when fixed upstream.
- openapi plugin: RegExp excludes are silently broken (`includes()` not `.test()`) — use exact Elysia route strings; data plane is excluded (wildcards inexpressible in OpenAPI). Docs at `/openapi`, admin plane only, Bearer scheme configured.

## Wire contract highlights

- PUT object: 201 + percent-encoded relative `Location`; overwrites also 201. Empty body allowed (zero-byte objects, S3-style). Content-Type stored verbatim from header (default application/octet-stream, no sniffing — sniffing was deliberately rejected). Max body 5GB (`serve.maxRequestBodySize`).
- GET: metadata-driven headers (stored content-type, Last-Modified UTC, RFC5987 Content-Disposition inline with encoded filename, quoted ETag = blob id). HEAD mirrors GET minus framework-computed headers.
- DELETE object/bucket: 204; missing → 404 (deliberate, not S3's idempotent 204). Bucket delete refuses non-empty (409 BUCKET_NOT_EMPTY, count pre-check + FK backstop) and removes the empty dir best-effort.
- Keys are defined AFTER percent-decoding; clients must encode. Validation precedes auth (422 before 401/403 — S3 does the reverse; documented trade for lifecycle-ordering robustness).

## Dev setup (new machine)

1. `bun install` (applies `patches/`), copy/create `.env`: `PORT=8000`, `SQLITE_PATH=./data/db.sqlite`, `BASE_URL=http://localhost:8000`.
2. `data/` is gitignored: DB + blobs do NOT travel. Fresh machine = fresh DB: run the Prisma migration apply flow, then `bun scripts/create-key.ts --name admin --admin` for key zero, create buckets via `PUT /_admin/buckets/:name`.
3. Old tokens are hashes in the old DB — they don't transfer; mint new ones.
4. `bun x tsc --noEmit` and the curl matrix are the acceptance rituals after any change to auth/routes.

## Current state & queue (2026-08-30)

DONE: object storage (streaming, atomic, metadata), bucket lifecycle, API-key auth end-to-end, Elysia 2.0 port (commit 3c2119a), OpenAPI admin docs + bucket object counts (4ef9f81).

NEXT (in order):
1. **Public-read bucket flag** — designed, not started: `publicRead Int @default(0)` on Bucket (deny-by-default is the one OK auth default), additive migration, `PATCH /_admin/buckets/:name` {publicRead}, toBucket mapping (booleanize, don't leak 0/1 — same lesson as toApiKey), auth macro fallback: no header + capability "read" + bucket public → allow; presented-but-invalid credentials still 401 (S3 semantics).
2. **Upload tester page** (currently 401-locked out of its own bucket — it needs public-read to load in a browser; page source lives in Claude's scratchpad history, re-uploadable, has key field for writes).
3. **Upstream bug reports** (receipts in git/transcripts): Elysia — Content-Range on 200s ("undefined" on empty files), Standard Schema messages dropped in schema-slot validation, macro beforeHandle autocomplete; @elysia/openapi — broken dist/gen typebox imports (patched locally), RegExp exclude ignored, 1.4.15's uncapped peer range.
4. Perennials: test files (validators/encoders/keyStorage round-trip — all edge cases already known from probes), README (API + documented decisions), phase 4: presigned URLs (HMAC over method+bucket+key+expiry, query-param auth path in the macro).

## Sebastian

Works best late evenings/nights — never suggest wrapping up for the night. Prefers advice over written code (but asks explicitly when he wants code). No AI attribution in commits, ever. Values: decide-deliberately, README-the-decision, one-lesson-per-bug.
