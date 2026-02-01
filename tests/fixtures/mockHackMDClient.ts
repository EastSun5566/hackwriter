import { vi } from "vitest";

export function createMockHackMDClient() {
  return {
    getNoteList: vi.fn(),
    getNote: vi.fn(),
    createNote: vi.fn(),
    updateNote: vi.fn(),
    updateNoteContent: vi.fn(),
    deleteNote: vi.fn(),
    getTeamNotes: vi.fn(),
    createTeamNote: vi.fn(),
    updateTeamNote: vi.fn(),
    updateTeamNoteContent: vi.fn(),
    deleteTeamNote: vi.fn(),
    getMe: vi.fn(),
    getTeams: vi.fn(),
    getHistory: vi.fn(),
  };
}

export function createMockNote(overrides: Partial<any> = {}) {
  return {
    id: "test-note-id",
    title: "Test Note",
    content: "# Test Content\n\nThis is a test note.",
    lastChangedAt: "2025-01-15T10:00:00Z",
    publishLink: "https://hackmd.io/@user/test-note-id",
    userPath: "user123",
    teamPath: null,
    readPermission: "owner" as const,
    writePermission: "owner" as const,
    commentPermission: "disabled" as const,
    tags: [],
    ...overrides,
  };
}
