import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "@mariozechner/pi-ai";
import type { Wiki } from "hackwiki";
import { HackwikiPostTurnMemoryWriter } from "../../../src/tools/hackwiki/PostTurnMemoryWriter.js";
import { createMockApprovalManager } from "../../fixtures/mockApprovalManager.ts";

const { completeMock, buildLanguageModelMock } = vi.hoisted(() => ({
  completeMock: vi.fn(),
  buildLanguageModelMock: vi.fn(() => ({ id: "test-model" })),
}));

vi.mock("@mariozechner/pi-ai", () => ({
  complete: completeMock,
}));

vi.mock("../../../src/agent/ModelFactory.js", () => ({
  buildLanguageModel: buildLanguageModelMock,
}));

function createMockWiki() {
  return {
    startSession: vi.fn(),
    createPage: vi.fn(),
    updatePage: vi.fn(),
    readPage: vi.fn(),
    readPages: vi.fn(),
    searchIndex: vi.fn(),
    lint: vi.fn(),
  } satisfies Record<keyof Wiki, ReturnType<typeof vi.fn>>;
}

function createAssistantMessage(text: string): Message {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    timestamp: Date.now(),
  };
}

describe("HackwikiPostTurnMemoryWriter", () => {
  let mockWiki: ReturnType<typeof createMockWiki>;
  let mockApproval: ReturnType<typeof createMockApprovalManager>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockWiki = createMockWiki();
    mockApproval = createMockApprovalManager(true);
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    completeMock.mockReset();
    buildLanguageModelMock.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates a new wiki page after the answer completes", async () => {
    completeMock.mockResolvedValue(
      createAssistantMessage(
        JSON.stringify({
          shouldPersist: true,
          type: "concept",
          title: "RAG",
          summary: "Retrieval-Augmented Generation",
          content: "# RAG\n\nGrounding by retrieval.",
        }),
      ),
    );
    mockWiki.searchIndex.mockResolvedValue([]);
    mockWiki.createPage.mockResolvedValue({ noteId: "note-1", indexSize: 3 });

    const writer = new HackwikiPostTurnMemoryWriter(
      mockWiki as unknown as Wiki,
      mockApproval as never,
    );

    await writer.maybePersistTurn({
      currentModelName: "test-model",
      config: {
        defaultModel: "test-model",
        models: {
          "test-model": {
            provider: "test-provider",
            model: "phi3",
            maxContextSize: 128000,
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
      userInput: "Explain RAG",
      messages: [createAssistantMessage("RAG helps with grounding.")],
    });

    expect(buildLanguageModelMock).toHaveBeenCalled();
    expect(mockWiki.searchIndex).toHaveBeenCalledWith("RAG");
    expect(mockWiki.createPage).toHaveBeenCalledWith(
      "concept",
      "RAG",
      "# RAG\n\nGrounding by retrieval.",
      "Retrieval-Augmented Generation",
    );
    expect(mockApproval.request).not.toHaveBeenCalled();
    expect(mockWiki.updatePage).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Auto-saved wiki memory (created): RAG · note-1"),
    );
  });

  it("updates an existing wiki page when the title already exists", async () => {
    completeMock.mockResolvedValue(
      createAssistantMessage(
        JSON.stringify({
          shouldPersist: true,
          type: "concept",
          title: "RAG",
          summary: "Retrieval-Augmented Generation",
          content: "# RAG\n\nNew grounding notes.",
        }),
      ),
    );
    mockWiki.searchIndex.mockResolvedValue([
      {
        noteId: "note-1",
        type: "concept",
        title: "RAG",
        summary: "Retrieval-Augmented Generation",
      },
    ]);
    mockWiki.readPage.mockResolvedValue("# RAG\n\nExisting content.");
    mockWiki.updatePage.mockResolvedValue(undefined);

    const writer = new HackwikiPostTurnMemoryWriter(
      mockWiki as unknown as Wiki,
      mockApproval as never,
    );

    await writer.maybePersistTurn({
      currentModelName: "test-model",
      config: {
        defaultModel: "test-model",
        models: {
          "test-model": {
            provider: "test-provider",
            model: "phi3",
            maxContextSize: 128000,
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
      userInput: "Explain RAG",
      messages: [createAssistantMessage("RAG helps with grounding.")],
    });

    expect(mockWiki.createPage).not.toHaveBeenCalled();
    expect(mockWiki.updatePage).toHaveBeenCalledWith(
      "note-1",
      expect.stringContaining("## Update ("),
    );
    expect(mockApproval.request).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Auto-saved wiki memory (updated): RAG · note-1"),
    );
  });

  it("skips persistence when the answer is not worth saving", async () => {
    completeMock.mockResolvedValue(
      createAssistantMessage(
        JSON.stringify({
          shouldPersist: false,
          type: null,
          title: null,
          summary: null,
          content: null,
        }),
      ),
    );

    const writer = new HackwikiPostTurnMemoryWriter(
      mockWiki as unknown as Wiki,
      mockApproval as never,
    );

    await writer.maybePersistTurn({
      currentModelName: "test-model",
      config: {
        defaultModel: "test-model",
        models: {
          "test-model": {
            provider: "test-provider",
            model: "phi3",
            maxContextSize: 128000,
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
      userInput: "Say hi",
      messages: [createAssistantMessage("Hi there!")],
    });

    expect(mockWiki.searchIndex).not.toHaveBeenCalled();
    expect(mockWiki.createPage).not.toHaveBeenCalled();
    expect(mockWiki.updatePage).not.toHaveBeenCalled();
    expect(mockApproval.request).not.toHaveBeenCalled();
    expect(consoleSpy).not.toHaveBeenCalled();
  });
});