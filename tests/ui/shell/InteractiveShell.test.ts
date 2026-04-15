import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  InteractiveShell,
  type ModelContext,
} from "../../../src/ui/shell/InteractiveShell.js";
import type { AgentExecutor } from "../../../src/agent/AgentExecutor.js";

// Mock readline to avoid terminal interaction
vi.mock("readline", () => ({
  createInterface: vi.fn(() => ({
    on: vi.fn(),
    setPrompt: vi.fn(),
    prompt: vi.fn(),
    close: vi.fn(),
  })),
}));

describe("InteractiveShell", () => {
  let mockExecutor: Partial<AgentExecutor>;
  let modelContext: ModelContext;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockExecutor = {
      status: {
        contextUsage: 0.05,
        tokenCount: 100,
        currentStep: 1,
        isHalted: false,
        haltReason: null,
      },
    } as Partial<AgentExecutor>;

    modelContext = {
      currentModelName: "test-model",
      config: {
        defaultModel: "test-model",
        models: {
          "test-model": {
            provider: "test-provider",
            model: "phi3",
            maxContextSize: 128000,
          },
          "another-model": {
            provider: "test-provider",
            model: "claude-3-5-haiku-latest",
            maxContextSize: 200000,
          },
        },
        providers: {
          "test-provider": {
            type: "ollama",
          },
        },
        services: {},
        loopControl: {
          maxStepsPerRun: 100,
          maxRetriesPerStep: 3,
        },
      },
      context: {} as any,
      toolRegistry: {} as any,
      systemPrompt: "test prompt",
    };

    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should accept ModelContext", () => {
      const shell = new InteractiveShell(
        mockExecutor as AgentExecutor,
        modelContext,
      );
      expect(shell).toBeDefined();
    });
  });

  describe("getShortModelName", () => {
    it("should return model name from config", () => {
      const shell = new InteractiveShell(
        mockExecutor as AgentExecutor,
        modelContext,
      );
      const name = (shell as any).getShortModelName();
      expect(name).toBe("phi3");
    });

    it("should return currentModelName if config not found", () => {
      modelContext.currentModelName = "nonexistent-model";
      const shell = new InteractiveShell(
        mockExecutor as AgentExecutor,
        modelContext,
      );
      const name = (shell as any).getShortModelName();
      expect(name).toBe("nonexistent-model");
    });
  });

  describe("getPrompt", () => {
    it("should include model name in prompt", () => {
      const shell = new InteractiveShell(
        mockExecutor as AgentExecutor,
        modelContext,
      );
      const prompt = (shell as any).getPrompt();
      expect(prompt).toContain("phi3");
      expect(prompt).toContain("[5%]"); // 0.05 * 100
    });

    it("should include user name in prompt", () => {
      const shell = new InteractiveShell(
        mockExecutor as AgentExecutor,
        modelContext,
      );
      const prompt = (shell as any).getPrompt();
      expect(prompt).toMatch(/@phi3/);
    });

    it("should show fractional usage for small non-zero context percentages", () => {
      mockExecutor.status = {
        contextUsage: 0.004,
        tokenCount: 512,
        currentStep: 1,
      } as AgentExecutor["status"];

      const shell = new InteractiveShell(
        mockExecutor as AgentExecutor,
        modelContext,
      );

      const prompt = (shell as any).getPrompt();
      expect(prompt).toContain("[0.4%]");
    });
  });

  describe("exit", () => {
    it("should set isClosed and close readline", () => {
      const shell = new InteractiveShell(
        mockExecutor as AgentExecutor,
        modelContext,
      );
      const rlCloseSpy = vi.spyOn((shell as any).rl, "close");

      shell.exit();

      expect((shell as any).isClosed).toBe(true);
      expect(rlCloseSpy).toHaveBeenCalled();
    });
  });

  describe("getModelContext", () => {
    it("should return model context", () => {
      const shell = new InteractiveShell(
        mockExecutor as AgentExecutor,
        modelContext,
      );
      expect(shell.getModelContext()).toBe(modelContext);
    });
  });

  describe("getExecutor", () => {
    it("should return executor", () => {
      const shell = new InteractiveShell(
        mockExecutor as AgentExecutor,
        modelContext,
      );
      expect(shell.getExecutor()).toBe(mockExecutor);
    });
  });

  describe("setExecutor", () => {
    it("should update executor", () => {
      const shell = new InteractiveShell(
        mockExecutor as AgentExecutor,
        modelContext,
      );
      const newExecutor = { ...mockExecutor } as AgentExecutor;

      shell.setExecutor(newExecutor);

      expect(shell.getExecutor()).toBe(newExecutor);
    });
  });
});
