import type { ModelDefinition } from './ProviderRegistry.js';
import { discoverRemoteModels } from './RemoteModelDiscovery.js';

interface OpenAIModel {
  id: string;
  object: string;
  created: number;
  owned_by: string;
}

interface OpenAIModelsResponse {
  object: string;
  data: OpenAIModel[];
}

export async function discoverOpenAIModels(apiKey: string): Promise<ModelDefinition[]> {
  return discoverRemoteModels<OpenAIModelsResponse>({
    loggerScope: 'OpenAIDiscovery',
    url: 'https://api.openai.com/v1/models',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    parseModels: (data) =>
      data.data
        .filter((model) => isChatModel(model.id))
        .map((model) => ({
          id: model.id,
          name: model.id,
          contextWindow: getContextWindow(model.id),
        }))
        .sort(compareModelPreference),
  });
}

function isChatModel(modelId: string): boolean {
  const chatPrefixes = ['gpt-4', 'gpt-3.5', 'o1', 'o3'];
  const excludePatterns = ['-instruct', 'embedding', 'whisper', 'tts', 'dall-e', 'davinci'];

  if (!chatPrefixes.some(prefix => modelId.startsWith(prefix))) {
    return false;
  }

  if (excludePatterns.some(pattern => modelId.includes(pattern))) {
    return false;
  }

  return true;
}

function compareModelPreference(a: ModelDefinition, b: ModelDefinition): number {
  const order = ['gpt-4o', 'gpt-4', 'gpt-3.5', 'o1', 'o3'];
  const aIndex = order.findIndex((prefix) => a.id.startsWith(prefix));
  const bIndex = order.findIndex((prefix) => b.id.startsWith(prefix));

  const aPriority = aIndex === -1 ? 999 : aIndex;
  const bPriority = bIndex === -1 ? 999 : bIndex;

  return aPriority - bPriority;
}

function getContextWindow(modelId: string): number {
  if (modelId.startsWith('gpt-4o')) return 128000;
  if (modelId.startsWith('o1')) return 200000;
  if (modelId.startsWith('o3')) return 200000;
  if (modelId.startsWith('gpt-4')) return 128000;
  if (modelId.startsWith('gpt-3.5')) return 16000;
  return 128000; // Default
}
