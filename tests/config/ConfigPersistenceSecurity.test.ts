import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConfigurationLoader } from "../../src/config/ConfigurationLoader.ts";
import { resolveHackMDServiceConfig } from "../../src/config/HackMDServiceResolution.ts";

describe("HackMD credential persistence", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("does not copy an environment token into persisted config", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "hackwriter-persist-"));
    const configPath = path.join(directory, "config.json");
    vi.stubEnv("HACKMD_API_TOKEN", "environment-secret");
    try {
      const config = await ConfigurationLoader.load({ configPath });
      expect(config.services.hackmd).toBeUndefined();
      expect(resolveHackMDServiceConfig(config.services.hackmd).hackmd?.apiToken)
        .toBe("environment-secret");

      config.defaultModel = "test/model";
      await ConfigurationLoader.save(config, { configPath });
      const persisted = await fs.readFile(configPath, "utf8");
      expect(persisted).not.toContain("environment-secret");
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});
