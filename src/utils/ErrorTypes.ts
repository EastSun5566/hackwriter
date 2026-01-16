/**
 * Structured error types for better error handling and user feedback
 */

export enum ErrorCategory {
  // Configuration errors
  CONFIGURATION = 'configuration',
  
  // Authentication/authorization errors
  AUTH = 'auth',
  
  // Network/API errors
  NETWORK = 'network',
  
  // Validation errors (user input)
  VALIDATION = 'validation',
  
  // Resource not found
  NOT_FOUND = 'not_found',
  
  // Permission/access denied
  PERMISSION = 'permission',
  
  // Rate limiting
  RATE_LIMIT = 'rate_limit',
  
  // Internal/unknown errors
  INTERNAL = 'internal',
}

export interface ErrorDetails {
  category: ErrorCategory;
  message: string;
  userMessage: string;  // User-friendly message to display
  code?: string;        // Error code for programmatic handling
  context?: Record<string, unknown>;  // Additional context
  suggestion?: string;  // Suggested action for user
}

/**
 * Base application error class with rich context
 */
export class AppError extends Error {
  readonly category: ErrorCategory;
  readonly userMessage: string;
  readonly code?: string;
  readonly context?: Record<string, unknown>;
  readonly suggestion?: string;

  constructor(details: ErrorDetails) {
    super(details.message);
    this.name = 'AppError';
    this.category = details.category;
    this.userMessage = details.userMessage;
    this.code = details.code;
    this.context = details.context;
    this.suggestion = details.suggestion;

    // Maintains proper stack trace for where error was thrown
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Format error for user display
   */
  toUserString(): string {
    let output = `❌ ${this.userMessage}`;
    
    if (this.suggestion) {
      output += `\n\n💡 ${this.suggestion}`;
    }
    
    return output;
  }

  /**
   * Format error for logging
   */
  toLogString(): string {
    return `[${this.category}${this.code ? `:${this.code}` : ''}] ${this.message}`;
  }
}

/**
 * Helper functions to create common error types
 */
export class ErrorFactory {
  static configuration(message: string, suggestion?: string): AppError {
    return new AppError({
      category: ErrorCategory.CONFIGURATION,
      message,
      userMessage: `Configuration error: ${message}`,
      suggestion: suggestion ?? 'Please run `hackwriter setup` to configure',
    });
  }

  static auth(message: string, service?: string): AppError {
    return new AppError({
      category: ErrorCategory.AUTH,
      message,
      userMessage: `Authentication failed${service ? ` for ${service}` : ''}`,
      code: 'AUTH_FAILED',
      suggestion: service 
        ? `Please check your ${service} API token in the configuration`
        : 'Please check your API credentials',
    });
  }

  static network(message: string, endpoint?: string): AppError {
    return new AppError({
      category: ErrorCategory.NETWORK,
      message,
      userMessage: 'Network request failed',
      code: 'NETWORK_ERROR',
      context: endpoint ? { endpoint } : undefined,
      suggestion: 'Please check your internet connection and try again',
    });
  }

  static validation(field: string, reason: string): AppError {
    return new AppError({
      category: ErrorCategory.VALIDATION,
      message: `Validation failed for ${field}: ${reason}`,
      userMessage: `Invalid ${field}: ${reason}`,
      code: 'VALIDATION_ERROR',
      context: { field, reason },
    });
  }

  static notFound(resource: string, identifier?: string): AppError {
    return new AppError({
      category: ErrorCategory.NOT_FOUND,
      message: `${resource} not found${identifier ? `: ${identifier}` : ''}`,
      userMessage: `${resource} not found${identifier ? ` (${identifier})` : ''}`,
      code: 'NOT_FOUND',
      context: identifier ? { resource, identifier } : { resource },
      suggestion: `Please verify the ${resource.toLowerCase()} exists`,
    });
  }

  static permission(action: string, resource?: string): AppError {
    return new AppError({
      category: ErrorCategory.PERMISSION,
      message: `Permission denied: ${action}${resource ? ` on ${resource}` : ''}`,
      userMessage: `You don't have permission to ${action}${resource ? ` ${resource}` : ''}`,
      code: 'PERMISSION_DENIED',
      suggestion: 'Please check your access permissions',
    });
  }

  static rateLimit(retryAfter?: number): AppError {
    return new AppError({
      category: ErrorCategory.RATE_LIMIT,
      message: 'Rate limit exceeded',
      userMessage: 'Too many requests',
      code: 'RATE_LIMIT',
      context: retryAfter ? { retryAfter } : undefined,
      suggestion: retryAfter 
        ? `Please wait ${retryAfter} seconds before trying again`
        : 'Please wait a moment before trying again',
    });
  }

  static internal(message: string, originalError?: Error): AppError {
    return new AppError({
      category: ErrorCategory.INTERNAL,
      message: originalError ? `${message}: ${originalError.message}` : message,
      userMessage: 'An unexpected error occurred',
      code: 'INTERNAL_ERROR',
      context: originalError ? { originalError: originalError.message } : undefined,
      suggestion: 'Please try again or contact support if the issue persists',
    });
  }

  /**
   * Convert unknown error to AppError
   */
  static fromUnknown(error: unknown, context?: string): AppError {
    if (error instanceof AppError) {
      return error;
    }

    if (error instanceof Error) {
      return ErrorFactory.internal(
        context ? `${context}: ${error.message}` : error.message,
        error
      );
    }

    return ErrorFactory.internal(
      context ? `${context}: ${String(error)}` : String(error)
    );
  }
}
