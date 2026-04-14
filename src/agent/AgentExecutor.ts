import { Agent as PiAgent } from "@mariozechner/pi-agent-core";
import type { AgentEvent, AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@mariozechner/pi-ai";
import type { Message, Model } from "@mariozechner/pi-ai";

import type { Agent } from "./Agent.js";
import type { ConversationContext } from "./ConversationContext.js";
import { MessageBus } from "../messaging/MessageBus.js";
import type { ToolLike } from "../tools/base/ToolRegistry.js";
import { Logger } from "../utils/Logger.js";

export interface ExecutorStatus {
  contextUsage: number;
  tokenCount: number;
  currentStep: number;
}

/**
 * Wraps an existing ToolLike (legacy Tool interface) as an AgentTool
 * compatible with @mariozechner/pi-agent-core.
 */
function wrapTool(tool: ToolLike): AgentTool {
  return {
    name: tool.name,
    label: tool.name,
    description: tool.description,
    // Use Type.Unsafe to pass the existing JSON Schema as a TypeBox schema
    parameters: Type.Unsafe(tool.inputSchema as Record<string, unknown>),
    execute: async (_toolCallId, params) => {
      const result = await tool.call(params as Record<string, unknown>);
      if (!result.ok) {
        throw new Error(result.message ?? result.output);
      }
      return {
        content: [{ type: "text" as const, text: result.output }],
        details: {
          ok: result.ok,
          output: result.output,
          message: result.message,
          brief: result.brief,
          json: result.json,
        },
      };
    },
  };
}

export class AgentExecutor {
  private piAgent: PiAgent;
  private context: ConversationContext;
  private messageBus: MessageBus;
  private maxContextSize: number;
  private _tokenCount = 0;
  private _stepCount = 0;

  constructor(
    agent: Agent,
    context: ConversationContext,
    model: Model<string>,
  ) {
    this.context = context;
    this.maxContextSize = agent.maxContextSize;
    this.messageBus = MessageBus.getInstance();

    const tools = agent.toolRegistry.getAll().map(wrapTool);
    const apiKey = agent.apiKey;

    this.piAgent = new PiAgent({
      initialState: {
        systemPrompt: agent.systemPrompt,
        model,
        tools,
        messages: context.getHistory(),
      },
      getApiKey: apiKey ? () => Promise.resolve(apiKey) : undefined,
    });

    this.piAgent.subscribe((event) => this.handleEvent(event));
  }

  get status(): ExecutorStatus {
    return {
      contextUsage: this._tokenCount / this.maxContextSize,
      tokenCount: this._tokenCount,
      currentStep: this._stepCount,
    };
  }

  async execute(userInput: string): Promise<void> {
    Logger.debug("AgentExecutor", "Starting execution", {
      input: userInput.slice(0, 100),
    });
    await this.piAgent.prompt(userInput);
    Logger.debug("AgentExecutor", "Execution completed", {
      finalTokens: this._tokenCount,
      totalSteps: this._stepCount,
    });
  }

  private handleEvent(event: AgentEvent): void {
    switch (event.type) {
      case "turn_start":
        this._stepCount++;
        this.messageBus.publish({
          type: "step_started",
          stepNumber: this._stepCount,
        });
        break;

      case "turn_end": {
        const msg = event.message as unknown as Record<string, unknown>;
        if (
          msg.role === "assistant" &&
          msg.usage &&
          typeof msg.usage === "object"
        ) {
          const usage = msg.usage as { input?: number; output?: number };
          this._tokenCount = (usage.input ?? 0) + (usage.output ?? 0);
          void this.context.setTokenCount(this._tokenCount);
        }
        this.messageBus.publish({ type: "step_completed" });
        break;
      }

      case "message_update":
        if (event.assistantMessageEvent.type === "text_delta") {
          this.messageBus.publish({
            type: "text_chunk",
            text: event.assistantMessageEvent.delta,
          });
        }
        break;

      case "tool_execution_start":
        this.messageBus.publish({
          type: "tool_call_started",
          toolCall: { id: event.toolCallId, name: event.toolName },
        });
        break;

      case "tool_execution_end": {
        const details = event.result as Record<string, unknown> | undefined;
        if (event.isError) {
          this.messageBus.publish({
            type: "tool_failed",
            toolCallId: event.toolCallId,
            error:
              typeof event.result === "string"
                ? event.result
                : (details?.output as string | undefined) ?? "Tool failed",
          });
        } else {
          this.messageBus.publish({
            type: "tool_completed",
            toolCallId: event.toolCallId,
            result: {
              ok: true,
              output: (details?.output as string | undefined) ?? "",
              message: details?.message as string | undefined,
              brief: details?.brief as string | undefined,
              json: details?.json,
            },
          });
        }
        break;
      }

      case "agent_end":
        // Sync agent messages back to the conversation context
        void this.syncMessages(event.messages as Message[]);
        break;

      default:
        break;
    }
  }

  private async syncMessages(messages: Message[]): Promise<void> {
    const existing = this.context.getHistory();
    const newMessages = messages.slice(existing.length);
    for (const msg of newMessages) {
      await this.context.addMessage(msg);
    }
  }
}
