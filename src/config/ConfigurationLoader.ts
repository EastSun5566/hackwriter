import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { Configuration } from './Configuration.js';
import { safeValidateConfiguration } from './ConfigSchema.js';
import { discoverProviders, discoverModels } from './ProviderDiscovery.js';
import { loadHackMDCLIConfig } from './HackMDConfigLoader.js';
import {
  describeHackMDTokenSource,
  resolveHackMDServiceConfig,
} from './HackMDServiceResolution.js';
import { ErrorFactory } from '../utils/ErrorTypes.js';
import { Logger } from '../utils/Logger.js';
import { SensitiveDataRedactor } from '../utils/SensitiveDataRedactor.js';
import {
  CONFIG_DIR,
  CONFIG_FILE,
  DEFAULT_MODEL,
  DEFAULT_MAX_STEPS_PER_RUN,
  DEFAULT_MAX_RETRIES_PER_STEP,
} from './constants.js';

export class ConfigurationLoader {
  private static configPath = path.join(
    os.homedir(),
    CONFIG_DIR,
    CONFIG_FILE
  );

  static async updateUserConfig(
    mutator: (config: Partial<Configuration>) => void,
  ): Promise<void> {
    try {
      let userConfig: Partial<Configuration> = {};

      try {
        const content = await fs.readFile(this.configPath, 'utf-8');
        userConfig = JSON.parse(content);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          if (error instanceof SyntaxError) {
            throw ErrorFactory.configuration(
              `Invalid JSON in config file: ${error.message}`,
              'Please check your config.json file for syntax errors'
            );
          }
          throw error;
        }
      }

      mutator(userConfig);

      const dir = path.dirname(this.configPath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(
        this.configPath,
        JSON.stringify(userConfig, null, 2),
        'utf-8'
      );

      Logger.debug('ConfigLoader', 'User configuration updated successfully');
    } catch (error) {
      if (error instanceof Error && error.name === 'AppError') {
        throw error;
      }

      throw ErrorFactory.fromUnknown(error, 'Failed to update configuration');
    }
  }

  static async load(): Promise<Configuration> {
    try {
      const discoveredProviders = discoverProviders();
      const discoveredModels = await discoverModels(discoveredProviders);

      const redactedProviders = SensitiveDataRedactor.redact(discoveredProviders);
      Logger.debug(
        'ConfigLoader',
        `Discovered ${Object.keys(discoveredProviders).length} providers, ${Object.keys(discoveredModels).length} models`,
        { providers: redactedProviders }
      );

      let userConfig: Partial<Configuration> = {};
      try {
        const content = await fs.readFile(this.configPath, 'utf-8');
        userConfig = JSON.parse(content);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          if (error instanceof SyntaxError) {
            throw ErrorFactory.configuration(
              `Invalid JSON in config file: ${error.message}`,
              'Please check your config.json file for syntax errors'
            );
          }
          throw error;
        }
        Logger.debug('ConfigLoader', 'No user config file found, using discovered only');
      }

      const providers = { ...discoveredProviders, ...(userConfig.providers ?? {}) };
      const models = { ...discoveredModels, ...(userConfig.models ?? {}) };

      const defaultModel =
        userConfig.defaultModel ??
        (DEFAULT_MODEL in models ? DEFAULT_MODEL : Object.keys(models)[0]) ??
        DEFAULT_MODEL;

      const hackmdCLIConfig = await loadHackMDCLIConfig();
      const { hackmd, tokenSource } = resolveHackMDServiceConfig(
        userConfig.services?.hackmd,
        hackmdCLIConfig,
      );

      const tokenSourceDescription = describeHackMDTokenSource(tokenSource);
      if (tokenSourceDescription) {
        Logger.debug(
          'ConfigLoader',
          `Using HackMD token from ${tokenSourceDescription}`,
        );
      }

      const config: Configuration = {
        defaultModel,
        models,
        providers,
        services: {
          ...userConfig.services,
          hackmd: hackmd ?? userConfig.services?.hackmd,
        },
        loopControl: userConfig.loopControl ?? {
          maxStepsPerRun: DEFAULT_MAX_STEPS_PER_RUN,
          maxRetriesPerStep: DEFAULT_MAX_RETRIES_PER_STEP,
        },
      };

      const validation = safeValidateConfiguration(config);

      if (!validation.success) {
        const errorMessages = validation.errors!
          .map((e: { path: string; message: string }) => `  - ${e.path}: ${e.message}`)
          .join('\n');

        throw ErrorFactory.configuration(
          `Invalid configuration:\n${errorMessages}`,
          'Please check your config.json file or environment variables'
        );
      }

      Logger.debug('ConfigLoader', 'Configuration loaded and validated successfully');
      Logger.debug('ConfigLoader', `Default model: ${config.defaultModel}`);
      Logger.debug('ConfigLoader', `Total models: ${Object.keys(config.models).length}`);

      return config;
    } catch (error) {
      if (error instanceof Error && error.name === 'AppError') {
        throw error;
      }

      throw ErrorFactory.fromUnknown(error, 'Failed to load configuration');
    }
  }

  static async save(config: Configuration): Promise<void> {
    try {
      const persistConfig: Record<string, unknown> = {
        defaultModel: config.defaultModel,
        services: config.services,
        loopControl: config.loopControl,
      };

      const providerKeys: Record<string, { type: string; apiKey?: string }> = {};
      for (const [name, provider] of Object.entries(config.providers)) {
        if (provider.apiKey) {
          providerKeys[name] = {
            type: provider.type,
            apiKey: provider.apiKey,
          };
        }
      }
      if (Object.keys(providerKeys).length > 0) {
        persistConfig.providers = providerKeys;
      }

      const dir = path.dirname(this.configPath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(
        this.configPath,
        JSON.stringify(persistConfig, null, 2),
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
}
