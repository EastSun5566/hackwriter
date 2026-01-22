import * as readline from "readline";
import chalk from "chalk";
import type { AgentExecutor } from "../../agent/AgentExecutor.js";
import type { Configuration } from "../../config/Configuration.js";
import type { ConversationContext } from "../../agent/ConversationContext.js";
import type { ToolRegistry } from "../../tools/base/ToolRegistry.js";
import { getShortModelName as getShortName } from "../../config/ProviderDiscovery.js";
import { OutputRenderer } from "./OutputRenderer.js";
import { CommandRegistry } from "./CommandRegistry.js";
import { MessageBus } from "../../messaging/MessageBus.js";
import { Logger } from "../../utils/Logger.js";

export interface ModelContext {
  currentModelName: string;
  config: Configuration;
  context: ConversationContext;
  toolRegistry: ToolRegistry;
  systemPrompt: string;
}

export class InteractiveShell {
  private executor: AgentExecutor;
  private renderer: OutputRenderer;
  private commandRegistry: CommandRegistry;
  private rl: readline.Interface;
  private isClosed = false;
  private modelContext: ModelContext;

  constructor(executor: AgentExecutor, modelContext: ModelContext) {
    this.executor = executor;
    this.modelContext = modelContext;
    this.renderer = new OutputRenderer();
    this.commandRegistry = new CommandRegistry(this);

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: this.getPrompt(),
    });
  }

  async start(initialCommand?: string): Promise<void> {
    this.printWelcome();
    this.setupMessageHandling();

    // If there's an initial command, execute it first
    if (initialCommand) {
      await this.handleInput(initialCommand);
    }

    // Always enter interactive mode (unless explicitly exited)
    return new Promise((resolve) => {
      this.rl.on("line", (input) => {
        void this.handleInput(input.trim())
          .then(() => {
            // Input handled successfully
          })
          .catch((error) => {
            Logger.error("Shell", "handleInput error", error);
          })
          .finally(() => {
            if (this.isClosed) {
              return;
            }
            this.rl.setPrompt(this.getPrompt());
            this.rl.prompt();
          });
      });

      this.rl.on("close", () => {
        this.isClosed = true;
        console.log(chalk.gray("\nGoodbye! 👋"));
        resolve();
      });

      this.rl.prompt();
    });
  }

  private async handleInput(input: string): Promise<void> {
    if (!input) return;

    // Handle commands
    if (input.startsWith("/")) {
      await this.commandRegistry.execute(input.slice(1));
      return;
    }

    // Execute agent
    try {
      Logger.debug("Shell", "Starting agent execution", { input: input.slice(0, 50) });
      await this.executor.execute(input);
      Logger.debug("Shell", "Agent execution completed successfully");
    } catch (error) {
      Logger.error("Shell", "Agent execution error", error);
      console.log(
        chalk.red("Error: "),
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private setupMessageHandling(): void {
    const bus = MessageBus.getInstance();
    this.renderer.attachToBus(bus);
  }

  private getPrompt(): string {
    const status = this.executor.status;
    const contextPercent = (status.contextUsage * 100).toFixed(0);
    const modelName = this.getShortModelName();

    return chalk.bold(
      `${process.env.USER ?? "user"}` +
        chalk.gray(`@${modelName}`) +
        chalk.gray(` [${contextPercent}%]`) +
        " > ",
    );
  }

  private getShortModelName(): string {
    const { currentModelName, config } = this.modelContext;
    const modelConfig = config.models[currentModelName];

    if (!modelConfig) {
      return currentModelName;
    }

    // Use ProviderDiscovery helper for consistent naming
    return getShortName(modelConfig.model);
  }

  getModelContext(): ModelContext {
    return this.modelContext;
  }

  getExecutor(): AgentExecutor {
    return this.executor;
  }

  setExecutor(executor: AgentExecutor): void {
    this.executor = executor;
    this.commandRegistry = new CommandRegistry(this);
  }

  exit(): void {
    Logger.debug("Shell", "exit() called - closing readline interface");
    this.isClosed = true;
    this.rl.close();
  }

  getReadline(): readline.Interface {
    return this.rl;
  }

  /**
   * Suspend readline for external prompts (like inquirer).
   * Must close and recreate because inquirer needs exclusive stdin access.
   */
  suspendReadline(): void {
    this.rl.close();
  }

  /**
   * Recreate readline after external prompts are done
   */
  recreateReadline(): void {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: this.getPrompt(),
    });

    // Re-attach the line handler
    this.rl.on("line", (input) => {
      void this.handleInput(input.trim())
        .catch((error) => {
          Logger.error("Shell", "handleInput error", error);
        })
        .finally(() => {
          if (this.isClosed) return;
          this.rl.setPrompt(this.getPrompt());
          this.rl.prompt();
        });
    });

    this.rl.on("close", () => {
      this.isClosed = true;
    });
  }

  private printWelcome(): void {
    console.log(chalk.bold.cyan("\n📝 HackWriter\n"));
    console.log(chalk.gray("Writing agent for HackMD"));
    console.log(chalk.gray("Type /help for commands or /exit to quit\n"));
  }
}
