import { describe, expect, test } from "bun:test";
import { version as serverVersion } from "../package.json";
import { version as sdkVersion } from "../packages/sdk/package.json";

// The server and @buns3/sdk ship one version number. Nothing else enforces
// that — the integration suite proves the pair works, not that they agree on
// what to call themselves — so the invariant lives here.

describe("server and SDK versions", () => {
  test("are in lockstep", () => {
    expect(sdkVersion).toBe(serverVersion);
  });

  test("are plain semver, no leading v", () => {
    // The git tag carries the v; the manifests must not, or the wire and the
    // registry disagree with the tag.
    expect(serverVersion).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
  });
});
