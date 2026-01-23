import { password } from '@inquirer/prompts';
import chalk from 'chalk';
import { ConfigurationLoader } from '../config/ConfigurationLoader.js';
import type { Configuration } from '../config/Configuration.js';
import { discoverProviders, discoverModels } from '../config/ProviderDiscovery.js';

export async function setupCommand(isAutoTriggered = false): Promise<void> {
  console.log(chalk.bold.cyan('\n🔧 HackWriter Setup\n'));

  // 1. Show what's already discovered
  const providers = discoverProviders();
  const models = await discoverModels(providers);
  const modelCount = Object.keys(models).length;

  if (Object.keys(providers).filter(p => p !== 'ollama').length > 0) {
    for (const [name, provider] of Object.entries(providers)) {
      if (provider.apiKey) {
        console.log(chalk.green(`  ✓ ${name.toUpperCase()}_API_KEY found`));
      } 
    }
    if (modelCount > 0) {
      console.log(chalk.green(`  ✓ ${modelCount} model(s) available\n`));
    }
  } else if (Object.values(models).some(m => m.provider === 'ollama')) {
    console.log(chalk.green('  ✓ Ollama detected'));
    console.log(chalk.green(`  ✓ ${modelCount} model(s) available\n`));
  } else {
    console.log(chalk.yellow('No providers detected in environment'));
  }

  // 2. HackMD token (only if not in env)
  let hackmdToken = process.env.HACKMD_API_TOKEN;
  if (!hackmdToken) {
    hackmdToken = await password({
      message: 'Enter HackMD API token',
      mask: '*',
    });

    if (!hackmdToken) {
      console.log(chalk.red('\n❌ HackMD token is required'));
      process.exit(1);
    }
  } else {
    console.log(chalk.green('Configuration:'));
    console.log(chalk.green('  ✓ HACKMD_API_TOKEN found\n'));
  }

  // 3. Check if we have any models available
  if (Object.keys(models).length === 0) {
    console.log(chalk.red('\n❌ No LLM providers available!\n'));
    console.log(chalk.yellow('Please set one of these environment variables:\n'));
    console.log(chalk.cyan('  export ANTHROPIC_API_KEY=sk-ant-...'));
    console.log(chalk.cyan('  export OPENAI_API_KEY=sk-...'));
    console.log(chalk.gray('\nOr install and run Ollama:'));
    console.log(chalk.cyan('  https://ollama.ai\n'));
    process.exit(1);
  }

  // 4. Save (only if needed)
  if (!process.env.HACKMD_API_TOKEN) {
    const config: Partial<Configuration> = {
      services: {
        hackmd: {
          apiToken: hackmdToken,
        },
      },
      loopControl: {
        maxStepsPerRun: 100,
        maxRetriesPerStep: 3,
      },
    };

    await ConfigurationLoader.save(config as Configuration);
    console.log(chalk.green('✅ Configuration saved!\n'));
  } else {
    console.log(chalk.green('✅ All set! (using environment variables)\n'));
  }

  if (isAutoTriggered) {
    console.log(chalk.cyan('🚀 Starting HackMD Agent...\n'));
  }
}
