import { describe, expect, it } from "vitest";
import { safeValidateConfiguration } from "../../src/config/ConfigSchema.js";

describe("ConfigSchema", () => {
  it("accepts optional hackwiki configuration", () => {
    const validation = safeValidateConfiguration({
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
        },
        hackwiki: {
          enabled: true,
          initialSchema: "# Personal Wiki",
          apiUrl: "https://hackmd.example.com/v1",
        },
      },
      loopControl: {
        maxStepsPerRun: 100,
        maxRetriesPerStep: 3,
      },
    });

    expect(validation.success).toBe(true);
  });
});
