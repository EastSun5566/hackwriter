import type { API } from "@hackmd/api";
import { Tool, type ToolResult, type ToolSchema } from "../base/Tool";
import { handleHackMDError } from "./errorHandler";

interface ReadNoteParams {
  noteId: string;
  [key: string]: unknown;
}

export class ReadNoteTool extends Tool<ReadNoteParams> {
  readonly name = "read_note";
  readonly description =
    "Read the full content of a specific HackMD note by its ID. You must provide the noteId.";
  readonly inputSchema: ToolSchema = {
    type: "object",
    properties: {
      noteId: {
        type: "string",
        description:
          "The ID of the note to read (required). This is the note ID from list_notes or search_notes results.",
      },
    },
    required: ["noteId"],
  };

  constructor(private hackmdClient: API) {
    super();
  }

  async call(params: ReadNoteParams): Promise<ToolResult> {
    try {
      const note = await this.hackmdClient.getNote(params.noteId);

      const output =
        `**${note.title}**\n\n` +
        `${note.content}\n\n` +
        `---\n` +
        `Last changed: ${new Date(note.lastChangedAt).toLocaleString()}`;

      return this.ok(
        output,
        `Successfully read note: ${note.title}`,
        note.title,
      );
    } catch (error) {
      const appError = handleHackMDError(error, params.noteId);
      return this.error(
        appError.toUserString(),
        appError.message,
        "Read failed",
      );
    }
  }
}
