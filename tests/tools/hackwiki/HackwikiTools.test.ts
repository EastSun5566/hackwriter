import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Wiki, WikiSession } from "hackwiki";
import {
  WikiCreatePageTool,
  WikiReadPageTool,
  WikiReadPagesTool,
  WikiSearchIndexTool,
  WikiStartSessionTool,
  WikiUpdatePageTool,
  createLocalHackwikiTools,
} from "../../../src/tools/hackwiki/LocalHackwikiTools.ts";
import { createMockApprovalManager } from "../../fixtures/mockApprovalManager.ts";

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

describe("Hackwiki tools", () => {
  let mockWiki: ReturnType<typeof createMockWiki>;
  let mockApproval: ReturnType<typeof createMockApprovalManager>;

  beforeEach(() => {
    mockWiki = createMockWiki();
    mockApproval = createMockApprovalManager(true);
  });

  it("creates the expected local hackwiki tool set", () => {
    const tools = createLocalHackwikiTools(mockWiki as unknown as Wiki, mockApproval as never);

    expect(tools.map((tool) => tool.name)).toEqual([
      "wiki_start_session",
      "wiki_search_index",
      "wiki_read_page",
      "wiki_read_pages",
      "wiki_create_page",
      "wiki_update_page",
    ]);
  });

  it("can create a read-only local hackwiki tool set", () => {
    const tools = createLocalHackwikiTools(
      mockWiki as unknown as Wiki,
      mockApproval as never,
      { includeWriteTools: false },
    );

    expect(tools.map((tool) => tool.name)).toEqual([
      "wiki_start_session",
      "wiki_search_index",
      "wiki_read_page",
      "wiki_read_pages",
    ]);
  });

  it("loads the current wiki session summary", async () => {
    const tool = new WikiStartSessionTool(mockWiki as unknown as Wiki);
    const session: WikiSession = {
      schema: "# Schema\n\nProject facts",
      index: [
        {
          noteId: "note-1",
          type: "concept",
          title: "RAG",
          summary: "Retrieval-Augmented Generation",
        },
      ],
      recentLog: ["## [2026-04-18] create | RAG"],
    };
    mockWiki.startSession.mockResolvedValue(session);

    const result = await tool.call({});

    expect(result.ok).toBe(true);
    expect(result.output).toContain("Indexed pages (1):");
    expect(result.output).toContain("RAG");
    expect(result.json).toEqual(session);
  });

  it("searches wiki index entries", async () => {
    const tool = new WikiSearchIndexTool(mockWiki as unknown as Wiki);
    mockWiki.searchIndex.mockResolvedValue([
      {
        noteId: "note-1",
        type: "concept",
        title: "RAG",
        summary: "Retrieval-Augmented Generation",
      },
      {
        noteId: "note-2",
        type: "entity",
        title: "HackMD",
        summary: "Collaborative markdown workspace",
      },
    ]);

    const result = await tool.call({ query: "ra", limit: 1 });

    expect(mockWiki.searchIndex).toHaveBeenCalledWith("ra");
    expect(result.ok).toBe(true);
    expect(result.output).toContain("RAG");
    expect(result.output).not.toContain("HackMD");
    expect(result.brief).toBe("RAG");
  });

  it("reads a single wiki page by noteId", async () => {
    const tool = new WikiReadPageTool(mockWiki as unknown as Wiki);
    mockWiki.readPage.mockResolvedValue("# RAG\n\nGrounding by retrieval");

    const result = await tool.call({ noteId: "note-1" });

    expect(mockWiki.readPage).toHaveBeenCalledWith("note-1");
    expect(result.ok).toBe(true);
    expect(result.output).toContain("Grounding by retrieval");
    expect(result.json).toEqual({
      noteId: "note-1",
      content: "# RAG\n\nGrounding by retrieval",
    });
  });

  it("reads multiple wiki pages in one call", async () => {
    const tool = new WikiReadPagesTool(mockWiki as unknown as Wiki);
    mockWiki.readPages.mockResolvedValue(
      new Map([
        ["note-1", "# Alpha"],
        ["note-2", "# Beta"],
      ]),
    );

    const result = await tool.call({ noteIds: ["note-1", "note-2"] });

    expect(mockWiki.readPages).toHaveBeenCalledWith(["note-1", "note-2"]);
    expect(result.ok).toBe(true);
    expect(result.output).toContain("## `note-1`");
    expect(result.output).toContain("# Beta");
    expect(result.brief).toBe("2 pages");
  });

  it("creates a wiki page after approval", async () => {
    const tool = new WikiCreatePageTool(
      mockWiki as unknown as Wiki,
      mockApproval as never,
    );
    mockWiki.createPage.mockResolvedValue({
      noteId: "note-1",
      indexSize: 3,
    });

    const result = await tool.call({
      type: "concept",
      title: "RAG",
      content: "# RAG\n\nGrounding by retrieval",
      summary: "Retrieval-Augmented Generation",
    });

    expect(mockApproval.request).toHaveBeenCalledWith(
      "wiki_create_page",
      "wiki_create_page",
      expect.stringContaining("RAG"),
    );
    expect(mockWiki.createPage).toHaveBeenCalledWith(
      "concept",
      "RAG",
      "# RAG\n\nGrounding by retrieval",
      "Retrieval-Augmented Generation",
    );
    expect(result.ok).toBe(true);
    expect(result.output).toContain("Wiki page created successfully");
    expect(result.output).toContain("note-1");
  });

  it("does not create a wiki page when approval is denied", async () => {
    mockApproval.request.mockResolvedValue(false);
    const tool = new WikiCreatePageTool(
      mockWiki as unknown as Wiki,
      mockApproval as never,
    );

    const result = await tool.call({
      type: "concept",
      title: "RAG",
      content: "# RAG",
      summary: "Retrieval-Augmented Generation",
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("rejected");
    expect(mockWiki.createPage).not.toHaveBeenCalled();
  });

  it("updates a wiki page after approval", async () => {
    const tool = new WikiUpdatePageTool(
      mockWiki as unknown as Wiki,
      mockApproval as never,
    );
    mockWiki.updatePage.mockResolvedValue(undefined);

    const result = await tool.call({
      noteId: "note-1",
      content: "# RAG\n\nUpdated content",
      title: "RAG",
    });

    expect(mockApproval.request).toHaveBeenCalledWith(
      "wiki_update_page",
      "wiki_update_page",
      expect.stringContaining("RAG (note-1)"),
    );
    expect(mockWiki.updatePage).toHaveBeenCalledWith(
      "note-1",
      "# RAG\n\nUpdated content",
    );
    expect(result.ok).toBe(true);
    expect(result.output).toContain("Wiki page updated successfully");
  });
});
