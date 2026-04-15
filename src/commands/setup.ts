import { password, select } from '@inquirer/prompts';
import chalk from 'chalk';
import { ConfigurationLoader } from '../config/ConfigurationLoader.js';
import type { Configuration, LLMModel, LLMProvider } from '../config/Configuration.js';
import { discoverProviders, discoverModels } from '../config/ProviderDiscovery.js';
import { loadHackMDCLIConfig } from '../config/HackMDConfigLoader.js';
import {
  describeHackMDTokenSource,
  resolveHackMDToken,
  type HackMDTokenSource,
} from '../config/HackMDServiceResolution.js';
import { DEFAULT_MAX_STEPS_PER_RUN, DEFAULT_MAX_RETRIES_PER_STEP } from '../config/constants.js';

type ConfigurableLLMProvider = 'anthropic' | 'openai';

interface DetectedEnvironment {
  providers: Record<string, LLMProvider>;
  models: Record<string, LLMModel>;
  hasAnthropicKey: boolean;
  hasOpenAIKey: boolean;
  hasOllamaModels: boolean;
}

function printSetupHeader(): void {
  console.log(chalk.bold.cyan('\n🔧 HackWriter Setup\n'));
}

async function detectEnvironment(): Promise<DetectedEnvironment> {
  const providers = discoverProviders();
  const models = await discoverModels(providers);

  return {
    providers,
    models,
    hasAnthropicKey: !!providers.anthropic?.apiKey,
    hasOpenAIKey: !!providers.openai?.apiKey,
    hasOllamaModels: Object.values(models).some((model) => model.provider === 'ollama'),
  };
}

function printEnvironmentDetection(environment: DetectedEnvironment): void {
  const { hasAnthropicKey, hasOpenAIKey, hasOllamaModels, models } = environment;
  const modelCount = Object.keys(models).length;

  if (!hasAnthropicKey && !hasOpenAIKey && !hasOllamaModels) {
    return;
  }

  console.log(chalk.green('Environment Detection:'));
  if (hasAnthropicKey) {
    console.log(chalk.green('  ✓ ANTHROPIC_API_KEY found'));
  }
  if (hasOpenAIKey) {
    console.log(chalk.green('  ✓ OPENAI_API_KEY found'));
  }
  if (hasOllamaModels) {
    console.log(chalk.green('  ✓ Ollama detected'));
  }
  if (modelCount > 0) {
    console.log(chalk.green(`  ✓ ${modelCount} model(s) available\n`));
  }
}

function printCurrentConfiguration(config: Configuration): void {
  console.log(chalk.gray('Current configuration:'));

  if (config.services.hackmd?.apiToken) {
    console.log(chalk.green('  ✓ HackMD API token configured'));
  } else {
    console.log(chalk.yellow('  ✗ HackMD API token not set'));
  }

  const hasAnthropicKey = !!config.providers.anthropic?.apiKey;
  const hasOpenAIKey = !!config.providers.openai?.apiKey;
  const hasOllama = Object.values(config.models).some((model) => model.provider === 'ollama');

  if (hasAnthropicKey) console.log(chalk.green('  ✓ Anthropic API key configured'));
  if (hasOpenAIKey) console.log(chalk.green('  ✓ OpenAI API key configured'));
  if (hasOllama) console.log(chalk.green('  ✓ Ollama available'));
  console.log();
}

async function promptForHackMDToken(): Promise<string | undefined> {
  return password({
    message: 'Enter HackMD API token',
    mask: '*',
  });
}

async function promptForLLMProvider(options: {
  message: string;
  includeSkip?: boolean;
  includeCancel?: boolean;
}): Promise<ConfigurableLLMProvider | 'skip' | 'cancel'> {
  const choices = [
    { name: 'Anthropic (Claude)', value: 'anthropic' },
    { name: 'OpenAI (GPT)', value: 'openai' },
    ...(options.includeSkip ? [{ name: 'Skip (I will use Ollama locally)', value: 'skip' }] : []),
    ...(options.includeCancel ? [{ name: 'Cancel', value: 'cancel' }] : []),
  ];

  return select({
    message: options.message,
    choices,
  }) as Promise<ConfigurableLLMProvider | 'skip' | 'cancel'>;
}

async function promptForLLMApiKey(
  provider: ConfigurableLLMProvider,
): Promise<string | undefined> {
  const providerName = provider === 'anthropic' ? 'Anthropic' : 'OpenAI';

  return password({
    message: `Enter ${providerName} API key`,
    mask: '*',
  });
}

async function configureOllamaModels(
  models: Record<string, LLMModel>,
): Promise<boolean> {
  console.log(chalk.cyan('\n🔍 Checking for Ollama...'));

  const { discoverOllamaModels } = await import('../config/OllamaDiscovery.js');
  const ollamaModels = await discoverOllamaModels();

  if (ollamaModels.length === 0) {
    console.log(chalk.red('\n❌ Ollama is not running or no models are installed'));
    console.log(chalk.gray('To use Ollama with HackWriter:'));
    console.log(chalk.cyan('  1. Install Ollama: https://ollama.ai'));
    console.log(chalk.cyan('  2. Run: ollama pull llama3.2'));
    console.log(chalk.cyan('  3. Start Ollama service\n'));
    console.log(chalk.gray('Alternatively:'));
    console.log(chalk.cyan('  - Set ANTHROPIC_API_KEY or OPENAI_API_KEY environment variable'));
    console.log(chalk.cyan('  - Run "hackwriter setup" again to configure\n'));
    return false;
  }

  console.log(chalk.green(`✓ Found ${ollamaModels.length} Ollama model(s):`));
  ollamaModels.slice(0, 5).forEach((model) => {
    console.log(chalk.gray(`  - ${model.name}`));
  });
  if (ollamaModels.length > 5) {
    console.log(chalk.gray(`  ... and ${ollamaModels.length - 5} more`));
  }
  console.log();

  for (const modelDef of ollamaModels) {
    const modelName = `ollama-${modelDef.id}`;
    models[modelName] = {
      provider: 'ollama',
      model: modelDef.id,
      maxContextSize: modelDef.contextWindow,
    };
  }

  return true;
}

function ensureLoopControl(config: Partial<Configuration>): void {
  config.loopControl ??= {
    maxStepsPerRun: DEFAULT_MAX_STEPS_PER_RUN,
    maxRetriesPerStep: DEFAULT_MAX_RETRIES_PER_STEP,
  };
}

function setHackMDToken(config: Configuration, token: string): void {
  config.services.hackmd = {
    ...config.services.hackmd,
    apiToken: token,
  };
}

function setProviderApiKey(
  config: Configuration,
  provider: ConfigurableLLMProvider,
  apiKey: string,
): void {
  config.providers[provider] = {
    ...config.providers[provider],
    type: provider,
    apiKey,
  };
}

async function saveBootstrapConfig(options: {
  hackmdToken?: string;
  tokenSource: HackMDTokenSource | 'prompt' | null;
  llmProvider?: ConfigurableLLMProvider;
  llmApiKey?: string;
}): Promise<boolean> {
  const configToSave: Partial<Configuration> = {};

  if (options.tokenSource === 'prompt' && options.hackmdToken) {
    configToSave.services = {
      hackmd: {
        apiToken: options.hackmdToken,
      },
    };
  }

  if (options.llmProvider && options.llmApiKey) {
    configToSave.providers = {
      [options.llmProvider]: {
        type: options.llmProvider,
        apiKey: options.llmApiKey,
      },
    };
  }

  if (!configToSave.services && !configToSave.providers) {
    return false;
  }

  ensureLoopControl(configToSave);
  await ConfigurationLoader.save(configToSave as Configuration);
  return true;
}

function printDetectedHackMDToken(source: HackMDTokenSource): void {
  console.log(chalk.green('Configuration:'));
  console.log(chalk.green(`  ✓ ${toSetupTokenLabel(source)}`));

  const sourceDescription = describeHackMDTokenSource(source);
  if (sourceDescription && source === 'config-hackwriter') {
    console.log(chalk.gray(`    source: ${sourceDescription}`));
  }
  console.log();
}

function printSetupCancelled(): void {
  console.log(chalk.gray('Setup cancelled.'));
}

function toSetupTokenLabel(source: HackMDTokenSource): string {
  switch (source) {
    case 'env-hackwriter':
      return 'HACKMD_API_TOKEN found';
    case 'env-cli':
      return 'HMD_API_ACCESS_TOKEN found (HackMD CLI compatible)';
    case 'config-cli':
      return 'HackMD CLI config found (~/.hackmd/config.json)';
    case 'config-hackwriter':
      return 'HackWriter config found';
  }
}

export async function setupCommand(isAutoTriggered = false): Promise<void> {
  printSetupHeader();

  const environment = await detectEnvironment();
  const { models } = environment;
  printEnvironmentDetection(environment);

  const hackmdCLIConfig = await loadHackMDCLIConfig();
  const detectedHackMDToken = resolveHackMDToken(undefined, hackmdCLIConfig);
  let hackmdToken = detectedHackMDToken.token;
  let tokenSource: HackMDTokenSource | 'prompt' | null = detectedHackMDToken.source ?? null;

  if (!hackmdToken) {
    console.log(chalk.yellow('Configuration needed:\n'));
    hackmdToken = await promptForHackMDToken();
    if (!hackmdToken) {
      console.log(chalk.red('\n❌ HackMD token is required'));
      process.exit(1);
    }
    tokenSource = 'prompt';
  } else {
    if (tokenSource) {
      printDetectedHackMDToken(tokenSource);
    }
  }

  let llmApiKey: string | undefined;
  let llmProvider: ConfigurableLLMProvider | undefined;
  if (Object.keys(models).length === 0) {
    const providerChoice = await promptForLLMProvider({
      message: 'Select an LLM provider to configure:',
      includeSkip: true,
    });

    if (providerChoice === 'skip') {
      const hasOllamaConfig = await configureOllamaModels(models);
      if (!hasOllamaConfig) {
        process.exit(1);
      }
    } else if (providerChoice !== 'cancel') {
      llmProvider = providerChoice;
      llmApiKey = await promptForLLMApiKey(providerChoice);
      if (!llmApiKey) {
        const providerName = llmProvider === 'anthropic' ? 'Anthropic' : 'OpenAI';
        console.log(chalk.red(`\n❌ ${providerName} API key is required`));
        process.exit(1);
      }

      const providerName = llmProvider === 'anthropic' ? 'Anthropic' : 'OpenAI';
      console.log(chalk.green(`\n✓ ${providerName} API key configured`));
    } else {
      printSetupCancelled();
      process.exit(0);
    }
  }

  const didSaveConfig = await saveBootstrapConfig({
    hackmdToken,
    tokenSource,
    llmProvider,
    llmApiKey,
  });

  if (didSaveConfig) {
    console.log(chalk.green('\n✅ Configuration saved!\n'));
  } else {
    console.log(chalk.green('\n✅ All set!\n'));
  }

  if (isAutoTriggered) {
    console.log(chalk.cyan('🚀 Starting HackWriter...\n'));
  } else {
    console.log(chalk.gray('Run "hackwriter" to start the agent\n'));
  }
}

export async function runInteractiveSetup(config: Configuration): Promise<void> {
  printSetupHeader();
  printCurrentConfiguration(config);

  const action = await select({
    message: 'What would you like to configure?',
    choices: [
      { name: 'LLM Provider (Anthropic/OpenAI)', value: 'llm' },
      { name: 'HackMD API Token', value: 'hackmd' },
      { name: 'Cancel', value: 'cancel' },
    ],
  });

  if (action === 'cancel') {
    printSetupCancelled();
    return;
  }

  if (action === 'hackmd') {
    const token = await password({
      message: 'Enter HackMD API token:',
      mask: '*',
    });

    if (!token) {
      printSetupCancelled();
      return;
    }

    setHackMDToken(config, token);
    ensureLoopControl(config);
    await ConfigurationLoader.save(config);
    console.log(chalk.green('\n✓ HackMD API token saved!'));
    console.log(chalk.yellow('\nRestart hackwriter to use the new configuration.'));
    return;
  }

  const providerChoice = await promptForLLMProvider({
    message: 'Select LLM provider:',
    includeCancel: true,
  });

  if (providerChoice === 'cancel' || providerChoice === 'skip') {
    printSetupCancelled();
    return;
  }

  const apiKey = await promptForLLMApiKey(providerChoice);
  if (!apiKey) {
    printSetupCancelled();
    return;
  }

  setProviderApiKey(config, providerChoice, apiKey);
  ensureLoopControl(config);
  await ConfigurationLoader.save(config);

  console.log(
    chalk.green(
      `\n✓ ${providerChoice === 'anthropic' ? 'Anthropic' : 'OpenAI'} API key saved!`,
    ),
  );
  console.log(chalk.yellow('\nRestart hackwriter to use the new configuration.'));
}
