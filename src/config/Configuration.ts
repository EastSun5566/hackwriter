export interface HackMDConfig {
  apiBaseUrl?: string;
  mcpBaseUrl?: string;
  apiToken: string;
}

export type LLMProviderType = "anthropic" | "openai" | "ollama";

export interface LLMProvider {
  type: LLMProviderType;
  apiKey?: string;
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

