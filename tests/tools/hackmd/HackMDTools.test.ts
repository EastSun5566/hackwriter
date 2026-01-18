import { describe, it, expect, beforeEach } from "vitest";
import { NotePermissionRole } from "../../../src/tools/hackmd/CreateNoteTool.ts";

import { ListNotesTool } from "../../../src/tools/hackmd/ListNotesTool.ts";
import { ReadNoteTool } from "../../../src/tools/hackmd/ReadNoteTool.ts";
import { SearchNotesTool } from "../../../src/tools/hackmd/SearchNotesTool.ts";
import { CreateNoteTool } from "../../../src/tools/hackmd/CreateNoteTool.ts";
import { UpdateNoteTool } from "../../../src/tools/hackmd/UpdateNoteTool.ts";
import { DeleteNoteTool } from "../../../src/tools/hackmd/DeleteNoteTool.ts";
import {
  createMockHackMDClient,
  createMockNote,
} from "../../fixtures/mockHackMDClient.ts";
import { createMockApprovalManager } from "../../fixtures/mockApprovalManager.ts";

describe("ListNotesTool", () => {
  let tool: ListNotesTool;
  let mockClient: ReturnType<typeof createMockHackMDClient>;

  beforeEach(() => {
    mockClient = createMockHackMDClient();
    tool = new ListNotesTool(mockClient as any);
  });

  it("should list notes successfully", async () => {
    const mockNotes = [
      createMockNote({ id: "note1", title: "First Note" }),
      createMockNote({ id: "note2", title: "Second Note" }),
    ];

    mockClient.getNoteList.mockResolvedValue(mockNotes);

    const result = await tool.call({});

    expect(result.ok).toBe(true);
    expect(result.output).toContain("First Note");
    expect(result.output).toContain("Second Note");
    expect(result.brief).toBe("2 notes");
    expect(mockClient.getNoteList).toHaveBeenCalledTimes(1);
  });

  it("should handle empty note list", async () => {
    mockClient.getNoteList.mockResolvedValue([]);

    const result = await tool.call({});

    expect(result.ok).toBe(true);
    expect(result.output).toBe("No notes found."); // Now shows message for empty list
    expect(result.message).toBe("Found 0 notes (showing 0)");
    expect(result.brief).toBe("0 notes");
  });

  it("should respect limit parameter", async () => {
    const mockNotes = Array.from({ length: 100 }, (_, i) =>
      createMockNote({ id: `note${i}`, title: `Note ${i}` }),
    );

    mockClient.getNoteList.mockResolvedValue(mockNotes);

    const result = await tool.call({ limit: 10 });

    expect(result.ok).toBe(true);
    expect(result.message).toBe("Found 100 notes (showing 10)");
    // Count numbered items in output
    const numberedLines = result.output
      .split("\n")
      .filter((l) => l.match(/^\d+\./));
    expect(numberedLines.length).toBe(10);
  });

  it("should handle API errors", async () => {
    mockClient.getNoteList.mockRejectedValue(new Error("API Error"));

    const result = await tool.call({});

    expect(result.ok).toBe(false);
    expect(result.message).toContain("Failed to list notes");
    expect(result.message).toContain("API Error");
  });
});

describe("ReadNoteTool", () => {
  let tool: ReadNoteTool;
  let mockClient: ReturnType<typeof createMockHackMDClient>;

  beforeEach(() => {
    mockClient = createMockHackMDClient();
    tool = new ReadNoteTool(mockClient as any);
  });

  it("should read note successfully", async () => {
    const mockNote = createMockNote({
      id: "test-note",
      title: "Test Note",
      content: "# Hello World\n\nTest content",
    });

    mockClient.getNote.mockResolvedValue(mockNote);

    const result = await tool.call({ noteId: "test-note" });

    expect(result.ok).toBe(true);
    expect(result.output).toContain("Test Note");
    expect(result.output).toContain("# Hello World");
    expect(result.brief).toBe("Test Note");
    expect(mockClient.getNote).toHaveBeenCalledWith("test-note");
  });

  it("should handle 404 errors with helpful message", async () => {
    const error = new Error("Request failed with status code 404");
    mockClient.getNote.mockRejectedValue(error);

    const result = await tool.call({ noteId: "non-existent" });

    expect(result.ok).toBe(false);
    // New error format uses structured errors
    expect(result.message).toContain("Note not found");
    expect(result.brief).toBe("Read failed");
  });

  it("should handle other errors", async () => {
    mockClient.getNote.mockRejectedValue(new Error("Network error"));

    const result = await tool.call({ noteId: "test-note" });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("Network error");
  });
});

describe("SearchNotesTool", () => {
  let tool: SearchNotesTool;
  let mockClient: ReturnType<typeof createMockHackMDClient>;

  beforeEach(() => {
    mockClient = createMockHackMDClient();
    tool = new SearchNotesTool(mockClient as any);
  });

  it("should search notes by title", async () => {
    const mockNotes = [
      createMockNote({ id: "note1", title: "Alien Research" }),
      createMockNote({ id: "note2", title: "Some Aliens Found" }),
      createMockNote({ id: "note3", title: "Unrelated Note" }),
    ];

    mockClient.getNoteList.mockResolvedValue(mockNotes);

    const result = await tool.call({ query: "alien" });

    expect(result.ok).toBe(true);
    expect(result.output).toContain("Alien Research");
    expect(result.output).toContain("Some Aliens Found");
    expect(result.output).not.toContain("Unrelated Note");
    expect(result.brief).toBe("2 results");
  });

  it("should search notes by tags", async () => {
    const mockNotes = [
      createMockNote({
        id: "note1",
        title: "Note 1",
        tags: ["research", "science"],
      }),
      createMockNote({
        id: "note2",
        title: "Note 2",
        tags: ["science", "physics"],
      }),
      createMockNote({ id: "note3", title: "Note 3", tags: ["music"] }),
    ];

    mockClient.getNoteList.mockResolvedValue(mockNotes);

    const result = await tool.call({ query: "science" });

    expect(result.ok).toBe(true);
    expect(result.output).toContain("Note 1");
    expect(result.output).toContain("Note 2");
    expect(result.output).not.toContain("Note 3");
  });

  it("should return no results message when nothing matches", async () => {
    const mockNotes = [
      createMockNote({ title: "Note 1" }),
      createMockNote({ title: "Note 2" }),
    ];

    mockClient.getNoteList.mockResolvedValue(mockNotes);

    const result = await tool.call({ query: "nonexistent" });

    expect(result.ok).toBe(true);
    expect(result.output).toContain("No notes found matching");
    expect(result.brief).toBe("No results");
  });

  it("should respect limit parameter", async () => {
    const mockNotes = Array.from({ length: 50 }, (_, i) =>
      createMockNote({ id: `note${i}`, title: `Test Note ${i}` }),
    );

    mockClient.getNoteList.mockResolvedValue(mockNotes);

    const result = await tool.call({ query: "test", limit: 5 });

    expect(result.ok).toBe(true);
    const numberedLines = result.output
      .split("\n")
      .filter((l) => l.match(/^\d+\./));
    expect(numberedLines.length).toBe(5);
  });

  it("should be case-insensitive", async () => {
    const mockNotes = [
      createMockNote({ title: "UPPER CASE NOTE" }),
      createMockNote({ title: "lower case note" }),
      createMockNote({ title: "MiXeD CaSe NoTe" }),
    ];

    mockClient.getNoteList.mockResolvedValue(mockNotes);

    const result = await tool.call({ query: "NOTE" });

    expect(result.ok).toBe(true);
    const numberedLines = result.output
      .split("\n")
      .filter((l) => l.match(/^\d+\./));
    expect(numberedLines.length).toBe(3);
  });
});

describe("CreateNoteTool", () => {
  let tool: CreateNoteTool;
  let mockClient: ReturnType<typeof createMockHackMDClient>;
  let mockApproval: ReturnType<typeof createMockApprovalManager>;

  beforeEach(() => {
    mockClient = createMockHackMDClient();
    mockApproval = createMockApprovalManager(true);
    tool = new CreateNoteTool(mockClient as any, mockApproval as any);
  });

  it("should create note successfully when approved", async () => {
    const mockNote = createMockNote({
      id: "new-note",
      title: "New Note",
      content: "# New Content",
    });

    mockClient.createNote.mockResolvedValue(mockNote);

    const result = await tool.call({
      title: "New Note",
      content: "# New Content",
    });

    expect(mockApproval.request).toHaveBeenCalledWith(
      "create_note",
      "create_note", // Changed from 'create_hackmd_note' after tool merge
      expect.stringContaining("New Note"),
    );
    expect(mockClient.createNote).toHaveBeenCalledWith({
      title: "New Note",
      content: "# New Content",
      readPermission: "owner",
      writePermission: "owner",
    });
    expect(result.ok).toBe(true);
    expect(result.output).toContain("New Note");
    expect(result.output).toContain("new-note");
  });

  it("should reject when user denies approval", async () => {
    mockApproval.request.mockResolvedValue(false);

    const result = await tool.call({
      title: "New Note",
      content: "# Content",
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("rejected");
    expect(mockClient.createNote).not.toHaveBeenCalled();
  });

  it("should use custom permissions", async () => {
    const mockNote = createMockNote();
    mockClient.createNote.mockResolvedValue(mockNote);

    await tool.call({
      title: "Public Note",
      content: "# Content",
      readPermission: NotePermissionRole.GUEST,
      writePermission: NotePermissionRole.SIGNED_IN,
    });

    expect(mockClient.createNote).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Public Note",
        content: "# Content",
        readPermission: "guest",
        writePermission: "signed_in",
      }),
    );
  });

  it("should handle creation errors", async () => {
    mockClient.createNote.mockRejectedValue(new Error("Permission denied"));

    const result = await tool.call({
      title: "Note",
      content: "# Content",
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("Permission denied");
  });

  it("should create team note with teamPath parameter", async () => {
    const mockNote = createMockNote({
      id: "team-note",
      title: "Team Note",
    });

    mockClient.createTeamNote.mockResolvedValue(mockNote);

    const result = await tool.call({
      title: "Team Note",
      content: "# Team Content",
      teamPath: "engineering",
    });

    expect(mockApproval.request).toHaveBeenCalledWith(
      "create_note",
      "create_team_note",
      expect.stringContaining("engineering"),
    );
    expect(mockClient.createTeamNote).toHaveBeenCalledWith("engineering", {
      title: "Team Note",
      content: "# Team Content",
      readPermission: "owner",
      writePermission: "owner",
    });
    expect(result.ok).toBe(true);
    expect(result.output).toContain("Team note created");
    expect(result.output).toContain("engineering");
  });
});

describe("UpdateNoteTool", () => {
  let tool: UpdateNoteTool;
  let mockClient: ReturnType<typeof createMockHackMDClient>;
  let mockApproval: ReturnType<typeof createMockApprovalManager>;

  beforeEach(() => {
    mockClient = createMockHackMDClient();
    mockApproval = createMockApprovalManager(true);
    tool = new UpdateNoteTool(mockClient as any, mockApproval as any);
  });

  it("should update personal note successfully when approved", async () => {
    mockClient.updateNote.mockResolvedValue(undefined);

    const result = await tool.call({
      noteId: "note123",
      content: "# Updated Content",
    });

    expect(mockApproval.request).toHaveBeenCalledWith(
      "update_note",
      "update_note",
      expect.stringContaining("note123"),
    );
    expect(mockClient.updateNote).toHaveBeenCalledWith("note123", {
      content: "# Updated Content",
    });
    expect(result.ok).toBe(true);
    expect(result.output).toContain("note123");
  });

  it("should update team note successfully with teamPath", async () => {
    mockClient.updateTeamNote.mockResolvedValue(undefined);

    const result = await tool.call({
      noteId: "team-note-456",
      content: "# Updated Team Content",
      teamPath: "my-team",
    });

    expect(mockApproval.request).toHaveBeenCalledWith(
      "update_note",
      "update_team_note",
      expect.stringContaining("my-team"),
    );
    expect(mockClient.updateTeamNote).toHaveBeenCalledWith(
      "my-team",
      "team-note-456",
      { content: "# Updated Team Content" },
    );
    expect(result.ok).toBe(true);
    expect(result.output).toContain("Team note updated");
    expect(result.output).toContain("my-team");
  });

  it("should reject when user denies approval", async () => {
    mockApproval.request.mockResolvedValue(false);

    const result = await tool.call({
      noteId: "note123",
      content: "# Content",
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("rejected");
    expect(mockClient.updateNote).not.toHaveBeenCalled();
  });

  it("should handle update errors with 404", async () => {
    mockClient.updateNote.mockRejectedValue(
      new Error("Request failed with status code 404"),
    );

    const result = await tool.call({
      noteId: "non-existent",
      content: "# Content",
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("Note not found");
  });
});

describe("DeleteNoteTool", () => {
  let tool: DeleteNoteTool;
  let mockClient: ReturnType<typeof createMockHackMDClient>;
  let mockApproval: ReturnType<typeof createMockApprovalManager>;

  beforeEach(() => {
    mockClient = createMockHackMDClient();
    mockApproval = createMockApprovalManager(true);
    tool = new DeleteNoteTool(mockClient as any, mockApproval as any);
  });

  it("should delete personal note successfully when approved", async () => {
    mockClient.deleteNote.mockResolvedValue(undefined);

    const result = await tool.call({
      noteId: "note-to-delete",
    });

    expect(mockApproval.request).toHaveBeenCalledWith(
      "delete_note",
      "delete_note",
      expect.stringContaining("note-to-delete"),
    );
    expect(mockClient.deleteNote).toHaveBeenCalledWith("note-to-delete");
    expect(result.ok).toBe(true);
    expect(result.output).toContain("deleted successfully");
  });

  it("should delete team note successfully with teamPath", async () => {
    mockClient.deleteTeamNote.mockResolvedValue(undefined);

    const result = await tool.call({
      noteId: "team-note-789",
      teamPath: "work-team",
    });

    expect(mockApproval.request).toHaveBeenCalledWith(
      "delete_note",
      "delete_team_note",
      expect.stringContaining("work-team"),
    );
    expect(mockClient.deleteTeamNote).toHaveBeenCalledWith(
      "work-team",
      "team-note-789",
    );
    expect(result.ok).toBe(true);
    expect(result.output).toContain("Team note deleted");
    expect(result.output).toContain("work-team");
  });

  it("should reject when user denies approval", async () => {
    mockApproval.request.mockResolvedValue(false);

    const result = await tool.call({
      noteId: "note123",
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("cancelled");
    expect(mockClient.deleteNote).not.toHaveBeenCalled();
  });

  it("should handle deletion errors with 403", async () => {
    mockClient.deleteNote.mockRejectedValue(
      new Error("Request failed with status code 403"),
    );

    const result = await tool.call({
      noteId: "protected-note",
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("Permission denied");
  });
});
