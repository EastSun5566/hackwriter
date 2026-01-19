import * as readline from "readline";
import chalk from "chalk";
import type { AgentExecutor } from "../../agent/AgentExecutor.js";
import type { Configuration } from "../../config/Configuration.js";
import type { ConversationContext } from "../../agent/ConversationContext.js";
import type { ToolRegistry } from "../../tools/base/ToolRegistry.js";
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
      await this.executor.execute(input);
    } catch (error) {
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

    // Return the actual model name (e.g., "phi3", "claude-3-5-haiku-latest")
    return modelConfig.model;
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
    this.isClosed = true;
    this.rl.close();
  }

  private printWelcome(): void {
    console.log(chalk.bold.cyan("\n📝 HackWriter\n"));
    console.log(chalk.gray("Writing agent for HackMD"));
    console.log(chalk.gray("Type /help for commands or /exit to quit\n"));
  }
}
