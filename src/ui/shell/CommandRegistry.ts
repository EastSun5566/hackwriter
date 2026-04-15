import chalk from "chalk";
import type { InteractiveShell } from "./InteractiveShell.js";
import { AgentExecutor } from "../../agent/AgentExecutor.js";
import { buildLanguageModel } from "../../agent/ModelFactory.js";
import { ConfigurationLoader } from "../../config/ConfigurationLoader.js";
import type { Agent } from "../../agent/Agent.js";
import { runInteractiveSetup } from "../../commands/setup.js";

type CommandHandler = (args: string[]) => Promise<void> | void;

interface CommandInfo {
  name: string;
  aliases?: string[];
  description: string;
  handler: CommandHandler;
}

export class CommandRegistry {
  private commands = new Map<string, CommandInfo>();

  constructor(private shell: InteractiveShell) {
    this.registerDefaultCommands();
  }

  private registerDefaultCommands(): void {
    this.register({
      name: "help",
      aliases: ["h", "?"],
      description: "Show help information",
      handler: () => this.showHelp(),
    });

    this.register({
      name: "status",
      aliases: ["s"],
      description: "Show current status",
      handler: () => this.showStatus(),
    });

    this.register({
      name: "clear",
      aliases: ["reset"],
      description: "Clear the screen",
      handler: () => {
        console.clear();
        console.log(chalk.green("✓ Screen cleared"));
      },
    });

    this.register({
      name: "exit",
      aliases: ["quit", "q"],
      description: "Exit HackWriter",
      handler: () => this.shell.exit(),
    });

    this.register({
      name: "model",
      aliases: ["m"],
      description: "List or switch models",
      handler: async (args) => {
        if (args.length === 0) {
          this.listModels();
        } else {
          await this.switchModel(args[0]);
        }
      },
    });

    this.register({
      name: "setup",
      aliases: ["config"],
      description: "Configure API keys and settings",
      handler: () => this.runSetup(),
    });
  }

  register(info: CommandInfo): void {
    this.commands.set(info.name, info);
    info.aliases?.forEach((alias) => {
      this.commands.set(alias, info);
    });
  }

  async execute(commandLine: string): Promise<void> {
    const [name, ...args] = commandLine.split(" ");
    const command = this.commands.get(name);

    if (!command) {
      console.log(chalk.red(`Unknown command: /${name}`));
      console.log(chalk.gray("Type /help for available commands"));
      return;
    }

    try {
      await command.handler(args);
    } catch (error) {
      console.log(
        chalk.red("Command failed: "),
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private showHelp(): void {
    console.log(chalk.bold("\n📚 Available Commands:\n"));

    const seen = new Set<string>();
    for (const [, info] of this.commands) {
      if (seen.has(info.name)) continue;
      seen.add(info.name);

      const aliases = info.aliases?.length
        ? chalk.gray(` (${info.aliases.join(", ")})`)
        : "";

      console.log(`  /${info.name}${aliases}`);
      console.log(chalk.gray(`    ${info.description}`));
    }
    console.log();
  }

  private showStatus(): void {
    const status = this.shell.getExecutor().status;

    console.log(chalk.bold("\n📊 Status:\n"));
    console.log(
      `  Context usage: ${chalk.cyan((status.contextUsage * 100).toFixed(1) + "%")}`,
    );
    console.log(
      `  Token count: ${chalk.cyan(status.tokenCount.toLocaleString())}`,
    );
    console.log(`  Current step: ${chalk.cyan(status.currentStep)}`);
    console.log();
  }

  private listModels(): void {
    const { config, currentModelName } = this.shell.getModelContext();

    console.log(chalk.bold('\n🤖 Available Models:\n'));

    // Group models by provider
    const byProvider = new Map<string, { name: string; model: string; isCurrent: boolean }[]>();

    for (const [name, modelConfig] of Object.entries(config.models)) {
      const provider = modelConfig.provider;
      if (!byProvider.has(provider)) {
        byProvider.set(provider, []);
      }

      byProvider.get(provider)!.push({
        name,
        model: modelConfig.model,
        isCurrent: name === currentModelName,
      });
    }

    // Display grouped by provider
    for (const [providerName, models] of byProvider) {
      const provider = config.providers[providerName];
      if (!provider) continue;

      // Provider header
      console.log(chalk.bold(`${provider.type}:`));

      // Models under this provider
      for (const { name, model, isCurrent } of models) {
        const marker = isCurrent ? chalk.green('●') : ' ';
        console.log(`  ${marker} ${chalk.cyan(name)} ${chalk.gray(`(${model})`)}`);
      }

      console.log(); // Blank line between providers
    }
  }

  private async switchModel(modelName: string): Promise<void> {
    const modelContext = this.shell.getModelContext();
    const { config } = modelContext;

    if (!config.models[modelName]) {
      console.log(chalk.red(`Model "${modelName}" not found`));
      this.listModels();
      return;
    }

    const modelConfig = config.models[modelName];
    const providerConfig = config.providers[modelConfig.provider];
    const languageModel = buildLanguageModel(providerConfig, modelConfig.model, modelConfig.maxContextSize);

    const agent: Agent = {
      name: "HackMD Agent",
      modelName: modelConfig.model,
      maxContextSize: modelConfig.maxContextSize,
      systemPrompt: modelContext.systemPrompt,
      toolRegistry: modelContext.toolRegistry,
      apiKey: providerConfig?.apiKey,
    };

    const newExecutor = new AgentExecutor(
      agent,
      modelContext.context,
      languageModel,
    );

    this.shell.setExecutor(newExecutor);
    modelContext.currentModelName = modelName;

    // Persist model selection
    config.defaultModel = modelName;
    await ConfigurationLoader.save(config);

    console.log(chalk.green(`✓ Switched to ${modelName}`));
  }

  private async runSetup(): Promise<void> {
    this.shell.suspendReadline();

    try {
      await runInteractiveSetup(this.shell.getModelContext().config);
    } finally {
      this.shell.recreateReadline();
      this.shell.getReadline().prompt();
    }
  }
}
