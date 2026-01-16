import { z } from 'zod';

/**
 * Zod schemas for runtime configuration validation
 */

export const HackMDConfigSchema = z.object({
  baseUrl: z.string().url(),
  apiToken: z.string().min(1, 'API token is required'),
});

export const LLMProviderSchema = z.object({
  type: z.enum(['anthropic', 'openai']),
  apiKey: z.string().min(1, 'API key is required'),
  baseUrl: z.string().url().optional(),
  organizationId: z.string().optional(),
  projectId: z.string().optional(),
});

export const LLMModelSchema = z.object({
  provider: z.string().min(1, 'Provider name is required'),
  model: z.string().min(1, 'Model name is required'),
  maxContextSize: z.number().int().positive('Max context size must be positive'),
});

export const LoopControlSchema = z.object({
  maxStepsPerRun: z.number().int().positive().default(100),
  maxRetriesPerStep: z.number().int().nonnegative().default(3),
});

export const ConfigurationSchema = z.object({
  defaultModel: z.string(),
  models: z.record(z.string(), LLMModelSchema),
  providers: z.record(z.string(), LLMProviderSchema),
  services: z.object({
    hackmd: HackMDConfigSchema.optional(),
  }),
  loopControl: LoopControlSchema,
});

// Infer TypeScript types from schemas
export type ValidatedConfiguration = z.infer<typeof ConfigurationSchema>;
export type ValidatedHackMDConfig = z.infer<typeof HackMDConfigSchema>;
export type ValidatedLLMProvider = z.infer<typeof LLMProviderSchema>;
export type ValidatedLLMModel = z.infer<typeof LLMModelSchema>;

/**
 * Validate configuration object
 */
export function validateConfiguration(data: unknown): ValidatedConfiguration {
  return ConfigurationSchema.parse(data);
}

/**
 * Safely validate configuration with detailed error messages
 */
export function safeValidateConfiguration(data: unknown): {
  success: boolean;
  data?: ValidatedConfiguration;
  errors?: { path: string; message: string }[];
} {
  const result = ConfigurationSchema.safeParse(data);
  
  if (result.success) {
    return { success: true, data: result.data };
  }
  
  const errors = result.error.issues.map(issue => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
  
  return { success: false, errors };
}
