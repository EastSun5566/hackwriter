import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWiki, type WikiSession } from "hackwiki";
import {
  createHackwikiRuntime,
  formatWikiMemoryContext,
} from "../../../src/tools/hackwiki/HackwikiRuntime.js";

vi.mock("hackwiki", () => ({
  createWiki: vi.fn(),
}));

describe("HackwikiRuntime", () => {
  const createWikiMock = vi.mocked(createWiki);

  beforeEach(() => {
    createWikiMock.mockReset();
  });

  it("returns undefined when hackwiki startup memory is disabled", () => {
    const runtime = createHackwikiRuntime(
      {
        apiToken: "hackmd-token",
      },
      undefined,
    );

    expect(runtime).toBeUndefined();
    expect(createWikiMock).not.toHaveBeenCalled();
  });

  it("creates a runtime and loads prompt context from the startup session", async () => {
    const session: WikiSession = {
      schema: "# Personal Wiki\n\nDurable facts live here.",
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

    const wiki = {
      startSession: vi.fn().mockResolvedValue(session),
    };
    createWikiMock.mockReturnValue(wiki as never);

    const runtime = createHackwikiRuntime(
      {
        apiToken: "hackmd-token",
        apiBaseUrl: "https://api.hackmd.example/v1",
      },
      {
        enabled: true,
        initialSchema: "# Custom Wiki Schema",
      },
    );

    expect(runtime).toBeDefined();
    expect(createWikiMock).toHaveBeenCalledWith({
      token: "hackmd-token",
      initialSchema: "# Custom Wiki Schema",
      apiUrl: "https://api.hackmd.example/v1",
    });

    await expect(runtime?.loadPromptContext()).resolves.toContain(
      "Indexed pages (1):",
    );
    expect(wiki.startSession).toHaveBeenCalledTimes(1);
  });

  it("formats a compact wiki memory summary", () => {
    const summary = formatWikiMemoryContext({
      schema: "# Wiki\n\nThis project prefers terse summaries.",
      index: [
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
          summary: "Collaborative markdown editor",
        },
      ],
      recentLog: [
        "## [2026-04-17] create | RAG",
        "## [2026-04-18] update | note-1",
      ],
    });

    expect(summary).toContain("Schema: # Wiki This project prefers terse summaries.");
    expect(summary).toContain("Indexed pages (2):");
    expect(summary).toContain("[concept] RAG — Retrieval-Augmented Generation");
    expect(summary).toContain("Recent activity:");
    expect(summary).toContain("update | note-1");
  });
});
