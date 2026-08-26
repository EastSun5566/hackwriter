import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Configuration } from "../../src/config/Configuration.ts";
import type { HackMDOAuthStore } from "../../src/mcp/HackMDOAuthStore.ts";
import type { ModelService } from "../../src/config/ModelService.ts";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  loadHackMDCLIConfig: vi.fn(),
}));

vi.mock("@inquirer/prompts", () => ({
  input: vi.fn(),
  password: vi.fn(),
  select: mocks.select,
}));

vi.mock("../../src/config/HackMDConfigLoader.ts", () => ({
  loadHackMDCLIConfig: mocks.loadHackMDCLIConfig,
}));

import { runInteractiveSetup } from "../../src/commands/setup.ts";

const config: Configuration = {
  version: 2,
  defaultModel: "provider/model",
  models: {},
  providers: {},
  services: {},
  loopControl: { maxStepsPerRun: 100, maxRetriesPerStep: 3 },
};

function modelService(): ModelService {
  return { initialize: vi.fn().mockResolvedValue(undefined) } as unknown as ModelService;
}

function oauthStore(): HackMDOAuthStore {
  return {
    read: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  };
}

describe("runInteractiveSetup HackMD endpoint resolution", () => {
  beforeEach(() => {
    mocks.select.mockResolvedValue("cancel");
  });

  it("does not offer official OAuth for a custom HackMD CLI endpoint", async () => {
    mocks.loadHackMDCLIConfig.mockResolvedValue({
      accessToken: "cli-token",
      hackmdAPIEndpointURL: "https://enterprise.example/api",
    });
    const store = oauthStore();

    await runInteractiveSetup(config, modelService(), { oauthStore: store });

    const prompt = mocks.select.mock.calls[0]?.[0];
    expect(prompt.choices.map((choice: { value: string }) => choice.value))
      .not.toContain("hackmd-oauth");
    expect(store.read).not.toHaveBeenCalled();
  });

  it("uses an explicit MCP endpoint alongside a custom HackMD CLI endpoint", async () => {
    mocks.loadHackMDCLIConfig.mockResolvedValue({
      accessToken: "cli-token",
      hackmdAPIEndpointURL: "https://enterprise.example/api",
    });
    const store = oauthStore();
    const explicitConfig = structuredClone(config);
    explicitConfig.services.hackmd = {
      mcpBaseUrl: "https://mcp.enterprise.example",
    };

    await runInteractiveSetup(explicitConfig, modelService(), { oauthStore: store });

    const prompt = mocks.select.mock.calls[0]?.[0];
    expect(prompt.choices.map((choice: { value: string }) => choice.value))
      .toContain("hackmd-oauth");
    expect(store.read).toHaveBeenCalledWith("https://mcp.enterprise.example");
  });

  it("keeps setup usable with an API token when the OAuth store is unreadable", async () => {
    mocks.loadHackMDCLIConfig.mockResolvedValue(null);
    const store = oauthStore();
    vi.mocked(store.read).mockRejectedValue(new Error("invalid OAuth file"));
    const tokenConfig = structuredClone(config);
    tokenConfig.services.hackmd = { apiToken: "api-token" };

    await expect(runInteractiveSetup(tokenConfig, modelService(), { oauthStore: store }))
      .resolves.toBe(false);
    expect(mocks.select).toHaveBeenCalledTimes(1);
  });
});
