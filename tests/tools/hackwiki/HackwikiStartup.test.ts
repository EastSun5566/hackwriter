import { beforeEach, describe, expect, it, vi } from "vitest";
import { API } from "@hackmd/api";
import { select } from "@inquirer/prompts";
import { ConfigurationLoader } from "../../../src/config/ConfigurationLoader.ts";
import {
  inspectHackwikiBootstrapState,
  resolveHackwikiStartup,
} from "../../../src/tools/hackwiki/HackwikiStartup.ts";
import type { Configuration } from "../../../src/config/Configuration.ts";

vi.mock("@hackmd/api", () => ({
  API: vi.fn(),
}));

vi.mock("@inquirer/prompts", () => ({
  select: vi.fn(),
}));

vi.mock("../../../src/config/ConfigurationLoader.ts", () => ({
  ConfigurationLoader: {
    updateUserConfig: vi.fn(),
  },
}));

function mockApiNoteList(
  apiMock: ReturnType<typeof vi.mocked<typeof API>>,
  notes: Array<{ id: string; title: string }>,
): void {
  apiMock.mockImplementation(
    function MockHackmdApi() {
      return {
        getNoteList: vi.fn().mockResolvedValue(notes),
      } as never;
    } as never,
  );
}

function createConfig(): Configuration {
  return {
    defaultModel: "anthropic-claude-3-5-haiku-latest",
    models: {
      "anthropic-claude-3-5-haiku-latest": {
        provider: "anthropic",
        model: "claude-3-5-haiku-latest",
        maxContextSize: 200000,
      },
    },
    providers: {
      anthropic: {
        type: "anthropic",
        apiKey: "sk-ant-test",
      },
    },
    services: {
      hackmd: {
        apiToken: "hackmd-token",
        apiBaseUrl: "https://api.hackmd.example/v1",
      },
    },
    loopControl: {
      maxStepsPerRun: 100,
      maxRetriesPerStep: 3,
    },
  };
}

describe("HackwikiStartup", () => {
  const apiMock = vi.mocked(API);
  const selectMock = vi.mocked(select);
  const updateUserConfigMock = vi.mocked(ConfigurationLoader.updateUserConfig);

  beforeEach(() => {
    apiMock.mockReset();
    selectMock.mockReset();
    updateUserConfigMock.mockReset();
  });

  it("detects when reserved hackwiki notes already exist", async () => {
    mockApiNoteList(apiMock, [
      { id: "1", title: "[hackwiki] schema" },
      { id: "2", title: "[hackwiki] index" },
      { id: "3", title: "[hackwiki] log" },
    ]);

    await expect(inspectHackwikiBootstrapState(createConfig())).resolves.toBe(
      "ready",
    );
    expect(apiMock).toHaveBeenCalledWith(
      "hackmd-token",
      "https://api.hackmd.example/v1",
    );
  });

  it("detects when bootstrap is still needed", async () => {
    mockApiNoteList(apiMock, [
      { id: "1", title: "[hackwiki] schema" },
    ]);

    await expect(inspectHackwikiBootstrapState(createConfig())).resolves.toBe(
      "needs-bootstrap",
    );
  });

  it("detects invalid reserved note duplicates", async () => {
    mockApiNoteList(apiMock, [
      { id: "1", title: "[hackwiki] schema" },
      { id: "2", title: "[hackwiki] schema" },
      { id: "3", title: "[hackwiki] index" },
      { id: "4", title: "[hackwiki] log" },
    ]);

    await expect(inspectHackwikiBootstrapState(createConfig())).resolves.toBe(
      "invalid",
    );
  });

  it("enables wiki memory by default when reserved notes are already ready", async () => {
    mockApiNoteList(apiMock, [
      { id: "1", title: "[hackwiki] schema" },
      { id: "2", title: "[hackwiki] index" },
      { id: "3", title: "[hackwiki] log" },
    ]);

    const result = await resolveHackwikiStartup(createConfig(), { yolo: false });

    expect(result).toEqual({
      enabled: true,
      bootstrapState: "ready",
    });
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("allows one-time bootstrap after explicit consent", async () => {
    mockApiNoteList(apiMock, []);
    selectMock.mockResolvedValue("enable_once");

    const result = await resolveHackwikiStartup(createConfig(), { yolo: false });

    expect(selectMock).toHaveBeenCalledTimes(1);
    expect(selectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining(
          "may automatically save or update durable memory after answers complete",
        ),
      }),
    );
    expect(result).toEqual({
      enabled: true,
      bootstrapState: "needs-bootstrap",
    });
    expect(updateUserConfigMock).not.toHaveBeenCalled();
  });

  it("persists always-enable choice without rewriting unrelated config", async () => {
    mockApiNoteList(apiMock, []);
    selectMock.mockResolvedValue("enable_always");

    const config = createConfig();
    const result = await resolveHackwikiStartup(config, { yolo: false });

    expect(result).toEqual({
      enabled: true,
      bootstrapState: "needs-bootstrap",
      persistedChoice: "enabled",
    });
    expect(config.services.hackwiki).toEqual({ enabled: true });
    expect(updateUserConfigMock).toHaveBeenCalledTimes(1);
  });

  it("offers an enable-once choice that explains automatic post-turn saves", async () => {
    mockApiNoteList(apiMock, []);
    selectMock.mockResolvedValue("skip_once");

    await resolveHackwikiStartup(createConfig(), { yolo: false });

    expect(selectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        choices: expect.arrayContaining([
          expect.objectContaining({
            value: "enable_once",
            name: expect.stringContaining("automatic post-turn saves"),
          }),
        ]),
      }),
    );
  });

  it("persists always-disable choice", async () => {
    mockApiNoteList(apiMock, []);
    selectMock.mockResolvedValue("disable_always");

    const config = createConfig();
    const result = await resolveHackwikiStartup(config, { yolo: false });

    expect(result).toEqual({
      enabled: false,
      bootstrapState: "needs-bootstrap",
      persistedChoice: "disabled",
    });
    expect(config.services.hackwiki).toEqual({ enabled: false });
    expect(updateUserConfigMock).toHaveBeenCalledTimes(1);
  });

  it("skips wiki memory for now when the user declines", async () => {
    mockApiNoteList(apiMock, []);
    selectMock.mockResolvedValue("skip_once");

    const result = await resolveHackwikiStartup(createConfig(), { yolo: false });

    expect(result).toEqual({
      enabled: false,
      bootstrapState: "needs-bootstrap",
    });
  });

  it("auto-enables bootstrap in yolo mode without persisting", async () => {
    mockApiNoteList(apiMock, []);

    const result = await resolveHackwikiStartup(createConfig(), { yolo: true });

    expect(result).toEqual({
      enabled: true,
      bootstrapState: "needs-bootstrap",
    });
    expect(selectMock).not.toHaveBeenCalled();
    expect(updateUserConfigMock).not.toHaveBeenCalled();
  });
});
