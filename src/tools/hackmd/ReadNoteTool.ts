import type { API } from "@hackmd/api";
import { Tool, type ToolResult, type ToolSchema } from "../base/Tool.ts";
import { handleHackMDError } from "./errorHandler.ts";
import { rethrowAbortError } from "../../utils/SafeError.ts";
import { withReadRetry } from "./readRetry.ts";

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

  constructor(private hackmdClient: API, private readonly maxRetries = 3) {
    super();
  }

  async call(params: ReadNoteParams, signal?: AbortSignal): Promise<ToolResult> {
    try {
      const note = await withReadRetry(
        () => this.hackmdClient.getNote(params.noteId),
        this.maxRetries,
        signal,
      );

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
      rethrowAbortError(error);
      const appError = handleHackMDError(error, params.noteId);
      return this.error(
        appError.toUserString(),
        appError.message,
        "Read failed",
      );
    }
  }
}
