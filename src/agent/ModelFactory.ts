import { getModel } from "@mariozechner/pi-ai";
import type { Model, OpenAICompletionsCompat } from "@mariozechner/pi-ai";
import type { LLMProvider } from "../config/Configuration.js";
import { Logger } from "../utils/Logger.js";
import { SensitiveDataRedactor } from "../utils/SensitiveDataRedactor.js";

const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com";
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434/v1";

const EXPLICIT_OPENAI_COMPAT: OpenAICompletionsCompat = {
  supportsStore: false,
  supportsDeveloperRole: false,
  supportsReasoningEffort: false,
  supportsUsageInStreaming: false,
  maxTokensField: "max_tokens",
};

function stripTrailingSlashes(url: string): string {
  return url.replace(/\/+$/u, "");
}

function normalizeAnthropicBaseUrl(baseUrl?: string): string {
  return stripTrailingSlashes(baseUrl ?? DEFAULT_ANTHROPIC_BASE_URL);
}

function normalizeOpenAIBaseUrl(baseUrl?: string): string {
  const normalized = stripTrailingSlashes(baseUrl ?? DEFAULT_OPENAI_BASE_URL);
  return normalized.endsWith("/v1") ? normalized : `${normalized}/v1`;
}

function normalizeOllamaBaseUrl(baseUrl?: string): string {
  const normalized = stripTrailingSlashes(baseUrl ?? DEFAULT_OLLAMA_BASE_URL);
  const hostBaseUrl = normalized.replace(/\/(api|v1)(?:\/.*)?$/u, "");
  return `${hostBaseUrl}/v1`;
}

function getBuiltInModel(
  providerType: Extract<LLMProvider["type"], "anthropic" | "openai">,
  modelId: string,
): Model<string> | undefined {
  return getModel(providerType as never, modelId as never) as Model<string> | undefined;
}

function mergeHeaders(
  baseHeaders?: Record<string, string>,
  overrideHeaders?: Record<string, string>,
): Record<string, string> | undefined {
  const merged = {
    ...(baseHeaders ?? {}),
    ...(overrideHeaders ?? {}),
  };

  return Object.keys(merged).length > 0 ? merged : undefined;
}

function buildOpenAIHeaders(provider: LLMProvider): Record<string, string> | undefined {
  const headers: Record<string, string> = {};

  if (provider.organizationId) {
    headers["OpenAI-Organization"] = provider.organizationId;
  }

  if (provider.projectId) {
    headers["OpenAI-Project"] = provider.projectId;
  }

  return Object.keys(headers).length > 0 ? headers : undefined;
}

function applyOverrides(
  model: Model<string>,
  overrides: Partial<Model<string>>,
): Model<string> {
  return {
    ...model,
    ...overrides,
    ...(mergeHeaders(model.headers, overrides.headers)
      ? { headers: mergeHeaders(model.headers, overrides.headers) }
      : {}),
  } as Model<string>;
}

function usesKnownOpenAICompat(baseUrl: string): boolean {
  return [
    "api.openai.com",
    "cerebras.ai",
    "api.x.ai",
    "chutes.ai",
    "deepseek.com",
    "api.z.ai",
    "opencode.ai",
    "openrouter.ai",
    "groq.com",
  ].some((pattern) => baseUrl.includes(pattern));
}

function buildCustomOpenAICompatibleModel(
  provider: LLMProvider,
  modelId: string,
  maxContextSize: number,
  config: {
    providerName: string;
    baseUrl: string;
    input: ("text" | "image")[];
    compat?: OpenAICompletionsCompat;
  },
): Model<string> {
  const zeroUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

  return {
    id: modelId,
    name: modelId,
    api: "openai-completions",
    provider: config.providerName,
    baseUrl: config.baseUrl,
    reasoning: false,
    input: config.input,
    cost: zeroUsage,
    contextWindow: maxContextSize,
    maxTokens: Math.min(16384, Math.floor(maxContextSize / 8)),
    ...(config.compat ? { compat: config.compat } : {}),
    ...(buildOpenAIHeaders(provider)
      ? { headers: buildOpenAIHeaders(provider) }
      : {}),
  } as Model<string>;
}

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
    case "anthropic": {
      const baseUrl = normalizeAnthropicBaseUrl(provider.baseUrl);
      const builtInModel = getBuiltInModel("anthropic", modelId);

      if (builtInModel) {
        return applyOverrides(builtInModel, {
          baseUrl,
          contextWindow: maxContextSize,
          maxTokens: Math.min(builtInModel.maxTokens, maxContextSize),
        });
      }

      return {
        id: modelId,
        name: modelId,
        api: "anthropic-messages",
        provider: "anthropic",
        baseUrl,
        reasoning: false,
        input: ["text", "image"],
        cost: zeroUsage,
        contextWindow: maxContextSize,
        maxTokens: Math.min(8096, Math.floor(maxContextSize / 10)),
      } as Model<string>;
    }

    case "openai": {
      const baseUrl = normalizeOpenAIBaseUrl(provider.baseUrl);
      const isOfficialOpenAIEndpoint = baseUrl === DEFAULT_OPENAI_BASE_URL;

      if (isOfficialOpenAIEndpoint) {
        const builtInModel = getBuiltInModel("openai", modelId);

        if (builtInModel) {
          return applyOverrides(builtInModel, {
            baseUrl,
            contextWindow: maxContextSize,
            maxTokens: Math.min(builtInModel.maxTokens, maxContextSize),
            headers: buildOpenAIHeaders(provider),
          });
        }
      }

      return buildCustomOpenAICompatibleModel(provider, modelId, maxContextSize, {
        providerName: "openai",
        baseUrl,
        input: ["text", "image"],
        compat: usesKnownOpenAICompat(baseUrl)
          ? undefined
          : EXPLICIT_OPENAI_COMPAT,
      });
    }

    case "ollama":
      return buildCustomOpenAICompatibleModel(provider, modelId, maxContextSize, {
        providerName: "ollama",
        baseUrl: normalizeOllamaBaseUrl(provider.baseUrl),
        input: ["text"],
        compat: EXPLICIT_OPENAI_COMPAT,
      });

    default:
      throw new Error(
        `Unsupported provider type: ${(provider as { type: string }).type}`,
      );
  }
}
