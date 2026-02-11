import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { Configuration } from './Configuration.js';
import { safeValidateConfiguration } from './ConfigSchema.js';
import { discoverProviders, discoverModels } from './ProviderDiscovery.js';
import { loadHackMDCLIConfig } from './HackMDConfigLoader.js';
import { ErrorFactory } from '../utils/ErrorTypes.js';
import { Logger } from '../utils/Logger.js';
import { SensitiveDataRedactor } from '../utils/SensitiveDataRedactor.js';
import {
  CONFIG_DIR,
  CONFIG_FILE,
  DEFAULT_HACKMD_API_URL,
  DEFAULT_HACKMD_MCP_URL,
  DEFAULT_MODEL,
  DEFAULT_MAX_STEPS_PER_RUN,
  DEFAULT_MAX_RETRIES_PER_STEP,
  HACKMD_CLI_TOKEN_ENV,
  HACKMD_CLI_ENDPOINT_ENV,
  HACKWRITER_TOKEN_ENV,
  HACKWRITER_API_URL_ENV,
  HACKWRITER_MCP_URL_ENV,
} from './constants.js';

export class ConfigurationLoader {
  private static configPath = path.join(
    os.homedir(),
    CONFIG_DIR,
    CONFIG_FILE
  );

  static async load(): Promise<Configuration> {
    try {
      // 1. Discover providers and models from environment
      const discoveredProviders = discoverProviders();
      const discoveredModels = await discoverModels(discoveredProviders);

      // Redact sensitive data before logging
      const redactedProviders = SensitiveDataRedactor.redact(discoveredProviders);
      Logger.debug(
        'ConfigLoader',
        `Discovered ${Object.keys(discoveredProviders).length} providers, ${Object.keys(discoveredModels).length} models`,
        { providers: redactedProviders }
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
      // Priority: user config > DEFAULT_MODEL constant > first discovered model
      const defaultModel =
        userConfig.defaultModel ??
        (DEFAULT_MODEL in models ? DEFAULT_MODEL : Object.keys(models)[0]) ??
        DEFAULT_MODEL;

      // 5. Load HackMD config with priority order:
      //    1. Environment variables (HackWriter)
      //    2. Environment variables (HackMD CLI)
      //    3. HackWriter config file
      //    4. HackMD CLI config file
      //    5. Default values
      
      // Load HackMD CLI config as fallback
      const hackmdCLIConfig = await loadHackMDCLIConfig();
      
      const hackmdToken = 
        process.env[HACKWRITER_TOKEN_ENV] ??      // Priority 1: HACKMD_API_TOKEN
        process.env[HACKMD_CLI_TOKEN_ENV] ??      // Priority 2: HMD_API_ACCESS_TOKEN
        userConfig.services?.hackmd?.apiToken ??  // Priority 3: HackWriter config
        hackmdCLIConfig?.accessToken;             // Priority 4: HackMD CLI config
      
      const hackmdApiBaseUrl = 
        process.env[HACKWRITER_API_URL_ENV] ??           // Priority 1: HACKMD_API_URL
        process.env[HACKMD_CLI_ENDPOINT_ENV] ??          // Priority 2: HMD_API_ENDPOINT_URL
        userConfig.services?.hackmd?.apiBaseUrl ??       // Priority 3: HackWriter config
        hackmdCLIConfig?.hackmdAPIEndpointURL ??         // Priority 4: HackMD CLI config
        DEFAULT_HACKMD_API_URL;                          // Priority 5: Default
      
      const hackmdMcpBaseUrl = 
        process.env[HACKWRITER_MCP_URL_ENV] ??    // Priority 1: HACKMD_MCP_URL
        userConfig.services?.hackmd?.mcpBaseUrl ??
        DEFAULT_HACKMD_MCP_URL;
      
      // Log configuration source for debugging
      if (hackmdToken) {
        if (process.env[HACKWRITER_TOKEN_ENV]) {
          Logger.debug('ConfigLoader', 'Using HackMD token from HACKMD_API_TOKEN');
        } else if (process.env[HACKMD_CLI_TOKEN_ENV]) {
          Logger.debug('ConfigLoader', 'Using HackMD token from HMD_API_ACCESS_TOKEN (HackMD CLI)');
        } else if (userConfig.services?.hackmd?.apiToken) {
          Logger.debug('ConfigLoader', 'Using HackMD token from HackWriter config');
        } else if (hackmdCLIConfig?.accessToken) {
          Logger.debug('ConfigLoader', 'Using HackMD token from HackMD CLI config (~/.hackmd/config.json)');
        }
      }

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
          maxStepsPerRun: DEFAULT_MAX_STEPS_PER_RUN,
          maxRetriesPerStep: DEFAULT_MAX_RETRIES_PER_STEP,
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
