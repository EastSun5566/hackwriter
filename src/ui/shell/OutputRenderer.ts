import chalk from 'chalk';
import ora, { type Ora } from 'ora';
import { MessageBus } from '../../messaging/MessageBus.js';
import type { AgentMessage } from '../../messaging/MessageTypes.js';

export class OutputRenderer {
  private activeSpinner: Ora | null = null;
  private pendingToolCalls = new Map<string, string>();
  private hasRenderedTextInCurrentStep = false;

  private stopSpinner(): void {
    if (this.activeSpinner) {
      this.activeSpinner.stop();
      this.activeSpinner = null;
    }
  }

  private resetStepState(): void {
    this.stopSpinner();
    this.pendingToolCalls.clear();
    this.hasRenderedTextInCurrentStep = false;
  }

  private updateSpinner(): void {
    if (this.hasRenderedTextInCurrentStep || this.pendingToolCalls.size === 0) {
      return;
    }

    const toolNames = [...new Set(this.pendingToolCalls.values())];
    const text =
      toolNames.length === 1
        ? `Using ${toolNames[0]}...`
        : `Using ${toolNames.length} tools: ${toolNames.join(', ')}...`;

    if (this.activeSpinner) {
      this.activeSpinner.text = chalk.yellow(text);
      return;
    }

    this.activeSpinner = ora({
      text: chalk.yellow(text),
      color: 'yellow',
      discardStdin: false,
    }).start();
  }

  attachToBus(bus: MessageBus): void {
    bus.subscribe((message) => this.render(message));
  }

  private render(message: AgentMessage): void {
    switch (message.type) {
      case 'step_started':
        this.resetStepState();
        break;

      case 'execution_interrupted':
        this.resetStepState();
        console.log(chalk.yellow('\n⚠ Interrupted.'));
        break;

      case 'text_chunk':
        this.hasRenderedTextInCurrentStep = true;
        this.stopSpinner();
        process.stdout.write(chalk.blue(message.text));
        break;

      case 'agent_failed':
        this.stopSpinner();
        this.pendingToolCalls.clear();
        console.log(chalk.red(`Error: ${message.error}`));
        break;

      case 'tool_call_started':
        this.pendingToolCalls.set(message.toolCall.id, message.toolCall.name);
        this.updateSpinner();
        break;

      case 'tool_completed': {
        const toolName =
          this.pendingToolCalls.get(message.toolCallId) ?? message.toolCallId;
        this.pendingToolCalls.delete(message.toolCallId);

        if (this.hasRenderedTextInCurrentStep) {
          break;
        }

        if (this.pendingToolCalls.size > 0) {
          this.updateSpinner();
          break;
        }

        const brief =
          message.result.brief && message.result.brief !== 'Completed'
            ? message.result.brief
            : `${toolName} completed`;

        if (this.activeSpinner) {
          this.activeSpinner.succeed(chalk.green(brief));
          this.activeSpinner = null;
        } else {
          console.log(chalk.green(`✓ ${brief}`));
        }
        break;
      }

      case 'tool_failed': {
        const toolName =
          this.pendingToolCalls.get(message.toolCallId) ?? message.toolCallId;
        this.pendingToolCalls.delete(message.toolCallId);
        const errorText = `${toolName}: ${message.error}`;

        if (this.activeSpinner) {
          this.activeSpinner.fail(chalk.red(errorText));
          this.activeSpinner = null;
        } else {
          console.log(chalk.red(`Error: ${errorText}`));
        }

        if (!this.hasRenderedTextInCurrentStep) {
          this.updateSpinner();
        }
        break;
      }

      case 'approval_requested':
        // Stop spinner during approval to show prompt clearly
        this.stopSpinner();
        break;

      case 'approval_completed':
        // Approval done, spinner will resume on next tool action if needed
        break;

      case 'step_completed':
        this.resetStepState();
        console.log(); // Add newline
        break;
    }
  }
}
