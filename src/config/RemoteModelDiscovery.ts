import { Logger } from '../utils/Logger.js';
import type { ModelDefinition } from './ProviderRegistry.js';

interface RemoteModelDiscoveryOptions<TResponse> {
  loggerScope: string;
  url: string;
  headers?: Record<string, string>;
  parseModels: (response: TResponse) => ModelDefinition[];
}

export async function discoverRemoteModels<TResponse>(
  options: RemoteModelDiscoveryOptions<TResponse>,
): Promise<ModelDefinition[]> {
  try {
    const response = await fetch(options.url, {
      headers: options.headers,
    });

    if (!response.ok) {
      Logger.debug(options.loggerScope, `API request failed: ${response.status}`);
      return [];
    }

    const data = await response.json() as TResponse;
    const models = options.parseModels(data);

    for (const model of models) {
      Logger.debug(options.loggerScope, `Discovered model: ${model.id}`);
    }

    return models;
  } catch (error) {
    Logger.debug(options.loggerScope, `Failed to discover models: ${String(error)}`);
    return [];
  }
}