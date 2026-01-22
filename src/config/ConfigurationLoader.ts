import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { Configuration } from './Configuration.js';
import { safeValidateConfiguration } from './ConfigSchema.js';
import { discoverProviders, discoverModels } from './ProviderDiscovery.js';
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
      // 1. Discover providers and models from environment
      const discoveredProviders = discoverProviders();
      const discoveredModels = await discoverModels(discoveredProviders);

      Logger.debug(
        'ConfigLoader',
        `Discovered ${Object.keys(discoveredProviders).length} providers, ${Object.keys(discoveredModels).length} models`
      );

      // 2. Load user config (if exists)
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

      // 3. Merge: user config overrides discovered
      const providers = { ...discoveredProviders, ...(userConfig.providers ?? {}) };
      const models = { ...discoveredModels, ...(userConfig.models ?? {}) };

      // 4. Determine default model
      const defaultModel =
        userConfig.defaultModel ??
        Object.keys(models)[0] ??
        'anthropic-claude-3-5-haiku-latest';

      // 5. Load HackMD config from env if not in config
      const hackmdToken = userConfig.services?.hackmd?.apiToken ?? process.env.HACKMD_API_TOKEN;
      const hackmdApiBaseUrl = userConfig.services?.hackmd?.apiBaseUrl ?? process.env.HACKMD_API_URL ?? 'https://api.hackmd.io/v1';
      const hackmdMcpBaseUrl = userConfig.services?.hackmd?.mcpBaseUrl ?? process.env.HACKMD_MCP_URL ?? 'https://mcp.hackmd.io/v1';

      const config: Configuration = {
        defaultModel,
        models,
        providers,
        services: {
          ...userConfig.services,
          hackmd: hackmdToken ? {
            apiBaseUrl: hackmdApiBaseUrl,
            mcpBaseUrl: hackmdMcpBaseUrl,
            apiToken: hackmdToken,
          } : userConfig.services?.hackmd,
        },
        loopControl: userConfig.loopControl ?? {
          maxStepsPerRun: 100,
          maxRetriesPerStep: 3,
        },
      };

      // 6. Validate merged configuration
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
      // Re-throw if it's already an AppError
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
