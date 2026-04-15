import { password, select } from '@inquirer/prompts';
import chalk from 'chalk';
import { ConfigurationLoader } from '../config/ConfigurationLoader.js';
import type { Configuration } from '../config/Configuration.js';
import { discoverProviders, discoverModels } from '../config/ProviderDiscovery.js';
import { loadHackMDCLIConfig } from '../config/HackMDConfigLoader.js';
import {
  describeHackMDTokenSource,
  resolveHackMDToken,
  type HackMDTokenSource,
} from '../config/HackMDServiceResolution.js';
import { DEFAULT_MAX_STEPS_PER_RUN, DEFAULT_MAX_RETRIES_PER_STEP } from '../config/constants.js';

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
  console.log(chalk.bold.cyan('\n🔧 HackWriter Setup\n'));

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

  const hackmdCLIConfig = await loadHackMDCLIConfig();
  const detectedHackMDToken = resolveHackMDToken(undefined, hackmdCLIConfig);
  let hackmdToken = detectedHackMDToken.token;
  let tokenSource: HackMDTokenSource | 'prompt' | null = detectedHackMDToken.source ?? null;

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
    if (tokenSource) {
      console.log(chalk.green(`  ✓ ${toSetupTokenLabel(tokenSource)}`));
      const sourceDescription = describeHackMDTokenSource(tokenSource);
      if (sourceDescription && tokenSource === 'config-hackwriter') {
        console.log(chalk.gray(`    source: ${sourceDescription}`));
      }
    }
    console.log();
  }

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
        process.exit(1);
      }
      
      console.log(chalk.green(`✓ Found ${ollamaModels.length} Ollama model(s):`));
      ollamaModels.slice(0, 5).forEach(model => {
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
    } else {
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
  }

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
