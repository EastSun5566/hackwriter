import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { CredentialStore } from "@earendil-works/pi-ai";

import type { Configuration, LLMProvider } from "./Configuration.ts";
import { safeValidateConfiguration } from "./ConfigSchema.ts";
import { FileCredentialStore } from "./FileCredentialStore.ts";
import {
  CONFIG_DIR,
  CONFIG_FILE,
  DEFAULT_MAX_RETRIES_PER_STEP,
  DEFAULT_MAX_STEPS_PER_RUN,
} from "./constants.ts";
import { ErrorFactory } from "../utils/ErrorTypes.ts";
import { Logger } from "../utils/Logger.ts";

interface LoaderOptions {
  configPath?: string;
  credentials?: CredentialStore;
  readOnly?: boolean;
}

interface LegacyConfiguration extends Partial<Omit<Configuration, "version">> {
  version?: number;
  providers?: Record<string, LLMProvider>;
}

const defaultConfigPath = path.join(os.homedir(), CONFIG_DIR, CONFIG_FILE);

function defaults(): Configuration {
  return {
    version: 2,
    defaultModel: "",
    models: {},
    providers: {},
    services: {},
    loopControl: {
      maxStepsPerRun: DEFAULT_MAX_STEPS_PER_RUN,
      maxRetriesPerStep: DEFAULT_MAX_RETRIES_PER_STEP,
    },
  };
}

export class ConfigurationLoader {
  static async load(options: LoaderOptions = {}): Promise<Configuration> {
    const configPath = options.configPath ?? defaultConfigPath;
    const credentials = options.credentials ?? new FileCredentialStore();

    try {
      let userConfig: LegacyConfiguration = {};
      let needsRewrite = false;

      try {
        userConfig = JSON.parse(await fs.readFile(configPath, "utf8"));
        if (!options.readOnly) await fs.chmod(configPath, 0o600);
        needsRewrite = userConfig.version !== 2;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          if (error instanceof SyntaxError) {
            throw ErrorFactory.configuration(
              `Invalid JSON in config file: ${error.message}`,
              "Please check your config.json file for syntax errors",
            );
          }
          throw error;
        }
      }

      const providers: Record<string, LLMProvider> = {};
      for (const [providerId, provider] of Object.entries(
        userConfig.providers ?? {},
      )) {
        if (provider.apiKey && !options.readOnly) {
          // Credential write must succeed before the legacy file is rewritten.
          await credentials.modify(providerId, (current) =>
            Promise.resolve(current ?? { type: "api_key", key: provider.apiKey }),
          );
          needsRewrite = true;
        }

        const { apiKey: _discarded, ...safeProvider } = provider;
        providers[providerId] = safeProvider;
      }

      const base = defaults();
      const config: Configuration = {
        version: 2,
        defaultModel: userConfig.defaultModel ?? base.defaultModel,
        models: userConfig.models ?? base.models,
        providers,
        services: userConfig.services ?? base.services,
        loopControl: userConfig.loopControl ?? base.loopControl,
      };

      const validation = safeValidateConfiguration(config);
      if (!validation.success) {
        const messages = validation.errors!
          .map((error) => `  - ${error.path}: ${error.message}`)
          .join("\n");
        throw ErrorFactory.configuration(
          `Invalid configuration:\n${messages}`,
          "Please check your config.json file or environment variables",
        );
      }

      if (needsRewrite && !options.readOnly) await this.save(config, { configPath });
      Logger.debug("ConfigLoader", "Configuration loaded and validated");
      return config;
    } catch (error) {
      if (error instanceof Error && error.name === "AppError") throw error;
      throw ErrorFactory.fromUnknown(error, "Failed to load configuration");
    }
  }

  static async save(
    config: Configuration,
    options: Pick<LoaderOptions, "configPath"> = {},
  ): Promise<void> {
    const configPath = options.configPath ?? defaultConfigPath;
    const providers = Object.fromEntries(
      Object.entries(config.providers ?? {}).map(([id, provider]) => {
        const { apiKey: _discarded, ...safeProvider } = provider;
        return [id, safeProvider];
      }),
    );
    const persisted: Configuration = {
      version: 2,
      defaultModel: config.defaultModel ?? "",
      models: config.models ?? {},
      providers,
      services: config.services ?? {},
      loopControl: config.loopControl ?? defaults().loopControl,
    };

    const directory = path.dirname(configPath);
    const temporaryPath = path.join(
      directory,
      `.${path.basename(configPath)}.${process.pid}.${Date.now()}.tmp`,
    );

    try {
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      await fs.chmod(directory, 0o700);
      await fs.writeFile(temporaryPath, `${JSON.stringify(persisted, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      await fs.chmod(temporaryPath, 0o600);
      await fs.rename(temporaryPath, configPath);
      await fs.chmod(configPath, 0o600);
      Logger.debug("ConfigLoader", "Configuration saved successfully");
    } catch (error) {
      await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
      throw ErrorFactory.fromUnknown(error, "Failed to save configuration");
    }
  }
}
