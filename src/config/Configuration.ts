export interface HackMDConfig {
  apiBaseUrl?: string;
  mcpBaseUrl?: string;
  apiToken: string;
}

export interface LLMProvider {
  type: string;
  /** @deprecated Read only while migrating an unversioned v1 config. */
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
  version: 2;
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
