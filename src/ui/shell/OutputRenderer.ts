import chalk from 'chalk';
import ora, { type Ora } from 'ora';
import { MessageBus } from '../../messaging/MessageBus.js';
import type { AgentMessage } from '../../messaging/MessageTypes.js';

interface ToolCallState {
  name: string;
  args: string;
}

export class OutputRenderer {
  private activeSpinner: Ora | null = null;
  private toolCalls = new Map<string, ToolCallState>();

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
        this.toolCalls.set(message.toolCall.id, {
          name: message.toolCall.name,
          args: '',
        });
        
        this.activeSpinner = ora({
          text: chalk.yellow(`Using ${message.toolCall.name}...`),
          color: 'yellow',
          discardStdin: false,
        }).start();
        break;

      case 'tool_arguments_chunk': {
        const state = this.toolCalls.get(message.toolCallId);
        if (state) {
          state.args += message.chunk;
        }
        break;
      }

      case 'tool_completed':
        if (this.activeSpinner) {
          const brief = message.result.brief ?? 'Completed';
          
          // Check if tool execution was successful
          if (message.result.ok) {
            this.activeSpinner.succeed(chalk.green(`✓ ${brief}`));
          } else {
            this.activeSpinner.fail(chalk.red(`✗ ${brief}`));
          }
          this.activeSpinner = null;
        }
        
        // Don't log tool output - agent will describe the result
        
        this.toolCalls.delete(message.toolCallId);
        break;

      case 'tool_failed':
        if (this.activeSpinner) {
          this.activeSpinner.fail(chalk.red(`✗ ${message.error}`));
          this.activeSpinner = null;
        }
        this.toolCalls.delete(message.toolCallId);
        break;

      case 'compression_started':
        this.activeSpinner = ora({
          text: 'Compressing context...',
          discardStdin: false,
        }).start();
        break;

      case 'compression_completed':
        if (this.activeSpinner) {
          this.activeSpinner.succeed(chalk.green('✓ Context compressed'));
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
