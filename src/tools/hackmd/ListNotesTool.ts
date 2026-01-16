import type { API } from "@hackmd/api";
import type { Note } from "@hackmd/api/dist/type.js";
import { Tool, type ToolResult, type ToolSchema } from "../base/Tool";
import { handleHackMDError } from "./errorHandler";

interface ListNotesParams {
  teamPath?: string; // Optional: if provided, lists team notes
  limit?: number;
  [key: string]: unknown;
}

export class ListNotesTool extends Tool<ListNotesParams> {
  readonly name = "list_notes";
  readonly description =
    "List notes from HackMD. Use teamPath to list team notes.";
  readonly inputSchema: ToolSchema = {
    type: "object",
    properties: {
      teamPath: {
        type: "string",
        description: "Optional: team path or ID to list team notes",
      },
      limit: {
        type: "number",
        description: "Maximum number of notes to return (default: 20)",
      },
    },
  };

  constructor(private hackmdClient: API) {
    super();
  }

  async call(params: ListNotesParams): Promise<ToolResult> {
    const isTeamNotes = Boolean(params.teamPath);

    try {
      const notes = isTeamNotes
        ? await this.hackmdClient.getTeamNotes(params.teamPath!)
        : await this.hackmdClient.getNoteList();

      const limit = params.limit ?? 20;
      const limitedNotes = notes.slice(0, limit);

      const output = limitedNotes
        .map(
          (note: Note, index: number) =>
            `${index + 1}. **${note.title}**\n` +
            `   ID: \`${note.id}\`\n` +
            `   Last changed: ${new Date(note.lastChangedAt).toLocaleString()}\n` +
            `   Link: ${note.publishLink ?? "N/A"}\n`,
        )
        .join("\n");

      const noteType = isTeamNotes ? "team notes" : "notes";
      return this.ok(
        output || `No ${noteType} found.`,
        `Found ${notes.length} ${noteType} (showing ${limitedNotes.length})`,
        `${notes.length} ${noteType}`,
      );
    } catch (error) {
      const noteType = isTeamNotes ? "team notes" : "notes";
      const appError = handleHackMDError(error, `Failed to list ${noteType}`);
      return this.error(
        appError.toUserString(),
        appError.message,
        "List failed",
      );
    }
  }
}
