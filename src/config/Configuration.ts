export interface HackMDConfig {
  baseUrl: string;
  apiToken: string;
}

export type LLMProviderType = 'anthropic' | 'openai';

export interface LLMProvider {
  type: LLMProviderType;
  apiKey: string;
  baseUrl?: string;
  organizationId?: string;
  projectId?: string;
}

export interface LLMModel {
  provider: string;
  model: string;
  maxContextSize: number;
}

export interface Configuration {
  defaultModel: string;
  models: Record<string, LLMModel>;
  providers: Record<string, LLMProvider>;
  services: {
    hackmd?: HackMDConfig;
  };
  loopControl: {
    maxStepsPerRun: number;
    maxRetriesPerStep: number;
  };
}
