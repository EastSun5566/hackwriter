import { Logger } from '../utils/Logger.js';
import type { ModelDefinition } from './ProviderRegistry.js';

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

/**
 * Discover OpenAI models by calling the API
 */
export async function discoverOpenAIModels(apiKey: string): Promise<ModelDefinition[]> {
  try {
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      Logger.debug('OpenAIDiscovery', `API request failed: ${response.status}`);
      return [];
    }

    const data = await response.json() as OpenAIModelsResponse;
    const models: ModelDefinition[] = [];

    for (const model of data.data) {
      // Filter to only include chat models (ignore fine-tuned, embeddings, etc.)
      if (isChatModel(model.id)) {
        models.push({
          id: model.id,
          name: model.id,
          contextWindow: getContextWindow(model.id),
        });

        Logger.debug('OpenAIDiscovery', `Discovered model: ${model.id}`);
      }
    }

    // Sort by preference (latest models first)
    return models.sort((a, b) => {
      const order = ['gpt-4o', 'gpt-4', 'gpt-3.5', 'o1', 'o3'];
      const aIndex = order.findIndex(prefix => a.id.startsWith(prefix));
      const bIndex = order.findIndex(prefix => b.id.startsWith(prefix));
      return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
    });
  } catch (error) {
    Logger.debug('OpenAIDiscovery', `Failed to discover models: ${String(error)}`);
    return [];
  }
}

/**
 * Check if model ID is a chat model
 */
function isChatModel(modelId: string): boolean {
  const chatPrefixes = ['gpt-4', 'gpt-3.5', 'o1', 'o3'];
  const excludePatterns = ['-instruct', 'embedding', 'whisper', 'tts', 'dall-e', 'davinci'];
  
  // Must start with chat prefix
  if (!chatPrefixes.some(prefix => modelId.startsWith(prefix))) {
    return false;
  }
  
  // Must not match exclude patterns
  if (excludePatterns.some(pattern => modelId.includes(pattern))) {
    return false;
  }
  
  return true;
}

/**
 * Get context window size based on model ID
 */
function getContextWindow(modelId: string): number {
  if (modelId.startsWith('gpt-4o')) return 128000;
  if (modelId.startsWith('o1')) return 200000;
  if (modelId.startsWith('o3')) return 200000;
  if (modelId.startsWith('gpt-4')) return 128000;
  if (modelId.startsWith('gpt-3.5')) return 16000;
  return 128000; // Default
}
