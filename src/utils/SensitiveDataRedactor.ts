/**
 * SensitiveDataRedactor provides utilities to redact sensitive information
 * from logs, error messages, and other outputs to prevent credential leaks
 */
export class SensitiveDataRedactor {
  /**
   * Default list of sensitive key patterns
   */
  private static readonly DEFAULT_SENSITIVE_KEYS = [
    'apiKey',
    'api_key',
    'API_KEY',
    'token',
    'accessToken',
    'access_token',
    'apiToken',
    'api_token',
    'password',
    'PASSWORD',
    'secret',
    'SECRET',
    'credential',
    'CREDENTIAL',
    'auth',
    'authorization',
    'bearer',
  ];

  /**
   * Regex patterns to detect sensitive data in strings
   */
  private static readonly SENSITIVE_PATTERNS = [
    /sk-[a-zA-Z0-9]{20,}/g,           // API keys like sk-ant-xxx
    /Bearer\s+[a-zA-Z0-9_\-.]+/gi,   // Bearer tokens
    /[a-zA-Z0-9]{32,}/g,              // Long alphanumeric strings (potential tokens)
  ];

  /**
   * Redact sensitive fields from an object
   * @param obj - The object to redact
   * @param sensitiveKeys - Optional custom list of sensitive keys
   * @returns A new object with sensitive values redacted
   */
  static redact(obj: unknown, sensitiveKeys?: string[]): unknown {
    const keys = sensitiveKeys ?? this.DEFAULT_SENSITIVE_KEYS;

    if (obj === null || obj === undefined) {
      return obj;
    }

    if (typeof obj !== 'object') {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.redact(item, sensitiveKeys));
    }

    const redacted: Record<string, unknown> = {};
    const record = obj as Record<string, unknown>;

    for (const [key, value] of Object.entries(record)) {
      // Check if key matches sensitive patterns
      const isSensitive = keys.some(sensitiveKey =>
        key.toLowerCase().includes(sensitiveKey.toLowerCase())
      );

      if (isSensitive) {
        redacted[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null) {
        // Recursively redact nested objects
        redacted[key] = this.redact(value, sensitiveKeys);
      } else {
        redacted[key] = value;
      }
    }

    return redacted;
  }

  /**
   * Redact API keys and tokens from strings
   * @param text - The text to redact
   * @returns Text with sensitive patterns replaced
   */
  static redactString(text: string): string {
    if (!text) {
      return text;
    }

    let redacted = text;

    // Apply each pattern
    for (const pattern of this.SENSITIVE_PATTERNS) {
      redacted = redacted.replace(pattern, '[REDACTED]');
    }

    return redacted;
  }

  /**
   * Clear sensitive data from memory
   * Overwrites sensitive values with empty strings and deletes properties
   * @param obj - The object to clear
   */
  static clearMemory(obj: Record<string, unknown>): void {
    if (!obj || typeof obj !== 'object') {
      return;
    }

    const keys = this.DEFAULT_SENSITIVE_KEYS;

    for (const key of Object.keys(obj)) {
      const isSensitive = keys.some(sensitiveKey =>
        key.toLowerCase().includes(sensitiveKey.toLowerCase())
      );

      if (isSensitive) {
        // Overwrite with empty string first
        if (typeof obj[key] === 'string') {
          obj[key] = '';
        }
        // Then delete the property
        delete obj[key];
      } else if (typeof obj[key] === 'object' && obj[key] !== null) {
        // Recursively clear nested objects
        this.clearMemory(obj[key] as Record<string, unknown>);
      }
    }
  }

  /**
   * Check if a key name appears to be sensitive
   * @param key - The key name to check
   * @returns true if the key appears sensitive
   */
  static isSensitiveKey(key: string): boolean {
    return this.DEFAULT_SENSITIVE_KEYS.some(sensitiveKey =>
      key.toLowerCase().includes(sensitiveKey.toLowerCase())
    );
  }
}
