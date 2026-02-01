import chalk from 'chalk';
import { SensitiveDataRedactor } from './SensitiveDataRedactor.js';

type LogLevel = 'silent' | 'info' | 'debug';

export class Logger {
  private static level: LogLevel = 'silent';

  static setLevel(level: LogLevel): void {
    Logger.level = level;
  }

  static getLevel(): LogLevel {
    return Logger.level;
  }

  static debug(category: string, message: string, data?: unknown): void {
    if (Logger.level !== 'debug') {
      return;
    }

    Logger.log(category, message, data, {
      category: chalk.cyan,
      message: chalk.white,
    });
  }

  static info(category: string, message: string, data?: unknown): void {
    if (Logger.level === 'silent') {
      return;
    }

    Logger.log(category, message, data, {
      category: chalk.blue,
      message: chalk.white,
    });
  }

  static warn(category: string, message: string, data?: unknown): void {
    if (Logger.level === 'silent') {
      return;
    }

    Logger.log(category, message, data, {
      category: chalk.yellow,
      message: chalk.yellow,
    });
  }

  static error(category: string, message: string, error?: unknown): void {
    if (Logger.level === 'silent') {
      return;
    }

    // Sanitize error message before logging
    const sanitizedMessage = SensitiveDataRedactor.redactString(message);

    Logger.log(category, sanitizedMessage, undefined, {
      category: chalk.red,
      message: chalk.red,
    });

    if (error !== undefined) {
      if (error instanceof Error) {
        // Sanitize error stack and message
        const sanitizedStack = SensitiveDataRedactor.redactString(error.stack ?? error.message);
        console.log(chalk.red(sanitizedStack));
      } else if (typeof error === 'object' && error !== null) {
        // Redact sensitive fields from error objects
        const redactedError = SensitiveDataRedactor.redact(error);
        console.log(chalk.red(JSON.stringify(redactedError, null, 2)));
      } else if (typeof error === 'string' || typeof error === 'number' || typeof error === 'boolean') {
        const sanitizedError = typeof error === 'string' 
          ? SensitiveDataRedactor.redactString(error)
          : String(error);
        console.log(chalk.red(sanitizedError));
      }
    }
  }

  private static log(
    category: string,
    message: string,
    data: unknown,
    colors: {
      category: (value: string) => string;
      message: (value: string) => string;
    },
  ): void {
    const timestamp = new Date().toISOString().split('T')[1].slice(0, -1);
    const categoryFormatted = colors.category(`[${category}]`);
    const timestampFormatted = chalk.gray(timestamp);

    console.log(`${timestampFormatted} ${categoryFormatted} ${colors.message(message)}`);

    if (data !== undefined) {
      if (typeof data === 'object' && data !== null) {
        console.log(chalk.gray(JSON.stringify(data, null, 2)));
      } else if (typeof data === 'string' || typeof data === 'number' || typeof data === 'boolean') {
        console.log(chalk.gray(String(data)));
      }
    }
  }
}
