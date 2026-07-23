import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CredentialStore } from "@earendil-works/pi-ai";

import { ConfigurationLoader } from "../../src/config/ConfigurationLoader.ts";
import { FileCredentialStore } from "../../src/config/FileCredentialStore.ts";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "hackwriter-config-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true }),
  ));
});

describe("ConfigurationLoader v2 migration", () => {
  it("atomically migrates provider keys and preserves aliases and overrides", async () => {
    const directory = await temporaryDirectory();
    const configPath = path.join(directory, "config.json");
    const authPath = path.join(directory, "auth.json");
    await fs.writeFile(configPath, JSON.stringify({
      defaultModel: "fast",
      models: {
        fast: { provider: "openai", model: "custom", maxContextSize: 123_456 },
      },
      providers: {
        openai: {
          type: "openai",
          apiKey: "legacy-secret",
          baseUrl: "https://llm.example/v1",
          organizationId: "org-1",
          projectId: "project-1",
        },
      },
      services: { hackmd: { apiToken: "hackmd-secret" } },
      loopControl: { maxStepsPerRun: 50, maxRetriesPerStep: 2 },
    }));
    const credentials = new FileCredentialStore(authPath);

    const loaded = await ConfigurationLoader.load({ configPath, credentials });
    expect(loaded).toMatchObject({
      version: 2,
      defaultModel: "fast",
      models: { fast: { model: "custom", maxContextSize: 123_456 } },
      providers: {
        openai: {
          baseUrl: "https://llm.example/v1",
          organizationId: "org-1",
          projectId: "project-1",
        },
      },
    });
    expect(loaded.providers.openai.apiKey).toBeUndefined();
    await expect(credentials.read("openai")).resolves.toEqual({
      type: "api_key",
      key: "legacy-secret",
    });
    await expect(credentials.list()).resolves.toEqual([
      { providerId: "openai", type: "api_key" },
    ]);

    const persisted = JSON.parse(await fs.readFile(configPath, "utf8"));
    expect(persisted.version).toBe(2);
    expect(persisted.providers.openai.apiKey).toBeUndefined();
    expect((await fs.stat(configPath)).mode & 0o777).toBe(0o600);
    expect((await fs.stat(authPath)).mode & 0o777).toBe(0o600);

    await expect(
      ConfigurationLoader.load({ configPath, credentials }),
    ).resolves.toMatchObject({ version: 2, defaultModel: "fast" });
  });

  it("does not rewrite the source config when credential migration fails", async () => {
    const directory = await temporaryDirectory();
    const configPath = path.join(directory, "config.json");
    const original = JSON.stringify({
      providers: { openai: { type: "openai", apiKey: "keep-me" } },
    });
    await fs.writeFile(configPath, original);
    const failingStore: CredentialStore = {
      read: async () => undefined,
      list: async () => [],
      modify: async () => { throw new Error("disk full"); },
      delete: async () => undefined,
    };

    await expect(
      ConfigurationLoader.load({ configPath, credentials: failingStore }),
    ).rejects.toThrow("Failed to load configuration");
    expect(await fs.readFile(configPath, "utf8")).toBe(original);
  });
});
