import type { ModelDefinition } from './ProviderRegistry.js';
import { discoverRemoteModels } from './RemoteModelDiscovery.js';

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

export async function discoverAnthropicModels(apiKey: string): Promise<ModelDefinition[]> {
  return discoverRemoteModels<AnthropicModelsResponse>({
    loggerScope: 'AnthropicDiscovery',
    url: 'https://api.anthropic.com/v1/models',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    parseModels: (data) =>
      data.data
        .filter((model) => model.type === 'model')
        .map((model) => ({
          id: model.id,
          name: model.display_name || model.id,
          contextWindow: getContextWindow(model.id),
        })),
  });
}

function getContextWindow(modelId: string): number {
  if (modelId.includes('claude-3-5')) {
    return 200000;
  }
  if (modelId.includes('opus')) {
    return 200000;
  }
  return 200000;
}
