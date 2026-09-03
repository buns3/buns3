// Tier-2 test fixture: per-run throwaway SQLite + data dir.
//
// ORDER IS LOAD-BEARING: env must be set before ANY project module loads —
// storage/constants.ts and prisma.config.ts read env at import time. Only
// node/bun builtins may be imported statically here; everything project-side
// is imported dynamically by test files, which run after this preload.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = path.join(tmpdir(), "buns3-test");
// Template cache lives in the repo (gitignored `.cache/`), NOT in node_modules:
// `rm -rf node_modules && bun install` is this repo's documented linker fix and
// must not evict it; %TEMP% is subject to Windows temp sweeps. Run dirs (below)
// stay in tmpdir — they are per-run garbage and belong there.
const CACHE_DIR = path.join(".cache", "buns3-test");

// The migration tip hash keys the template cache — migrations change, the
// hash changes, the stale template is simply never used again.
const ref = JSON.parse(
  await Bun.file("src/modules/prisma/migrations/app/refs/db.json").text(),
) as { hash: string };
const template = path.join(CACHE_DIR, `template-${ref.hash}.sqlite`);

// Clean up previous runs NOW rather than at exit: exit-time deletion races
// Windows file locks, and a failed run's corpse stays inspectable until the
// next run starts.
if (existsSync(ROOT)) {
  for (const entry of readdirSync(ROOT)) {
    try {
      rmSync(path.join(ROOT, entry), { recursive: true, force: true });
    } catch {
      // a previous process may still hold a lock; its dir gets swept next run
    }
  }
}

const runDir = path.join(ROOT, `run-${crypto.randomUUID().slice(0, 8)}`);
const dataDir = path.join(runDir, "data");
mkdirSync(path.join(dataDir, ".tmp"), { recursive: true });

process.env.SQLITE_PATH = path.join(runDir, "db.sqlite");
process.env.DATA_PATH = dataDir;

// Template DB: migrate once per migration tip, file-copy per run.
//
// Cold build is ~2s (measured 2026-09-03: CLI startup ~1s + migrate <1s).
// `prisma` is a PINNED root devDependency so `bun x` resolves node_modules/.bin
// — zero registry contact, no version drift. An UNPINNED bunx here re-checks
// the npm registry for `latest` on every cold build: nondeterministic CLI
// version AND network-dependent latency (the only network step in `bun test`).
// The build announces itself on stderr so a slow one is visibly slow, never
// mistaken for a hang.
if (!existsSync(template)) {
  mkdirSync(CACHE_DIR, { recursive: true });
  console.error(
    `tier-2 fixture: building template DB ${path.basename(template)} (once per migration tip, ~2s)...`,
  );
  const t0 = performance.now();
  const res = spawnSync("bun", ["x", "prisma", "db", "migrate"], {
    env: { ...process.env, SQLITE_PATH: template },
    stdio: "pipe",
    shell: true,
  });
  if (res.status !== 0) {
    rmSync(template, { force: true });
    throw new Error(
      `tier-2 fixture: prisma db migrate failed building template:\n${res.stderr}`,
    );
  }
  console.error(
    `tier-2 fixture: template built in ${((performance.now() - t0) / 1000).toFixed(1)}s`,
  );
}
cpSync(template, process.env.SQLITE_PATH);
