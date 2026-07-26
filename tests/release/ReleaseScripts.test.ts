import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageJson = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
);
const script = fileURLToPath(new URL("../../scripts/verify-release-tag.mjs", import.meta.url));

describe("release scripts", () => {
  it("accepts a tag matching package.json", () => {
    const result = spawnSync(process.execPath, [script, `v${packageJson.version}`]);
    expect(result.status).toBe(0);
  });

  it("rejects a tag that does not match package.json", () => {
    const result = spawnSync(process.execPath, [script, "v0.0.0-mismatch"]);
    expect(result.status).toBe(1);
  });
});
