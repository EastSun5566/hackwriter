import { password, select } from '@inquirer/prompts';
import chalk from 'chalk';
import { ConfigurationLoader } from '../config/ConfigurationLoader.js';
import type { Configuration } from '../config/Configuration.js';
import { discoverProviders, discoverModels } from '../config/ProviderDiscovery.js';
import { loadHackMDCLIConfig } from '../config/HackMDConfigLoader.js';
import { DEFAULT_MAX_STEPS_PER_RUN, DEFAULT_MAX_RETRIES_PER_STEP } from '../config/constants.js';

export async function setupCommand(isAutoTriggered = false): Promise<void> {
  console.log(chalk.bold.cyan('\n🔧 HackWriter Setup\n'));

  // 1. Show what's already discovered
  const providers = discoverProviders();
  const models = await discoverModels(providers);
  const modelCount = Object.keys(models).length;

  const hasAnthropicKey = !!providers.anthropic?.apiKey;
  const hasOpenAIKey = !!providers.openai?.apiKey;
  const hasOllamaModels = Object.values(models).some(m => m.provider === 'ollama');

  if (hasAnthropicKey || hasOpenAIKey || hasOllamaModels) {
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

  // 2. HackMD token (check all sources)
  // Priority: HackWriter env > HackMD CLI env > HackMD CLI config file
  let hackmdToken = process.env.HACKMD_API_TOKEN ?? process.env.HMD_API_ACCESS_TOKEN;
  let tokenSource: 'env-hackwriter' | 'env-cli' | 'config-cli' | 'prompt' | null = null;
  
  // Check HackMD CLI config file if no env var
  if (!hackmdToken) {
    const hackmdCLIConfig = await loadHackMDCLIConfig();
    if (hackmdCLIConfig?.accessToken) {
      hackmdToken = hackmdCLIConfig.accessToken;
      tokenSource = 'config-cli';
    }
  } else {
    tokenSource = process.env.HACKMD_API_TOKEN ? 'env-hackwriter' : 'env-cli';
  }
  
  if (!hackmdToken) {
    console.log(chalk.yellow('Configuration needed:\n'));
    hackmdToken = await password({
      message: 'Enter HackMD API token',
      mask: '*',
    });
    if (!hackmdToken) {
      console.log(chalk.red('\n❌ HackMD token is required'));
      process.exit(1);
    }
    tokenSource = 'prompt';
  } else {
    console.log(chalk.green('Configuration:'));
    // Show which source was detected
    if (tokenSource === 'env-hackwriter') {
      console.log(chalk.green('  ✓ HACKMD_API_TOKEN found'));
    } else if (tokenSource === 'env-cli') {
      console.log(chalk.green('  ✓ HMD_API_ACCESS_TOKEN found (HackMD CLI compatible)'));
    } else if (tokenSource === 'config-cli') {
      console.log(chalk.green('  ✓ HackMD CLI config found (~/.hackmd/config.json)'));
    }
    console.log();
  }

  // 3. If no models available, prompt user to add LLM provider
  let llmApiKey: string | undefined;
  let llmProvider: 'anthropic' | 'openai' | undefined;
  if (Object.keys(models).length === 0) {
    const providerChoice = await select({
      message: 'Select an LLM provider to configure:',
      choices: [
        { name: 'Anthropic (Claude)', value: 'anthropic' },
        { name: 'OpenAI (GPT)', value: 'openai' },
        { name: 'Skip (I will use Ollama locally)', value: 'skip' },
      ],
    });

    if (providerChoice === 'skip') {
      console.log(chalk.yellow('\n⚠️  Skipping LLM configuration'));
      console.log(chalk.gray('To use HackWriter, you need to either:'));
      console.log(chalk.cyan('  1. Install and run Ollama: https://ollama.ai'));
      console.log(chalk.cyan('  2. Set ANTHROPIC_API_KEY or OPENAI_API_KEY environment variable'));
      console.log(chalk.cyan('  3. Run "hackwriter setup" again to configure\n'));
      process.exit(0);
    }

    llmProvider = providerChoice as 'anthropic' | 'openai';
    const providerName = llmProvider === 'anthropic' ? 'Anthropic' : 'OpenAI';
    llmApiKey = await password({
      message: `Enter ${providerName} API key`,
      mask: '*',
    });
    if (!llmApiKey) {
      console.log(chalk.red(`\n❌ ${providerName} API key is required`));
      process.exit(1);
    }

    console.log(chalk.green(`\n✓ ${providerName} API key configured`));
  }

  // 4. Save configuration (only if token was entered via prompt)
  if (tokenSource === 'prompt') {
    const configToSave: Partial<Configuration> = {
      services: {
        hackmd: {
          apiToken: hackmdToken,
        },
      },
      loopControl: {
        maxStepsPerRun: DEFAULT_MAX_STEPS_PER_RUN,
        maxRetriesPerStep: DEFAULT_MAX_RETRIES_PER_STEP,
      },
    };

    // Add LLM provider if configured
    if (llmProvider && llmApiKey) {
      configToSave.providers = {
        [llmProvider]: {
          type: llmProvider,
          apiKey: llmApiKey,
        },
      };
    }

    await ConfigurationLoader.save(configToSave as Configuration);
    console.log(chalk.green('\n✅ Configuration saved!\n'));
  } else {
    // Token from env or HackMD CLI config - only save LLM provider if configured
    if (llmProvider && llmApiKey) {
      const configToSave: Partial<Configuration> = {
        providers: {
          [llmProvider]: {
            type: llmProvider,
            apiKey: llmApiKey,
          },
        },
        loopControl: {
          maxStepsPerRun: DEFAULT_MAX_STEPS_PER_RUN,
          maxRetriesPerStep: DEFAULT_MAX_RETRIES_PER_STEP,
        },
      };
      
      await ConfigurationLoader.save(configToSave as Configuration);
      console.log(chalk.green('\n✅ Configuration saved!\n'));
    } else {
      console.log(chalk.green('\n✅ All set!\n'));
    }
  }

  if (isAutoTriggered) {
    console.log(chalk.cyan('🚀 Starting HackWriter...\n'));
  } else {
    console.log(chalk.gray('Run "hackwriter" to start the agent\n'));
  }
}
