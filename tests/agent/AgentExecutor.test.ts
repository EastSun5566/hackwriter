import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  registerFauxProvider,
  fauxText,
  fauxToolCall,
  fauxAssistantMessage,
  type AssistantMessage,
  type Message,
  type FauxProviderRegistration,
} from "@mariozechner/pi-ai";

import { AgentExecutor } from "../../src/agent/AgentExecutor";
import type { Agent } from "../../src/agent/Agent";
import { ConversationContext } from "../../src/agent/ConversationContext";
import { ToolRegistry } from "../../src/tools/base/ToolRegistry";
import { Tool } from "../../src/tools/base/Tool";
import { MessageBus } from "../../src/messaging/MessageBus";
import type { ToolResult } from "../../src/tools/base/Tool";

vi.mock("../../src/messaging/MessageBus", () => ({
  MessageBus: {
    getInstance: vi.fn(() => ({
      publish: vi.fn(),
    })),
  },
}));

class TestTool extends Tool {
  readonly name: string;
  readonly description = "Test tool";
  readonly inputSchema = {
    type: "object" as const,
    properties: {},
    required: [] as string[],
  };

  constructor(
    name: string,
    private handler: (
      input: Record<string, unknown>,
    ) => Promise<{ ok: boolean; output: string; brief?: string }>,
  ) {
    super();
    this.name = name;
  }

  async call(input: Record<string, unknown>): Promise<ToolResult> {
    return this.handler(input);
  }
}

describe("AgentExecutor", () => {
  let faux: FauxProviderRegistration;
  let executor: AgentExecutor;
  let mockAgent: Agent;
  let context: ConversationContext;
  let toolRegistry: ToolRegistry;
  let messageBus: { publish: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    faux = registerFauxProvider();
    messageBus = { publish: vi.fn() };
    (MessageBus.getInstance as unknown as ReturnType<typeof vi.fn>).mockReturnValue(messageBus);

    toolRegistry = new ToolRegistry();
    mockAgent = {
      name: "Test Agent",
      modelName: "faux-model",
      maxContextSize: 200000,
      systemPrompt: "You are a helpful assistant.",
      toolRegistry,
    };

    context = new ConversationContext(":memory:");
    executor = new AgentExecutor(mockAgent, context, faux.getModel());
  });

  afterEach(() => {
    faux.unregister();
  });

  it("stores assistant response in context", async () => {
    faux.setResponses([
      fauxAssistantMessage(fauxText("Hello! How can I help you today?")),
    ]);

    await executor.execute("Hi there");

    // The agent syncs messages on agent_end, context should have user + assistant
    const history = context.getHistory();
    expect(history.length).toBeGreaterThanOrEqual(2);
    const userMsg = history.find((m) => m.role === "user");
    const assistantMsg = history.find((m) => m.role === "assistant");
    expect(userMsg).toBeDefined();
    expect(assistantMsg).toBeDefined();
  });

  it("publishes text chunks during streaming", async () => {
    faux.setResponses([
      fauxAssistantMessage(fauxText("Hello world")),
    ]);

    await executor.execute("Hi");

    expect(messageBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: "text_chunk" }),
    );
  });

  it("increments step count per turn", async () => {
    faux.setResponses([fauxAssistantMessage(fauxText("Response"))]);

    expect(executor.status.currentStep).toBe(0);
    await executor.execute("Test");
    expect(executor.status.currentStep).toBeGreaterThan(0);
  });

  describe("tool execution", () => {
    it("executes a tool when called by the model", async () => {
      const testTool = new TestTool("test_tool", async () => ({
        ok: true,
        output: "Tool executed successfully",
        brief: "Done",
      }));
      toolRegistry.register(testTool);
      executor = new AgentExecutor(mockAgent, context, faux.getModel());

      faux.setResponses([
        fauxAssistantMessage([
          fauxToolCall("test_tool", { param: "value" }),
        ]),
        fauxAssistantMessage(fauxText("The tool ran successfully.")),
      ]);

      await executor.execute("Use the tool");

      expect(messageBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({ type: "tool_call_started" }),
      );
      expect(messageBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({ type: "tool_completed" }),
      );
    });

    it("publishes tool_failed when tool throws an error", async () => {
      const errorTool = new TestTool("error_tool", async () => ({
        ok: false,
        output: "Tool failed: Invalid input",
        brief: "Failed",
      }));
      toolRegistry.register(errorTool);
      executor = new AgentExecutor(mockAgent, context, faux.getModel());

      faux.setResponses([
        fauxAssistantMessage([
          fauxToolCall("error_tool", { param: "bad" }),
        ]),
        fauxAssistantMessage(fauxText("I encountered an error.")),
      ]);

      await executor.execute("Use error tool");

      expect(messageBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({ type: "tool_failed" }),
      );
    });
  });

  describe("status", () => {
    it("returns contextUsage as fraction of maxContextSize", async () => {
      faux.setResponses([fauxAssistantMessage(fauxText("OK"))]);
      await executor.execute("Test");
      const { contextUsage } = executor.status;
      expect(contextUsage).toBeGreaterThanOrEqual(0);
    });

    it("initializes tokenCount from persisted conversation context", async () => {
      await context.setTokenCount(1234);

      executor = new AgentExecutor(mockAgent, context, faux.getModel());

      expect(executor.status.tokenCount).toBe(1234);
    });

    it("uses assistant totalTokens when provider usage is available", async () => {
      const assistantMessage: AssistantMessage = {
        role: "assistant",
        content: [{ type: "text", text: "Usage-aware response" }],
        api: faux.getModel().api,
        provider: faux.getModel().provider,
        model: faux.getModel().id,
        usage: {
          input: 120,
          output: 30,
          cacheRead: 40,
          cacheWrite: 10,
          totalTokens: 200,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: Date.now(),
      };

      await (executor as unknown as {
        handleEvent(event: {
          type: "turn_end";
          message: Message;
          toolResults: Message[];
        }): Promise<void>;
      }).handleEvent({
        type: "turn_end",
        message: assistantMessage,
        toolResults: [],
      });

      expect(executor.status.tokenCount).toBe(200);
      expect(context.tokenCount).toBe(200);
    });
  });

  describe("event fallbacks", () => {
    it("publishes final assistant text on message_end when no text delta was streamed", async () => {
      const assistantMessage: AssistantMessage = {
        role: "assistant",
        content: [{ type: "text", text: "Buffered response" }],
        api: faux.getModel().api,
        provider: faux.getModel().provider,
        model: faux.getModel().id,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: Date.now(),
      };

      await (executor as unknown as {
        handleEvent(event: {
          type: "message_end";
          message: Message;
        }): Promise<void>;
      }).handleEvent({
        type: "message_end",
        message: assistantMessage,
      });

      expect(messageBus.publish).toHaveBeenCalledWith({
        type: "text_chunk",
        text: "Buffered response",
      });
    });

    it("publishes agent_failed for agent_end error messages", async () => {
      const errorMessage: AssistantMessage = {
        role: "assistant",
        content: [{ type: "text", text: "" }],
        api: faux.getModel().api,
        provider: faux.getModel().provider,
        model: faux.getModel().id,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "error",
        errorMessage: "No API key for provider: ollama",
        timestamp: Date.now(),
      };

      await (executor as unknown as {
        handleEvent(event: {
          type: "agent_end";
          messages: Message[];
        }): Promise<void>;
      }).handleEvent({
        type: "agent_end",
        messages: [errorMessage],
      });

      expect(messageBus.publish).toHaveBeenCalledWith({
        type: "agent_failed",
        error: "No API key for provider: ollama",
      });
    });

    it("syncs all agent_end messages without slicing against existing history", async () => {
      await context.addMessage({
        role: "user",
        content: "Earlier message",
        timestamp: Date.now() - 10,
      });

      const newMessages: Message[] = [
        {
          role: "user",
          content: "New prompt",
          timestamp: Date.now(),
        },
        {
          role: "assistant",
          content: [{ type: "text", text: "New reply" }],
          api: faux.getModel().api,
          provider: faux.getModel().provider,
          model: faux.getModel().id,
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "stop",
          timestamp: Date.now() + 1,
        },
      ];

      await (executor as unknown as {
        handleEvent(event: {
          type: "agent_end";
          messages: Message[];
        }): Promise<void>;
      }).handleEvent({
        type: "agent_end",
        messages: newMessages,
      });

      const history = context.getHistory();
      expect(history).toHaveLength(3);
      expect(history[1]).toMatchObject({ role: "user", content: "New prompt" });
      expect(history[2]).toMatchObject({ role: "assistant" });
    });

    it("estimates token usage on agent_end when provider usage is unavailable", async () => {
      const newMessages: Message[] = [
        {
          role: "user",
          content: "Please summarize the latest note.",
          timestamp: Date.now(),
        },
        {
          role: "assistant",
          content: [{ type: "text", text: "Here is a concise summary." }],
          api: faux.getModel().api,
          provider: faux.getModel().provider,
          model: faux.getModel().id,
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "stop",
          timestamp: Date.now() + 1,
        },
      ];

      await (executor as unknown as {
        handleEvent(event: {
          type: "agent_end";
          messages: Message[];
        }): Promise<void>;
      }).handleEvent({
        type: "agent_end",
        messages: newMessages,
      });

      expect(executor.status.tokenCount).toBeGreaterThan(0);
      expect(context.tokenCount).toBe(executor.status.tokenCount);
      expect(executor.status.contextUsage).toBeGreaterThan(0);
    });
  });
});
