import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

const INCREMENTS = ["patch", "minor", "major"] as const;
type Increment = (typeof INCREMENTS)[number];

// The server and @buns3/sdk carry one number. Both move or neither does.
const MANIFESTS = ["package.json", "packages/sdk/package.json"] as const;

const RELEASE_BRANCH = "main";

// CLAUDE.md's acceptance ritual, minus the curl matrix — that one needs a
// running server and a human reading it.
const RITUAL: { label: string; cmd: string[]; cwd?: string }[] = [
  { label: "bun test", cmd: ["bun", "test"] },
  { label: "tsc", cmd: ["bun", "x", "tsc", "--noEmit"] },
  {
    label: "tsc (integration)",
    cmd: ["bun", "x", "tsc", "--noEmit", "-p", "tsconfig.integration.json"],
  },
  {
    label: "tsc (sdk tests)",
    cmd: ["bun", "x", "tsc", "--noEmit", "-p", "tsconfig.test.json"],
    cwd: "packages/sdk",
  },
  { label: "sdk build", cmd: ["bun", "run", "build"], cwd: "packages/sdk" },
];

const { values, positionals } = parseArgs({
  strict: true,
  allowPositionals: true,
  options: {
    help: { type: "boolean", short: "h" },
    push: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
  },
});

if (values.help) {
  console.log(`Usage: bun scripts/release.ts <${INCREMENTS.join("|")}> [options]

      --push        Push the branch and tag when done (this deploys)
      --dry-run     Run every check, change nothing
      --help   -h   This

  Bumps both manifests, runs the acceptance ritual against the bumped tree,
  commits, and tags. The tag is what Dokploy deploys.
  `);
  process.exit(0);
}

function die(message: string): never {
  console.error(message);
  process.exit(1);
}

function git(...args: string[]) {
  const run = Bun.spawnSync(["git", ...args]);
  if (run.exitCode !== 0) {
    die(`git ${args.join(" ")} failed:\n${run.stderr.toString().trim()}`);
  }
  return run.stdout.toString().trim();
}

function readVersion(path: string) {
  const found = readFileSync(path, "utf8").match(/^\s*"version":\s*"([^"]+)"/m);
  if (!found?.[1]) die(`${path} has no version field`);
  return found[1];
}

function writeVersion(path: string, next: string) {
  // A targeted replace rather than JSON.parse/stringify: reserialising would
  // reformat and reorder manifests that are maintained by hand.
  const text = readFileSync(path, "utf8");
  writeFileSync(path, text.replace(/^(\s*"version":\s*")[^"]+(")/m, `$1${next}$2`));
}

function bump(version: string, increment: Increment) {
  const parts = version.split(".").map(Number);
  const [major, minor, patch] = parts;
  if (parts.length !== 3 || parts.some((n) => !Number.isInteger(n))) {
    die(`${version} is not plain x.y.z — bump prereleases by hand`);
  }
  if (increment === "major") return `${major! + 1}.0.0`;
  if (increment === "minor") return `${major}.${minor! + 1}.0`;
  return `${major}.${minor}.${patch! + 1}`;
}

const increment = positionals[0] as Increment | undefined;
if (!increment || !INCREMENTS.includes(increment)) {
  die(`Usage: bun scripts/release.ts <${INCREMENTS.join("|")}> [--push] [--dry-run]`);
}

const branch = git("rev-parse", "--abbrev-ref", "HEAD");
if (branch !== RELEASE_BRANCH) die(`On ${branch}; releases come from ${RELEASE_BRANCH}`);

// Anything uncommitted would end up inside the tag without ever being reviewed.
if (git("status", "--porcelain")) die("Working tree is dirty; commit or stash first");

git("fetch", "--tags", "--quiet");
if (git("rev-parse", "HEAD") !== git("rev-parse", `origin/${RELEASE_BRANCH}`)) {
  die(`HEAD and origin/${RELEASE_BRANCH} disagree; pull or push before releasing`);
}

const current = readVersion(MANIFESTS[0]);
for (const manifest of MANIFESTS) {
  const found = readVersion(manifest);
  if (found !== current) die(`Lockstep broken: ${MANIFESTS[0]} is ${current}, ${manifest} is ${found}`);
}

const next = bump(current, increment);
const tag = `v${next}`;
if (git("tag", "--list", tag)) die(`${tag} already exists`);

if (increment === "major") {
  console.log("Note: the ledger says stay 0.x until the wire contract is stable.\n");
}
console.log(`${current} -> ${next}${values["dry-run"] ? " (dry run)" : ""}\n`);

// Bump first so the ritual runs against the exact tree that gets tagged —
// version.test.ts and the integration tests both assert on these numbers.
for (const manifest of MANIFESTS) writeVersion(manifest, next);

for (const step of RITUAL) {
  process.stdout.write(`${step.label} ... `);
  const run = Bun.spawnSync(step.cmd, { cwd: step.cwd });
  if (run.exitCode !== 0) {
    console.log("FAILED\n");
    console.error(run.stdout.toString() + run.stderr.toString());
    git("checkout", "--", ...MANIFESTS);
    die(`${step.label} failed; manifests reverted, nothing tagged`);
  }
  console.log("ok");
}

if (values["dry-run"]) {
  git("checkout", "--", ...MANIFESTS);
  console.log(`\nDry run: everything passed. Would have tagged ${tag}`);
  process.exit(0);
}

git("add", ...MANIFESTS);
git("commit", "-m", `Release ${tag}`);
git("tag", "-a", tag, "-m", `buns3 ${next}`);
console.log(`\nTagged ${tag}`);

if (values.push) {
  git("push", "--follow-tags");
  console.log("Pushed. The tag triggers a deploy.");
} else {
  console.log("Not pushed. To release:\n\n  git push --follow-tags\n");
}
