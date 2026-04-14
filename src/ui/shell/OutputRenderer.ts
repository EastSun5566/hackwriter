import chalk from 'chalk';
import ora, { type Ora } from 'ora';
import { MessageBus } from '../../messaging/MessageBus.js';
import type { AgentMessage } from '../../messaging/MessageTypes.js';

export class OutputRenderer {
  private activeSpinner: Ora | null = null;

  attachToBus(bus: MessageBus): void {
    bus.subscribe((message) => this.render(message));
  }

  private render(message: AgentMessage): void {
    switch (message.type) {
      case 'step_started':
        // Optional: show step number
        break;

      case 'text_chunk':
        if (this.activeSpinner) {
          this.activeSpinner.stop();
          this.activeSpinner = null;
        }
        process.stdout.write(chalk.blue(message.text));
        break;

      case 'tool_call_started':
        this.activeSpinner = ora({
          text: chalk.yellow(`Using ${message.toolCall.name}...`),
          color: 'yellow',
          discardStdin: false,
        }).start();
        break;

      case 'tool_completed':
        if (this.activeSpinner) {
          const brief = message.result.brief ?? 'Completed';
          if (message.result.ok) {
            this.activeSpinner.succeed(chalk.green(`✓ ${brief}`));
          } else {
            this.activeSpinner.fail(chalk.red(`✗ ${brief}`));
          }
          this.activeSpinner = null;
        }
        break;

      case 'tool_failed':
        if (this.activeSpinner) {
          this.activeSpinner.fail(chalk.red(`✗ ${message.error}`));
          this.activeSpinner = null;
        }
        break;

      case 'approval_requested':
        // Stop spinner during approval to show prompt clearly
        if (this.activeSpinner) {
          this.activeSpinner.stop();
          this.activeSpinner = null;
        }
        break;

      case 'approval_completed':
        // Approval done, spinner will resume on next tool action if needed
        break;

      case 'step_completed':
        if (this.activeSpinner) {
          this.activeSpinner.stop();
          this.activeSpinner = null;
        }
        console.log(); // Add newline
        break;
    }
  }
}
