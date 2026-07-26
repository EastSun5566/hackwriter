import { SensitiveDataRedactor } from "./SensitiveDataRedactor.ts";

function isAbortError(error: unknown): error is Error {
  return error instanceof Error && error.name === "AbortError";
}

export function rethrowAbortError(error: unknown): void {
  if (isAbortError(error)) throw error;
}

export function formatSafeError(error: unknown, includeStack = false): string {
  if (error instanceof Error) {
    const value = includeStack ? (error.stack ?? error.message) : error.message;
    return SensitiveDataRedactor.redactString(value);
  }
  return SensitiveDataRedactor.redactString(String(error));
}
