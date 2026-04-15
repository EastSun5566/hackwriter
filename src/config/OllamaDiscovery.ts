import type { ModelDefinition } from './ProviderRegistry.js';
import { discoverRemoteModels } from './RemoteModelDiscovery.js';

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

function normalizeOllamaHostUrl(baseUrl: string): string {
  return baseUrl.replace(/\/(?:api|v1)(?:\/.*)?$/u, '');
}

export async function discoverOllamaModels(
  baseUrl = 'http://localhost:11434',
): Promise<ModelDefinition[]> {
  const hostUrl = normalizeOllamaHostUrl(baseUrl);

  return discoverRemoteModels<OllamaListResponse>({
    loggerScope: 'OllamaDiscovery',
    url: `${hostUrl}/api/tags`,
    parseModels: (data) =>
      data.models.map((model) => ({
        id: model.name,
        name: model.name,
        contextWindow: 128000,
      })),
  });
}
