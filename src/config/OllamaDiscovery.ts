import { Logger } from '../utils/Logger.js';
import type { ModelDefinition } from './ProviderRegistry.js';

interface OllamaModelDetails {
  format: string;
  family: string;
  families: string[];
  parameter_size: string;
  quantization_level: string;
}

interface OllamaModel {
  name: string;
  modified_at: string;
  size: number;
  digest: string;
  details: OllamaModelDetails;
}

interface OllamaListResponse {
  models: OllamaModel[];
}

/**
 * Discover Ollama models by calling the HTTP API
 */
export async function discoverOllamaModels(baseUrl = 'http://localhost:11434/api'): Promise<ModelDefinition[]> {
  try {
    // AI SDK uses baseUrl with /api suffix, but /api/tags endpoint needs host base
    const hostUrl = baseUrl.replace(/\/api\/?$/, '');
    const response = await fetch(`${hostUrl}/api/tags`);

    if (!response.ok) {
      Logger.debug('OllamaDiscovery', `API request failed: ${response.status}`);
      return [];
    }

    const data = await response.json() as OllamaListResponse;
    const models: ModelDefinition[] = [];

    for (const model of data.models) {
      models.push({
        id: model.name,
        name: model.name,
        contextWindow: 128000, // Default context window
      });

      Logger.debug('OllamaDiscovery', `Discovered Ollama model: ${model.name}`);
    }

    return models;
  } catch (error) {
    Logger.debug('OllamaDiscovery', `Failed to discover Ollama models: ${String(error)}`);
    return [];
  }
}
