import * as readline from "readline";
import chalk from "chalk";
import type { AgentExecutor, ExecutionResult } from "../../agent/AgentExecutor.ts";
import type { Configuration } from "../../config/Configuration.ts";
import type { ConversationContext } from "../../agent/ConversationContext.ts";
import type { ToolRegistry } from "../../tools/base/ToolRegistry.ts";
import { OutputRenderer } from "./OutputRenderer.ts";
import { CommandRegistry } from "./CommandRegistry.ts";
import { MessageBus } from "../../messaging/MessageBus.ts";
import { Logger } from "../../utils/Logger.ts";
import type { Disposable } from "../../utils/ResourceManager.ts";
import type { ModelService } from "../../config/ModelService.ts";
import { formatSafeError } from "../../utils/SafeError.ts";
import type { ApprovalManager } from "../../agent/ApprovalManager.ts";
import type { RuntimeBundle } from "../../runtime/RuntimeCoordinator.ts";

function getShortName(modelId: string): string {
  const normalized = modelId.toLowerCase();
  for (const family of ["haiku", "sonnet", "opus"]) {
    if (normalized.includes(family)) return family;
  }
  const llama = /llama[\d.]+/u.exec(normalized);
  return llama?.[0] ?? modelId;
}

export interface ModelContext {
  currentModelName: string;
  config: Configuration;
  modelService?: ModelService;
  context: ConversationContext;
  toolRegistry: ToolRegistry;
  systemPrompt: string;
  approvalManager?: ApprovalManager;
  reloadRuntime?: (
    config: Configuration,
    requestedModel?: string,
  ) => Promise<RuntimeBundle>;
  commitRuntime?: (runtime: RuntimeBundle) => Promise<void>;
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
      const result = await this.handleInput(initialCommand);
      if (result?.status === "aborted") process.exitCode = 130;
      else if (result && result.status !== "completed") process.exitCode = 1;
      return;
    }
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

  private async handleInput(input: string): Promise<ExecutionResult | undefined> {
    if (!input) return;

    // Handle commands
    if (input.startsWith("/")) {
      await this.commandRegistry.execute(input.slice(1));
      return;
    }

    // Execute agent
    try {
      Logger.debug("Shell", "Starting agent execution", { input: input.slice(0, 50) });
      const result = await this.executor.execute(input);
      if (result.status === "limit_reached") {
        console.log(chalk.yellow(result.error));
      }
      Logger.debug("Shell", "Agent execution completed successfully");
      return result;
    } catch (error) {
      Logger.error("Shell", "Agent execution error", error);
      console.log(
        chalk.red("Error: "),
        formatSafeError(error),
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
    const runtimeModel = this.modelContext.modelService?.resolve(currentModelName);
    if (runtimeModel) return getShortName(runtimeModel.model.id);
    const modelConfig = config.models[currentModelName];

    if (!modelConfig) {
      return currentModelName;
    }

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

  applyRuntime(runtime: RuntimeBundle): void {
    this.modelContext.config = runtime.config;
    this.modelContext.modelService = runtime.modelService;
    this.modelContext.currentModelName = runtime.modelMatch.canonicalId;
    this.modelContext.toolRegistry = runtime.toolRegistry;
    this.modelContext.systemPrompt = runtime.systemPrompt;
    this.setExecutor(runtime.executor);
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
    this.modelContext.approvalManager?.setMainRl(this.rl);
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
