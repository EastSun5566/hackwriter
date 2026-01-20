import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CommandRegistry } from "../../../src/ui/shell/CommandRegistry.js";
import type { InteractiveShell } from "../../../src/ui/shell/InteractiveShell.js";

// Mock ModelFactory
vi.mock("../../../src/agent/ModelFactory.js", () => ({
  buildLanguageModel: vi.fn(() => ({}) as any),
}));

// Mock ConfigurationLoader
vi.mock("../../../src/config/ConfigurationLoader.js", () => ({
  ConfigurationLoader: {
    save: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock AgentExecutor as a class
vi.mock("../../../src/agent/AgentExecutor.js", () => ({
  AgentExecutor: vi.fn().mockImplementation(() => ({
    status: {
      contextUsage: 0,
      tokenCount: 0,
      currentStep: 0,
      isHalted: false,
      haltReason: null,
    },
  })),
}));

describe("CommandRegistry", () => {
  let mockShell: Partial<InteractiveShell>;
  let mockConfig: any;
  let registry: CommandRegistry;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockConfig = {
      models: {
        model1: {
          provider: "provider1",
          model: "phi3",
          maxContextSize: 128000,
        },
        model2: {
          provider: "provider1",
          model: "claude-3-5-haiku-latest",
          maxContextSize: 200000,
        },
      },
      providers: {
        provider1: {
          type: "ollama",
          baseUrl: "http://localhost:11434/api",
        },
      },
      loopControl: {
        maxStepsPerRun: 100,
        maxRetriesPerStep: 3,
      },
    };

    mockShell = {
      getExecutor: vi.fn(
        () =>
          ({
            status: {
              contextUsage: 0.1,
              tokenCount: 500,
              currentStep: 2,
              isHalted: false,
              haltReason: null,
            },
          }) as any,
      ),
      getModelContext: vi.fn(() => ({
        currentModelName: "model1",
        config: mockConfig,
        context: {
          getHistory: vi.fn(() => []),
          addMessage: vi.fn(),
          tokenCount: 100,
        } as any,
        toolRegistry: {
          getTool: vi.fn(),
          getAllTools: vi.fn(() => []),
        } as any,
        systemPrompt: "test",
      })),
      setExecutor: vi.fn(),
      exit: vi.fn(),
    } as Partial<InteractiveShell>;

    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    registry = new CommandRegistry(mockShell as InteractiveShell);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("/model command", () => {
    it("should list models when no args", async () => {
      await registry.execute("model");

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Available Models"),
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("model1"),
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("model2"),
      );
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("phi3"));
    });

    it("should show current model with marker", async () => {
      await registry.execute("model");

      // Should show marker (●) for current model
      const calls = consoleSpy.mock.calls;
      const model1Line = calls.find((call: any[]) =>
        call[0]?.includes("model1"),
      );
      expect(model1Line).toBeDefined();
      expect(model1Line![0]).toContain("●"); // Current model marker
    });

    it("should switch to valid model", async () => {
      await registry.execute("model model2");

      // Verify success message was shown
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Switched"),
      );
    });

    it("should show error for invalid model", async () => {
      await registry.execute("model invalid");

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("not found"),
      );
      expect(mockShell.setExecutor).not.toHaveBeenCalled();
    });

    it("should work with /m alias", async () => {
      await registry.execute("m");

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Available Models"),
      );
    });
  });

  describe("/exit command", () => {
    it("should call shell.exit()", async () => {
      await registry.execute("exit");
      expect(mockShell.exit).toHaveBeenCalled();
    });

    it("should work with /quit alias", async () => {
      await registry.execute("quit");
      expect(mockShell.exit).toHaveBeenCalled();
    });

    it("should work with /q alias", async () => {
      await registry.execute("q");
      expect(mockShell.exit).toHaveBeenCalled();
    });
  });

  describe("/status command", () => {
    it("should show current status", async () => {
      await registry.execute("status");

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Status"),
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("10.0%"), // 0.1 * 100
      );
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("500"));
    });

    it("should work with /s alias", async () => {
      await registry.execute("s");

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Status"),
      );
    });
  });

  describe("/help command", () => {
    it("should show help", async () => {
      await registry.execute("help");

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Available Commands"),
      );
    });

    it("should list all commands", async () => {
      await registry.execute("help");

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("/help"));
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("/status"),
      );
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("/exit"));
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("/model"),
      );
    });
  });

  describe("/clear command", () => {
    it("should clear the screen", async () => {
      const clearSpy = vi.spyOn(console, "clear").mockImplementation(() => {});

      await registry.execute("clear");

      expect(clearSpy).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Screen cleared"),
      );
    });
  });

  describe("unknown command", () => {
    it("should show error for unknown command", async () => {
      await registry.execute("unknown");

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Unknown command"),
      );
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("/help"));
    });
  });
});
