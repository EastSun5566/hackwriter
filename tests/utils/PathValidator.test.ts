import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PathValidator } from "../../src/utils/PathValidator.ts";
import { ReadFileTool } from "../../src/tools/file/ReadFileTool.ts";
import { WriteFileTool } from "../../src/tools/file/WriteFileTool.ts";

const temporaryDirectories: string[] = [];

async function fixture(): Promise<{ root: string; outside: string }> {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "hackwriter-path-"));
  temporaryDirectories.push(base);
  const root = path.join(base, "work");
  const outside = path.join(base, "outside");
  await fs.mkdir(root);
  await fs.mkdir(outside);
  await fs.writeFile(path.join(root, "inside.md"), "inside");
  await fs.writeFile(path.join(outside, "secret.md"), "secret");
  return { root, outside };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true }),
  ));
});

describe("PathValidator working-directory boundary", () => {
  it("accepts relative and absolute paths inside the working directory", async () => {
    const { root } = await fixture();
    const realRoot = await fs.realpath(root);
    await expect(PathValidator.validateExisting("inside.md", root)).resolves.toBe(
      path.join(realRoot, "inside.md"),
    );
    await expect(
      PathValidator.validateExisting(path.join(root, "inside.md"), root),
    ).resolves.toBe(path.join(realRoot, "inside.md"));
  });

  it("rejects traversal, absolute and symlink paths outside the boundary", async () => {
    const { root, outside } = await fixture();
    await fs.symlink(outside, path.join(root, "escape"));
    await expect(PathValidator.validateExisting("../outside/secret.md", root)).rejects.toThrow(
      "outside the working directory",
    );
    await expect(PathValidator.validateExisting(path.join(outside, "secret.md"), root)).rejects.toThrow(
      "outside the working directory",
    );
    await expect(PathValidator.validateExisting("escape/secret.md", root)).rejects.toThrow(
      "outside the working directory",
    );
    await expect(PathValidator.validateForWrite("escape/new.md", root)).rejects.toThrow(
      "outside the working directory",
    );
  });

  it("validates a new write before requesting approval", async () => {
    const { root } = await fixture();
    const approval = { request: vi.fn().mockResolvedValue(true) };
    const tool = new WriteFileTool(approval as never, root);
    const result = await tool.call({ filePath: "../blocked.md", content: "no" });
    expect(result.ok).toBe(false);
    expect(approval.request).not.toHaveBeenCalled();
  });

  it("reads an in-bound file through the validated real path", async () => {
    const { root } = await fixture();
    const result = await new ReadFileTool(root).call({ filePath: "inside.md" });
    expect(result.ok).toBe(true);
    expect(result.output).toContain("inside");
  });
});
