import * as readline from 'readline';
import chalk from 'chalk';
import type { AgentExecutor } from '../../agent/AgentExecutor';
import { OutputRenderer } from './OutputRenderer';
import { CommandRegistry } from './CommandRegistry';
import { MessageBus } from '../../messaging/MessageBus';
import { Logger } from '../../utils/Logger';

export class InteractiveShell {
  private executor: AgentExecutor;
  private renderer: OutputRenderer;
  private commandRegistry: CommandRegistry;
  private rl: readline.Interface;
  private isClosed = false;

  constructor(executor: AgentExecutor) {
    this.executor = executor;
    this.renderer = new OutputRenderer();
    this.commandRegistry = new CommandRegistry(executor);
    
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
      this.rl.on('line', (input) => {
        void this.handleInput(input.trim())
          .then(() => {
            // Input handled successfully
          })
          .catch((error) => {
            Logger.error('Shell', 'handleInput error', error);
          })
          .finally(() => {
            if (this.isClosed) {
              return;
            }
            this.rl.setPrompt(this.getPrompt());
            this.rl.prompt();
          });
      });

      this.rl.on('close', () => {
        this.isClosed = true;
        console.log(chalk.gray('\nGoodbye! 👋'));
        resolve();
      });
      
      this.rl.prompt();
    });
  }

  private async handleInput(input: string): Promise<void> {
    if (!input) return;

    if (input === 'exit' || input === 'quit') {
      this.isClosed = true;
      this.rl.close();
      return;
    }

    // Handle commands
    if (input.startsWith('/')) {
      await this.commandRegistry.execute(input.slice(1));
      return;
    }

    // Execute agent
    try {
      await this.executor.execute(input);
    } catch (error) {
      console.log(
        chalk.red('Error: '),
        error instanceof Error ? error.message : String(error)
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
    
    return chalk.bold(
      `${process.env.USER ?? 'user'}` +
      chalk.gray(` [${contextPercent}%]`) +
      ' > '
    );
  }

  private printWelcome(): void {
    console.log(chalk.bold.cyan('\n📝 HackWriter\n'));
    console.log(chalk.gray('Writing agent for HackMD'));
    console.log(chalk.gray('Type /help for available commands\n'));
  }
}
