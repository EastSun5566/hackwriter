import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../../src/agent/SystemPrompt.js";

describe("SystemPrompt", () => {
  it("omits the wiki section when no wiki memory context is provided", () => {
    const prompt = buildSystemPrompt({
      workDir: "/tmp/hackwriter",
    });

    expect(prompt).toContain("Working directory: /tmp/hackwriter");
    expect(prompt).not.toContain("Durable wiki memory context:");
  });

  it("appends durable wiki memory context when provided", () => {
    const prompt = buildSystemPrompt({
      workDir: "/tmp/hackwriter",
      wikiMemoryContext: "Schema: # Personal wiki\nIndexed pages (1):\n  - [concept] RAG — retrieval",
    });

    expect(prompt).toContain("Durable wiki memory context:");
    expect(prompt).toContain("Schema: # Personal wiki");
    expect(prompt).toContain("[concept] RAG — retrieval");
  });

  it("switches to semantic wiki tool guidance in wiki mode", () => {
    const prompt = buildSystemPrompt({
      workDir: "/tmp/hackwriter",
      wikiToolsEnabled: true,
    });

    expect(prompt).toContain("wiki_search_index");
    expect(prompt).not.toContain("wiki_create_page");
    expect(prompt).toContain("Focus on answering the user first; durable wiki writes happen after the response is complete");
    expect(prompt).toContain("without another approval prompt");
    expect(prompt).not.toContain("list_notes, read_note, create_note");
  });
});
