import { describe, expect, it } from "vitest";

import { buildLanguageModel } from "../../src/agent/ModelFactory.js";

describe("ModelFactory", () => {
  it("uses pi-ai built-in metadata for official OpenAI models", () => {
    const model = buildLanguageModel(
      { type: "openai", apiKey: "test-key" },
      "gpt-5",
      200000,
    );

    expect(model.api).toBe("openai-responses");
    expect(model.provider).toBe("openai");
    expect(model.baseUrl).toBe("https://api.openai.com/v1");
    expect(model.contextWindow).toBe(200000);
  });

  it("adds safe compat flags for unknown custom OpenAI-compatible endpoints", () => {
    const model = buildLanguageModel(
      {
        type: "openai",
        apiKey: "test-key",
        baseUrl: "https://moonshot.example.com",
      },
      "kimi-k2.5",
      128000,
    );

    expect(model.api).toBe("openai-completions");
    expect(model.provider).toBe("openai");
    expect(model.baseUrl).toBe("https://moonshot.example.com/v1");
    expect(model.compat).toMatchObject({
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      supportsUsageInStreaming: false,
      maxTokensField: "max_tokens",
    });
  });

  it("configures Ollama as an OpenAI-compatible local endpoint", () => {
    const model = buildLanguageModel(
      { type: "ollama", baseUrl: "http://localhost:11434" },
      "kimi-k2.5:cloud",
      128000,
    );

    expect(model.api).toBe("openai-completions");
    expect(model.provider).toBe("ollama");
    expect(model.baseUrl).toBe("http://localhost:11434/v1");
    expect(model.input).toEqual(["text"]);
    expect(model.compat).toMatchObject({
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      supportsUsageInStreaming: false,
      maxTokensField: "max_tokens",
    });
  });

  it("normalizes legacy Ollama /api base URLs to the OpenAI-compatible /v1 endpoint", () => {
    const model = buildLanguageModel(
      { type: "ollama", baseUrl: "http://localhost:11434/api" },
      "kimi-k2.5:cloud",
      128000,
    );

    expect(model.baseUrl).toBe("http://localhost:11434/v1");
  });
});
