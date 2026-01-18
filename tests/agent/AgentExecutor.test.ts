import { describe, it, expect, beforeEach, vi } from "vitest";
import type { LanguageModel, LanguageModelUsage } from "ai";

import { AgentExecutor } from "../../src/agent/AgentExecutor";
import type { Agent } from "../../src/agent/Agent";
import { ConversationContext } from "../../src/agent/ConversationContext";
import { ToolRegistry } from "../../src/tools/base/ToolRegistry";
import { Tool } from "../../src/tools/base/Tool";
import { MessageBus } from "../../src/messaging/MessageBus";

const mockStreamText = vi.hoisted(() => vi.fn());

vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return {
    ...actual,
    streamText: mockStreamText,
  };
});

vi.mock("../../src/messaging/MessageBus", () => ({
  MessageBus: {
    getInstance: vi.fn(() => ({
      publish: vi.fn(),
    })),
  },
}));

vi.mock("../../src/agent/ContextCompressor", () => {
  class MockContextCompressor {
    compress = vi.fn().mockResolvedValue("Compressed summary");
  }

  return { ContextCompressor: MockContextCompressor };
});

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
    ) => Promise<{ ok: boolean; output: string }>,
  ) {
    super();
    this.name = name;
  }

  async call(input: Record<string, unknown>) {
    return this.handler(input);
  }
}

describe("AgentExecutor", () => {
  let executor: AgentExecutor;
  let mockAgent: Agent;
  let context: ConversationContext;
  let toolRegistry: ToolRegistry;
  let messageBus: { publish: ReturnType<typeof vi.fn> };
  const fakeModel = {} as LanguageModel;
  const testStorageFile = ":memory:";

  beforeEach(() => {
    mockStreamText.mockReset();
    messageBus = { publish: vi.fn() };
    (MessageBus.getInstance as unknown as vi.Mock).mockReturnValue(messageBus);

    toolRegistry = new ToolRegistry();
    mockAgent = {
      modelName: "claude-sonnet-4-20250514",
      systemPrompt: "You are a helpful assistant.",
      maxContextSize: 200000,
      toolRegistry,
    } as Agent;

    context = new ConversationContext(testStorageFile);
    executor = new AgentExecutor(mockAgent, context, fakeModel);
  });

  it("stores assistant response and tokens", async () => {
    mockStreamText.mockReturnValue(
      createStreamResult(
        createTextChunks("Hello! How can I help you today?"),
        createUsage(42),
      ),
    );

    await executor.execute("Hi there");

    expect(mockStreamText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: fakeModel,
        system: "You are a helpful assistant.",
      }),
    );

    const history = context.getHistory();
    expect(history).toHaveLength(2);
    expect(history[0]).toEqual({ role: "user", content: "Hi there" });
    expect(history[1]).toEqual({
      role: "assistant",
      content: "Hello! How can I help you today?",
    });
    expect(context.tokenCount).toBe(42);
  });

  it("publishes text chunks", async () => {
    mockStreamText.mockReturnValue(
      createStreamResult(createTextChunks("Hello world")),
    );

    await executor.execute("Hi");

    expect(messageBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: "text_chunk", text: "Hello world" }),
    );
  });

  it("creates checkpoints for each run", async () => {
    mockStreamText.mockReturnValue(
      createStreamResult(createTextChunks("Response")),
    );

    expect(context.checkpointCount).toBe(0);
    await executor.execute("Test");
    expect(context.checkpointCount).toBeGreaterThan(0);
  });

  describe("tool execution", () => {
    it("executes tool and records results", async () => {
      const testTool = new TestTool("test_tool", async () => ({
        ok: true,
        output: "Tool executed successfully",
      }));
      toolRegistry.register(testTool);
      executor = new AgentExecutor(mockAgent, context, fakeModel);

      mockStreamText
        .mockReturnValueOnce(
          createStreamResult(
            createToolCallChunks("test_tool", { param: "value" }),
          ),
        )
        .mockReturnValueOnce(createStreamResult(createTextChunks("Done!")));

      await executor.execute("Use the tool");

      const history = context.getHistory();
      expect(history).toHaveLength(4);
      expect(history[1]).toMatchObject({
        role: "assistant",
        content: expect.arrayContaining([
          expect.objectContaining({ type: "tool-call", toolName: "test_tool" }),
        ]),
      });
      expect(history[2]).toEqual({
        role: "tool",
        content: [
          expect.objectContaining({
            type: "tool-result",
            toolName: "test_tool",
          }),
        ],
      } as any);
    });

    it("handles tool errors gracefully", async () => {
      const errorTool = new TestTool("error_tool", async () => ({
        ok: false,
        output: "Tool failed: Invalid input",
      }));
      toolRegistry.register(errorTool);
      executor = new AgentExecutor(mockAgent, context, fakeModel);

      mockStreamText
        .mockReturnValueOnce(
          createStreamResult(
            createToolCallChunks("error_tool", { param: "bad" }),
          ),
        )
        .mockReturnValueOnce(
          createStreamResult(createTextChunks("I encountered an error.")),
        );

      await executor.execute("Use error tool");

      const toolMessage = context.getHistory()[2];
      expect(toolMessage).toMatchObject({
        role: "tool",
        content: [
          expect.objectContaining({
            type: "tool-result",
            toolName: "error_tool",
            output: expect.objectContaining({
              type: "error-json",
              value: expect.objectContaining({ ok: false }),
            }),
          }),
        ],
      });
    });

    it("publishes tool events", async () => {
      const testTool = new TestTool("test_tool", async () => ({
        ok: true,
        output: "Success",
      }));
      toolRegistry.register(testTool);
      executor = new AgentExecutor(mockAgent, context, fakeModel);

      mockStreamText
        .mockReturnValueOnce(
          createStreamResult(createToolCallChunks("test_tool", {})),
        )
        .mockReturnValueOnce(createStreamResult(createTextChunks("Done")));

      await executor.execute("Test");

      expect(messageBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({ type: "tool_call_started" }),
      );
    });
  });

  describe("multi-turn conversations", () => {
    it("maintains conversation history across turns", async () => {
      mockStreamText
        .mockReturnValueOnce(
          createStreamResult(createTextChunks("First response")),
        )
        .mockReturnValueOnce(
          createStreamResult(createTextChunks("Second response")),
        );

      await executor.execute("First message");
      await executor.execute("Second message");

      const history = context.getHistory();
      expect(history).toHaveLength(4);
      expect(history[0].content).toBe("First message");
      expect(history[2].content).toBe("Second message");

      const secondCall = mockStreamText.mock.calls[1][0];
      expect(secondCall.messages.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("error handling and limits", () => {
    it("propagates stream errors", async () => {
      mockStreamText.mockImplementation(() => {
        throw new Error("API Error");
      });

      await expect(executor.execute("Test")).rejects.toThrow("API Error");
    });

    it("enforces max step limit", async () => {
      const loopTool = new TestTool("loop_tool", async () => ({
        ok: true,
        output: "continue",
      }));
      toolRegistry.register(loopTool);
      executor = new AgentExecutor(mockAgent, context, fakeModel, {
        maxStepsPerRun: 1,
      });

      mockStreamText.mockReturnValue(
        createStreamResult(createToolCallChunks("loop_tool", {})),
      );

      await expect(executor.execute("Loop forever")).rejects.toThrow(
        "Maximum steps",
      );
    });
  });
});

function createStreamResult(
  chunks: unknown[],
  usage: LanguageModelUsage = createUsage(0),
) {
  async function* iterator() {
    for (const chunk of chunks) {
      yield chunk;
    }
  }

  return {
    fullStream: iterator(),
    usage: Promise.resolve(usage),
  } as any;
}

function createTextChunks(text: string) {
  return [
    { type: "text-delta", id: "text_0", text },
    { type: "text-end", id: "text_0" },
  ];
}

function createToolCallChunks(name: string, input: Record<string, unknown>) {
  return [
    { type: "tool-call", toolCallId: `call_${name}`, toolName: name, input },
  ];
}

function createUsage(
  inputTokens: number,
  outputTokens: number = 0,
): LanguageModelUsage {
  return {
    totalTokens: inputTokens + outputTokens,
    inputTokens,
    outputTokens,
  };
}
