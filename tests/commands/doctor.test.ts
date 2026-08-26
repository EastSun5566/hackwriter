import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { inspectDoctor } from "../../src/commands/doctor.ts";

describe("hackwriter doctor", () => {
  it("returns structured, redacted diagnostics without changing file modes", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "hackwriter-doctor-"));
    const configDir = path.join(home, ".hackwriter");
    const configPath = path.join(configDir, "config.json");
    await fs.mkdir(configDir, { recursive: true, mode: 0o700 });
    await fs.writeFile(configPath, JSON.stringify({
      version: 2,
      defaultModel: "",
      models: {},
      providers: {},
      services: { hackmd: { apiToken: "doctor-super-secret" } },
      loopControl: { maxStepsPerRun: 100, maxRetriesPerStep: 3 },
    }), { mode: 0o644 });
    try {
      const report = await inspectDoctor("test", { homeDir: home, network: false });
      const serialized = JSON.stringify(report);

      expect(report.version).toBe("test");
      expect(report.checks).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "files.config", status: "fail" }),
        expect.objectContaining({ id: "hackmd.api", status: "skip" }),
      ]));
      expect(serialized).not.toContain("doctor-super-secret");
      expect((await fs.stat(configPath)).mode & 0o777).toBe(0o644);
    } finally {
      await fs.rm(home, { recursive: true, force: true });
      vi.unstubAllEnvs();
    }
  });

  it("fails when a saved session file has unsafe permissions", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "hackwriter-doctor-"));
    const workspace = path.join(home, ".hackwriter", "sessions", "workspace");
    const history = path.join(workspace, "session.jsonl");
    await fs.mkdir(workspace, { recursive: true, mode: 0o700 });
    await fs.chmod(path.join(home, ".hackwriter", "sessions"), 0o700);
    await fs.writeFile(history, "", { mode: 0o644 });
    try {
      const report = await inspectDoctor("test", { homeDir: home, network: false });
      expect(report.checks).toContainEqual(expect.objectContaining({
        id: "files.session_contents",
        status: "fail",
      }));
    } finally {
      await fs.rm(home, { recursive: true, force: true });
      vi.unstubAllEnvs();
    }
  });

  it("recognizes the official cross-origin API and MCP pair as safe", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "hackwriter-doctor-"));
    vi.stubEnv("HACKMD_API_TOKEN", "doctor-token");
    vi.stubEnv("HMD_API_ACCESS_TOKEN", "");
    vi.stubEnv("HACKMD_API_URL", "");
    vi.stubEnv("HMD_API_ENDPOINT_URL", "");
    vi.stubEnv("HACKMD_MCP_URL", "");
    try {
      const report = await inspectDoctor("test", { homeDir: home, network: false });
      expect(report.checks).toContainEqual(expect.objectContaining({
        id: "hackmd.endpoints",
        status: "pass",
        summary: "Using the official HackMD API and MCP endpoints",
      }));
    } finally {
      await fs.rm(home, { recursive: true, force: true });
      vi.unstubAllEnvs();
    }
  });

  it("recognizes stored OAuth without requiring or rewriting an API token", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "hackwriter-doctor-"));
    const configDir = path.join(home, ".hackwriter");
    const oauthPath = path.join(configDir, "hackmd-oauth.json");
    await fs.mkdir(configDir, { recursive: true, mode: 0o700 });
    await fs.writeFile(oauthPath, JSON.stringify({
      version: 1,
      servers: {
        "https://mcp.hackmd.io": {
          clientInformation: { client_id: "doctor-client" },
          tokens: { access_token: "doctor-oauth-secret", token_type: "Bearer" },
        },
      },
    }), { mode: 0o644 });
    vi.stubEnv("HACKMD_API_TOKEN", "");
    vi.stubEnv("HMD_API_ACCESS_TOKEN", "");
    try {
      const report = await inspectDoctor("test", { homeDir: home, network: false });
      expect(report.checks).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "files.hackmd_oauth", status: "fail" }),
        expect.objectContaining({ id: "hackmd.oauth", status: "pass" }),
        expect.objectContaining({ id: "hackmd.credential", status: "pass" }),
        expect.objectContaining({ id: "hackmd.api", status: "skip" }),
      ]));
      expect(JSON.stringify(report)).not.toContain("doctor-oauth-secret");
      expect((await fs.stat(oauthPath)).mode & 0o777).toBe(0o644);
    } finally {
      await fs.rm(home, { recursive: true, force: true });
      vi.unstubAllEnvs();
    }
  });
});
