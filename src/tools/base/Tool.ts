import type { JSONSchema7 } from "json-schema";
import { formatSafeError } from "../../utils/SafeError.ts";

export interface ToolResult {
  ok: boolean;
  output: string; // Human-readable text output
  message?: string;
  brief?: string;
  json?: unknown; // Optional structured data for model/UI
}

export type ToolSchema = JSONSchema7;

export abstract class Tool<
  P extends Record<string, unknown> = Record<string, unknown>,
> {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly inputSchema: ToolSchema;

  abstract call(params: P, signal?: AbortSignal): Promise<ToolResult>;

  protected ok(output: string, message?: string, brief?: string): ToolResult {
    return { ok: true, output, message, brief };
  }

  protected error(output: string, message: string, brief?: string): ToolResult {
    return { ok: false, output, message, brief };
  }

  protected formatError(error: unknown): string {
    return formatSafeError(error);
  }
}
