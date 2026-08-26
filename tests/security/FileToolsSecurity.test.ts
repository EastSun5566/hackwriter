import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApprovalManager } from "../../src/agent/ApprovalManager.ts";
import { ReadFileTool } from "../../src/tools/file/ReadFileTool.ts";
import { ExportNoteTool } from "../../src/tools/hackmd/ExportNoteTool.ts";

const directories: string[] = [];

async function tempDir(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "hackwriter-security-"));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true })
  ));
});

describe("local file safety", () => {
  it("requires one-time approval before reading a sensitive file", async () => {
    const workDir = await tempDir();
    await fs.writeFile(path.join(workDir, ".env"), "SECRET_VALUE=do-not-log");
    const provider = { request: vi.fn().mockResolvedValue("approve_for_session") };
    const approval = new ApprovalManager(provider);
    const tool = new ReadFileTool(workDir, approval);

    await expect(tool.call({ filePath: ".env" })).resolves.toMatchObject({ ok: true });
    await expect(tool.call({ filePath: ".env" })).resolves.toMatchObject({ ok: true });

    expect(provider.request).toHaveBeenCalledTimes(2);
    expect(provider.request).toHaveBeenCalledWith(
      expect.objectContaining({ action: "read_sensitive_file", allowSession: false }),
      undefined,
    );
  });

  it("does not treat .env.example as a sensitive file", async () => {
    const workDir = await tempDir();
    await fs.writeFile(path.join(workDir, ".env.example"), "TOKEN=example");
    const provider = { request: vi.fn().mockResolvedValue("approve") };
    const tool = new ReadFileTool(workDir, new ApprovalManager(provider));

    await expect(tool.call({ filePath: ".env.example" })).resolves.toMatchObject({ ok: true });
    expect(provider.request).not.toHaveBeenCalled();
  });

  it("treats HackMD OAuth storage as a sensitive credential file", async () => {
    const workDir = await tempDir();
    await fs.writeFile(path.join(workDir, "hackmd-oauth.json"), "oauth-secret");
    const provider = { request: vi.fn().mockResolvedValue("approve") };
    const tool = new ReadFileTool(workDir, new ApprovalManager(provider));

    await expect(tool.call({ filePath: "hackmd-oauth.json" })).resolves.toMatchObject({
      ok: true,
    });
    expect(provider.request).toHaveBeenCalledWith(
      expect.objectContaining({ action: "read_sensitive_file", allowSession: false }),
      undefined,
    );
  });

  it("exports Markdown only inside the working directory after approval", async () => {
    const workDir = await tempDir();
    const client = {
      getNote: vi.fn().mockResolvedValue({ title: "Safe note", content: "# Content" }),
    };
    const provider = { request: vi.fn().mockResolvedValue("approve") };
    const tool = new ExportNoteTool(client as never, new ApprovalManager(provider), workDir);

    const result = await tool.call({ noteId: "note-1", outputPath: "exports/note" });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("ENOENT");
    await fs.mkdir(path.join(workDir, "exports"));
    await expect(tool.call({ noteId: "note-1", outputPath: "exports/note" }))
      .resolves.toMatchObject({ ok: true });
    await expect(fs.readFile(path.join(workDir, "exports/note.md"), "utf8"))
      .resolves.toBe("# Content");
    expect((await fs.stat(path.join(workDir, "exports/note.md"))).mode & 0o777).toBe(0o600);
    expect(tool.inputSchema.properties?.format).toBeUndefined();
  });

  it("rejects export paths outside the working directory before approval", async () => {
    const workDir = await tempDir();
    const client = {
      getNote: vi.fn().mockResolvedValue({ title: "Note", content: "content" }),
    };
    const provider = { request: vi.fn().mockResolvedValue("approve") };
    const tool = new ExportNoteTool(client as never, new ApprovalManager(provider), workDir);

    const result = await tool.call({ noteId: "note-1", outputPath: "../outside" });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("Security violation");
    expect(client.getNote).not.toHaveBeenCalled();
    expect(provider.request).not.toHaveBeenCalled();
  });

  it("propagates cancellation instead of converting it to a tool error", async () => {
    const workDir = await tempDir();
    await fs.writeFile(path.join(workDir, "note.md"), "content");
    const controller = new AbortController();
    controller.abort();

    await expect(new ReadFileTool(workDir).call(
      { filePath: "note.md" },
      controller.signal,
    )).rejects.toMatchObject({ name: "AbortError" });
  });
});
