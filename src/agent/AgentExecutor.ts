import type {
  LanguageModel,
  ModelMessage,
  TextPart,
  ToolCallPart,
  ToolResultPart,
  Tool as AITool,
} from "ai";
import { jsonSchema, streamText } from "ai";

import type { Agent } from "./Agent.js";
import type { ConversationContext } from "./ConversationContext.js";
import { MessageBus } from "../messaging/MessageBus.js";
import { ContextCompressor } from "./ContextCompressor.js";
import type { ToolResult } from "../tools/base/Tool.js";
import { Logger } from "../utils/Logger.js";
import type { Halt, StepOutcome } from "./AgentTypes.js";
import { stepContinue, stepHalt } from "./AgentTypes.js";

export interface ExecutorStatus {
  contextUsage: number;
  tokenCount: number;
  currentStep: number;
}

interface ToolCallInfo {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface ToolExecutionResult extends ToolResult {
  toolCallId: string;
  toolName: string;
}

type StreamChunk =
  | { type: "text-delta"; text: string }
  | { type: "text-end" }
  | { type: "tool-input-delta"; toolCallId: string; inputTextDelta: string }
  | { type: "tool-call"; toolCallId: string; toolName: string; input: unknown }
  | {
      type: "tool-result";
      toolCallId: string;
      toolName: string;
      output: ToolResultPart["output"];
    }
  | { type: "error"; error: unknown };

export class AgentExecutor {
  private context: ConversationContext;
  private agent: Agent;
  private model: LanguageModel;
  private messageBus: MessageBus;
  private compressor: ContextCompressor;

  private maxSteps: number;
  private maxRetriesPerStep: number;
  private reservedTokens: number;
  private currentStep = 0;

  // Stuck detection
  private consecutiveEmptyMessages = 0;
  private recentToolCalls: string[] = [];
  private readonly MAX_EMPTY_MESSAGES = 2;
  private readonly MAX_SAME_TOOL_REPEATS = 5;

  constructor(
    agent: Agent,
    context: ConversationContext,
    model: LanguageModel,
    loopControl?: {
      maxStepsPerRun?: number;
      maxRetriesPerStep?: number;
      reservedTokens?: number;
    },
  ) {
    this.agent = agent;
    this.context = context;
    this.model = model;
    this.messageBus = MessageBus.getInstance();
    this.compressor = new ContextCompressor(model);
    this.maxSteps = loopControl?.maxStepsPerRun ?? 100;
    this.maxRetriesPerStep = loopControl?.maxRetriesPerStep ?? 2;
    // Reserve 25% of context or 50k tokens, whichever is smaller
    this.reservedTokens =
      loopControl?.reservedTokens ??
      Math.min(50000, Math.floor(agent.maxContextSize * 0.25));
  }

  get status(): ExecutorStatus {
    return {
      contextUsage: this.context.tokenCount / this.agent.maxContextSize,
      tokenCount: this.context.tokenCount,
      currentStep: this.currentStep,
    };
  }

  async execute(userInput: string): Promise<void> {
    Logger.debug("AgentExecutor", "Starting execution", {
      input: userInput.slice(0, 100),
      currentTokens: this.context.tokenCount,
    });

    const userMessage: ModelMessage = {
      role: "user",
      content: userInput,
    };

    await this.context.createCheckpoint();
    await this.context.addMessage(userMessage);
    await this.runLoop();

    Logger.debug("AgentExecutor", "Execution completed", {
      finalTokens: this.context.tokenCount,
      totalSteps: this.currentStep,
    });
  }

  private async runLoop(): Promise<void> {
    this.currentStep = 1;
    this.consecutiveEmptyMessages = 0;
    this.recentToolCalls = [];

    while (true) {
      Logger.debug(
        "AgentExecutor",
        `Step ${this.currentStep}/${this.maxSteps}`,
      );

      this.messageBus.publish({
        type: "step_started",
        stepNumber: this.currentStep,
      });

      // Check if context compression needed
      if (this.shouldCompressContext()) {
        Logger.info("AgentExecutor", "Context compression triggered", {
          currentTokens: this.context.tokenCount,
          maxTokens: this.agent.maxContextSize,
        });
        this.messageBus.publish({ type: "compression_started" });
        await this.compressContext();
        this.messageBus.publish({ type: "compression_completed" });
        Logger.info("AgentExecutor", "Context compression completed", {
          newTokenCount: this.context.tokenCount,
        });
      }

      await this.context.createCheckpoint();

      // Execute single step
      const outcome = await this.executeStep();

      if (outcome.kind === "halt") {
        this.handleHalt(outcome.halt);
        this.messageBus.publish({ type: "step_completed" });
        return;
      }

      this.currentStep++;
      if (this.currentStep > this.maxSteps) {
        const halt: Halt = { kind: "max_steps" };
        this.handleHalt(halt);
        this.messageBus.publish({ type: "step_completed" });
        return;
      }
    }
  }

  private handleHalt(halt: Halt): void {
    switch (halt.kind) {
      case "done":
        Logger.debug("AgentExecutor", "Execution completed naturally");
        break;
      case "max_steps":
        Logger.warn(
          "AgentExecutor",
          `Maximum steps (${this.maxSteps}) reached`,
        );
        throw new Error(`Maximum steps (${this.maxSteps}) reached`);
      case "error":
        Logger.error(
          "AgentExecutor",
          "Execution halted due to error",
          halt.error,
        );
        throw halt.error;
      case "stuck":
        Logger.warn("AgentExecutor", "Agent appears stuck - halting");
        throw new Error("Agent stuck in loop");
      case "await_user":
        Logger.debug("AgentExecutor", "Waiting for user input");
        break;
    }
  }

  private async executeStep(): Promise<StepOutcome> {
    const stream = streamText({
      model: this.model,
      system: this.agent.systemPrompt,
      messages: this.context.getHistory(),
      tools: this.buildToolSet(),
      maxRetries: this.maxRetriesPerStep,
    });

    const toolCalls: ToolCallInfo[] = [];
    const assistantParts: (TextPart | ToolCallPart | ToolResultPart)[] = [];
    let pendingText = "";

    const flushText = (): void => {
      if (!pendingText.length) {
        return;
      }
      assistantParts.push({ type: "text", text: pendingText });
      pendingText = "";
    };

    try {
      const streamIterator = stream.fullStream as AsyncIterable<StreamChunk>;
      for await (const chunk of streamIterator) {
        switch (chunk.type) {
          case "text-delta": {
            pendingText += chunk.text;
            this.messageBus.publish({ type: "text_chunk", text: chunk.text });
            break;
          }
          case "text-end": {
            flushText();
            break;
          }
          case "tool-input-delta": {
            this.messageBus.publish({
              type: "tool_arguments_chunk",
              toolCallId: chunk.toolCallId,
              chunk: chunk.inputTextDelta,
            });
            break;
          }
          case "tool-call": {
            flushText();
            const normalizedInput = this.normalizeToolInput(chunk.input);
            const toolCall: ToolCallInfo = {
              id: chunk.toolCallId,
              name: chunk.toolName,
              input: normalizedInput,
            };
            toolCalls.push(toolCall);
            assistantParts.push({
              type: "tool-call",
              toolCallId: chunk.toolCallId,
              toolName: chunk.toolName,
              input: normalizedInput,
            });
            this.messageBus.publish({
              type: "tool_call_started",
              toolCall: {
                id: toolCall.id,
                name: toolCall.name,
              },
            });
            break;
          }
          case "tool-result": {
            flushText();
            assistantParts.push({
              type: "tool-result",
              toolCallId: chunk.toolCallId,
              toolName: chunk.toolName,
              output: chunk.output,
            });
            break;
          }
          case "error": {
            const error =
              chunk.error instanceof Error
                ? chunk.error
                : new Error(String(chunk.error));
            return stepHalt({ kind: "error", error });
          }
          default:
            // Ignore other chunk types (start/finish markers, reasoning, sources, etc.)
            break;
        }
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      return stepHalt({ kind: "error", error: err });
    } finally {
      flushText();
    }

    const assistantMessage = this.createAssistantMessage(assistantParts);
    await this.context.addMessage(assistantMessage);

    const usage = await stream.usage;
    // Use inputTokens as it represents prompt/context size better than totalTokens
    const contextTokens = usage?.inputTokens ?? this.context.tokenCount;
    await this.context.setTokenCount(contextTokens);

    // Check for stuck: consecutive empty messages
    const messageText = this.extractMessageText(assistantMessage);
    if (!messageText.trim() && toolCalls.length === 0) {
      this.consecutiveEmptyMessages++;
      if (this.consecutiveEmptyMessages >= this.MAX_EMPTY_MESSAGES) {
        Logger.warn("AgentExecutor", "Detected consecutive empty messages");
        return stepHalt({ kind: "stuck" });
      }
    } else {
      this.consecutiveEmptyMessages = 0;
    }

    if (toolCalls.length > 0) {
      // Track tool calls for stuck detection
      for (const call of toolCalls) {
        this.recentToolCalls.push(call.name);
      }

      // Keep only last N tool calls
      if (this.recentToolCalls.length > this.MAX_SAME_TOOL_REPEATS) {
        this.recentToolCalls = this.recentToolCalls.slice(
          -this.MAX_SAME_TOOL_REPEATS,
        );
      }

      // Check if same tool called repeatedly
      if (this.recentToolCalls.length === this.MAX_SAME_TOOL_REPEATS) {
        const allSame = this.recentToolCalls.every(
          (name) => name === this.recentToolCalls[0],
        );
        if (allSame) {
          Logger.warn(
            "AgentExecutor",
            `Tool "${this.recentToolCalls[0]}" called ${this.MAX_SAME_TOOL_REPEATS} times in a row`,
          );
          // Inject controller message to help agent recover
          await this.injectControllerMessage(
            `You've called the tool "${this.recentToolCalls[0]}" ${this.MAX_SAME_TOOL_REPEATS} times in a row. ` +
              `This suggests you may be stuck. Please try a different approach or provide your final answer.`,
          );
          this.recentToolCalls = []; // Reset after intervention
        }
      }

      const results = await this.executeTools(toolCalls);
      const toolResultMessage: ModelMessage = {
        role: "tool",
        content: results.map((result) => this.createToolResultPart(result)),
      };
      await this.context.addMessage(toolResultMessage);
      return stepContinue();
    }

    // No tool calls - execution complete
    return stepHalt({ kind: "done" });
  }

  private async executeTools(
    toolCalls: ToolCallInfo[],
  ): Promise<ToolExecutionResult[]> {
    Logger.debug(
      "AgentExecutor",
      `Executing ${toolCalls.length} tool(s): ${toolCalls.map((t) => t.name).join(", ")}`,
    );

    return await Promise.all(
      toolCalls.map(async (call) => {
        const tool = this.agent.toolRegistry.get(call.name);

        if (!tool) {
          const errorResult = {
            toolCallId: call.id,
            toolName: call.name,
            ok: false,
            output: `Tool ${call.name} not found`,
          };

          this.messageBus.publish({
            type: "tool_failed",
            toolCallId: call.id,
            error: errorResult.output,
          });

          return errorResult;
        }

        try {
          const result = await tool.call(call.input);

          Logger.debug(
            "AgentExecutor",
            `Tool ${call.name}: ${result.ok ? "✓" : "✗"} ${result.brief ?? ""}`,
          );

          this.messageBus.publish({
            type: "tool_completed",
            toolCallId: call.id,
            result,
          });

          return {
            toolCallId: call.id,
            toolName: call.name,
            ...result,
          };
        } catch (error) {
          Logger.error("AgentExecutor", `Tool ${call.name} failed`, error);
          const errorResult = {
            toolCallId: call.id,
            toolName: call.name,
            ok: false,
            output: error instanceof Error ? error.message : String(error),
          };

          this.messageBus.publish({
            type: "tool_failed",
            toolCallId: call.id,
            error: errorResult.output,
          });

          return errorResult;
        }
      }),
    );
  }

  private shouldCompressContext(): boolean {
    return (
      this.context.tokenCount + this.reservedTokens >= this.agent.maxContextSize
    );
  }

  private async compressContext(): Promise<void> {
    const compressed = await this.compressor.compress(
      this.context.getHistory(),
    );

    await this.context.revertToCheckpoint(0);
    await this.context.createCheckpoint();
    await this.context.addMessage({
      role: "assistant",
      content: `<system>Previous context compressed:\n${compressed}</system>`,
    });
  }

  private buildToolSet(): Record<string, AITool> {
    const tools: Record<string, AITool> = {};
    for (const tool of this.agent.toolRegistry.getAll()) {
      tools[tool.name] = {
        description: tool.description,
        inputSchema: jsonSchema(tool.inputSchema),
      } satisfies AITool;
    }
    return tools;
  }

  private normalizeToolInput(input: unknown): Record<string, unknown> {
    if (input && typeof input === "object" && !Array.isArray(input)) {
      return input as Record<string, unknown>;
    }
    return {};
  }

  private createAssistantMessage(
    parts: (TextPart | ToolCallPart | ToolResultPart)[],
  ): ModelMessage {
    if (parts.length === 0) {
      return { role: "assistant", content: "" };
    }

    if (parts.length === 1 && parts[0].type === "text") {
      return { role: "assistant", content: parts[0].text };
    }

    return { role: "assistant", content: parts };
  }

  private createToolResultPart(result: ToolExecutionResult): ToolResultPart {
    // If tool provides structured json, use it; otherwise use text-based output
    const value = (result.json ?? {
      ok: result.ok,
      output: result.output,
      message: result.message ?? null,
      brief: result.brief ?? null,
    }) as Record<string, unknown>;

    return {
      type: "tool-result",
      toolCallId: result.toolCallId,
      toolName: result.toolName,
      output: result.ok
        ? { type: "json", value: value as unknown }
        : { type: "error-json", value: value as unknown },
    } as ToolResultPart;
  }

  /**
   * Extract text content from a message for stuck detection
   */
  private extractMessageText(message: ModelMessage): string {
    if (typeof message.content === "string") {
      return message.content;
    }
    if (Array.isArray(message.content)) {
      return message.content
        .filter((part): part is TextPart => part.type === "text")
        .map((part) => part.text)
        .join("");
    }
    return "";
  }

  /**
   * Inject a system/controller message to help agent recover from stuck state
   */
  private async injectControllerMessage(message: string): Promise<void> {
    const controllerMessage: ModelMessage = {
      role: "assistant",
      content: `<system>${message}</system>`,
    };
    await this.context.addMessage(controllerMessage);
    Logger.info("AgentExecutor", "Injected controller message", { message });
  }
}
