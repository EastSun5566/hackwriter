import { Agent as PiAgent } from "@mariozechner/pi-agent-core";
import type { AgentEvent, AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@mariozechner/pi-ai";
import type {
  AssistantMessage as PiAssistantMessage,
  Message,
  Model,
} from "@mariozechner/pi-ai";

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

function estimateTokens(text: string): number {
  if (text.length === 0) {
    return 0;
  }

  return Math.ceil(text.length / 4);
}

function serializeMessage(message: Message): string {
  if (message.role === "user") {
    if (typeof message.content === "string") {
      return message.content;
    }

    return message.content
      .map((block) =>
        block.type === "text"
          ? block.text
          : `[image:${block.mimeType}:${block.data.length}]`,
      )
      .join("\n");
  }

  if (message.role === "assistant") {
    return message.content
      .map((block) => {
        switch (block.type) {
          case "text":
            return block.text;
          case "thinking":
            return block.thinking;
          case "toolCall":
            return `${block.name}:${JSON.stringify(block.arguments)}`;
        }
      })
      .join("\n");
  }

  return [
    message.toolName,
    ...message.content.map((block) =>
      block.type === "text"
        ? block.text
        : `[image:${block.mimeType}:${block.data.length}]`,
    ),
  ].join("\n");
}

function estimateConversationTokens(
  messages: Message[],
  systemPrompt: string,
  tools: ToolLike[],
): number {
  const parts: string[] = [];

  if (systemPrompt.length > 0) {
    parts.push(`system:${systemPrompt}`);
  }

  for (const message of messages) {
    parts.push(`${message.role}:${serializeMessage(message)}`);
  }

  if (tools.length > 0) {
    parts.push(
      `tools:${JSON.stringify(
        tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      )}`,
    );
  }

  return estimateTokens(parts.join("\n\n"));
}

function getReportedTokenCount(message: PiAssistantMessage): number {
  const { usage } = message;

  if (usage.totalTokens > 0) {
    return usage.totalTokens;
  }

  return usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
}

function isAbortError(error: unknown): error is Error {
  return error instanceof Error && error.name === "AbortError";
}

export class AgentExecutor {
  private piAgent: PiAgent;
  private context: ConversationContext;
  private messageBus: MessageBus;
  private maxContextSize: number;
  private readonly systemPrompt: string;
  private readonly toolsForEstimation: ToolLike[];
  private _tokenCount = 0;
  private _stepCount = 0;
  private _isExecuting = false;
  private _abortRequested = false;
  private sawUsageThisRun = false;
  private streamedAssistantText = new Map<string, number>();

  constructor(
    agent: Agent,
    context: ConversationContext,
    model: Model<string>,
  ) {
    this.context = context;
    this.maxContextSize = agent.maxContextSize;
    this.systemPrompt = agent.systemPrompt;
    this.messageBus = MessageBus.getInstance();
    this._tokenCount = context.tokenCount;

    this.toolsForEstimation = agent.toolRegistry.getAll();
    const tools = this.toolsForEstimation.map(wrapTool);
    const apiKey = agent.apiKey;

    this.piAgent = new PiAgent({
      initialState: {
        systemPrompt: agent.systemPrompt,
        model,
        tools,
        messages: context.getHistory(),
      },
      getApiKey: (providerName) => {
        if (apiKey) {
          return apiKey;
        }

        // pi-ai's OpenAI-compatible "simple" streaming path requires an API key,
        // but Ollama ignores it. Return a dummy value so local Ollama models work.
        if (providerName === "ollama") {
          return "ollama";
        }

        return undefined;
      },
    });

    this.piAgent.subscribe((event) => this.handleEvent(event));
  }

  get status(): ExecutorStatus {
    const safeMaxContextSize = Math.max(this.maxContextSize, 1);

    return {
      contextUsage: Math.min(this._tokenCount / safeMaxContextSize, 1),
      tokenCount: this._tokenCount,
      currentStep: this._stepCount,
    };
  }

  get isExecuting(): boolean {
    return this._isExecuting;
  }

  abort(): void {
    if (!this._isExecuting || this._abortRequested) {
      return;
    }

    Logger.debug("AgentExecutor", "Aborting active execution");
    this._abortRequested = true;
    this.piAgent.abort();
    this.messageBus.publish({ type: "execution_interrupted" });
  }

  async execute(userInput: string): Promise<void> {
    Logger.debug("AgentExecutor", "Starting execution", {
      input: userInput.slice(0, 100),
    });
    this._isExecuting = true;
    this._abortRequested = false;
    this.sawUsageThisRun = false;

    try {
      await this.piAgent.prompt(userInput);
      Logger.debug("AgentExecutor", "Execution completed", {
        finalTokens: this._tokenCount,
        totalSteps: this._stepCount,
      });
    } catch (error) {
      if (isAbortError(error)) {
        Logger.debug("AgentExecutor", "Execution aborted");
        return;
      }

      throw error;
    } finally {
      this._isExecuting = false;
    }
  }

  private async handleEvent(event: AgentEvent): Promise<void> {
    switch (event.type) {
      case "turn_start":
        this._stepCount++;
        this.messageBus.publish({
          type: "step_started",
          stepNumber: this._stepCount,
        });
        break;

      case "turn_end": {
        if (event.message.role === "assistant") {
          const tokenCount = getReportedTokenCount(event.message);

          if (tokenCount > 0) {
            this.sawUsageThisRun = true;
            await this.updateTokenCount(tokenCount);
          }
        }
        this.messageBus.publish({ type: "step_completed" });
        break;
      }

      case "message_update":
        if (
          event.message.role === "assistant" &&
          event.assistantMessageEvent.type === "text_delta"
        ) {
          const message = event.message;
          const messageKey = this.getAssistantMessageKey(message);
          const streamedLength = this.streamedAssistantText.get(messageKey) ?? 0;
          this.streamedAssistantText.set(
            messageKey,
            streamedLength + event.assistantMessageEvent.delta.length,
          );

          this.messageBus.publish({
            type: "text_chunk",
            text: event.assistantMessageEvent.delta,
          });
        }
        break;

      case "message_end":
        if (event.message.role === "assistant") {
          this.publishRemainingAssistantText(event.message);
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

      case "agent_end": {
        const isAbortedRun = this.isAbortedRun(event.messages as Message[]);

        if (isAbortedRun) {
          if (!this._abortRequested) {
            this._abortRequested = true;
            this.messageBus.publish({ type: "execution_interrupted" });
          }

          this.streamedAssistantText.clear();
          break;
        }

        const assistantError = event.messages.find(
          (message): message is PiAssistantMessage =>
            message.role === "assistant" &&
            typeof message.errorMessage === "string" &&
            message.errorMessage.length > 0,
        );

        if (assistantError?.errorMessage) {
          this.messageBus.publish({
            type: "agent_failed",
            error: assistantError.errorMessage,
          });
        }

        // Sync agent messages back to the conversation context
        await this.syncMessages(event.messages as Message[]);

        if (!this.sawUsageThisRun || this._tokenCount === 0) {
          await this.updateTokenCount(
            estimateConversationTokens(
              this.context.getHistory(),
              this.systemPrompt,
              this.toolsForEstimation,
            ),
          );
        }
        break;
      }

      default:
        break;
    }
  }

  private getAssistantMessageKey(message: PiAssistantMessage): string {
    return message.responseId ?? `${message.model}:${message.timestamp}`;
  }

  private isAbortedRun(messages: Message[]): boolean {
    return messages.some(
      (message): message is PiAssistantMessage =>
        message.role === "assistant" && message.stopReason === "aborted",
    );
  }

  private publishRemainingAssistantText(message: PiAssistantMessage): void {
    const fullText = message.content
      .filter(
        (block): block is Extract<PiAssistantMessage["content"][number], { type: "text" }> =>
          block.type === "text",
      )
      .map((block) => block.text)
      .join("");

    const messageKey = this.getAssistantMessageKey(message);
    const streamedLength = this.streamedAssistantText.get(messageKey) ?? 0;

    if (fullText.length > streamedLength) {
      this.messageBus.publish({
        type: "text_chunk",
        text: fullText.slice(streamedLength),
      });
    }

    this.streamedAssistantText.delete(messageKey);
  }

  private async syncMessages(messages: Message[]): Promise<void> {
    if (messages.length === 0) {
      return;
    }

    await this.context.addMessage(messages);
  }

  private async updateTokenCount(tokenCount: number): Promise<void> {
    const normalizedTokenCount = Math.max(0, Math.floor(tokenCount));

    if (normalizedTokenCount === this._tokenCount) {
      return;
    }

    this._tokenCount = normalizedTokenCount;
    await this.context.setTokenCount(this._tokenCount);
  }
}
