export interface ModelDefinition {
  id: string;
  name: string;
  contextWindow: number;
  maxTokens?: number;
}

export interface ProviderDefinition {
  type: 'anthropic' | 'openai' | 'ollama';
  envKey?: string;
  defaultBaseUrl?: string;
  defaultModels: ModelDefinition[];
}

export const BUILT_IN_PROVIDERS: Record<string, ProviderDefinition> = {
  anthropic: {
    type: 'anthropic',
    envKey: 'ANTHROPIC_API_KEY',
    defaultModels: [
      {
        id: 'claude-3-5-haiku-latest',
        name: 'Claude 3.5 Haiku',
        contextWindow: 200000,
      },
      {
        id: 'claude-3-5-sonnet-latest',
        name: 'Claude 3.5 Sonnet',
        contextWindow: 200000,
      },
    ],
  },
  openai: {
    type: 'openai',
    envKey: 'OPENAI_API_KEY',
    defaultModels: [
      {
        id: 'gpt-4o-mini',
        name: 'GPT-4o Mini',
        contextWindow: 128000,
      },
      {
        id: 'gpt-4o',
        name: 'GPT-4o',
        contextWindow: 128000,
      }
    ],
  },
  ollama: {
    type: 'ollama',
    defaultBaseUrl: 'http://localhost:11434/api',
    defaultModels: [], // Discovered dynamically from API
  },
};

export function getProviderDefinition(
  providerType: string
): ProviderDefinition | undefined {
  return BUILT_IN_PROVIDERS[providerType];
}

export function getAllProviderDefinitions(): Record<string, ProviderDefinition> {
  return BUILT_IN_PROVIDERS;
}
