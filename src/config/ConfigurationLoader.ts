import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { Configuration } from './Configuration.js';
import { safeValidateConfiguration } from './ConfigSchema.js';
import { ErrorFactory } from '../utils/ErrorTypes.js';
import { Logger } from '../utils/Logger.js';

export class ConfigurationLoader {
  private static configPath = path.join(
    os.homedir(),
    '.hackwriter',
    'config.json'
  );

  static async load(): Promise<Configuration> {
    try {
      const content = await fs.readFile(this.configPath, 'utf-8');
      const rawConfig = JSON.parse(content);
      
      // Validate configuration
      const validation = safeValidateConfiguration(rawConfig);
      
      if (!validation.success) {
        const errorMessages = validation.errors!
          .map((e: { path: string; message: string }) => `  - ${e.path}: ${e.message}`)
          .join('\n');
          
        throw ErrorFactory.configuration(
          `Invalid configuration:\n${errorMessages}`,
          'Please check your config.json file or run `hackwriter setup` to reconfigure'
        );
      }
      
      Logger.debug('ConfigLoader', 'Configuration loaded and validated successfully');
      return validation.data as Configuration;
      
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        Logger.debug('ConfigLoader', 'No config file found, returning defaults');
        return this.getDefaultConfig();
      }
      
      // Re-throw if it's already an AppError
      if (error instanceof Error && error.name === 'AppError') {
        throw error;
      }
      
      // Handle JSON parse errors
      if (error instanceof SyntaxError) {
        throw ErrorFactory.configuration(
          `Invalid JSON in config file: ${error.message}`,
          'Please check your config.json file for syntax errors'
        );
      }
      
      throw ErrorFactory.fromUnknown(error, 'Failed to load configuration');
    }
  }

  static async save(config: Configuration): Promise<void> {
    try {
      // Validate before saving
      const validation = safeValidateConfiguration(config);
      
      if (!validation.success) {
        const errorMessages = validation.errors!
          .map((e: { path: string; message: string }) => `  - ${e.path}: ${e.message}`)
          .join('\n');
          
        throw ErrorFactory.validation(
          'configuration',
          `Invalid configuration data:\n${errorMessages}`
        );
      }
      
      const dir = path.dirname(this.configPath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(
        this.configPath,
        JSON.stringify(config, null, 2),
        'utf-8'
      );
      
      Logger.debug('ConfigLoader', 'Configuration saved successfully');
      
    } catch (error) {
      if (error instanceof Error && error.name === 'AppError') {
        throw error;
      }
      throw ErrorFactory.fromUnknown(error, 'Failed to save configuration');
    }
  }

  private static getDefaultConfig(): Configuration {
    return {
      defaultModel: '',
      models: {},
      providers: {},
      services: {},
      loopControl: {
        maxStepsPerRun: 100,
        maxRetriesPerStep: 3,
      },
    };
  }
}
