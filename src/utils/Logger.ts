import chalk from 'chalk';
import { SensitiveDataRedactor } from './SensitiveDataRedactor.ts';

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

    Logger.log(category, message, error, {
      category: chalk.red,
      message: chalk.red,
    });

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
    const timestampFormatted = chalk.gray(timestamp);

    const safeCategory = SensitiveDataRedactor.redactString(category);
    const safeMessage = SensitiveDataRedactor.redactString(message);
    const safeCategoryFormatted = colors.category(`[${safeCategory}]`);
    console.log(`${timestampFormatted} ${safeCategoryFormatted} ${colors.message(safeMessage)}`);

    if (data !== undefined) {
      if (data instanceof Error) {
        console.log(chalk.gray(SensitiveDataRedactor.redactString(data.stack ?? data.message)));
      } else if (typeof data === 'object' && data !== null) {
        console.log(chalk.gray(JSON.stringify(SensitiveDataRedactor.redact(data), null, 2)));
      } else if (typeof data === 'string' || typeof data === 'number' || typeof data === 'boolean') {
        const value = typeof data === 'string'
          ? SensitiveDataRedactor.redactString(data)
          : String(data);
        console.log(chalk.gray(value));
      }
    }
  }
}
