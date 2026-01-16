import chalk from 'chalk';

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

    Logger.log(category, message, undefined, {
      category: chalk.red,
      message: chalk.red,
    });

    if (error !== undefined) {
      if (error instanceof Error) {
        console.log(chalk.red(error.stack ?? error.message));
      } else if (typeof error === 'object' && error !== null) {
        console.log(chalk.red(JSON.stringify(error, null, 2)));
      } else if (typeof error === 'string' || typeof error === 'number' || typeof error === 'boolean') {
        console.log(chalk.red(String(error)));
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
