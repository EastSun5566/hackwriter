import chalk from "chalk";
import type { InteractiveShell } from "./InteractiveShell.ts";
import { AgentExecutor } from "../../agent/AgentExecutor.ts";
import { ConfigurationLoader } from "../../config/ConfigurationLoader.ts";
import type { Configuration } from "../../config/Configuration.ts";
import type { Agent } from "../../agent/Agent.ts";
import { runInteractiveSetup } from "../../commands/setup.ts";
import { formatSafeError } from "../../utils/SafeError.ts";
import type { Credential, CredentialStore } from "@earendil-works/pi-ai";

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
          await this.listModels();
        } else if (args[0] === "search") {
          this.searchModels(args.slice(1).join(" "));
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
        formatSafeError(error),
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

  private async listModels(): Promise<void> {
    const { currentModelName, modelService } = this.shell.getModelContext();

    console.log(chalk.bold('\n🤖 Available Models:\n'));
    console.log(`  Current: ${chalk.cyan(currentModelName)}\n`);
    if (!modelService) return;
    for (const status of await modelService.providerStatuses()) {
      if (!status.available) continue;
      console.log(
        `  ${chalk.bold(status.name)} (${status.id}): ${status.modelCount} model(s)` +
          (status.authSource ? chalk.gray(` — ${status.authSource}`) : ""),
      );
    }
    console.log(chalk.gray("\n  Use /model search <text> to find models."));
  }

  private searchModels(query: string): void {
    const { modelService, currentModelName } = this.shell.getModelContext();
    if (!modelService) {
      console.log(chalk.yellow("Runtime model search is unavailable."));
      return;
    }
    if (!query.trim()) {
      console.log(chalk.yellow("Usage: /model search <text>"));
      return;
    }
    const result = modelService.search(query, 20);
    console.log(chalk.bold(`\n🔎 ${result.total} matching model(s):\n`));
    for (const match of result.matches) {
      const marker = match.canonicalId === currentModelName ? chalk.green("●") : " ";
      console.log(`  ${marker} ${chalk.cyan(match.canonicalId)} — ${match.model.name}`);
    }
    if (result.total > result.matches.length) {
      console.log(chalk.gray(`\n  Showing 20 of ${result.total}; refine the search text.`));
    }
  }

  private async switchModel(modelName: string): Promise<void> {
    const modelContext = this.shell.getModelContext();
    const { config, modelService } = modelContext;

    const match = modelService?.resolve(modelName);
    if (!modelService || !match || !(await modelService.isAvailable(match.model))) {
      console.log(chalk.red(`Model "${modelName}" not found or provider unavailable`));
      return;
    }
    const agent: Agent = {
      name: "HackMD Agent",
      modelName: match.model.id,
      maxContextSize: match.model.contextWindow,
      systemPrompt: modelContext.systemPrompt,
      toolRegistry: modelContext.toolRegistry,
    };
    const newExecutor = new AgentExecutor(
      agent,
      modelContext.context,
      match.model,
      modelService.models,
      config.loopControl,
    );
    this.shell.setExecutor(newExecutor);
    modelContext.currentModelName = match.canonicalId;
    config.defaultModel = match.canonicalId;
    await ConfigurationLoader.save(config);
    console.log(chalk.green(`✓ Switched to ${match.canonicalId}`));
  }

  private async runSetup(): Promise<void> {
    this.shell.suspendReadline();

    try {
      const context = this.shell.getModelContext();
      const configSnapshot = structuredClone(context.config);
      const credentialSnapshot = context.modelService
        ? await snapshotCredentials(context.modelService.credentials)
        : undefined;
      let changed: boolean;
      try {
        if (context.modelService) {
          changed = await runInteractiveSetup(context.config, context.modelService);
        } else {
          changed = await runInteractiveSetup(context.config);
        }
        if (changed && context.reloadRuntime) {
          const runtime = await context.reloadRuntime(
            context.config,
            context.config.defaultModel,
          );
          try {
            this.shell.applyRuntime(runtime);
            await context.commitRuntime?.(runtime);
          } catch (error) {
            await runtime.mcpClient?.dispose().catch(() => undefined);
            throw error;
          }
        }
      } catch (error) {
        if (credentialSnapshot && context.modelService) {
          await restoreCredentials(context.modelService.credentials, credentialSnapshot);
        }
        replaceConfig(context.config, configSnapshot);
        await ConfigurationLoader.save(context.config);
        throw error;
      }
    } finally {
      this.shell.recreateReadline();
      this.shell.getReadline().prompt();
    }
  }
}

async function snapshotCredentials(
  store: CredentialStore,
): Promise<Map<string, Credential>> {
  const snapshot = new Map<string, Credential>();
  for (const { providerId } of await store.list()) {
    const credential = await store.read(providerId);
    if (credential) snapshot.set(providerId, structuredClone(credential));
  }
  return snapshot;
}

async function restoreCredentials(
  store: CredentialStore,
  snapshot: ReadonlyMap<string, Credential>,
): Promise<void> {
  for (const { providerId } of await store.list()) await store.delete(providerId);
  for (const [providerId, credential] of snapshot) {
    await store.modify(providerId, () => Promise.resolve(structuredClone(credential)));
  }
}

function replaceConfig(target: Configuration, source: Configuration): void {
  Object.assign(target, structuredClone(source));
}
