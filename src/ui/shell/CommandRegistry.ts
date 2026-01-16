import chalk from 'chalk';
import type { AgentExecutor } from '../../agent/AgentExecutor';

type CommandHandler = (args: string[]) => Promise<void> | void;

interface CommandInfo {
  name: string;
  aliases?: string[];
  description: string;
  handler: CommandHandler;
}

export class CommandRegistry {
  private commands = new Map<string, CommandInfo>();

  constructor(private executor: AgentExecutor) {
    this.registerDefaultCommands();
  }

  private registerDefaultCommands(): void {
    this.register({
      name: 'help',
      aliases: ['h', '?'],
      description: 'Show help information',
      handler: () => this.showHelp(),
    });

    this.register({
      name: 'status',
      aliases: ['s'],
      description: 'Show current status',
      handler: () => this.showStatus(),
    });

    this.register({
      name: 'clear',
      aliases: ['reset'],
      description: 'Clear the screen',
      handler: () => {
        console.clear();
        console.log(chalk.green('✓ Screen cleared'));
      },
    });
  }

  register(info: CommandInfo): void {
    this.commands.set(info.name, info);
    info.aliases?.forEach(alias => {
      this.commands.set(alias, info);
    });
  }

  async execute(commandLine: string): Promise<void> {
    const [name, ...args] = commandLine.split(' ');
    const command = this.commands.get(name);

    if (!command) {
      console.log(chalk.red(`Unknown command: /${name}`));
      console.log(chalk.gray('Type /help for available commands'));
      return;
    }

    try {
      await command.handler(args);
    } catch (error) {
      console.log(
        chalk.red('Command failed: '),
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  private showHelp(): void {
    console.log(chalk.bold('\n📚 Available Commands:\n'));
    
    const seen = new Set<string>();
    for (const [, info] of this.commands) {
      if (seen.has(info.name)) continue;
      seen.add(info.name);

      const aliases = info.aliases?.length 
        ? chalk.gray(` (${info.aliases.join(', ')})`)
        : '';
      
      console.log(`  /${info.name}${aliases}`);
      console.log(chalk.gray(`    ${info.description}`));
    }
    console.log();
  }

  private showStatus(): void {
    const status = this.executor.status;
    
    console.log(chalk.bold('\n📊 Status:\n'));
    console.log(`  Context usage: ${chalk.cyan((status.contextUsage * 100).toFixed(1) + '%')}`);
    console.log(`  Token count: ${chalk.cyan(status.tokenCount.toLocaleString())}`);
    console.log(`  Current step: ${chalk.cyan(status.currentStep)}`);
    console.log();
  }
}
