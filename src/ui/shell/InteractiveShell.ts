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
import type { Disposable } from "../../utils/ResourceManager.js";

export interface ModelContext {
  currentModelName: string;
  config: Configuration;
  context: ConversationContext;
  toolRegistry: ToolRegistry;
  systemPrompt: string;
}

export class InteractiveShell implements Disposable {
  private executor: AgentExecutor;
  private renderer: OutputRenderer;
  private commandRegistry: CommandRegistry;
  private rl: readline.Interface;
  private isClosed = false;
  private isSuspendingReadline = false;
  private closeResolver?: () => void;
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
      this.closeResolver = resolve;
      this.attachReadlineHandlers();

      this.rl.prompt();
    });
  }

  private attachReadlineHandlers(): void {
    this.rl.on("line", this.handleLine);
    this.rl.on("SIGINT", this.handleSigint);
    this.rl.on("close", this.handleClose);
  }

  private readonly handleLine = (input: string): void => {
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
  };

  private readonly handleSigint = (): void => {
    if (this.executor.isExecuting) {
      Logger.debug("Shell", "SIGINT received during execution - aborting run");
      this.executor.abort();
      return;
    }

    Logger.debug("Shell", "SIGINT received while idle - exiting shell");
    this.exit();
  };

  private readonly handleClose = (): void => {
    if (this.isSuspendingReadline) {
      this.isSuspendingReadline = false;
      return;
    }

    this.isClosed = true;
    console.log(chalk.gray("\nGoodbye! 👋"));
    const resolve = this.closeResolver;
    this.closeResolver = undefined;
    resolve?.();
  };

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
    const contextPercent = this.formatContextPercent(status.contextUsage);
    const modelName = this.getShortModelName();

    return chalk.bold(
      `${process.env.USER ?? "user"}` +
        chalk.gray(`@${modelName}`) +
        chalk.gray(` [${contextPercent}]`) +
        " > ",
    );
  }

  private formatContextPercent(contextUsage: number): string {
    const percent = Math.max(0, contextUsage * 100);

    if (percent === 0) {
      return "0%";
    }

    if (percent < 0.1) {
      return "<0.1%";
    }

    if (percent < 1) {
      return `${percent.toFixed(1)}%`;
    }

    return `${percent.toFixed(0)}%`;
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
    this.isSuspendingReadline = true;
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
    this.attachReadlineHandlers();
  }

  private printWelcome(): void {
    console.log(chalk.bold.cyan("\n📝 HackWriter\n"));
    console.log(chalk.gray("Writing agent for HackMD"));
    console.log(chalk.gray("Type /help for commands or /exit to quit\n"));
  }

  /**
   * Dispose of resources (implements Disposable interface)
   */
  dispose(): void {
    Logger.debug("InteractiveShell", "Disposing resources");
    if (!this.isClosed) {
      this.rl.close();
      this.isClosed = true;
    }
  }
}
