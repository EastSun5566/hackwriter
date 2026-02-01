import { z } from "zod";

/**
 * Zod schemas for runtime configuration validation
 */

const HackMDConfigSchema = z.object({
  apiBaseUrl: z.url().optional(),
  mcpBaseUrl: z.url().optional(),
  apiToken: z.string().min(1, "API token is required"),
});

const LLMProviderSchema = z.object({
  type: z.enum(["anthropic", "openai", "ollama"]),
  apiKey: z.string().min(1, "API key is required").optional(),
  baseUrl: z.url().optional(),
  organizationId: z.string().optional(),
  projectId: z.string().optional(),
});

const LLMModelSchema = z.object({
  provider: z.string().min(1, "Provider name is required"),
  model: z.string().min(1, "Model name is required"),
  maxContextSize: z
    .number()
    .int()
    .positive("Max context size must be positive"),
});

const LoopControlSchema = z.object({
  maxStepsPerRun: z.number().int().positive().default(100),
  maxRetriesPerStep: z.number().int().nonnegative().default(3),
});

const ConfigurationSchema = z.object({
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

  const errors = result.error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));

  return { success: false, errors };
}
