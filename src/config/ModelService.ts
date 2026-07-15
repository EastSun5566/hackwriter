import {
  createProvider,
  type Api,
  type AuthResult,
  type CredentialStore,
  type Model,
  type MutableModels,
  type Provider,
} from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import {
  builtinModels,
  getBuiltinProviders,
} from "@earendil-works/pi-ai/providers/all";

import type {
  Configuration,
  LLMModel,
  LLMProvider,
} from "./Configuration.ts";
import { FileCredentialStore } from "./FileCredentialStore.ts";
import { discoverOllamaModels } from "./OllamaDiscovery.ts";
import { Logger } from "../utils/Logger.ts";

const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";
const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

export interface ModelMatch {
  canonicalId: string;
  model: Model<Api>;
  aliases: string[];
}

export interface ProviderStatus {
  id: string;
  name: string;
  available: boolean;
  modelCount: number;
  authSource?: string;
  error?: string;
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/u, "");
}

function normalizeOllamaBaseUrl(value = DEFAULT_OLLAMA_BASE_URL): string {
  const host = stripTrailingSlash(value).replace(/\/(?:api|v1)(?:\/.*)?$/u, "");
  return `${host}/v1`;
}

function modelFromConfig(
  providerId: string,
  config: LLMModel,
  provider: LLMProvider,
): Model<Api> {
  const baseUrl = provider.type === "ollama"
    ? normalizeOllamaBaseUrl(provider.baseUrl)
    : stripTrailingSlash(provider.baseUrl ?? "https://api.openai.com/v1");

  return {
    id: config.model,
    name: config.model,
    api: provider.type === "anthropic" ? "anthropic-messages" : "openai-completions",
    provider: providerId,
    baseUrl,
    reasoning: false,
    input: provider.type === "ollama" ? ["text"] : ["text", "image"],
    cost: ZERO_COST,
    contextWindow: config.maxContextSize,
    maxTokens: Math.min(16_384, Math.max(1, Math.floor(config.maxContextSize / 8))),
    headers: {
      ...(provider.organizationId
        ? { "OpenAI-Organization": provider.organizationId }
        : {}),
      ...(provider.projectId ? { "OpenAI-Project": provider.projectId } : {}),
    },
  };
}

function withProviderOverrides(
  providerId: string,
  source: Provider,
  config: LLMProvider,
  customModels: readonly Model<Api>[],
): Provider {
  const baseUrl = config.baseUrl ? stripTrailingSlash(config.baseUrl) : undefined;
  const headers = {
    ...(config.organizationId
      ? { "OpenAI-Organization": config.organizationId }
      : {}),
    ...(config.projectId ? { "OpenAI-Project": config.projectId } : {}),
  };
  const models = new Map<string, Model<Api>>();

  for (const model of source.getModels()) {
    models.set(model.id, {
      ...model,
      provider: providerId,
      ...(baseUrl ? { baseUrl } : {}),
      ...(Object.keys(headers).length > 0
        ? { headers: { ...model.headers, ...headers } }
        : {}),
    });
  }
  for (const model of customModels) models.set(model.id, model);

  return {
    id: providerId,
    name: source.name,
    baseUrl: baseUrl ?? source.baseUrl,
    headers: { ...source.headers, ...headers },
    auth: source.auth,
    getModels: () => [...models.values()],
    refreshModels: source.refreshModels
      ? async () => {
          await source.refreshModels!();
          for (const model of source.getModels()) {
            models.set(model.id, {
              ...model,
              provider: providerId,
              ...(baseUrl ? { baseUrl } : {}),
            });
          }
        }
      : undefined,
    stream: (model, context, options) => source.stream(model, context, options),
    streamSimple: (model, context, options) =>
      source.streamSimple(model, context, options),
  };
}

function createOllamaProvider(
  providerId: string,
  config: LLMProvider,
  configuredModels: readonly Model<Api>[],
): Provider {
  const baseUrl = normalizeOllamaBaseUrl(config.baseUrl);
  return createProvider({
    id: providerId,
    name: providerId === "ollama" ? "Ollama" : providerId,
    baseUrl,
    auth: {
      apiKey: {
        name: "Local Ollama",
        resolve: () => Promise.resolve({ auth: {}, source: "local Ollama" }),
      },
    },
    models: configuredModels,
    refreshModels: async () => {
      const discovered = await discoverOllamaModels(config.baseUrl ?? DEFAULT_OLLAMA_BASE_URL);
      return discovered.map((model) => ({
        id: model.id,
        name: model.name,
        api: "openai-completions" as const,
        provider: providerId,
        baseUrl,
        reasoning: false,
        input: ["text" as const],
        cost: ZERO_COST,
        contextWindow: model.contextWindow,
        maxTokens: Math.min(16_384, Math.max(1, Math.floor(model.contextWindow / 8))),
      }));
    },
    api: openAICompletionsApi(),
  });
}

export class ModelService {
  readonly models: MutableModels;
  readonly credentials: CredentialStore;
  private readonly aliases = new Map<string, string>();

  constructor(
    readonly config: Configuration,
    credentials: CredentialStore = new FileCredentialStore(),
  ) {
    this.credentials = credentials;
    this.models = builtinModels({ credentials });
    this.registerConfiguredProviders();
    this.rebuildAliases();
  }

  static builtinProviderIds(): string[] {
    return [...getBuiltinProviders()];
  }

  async initialize(): Promise<void> {
    const ollamaProviders = this.models
      .getProviders()
      .filter((provider) => provider.id === "ollama" || provider.id.startsWith("ollama-"));
    await Promise.all(
      ollamaProviders.map((provider) =>
        this.models.refresh(provider.id).catch((error) => {
          Logger.debug("ModelService", `Unable to refresh ${provider.id}`, error);
        }),
      ),
    );
    this.rebuildAliases();
  }

  canonicalId(model: Model<Api>): string {
    return `${model.provider}/${model.id}`;
  }

  resolve(idOrAlias: string): ModelMatch | undefined {
    const canonical = this.aliases.get(idOrAlias) ?? idOrAlias;
    const separator = canonical.indexOf("/");
    if (separator < 1) return undefined;
    const providerId = canonical.slice(0, separator);
    const modelId = canonical.slice(separator + 1);
    const model = this.models.getModel(providerId, modelId);
    if (!model) return undefined;

    return {
      canonicalId: this.canonicalId(model),
      model,
      aliases: [...this.aliases.entries()]
        .filter(([, value]) => value === canonical)
        .map(([alias]) => alias),
    };
  }

  async isAvailable(model: Model<Api>): Promise<AuthResult | undefined> {
    return this.models.getAuth(model);
  }

  async availableModels(): Promise<ModelMatch[]> {
    const matches: ModelMatch[] = [];
    for (const provider of this.models.getProviders()) {
      const providerModels = provider.getModels();
      if (providerModels.length === 0) continue;
      try {
        if (!(await this.models.getAuth(providerModels[0]))) continue;
      } catch (error) {
        Logger.debug("ModelService", `Auth check failed for ${provider.id}`, error);
        continue;
      }
      for (const model of providerModels) {
        const match = this.resolve(this.canonicalId(model));
        if (match) matches.push(match);
      }
    }
    return matches;
  }

  search(query: string, limit = 20): { matches: ModelMatch[]; total: number } {
    const normalized = query.trim().toLowerCase();
    const all = this.models.getModels().filter((model) => {
      const searchable = `${model.provider} ${model.id} ${model.name}`.toLowerCase();
      return searchable.includes(normalized);
    });
    return {
      matches: all.slice(0, limit).flatMap((model) => {
        const match = this.resolve(this.canonicalId(model));
        return match ? [match] : [];
      }),
      total: all.length,
    };
  }

  async providerStatuses(): Promise<ProviderStatus[]> {
    const statuses: ProviderStatus[] = [];
    for (const provider of this.models.getProviders()) {
      const providerModels = provider.getModels();
      let auth: AuthResult | undefined;
      let error: string | undefined;
      try {
        auth = providerModels[0]
          ? await this.models.getAuth(providerModels[0])
          : undefined;
      } catch (cause) {
        error = cause instanceof Error ? cause.message : String(cause);
      }
      statuses.push({
        id: provider.id,
        name: provider.name,
        available: auth !== undefined,
        modelCount: providerModels.length,
        authSource: auth?.source,
        error,
      });
    }
    return statuses;
  }

  private registerConfiguredProviders(): void {
    const configuredProviders: Record<string, LLMProvider> = {
      ...this.config.providers,
    };
    if (!configuredProviders.ollama) {
      configuredProviders.ollama = { type: "ollama", baseUrl: DEFAULT_OLLAMA_BASE_URL };
    }

    for (const [providerId, config] of Object.entries(configuredProviders)) {
      const configuredModels = Object.values(this.config.models)
        .filter((model) => model.provider === providerId)
        .map((model) => modelFromConfig(providerId, model, config));

      if (config.type === "ollama") {
        this.models.setProvider(
          createOllamaProvider(providerId, config, configuredModels),
        );
        continue;
      }

      const source = this.models.getProvider(config.type);
      if (source) {
        this.models.setProvider(
          withProviderOverrides(providerId, source, config, configuredModels),
        );
      }
    }
  }

  private rebuildAliases(): void {
    this.aliases.clear();
    for (const model of this.models.getModels()) {
      const canonical = this.canonicalId(model);
      this.aliases.set(canonical, canonical);
      this.aliases.set(`${model.provider}-${model.id}`, canonical);
    }
    for (const [alias, modelConfig] of Object.entries(this.config.models)) {
      this.aliases.set(alias, `${modelConfig.provider}/${modelConfig.model}`);
    }
  }
}
