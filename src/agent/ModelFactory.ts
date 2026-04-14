import type { Model } from "@mariozechner/pi-ai";
import type { LLMProvider } from "../config/Configuration.js";
import { Logger } from "../utils/Logger.js";
import { SensitiveDataRedactor } from "../utils/SensitiveDataRedactor.js";

export function buildLanguageModel(
  provider: LLMProvider,
  modelId: string,
  maxContextSize = 200000,
): Model<string> {
  // Redact sensitive data before logging
  const redactedProvider = SensitiveDataRedactor.redact(provider);
  Logger.debug("ModelFactory", "Building language model", {
    providerType: provider.type,
    modelId,
    hasApiKey: !!provider.apiKey,
    provider: redactedProvider,
  });

  const zeroUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

  switch (provider.type) {
    case "anthropic":
      return {
        id: modelId,
        name: modelId,
        api: "anthropic-messages",
        provider: "anthropic",
        baseUrl: provider.baseUrl ?? "https://api.anthropic.com",
        reasoning: false,
        input: ["text", "image"],
        cost: zeroUsage,
        contextWindow: maxContextSize,
        maxTokens: Math.min(8096, Math.floor(maxContextSize / 10)),
        ...(provider.apiKey ? { headers: { "x-api-key": provider.apiKey } } : {}),
      } as Model<string>;

    case "openai":
      return {
        id: modelId,
        name: modelId,
        api: "openai-completions",
        provider: "openai",
        baseUrl: provider.baseUrl ?? "https://api.openai.com/v1",
        reasoning: false,
        input: ["text", "image"],
        cost: zeroUsage,
        contextWindow: maxContextSize,
        maxTokens: Math.min(16384, Math.floor(maxContextSize / 8)),
      } as Model<string>;

    case "ollama":
      return {
        id: modelId,
        name: modelId,
        api: "openai-completions",
        provider: "ollama",
        baseUrl: (provider.baseUrl ?? "http://localhost:11434") + "/v1",
        reasoning: false,
        input: ["text"],
        cost: zeroUsage,
        contextWindow: maxContextSize,
        maxTokens: Math.min(4096, Math.floor(maxContextSize / 4)),
      } as Model<string>;

    default:
      throw new Error(
        `Unsupported provider type: ${(provider as { type: string }).type}`,
      );
  }
}
