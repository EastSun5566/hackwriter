import { Logger } from '../utils/Logger.js';
import type { ModelDefinition } from './ProviderRegistry.js';

interface AnthropicModel {
  id: string;
  display_name: string;
  created_at: string;
  type: string;
}

interface AnthropicModelsResponse {
  data: AnthropicModel[];
  has_more: boolean;
  first_id: string | null;
  last_id: string | null;
}

/**
 * Discover Anthropic models by calling the API
 */
export async function discoverAnthropicModels(apiKey: string): Promise<ModelDefinition[]> {
  try {
    const response = await fetch('https://api.anthropic.com/v1/models', {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
    });

    if (!response.ok) {
      Logger.debug('AnthropicDiscovery', `API request failed: ${response.status}`);
      return [];
    }

    const data = await response.json() as AnthropicModelsResponse;
    const models: ModelDefinition[] = [];

    for (const model of data.data) {
      // Only include chat models (not embeddings, etc.)
      if (model.type === 'model') {
        models.push({
          id: model.id,
          name: model.display_name || model.id,
          contextWindow: getContextWindow(model.id),
        });

        Logger.debug('AnthropicDiscovery', `Discovered model: ${model.id}`);
      }
    }

    return models;
  } catch (error) {
    Logger.debug('AnthropicDiscovery', `Failed to discover models: ${String(error)}`);
    return [];
  }
}

/**
 * Get context window size based on model ID
 */
function getContextWindow(modelId: string): number {
  // Claude 3.5 models
  if (modelId.includes('claude-3-5')) {
    return 200000;
  }
  // Claude 3 Opus
  if (modelId.includes('opus')) {
    return 200000;
  }
  // Default
  return 200000;
}
