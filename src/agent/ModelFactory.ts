import type { LanguageModel } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import type { LLMProvider } from '../config/Configuration.js';
import { Logger } from '../utils/Logger.js';

export function buildLanguageModel(provider: LLMProvider, modelId: string): LanguageModel {
  Logger.debug('ModelFactory', 'Building language model', {
    providerType: provider.type,
    modelId,
    hasApiKey: !!provider.apiKey,
    baseUrl: provider.baseUrl
  });

  switch (provider.type) {
    case 'anthropic': {
      const anthropic = createAnthropic({
        apiKey: provider.apiKey,
        baseURL: provider.baseUrl,
      });
      return anthropic.languageModel(modelId);
    }
    case 'openai': {
      const openai = createOpenAI({
        apiKey: provider.apiKey,
        baseURL: provider.baseUrl,
        organization: provider.organizationId,
        project: provider.projectId,
      });
      return openai.languageModel(modelId);
    }
    default:
      throw new Error(`Unsupported provider type: ${(provider as { type: string }).type}`);
  }
}
