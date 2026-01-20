import type { LLMProvider, LLMModel } from './Configuration.js';
import { BUILT_IN_PROVIDERS } from './ProviderRegistry.js';
import { Logger } from '../utils/Logger.js';

export function discoverProviders(): Record<string, LLMProvider> {
  const discovered: Record<string, LLMProvider> = {};

  for (const [name, definition] of Object.entries(BUILT_IN_PROVIDERS)) {
    const apiKey = definition.envKey ? process.env[definition.envKey] : undefined;

    // Skip if no API key and not Ollama (Ollama doesn't need API key)
    if (!apiKey && definition.type !== 'ollama') {
      Logger.debug('ProviderDiscovery', `Skipping ${name}: no API key in env`);
      continue;
    }

    Logger.debug('ProviderDiscovery', `Discovered provider: ${name}`);
    discovered[name] = {
      type: definition.type,
      apiKey,
      baseUrl: definition.defaultBaseUrl,
    };
  }

  return discovered;
}

export async function discoverModels(
  providers: Record<string, LLMProvider>
): Promise<Record<string, LLMModel>> {
  const models: Record<string, LLMModel> = {};

  for (const [providerName, provider] of Object.entries(providers)) {
    const definition = BUILT_IN_PROVIDERS[providerName];
    if (!definition) {
      Logger.debug('ProviderDiscovery', `No definition for provider: ${providerName}`);
      continue;
    }

    // Get models for this provider
    let modelsToAdd = definition.defaultModels;

    // Try dynamic discovery with API, fallback to static
    if (definition.type === 'anthropic' && provider.apiKey) {
      const { discoverAnthropicModels } = await import('./AnthropicDiscovery.js');
      const discovered = await discoverAnthropicModels(provider.apiKey);
      if (discovered.length > 0) {
        modelsToAdd = discovered;
        Logger.debug('ProviderDiscovery', `Anthropic API: ${discovered.length} models`);
      }
    } else if (definition.type === 'openai' && provider.apiKey) {
      const { discoverOpenAIModels } = await import('./OpenAIDiscovery.js');
      const discovered = await discoverOpenAIModels(provider.apiKey);
      if (discovered.length > 0) {
        modelsToAdd = discovered;
        Logger.debug('ProviderDiscovery', `OpenAI API: ${discovered.length} models`);
      }
    } else if (definition.type === 'ollama') {
      const { discoverOllamaModels } = await import('./OllamaDiscovery.js');
      modelsToAdd = await discoverOllamaModels(provider.baseUrl ?? 'http://localhost:11434');
      Logger.debug('ProviderDiscovery', `Ollama: ${modelsToAdd.length} models`);
    }

    for (const modelDef of modelsToAdd) {
      // Use format: providerName-modelId
      const modelName = `${providerName}-${modelDef.id}`;
      models[modelName] = {
        provider: providerName,
        model: modelDef.id,
        maxContextSize: modelDef.contextWindow,
      };

      Logger.debug('ProviderDiscovery', `Discovered model: ${modelName}`);
    }
  }

  return models;
}

export function getShortModelName(fullModelId: string): string {
  // Extract short name from model ID
  // "claude-3-5-haiku-latest" -> "haiku"
  // "gpt-4o-mini" -> "gpt-4o-mini"
  // "llama3.1:8b" -> "llama3.1"

  const normalized = fullModelId.toLowerCase();

  if (normalized.includes('haiku')) return 'haiku';
  if (normalized.includes('sonnet')) return 'sonnet';
  if (normalized.includes('opus')) return 'opus';
  if (normalized.includes('gpt-4o-mini')) return 'gpt-4o-mini';
  if (normalized.includes('gpt-4o')) return 'gpt-4o';
  if (normalized.includes('o1')) return 'o1';
  if (normalized.includes('phi3')) return 'phi3';
  if (normalized.includes('llama')) {
    const regex = /llama[\d.]+/;
    const match = regex.exec(normalized);
    return match ? match[0] : fullModelId;
  }

  // Fallback: return full ID
  return fullModelId;
}
