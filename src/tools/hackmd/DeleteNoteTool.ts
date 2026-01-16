import type { API } from "@hackmd/api";
import { Tool, type ToolResult, type ToolSchema } from "../base/Tool.js";
import type { ApprovalManager } from "../../agent/ApprovalManager.js";
import { handleHackMDError } from "./errorHandler.js";

interface DeleteNoteParams {
  noteId: string;
  teamPath?: string; // Optional: if provided, deletes a team note
  [key: string]: unknown;
}

export class DeleteNoteTool extends Tool<DeleteNoteParams> {
  readonly name = "delete_note";
  readonly description =
    "Delete a HackMD note (requires confirmation). Use teamPath for team notes.";
  readonly inputSchema: ToolSchema = {
    type: "object",
    properties: {
      noteId: {
        type: "string",
        description: "The ID of the note to delete",
      },
      teamPath: {
        type: "string",
        description: "Optional: team path or ID for team notes",
      },
    },
    required: ["noteId"],
  };

  constructor(
    private hackmdClient: API,
    private approvalManager: ApprovalManager,
  ) {
    super();
  }

  async call(params: DeleteNoteParams): Promise<ToolResult> {
    const isTeamNote = Boolean(params.teamPath);
    const actionDesc = isTeamNote
      ? `Delete team note ${params.noteId} from team "${params.teamPath}"? This action cannot be undone.`
      : `Delete note ${params.noteId}? This action cannot be undone.`;

    const approved = await this.approvalManager.request(
      this.name,
      isTeamNote ? "delete_team_note" : "delete_note",
      actionDesc,
    );

    if (!approved) {
      return this.error(
        "Deletion cancelled by user",
        "Deletion cancelled by user",
        "Cancelled",
      );
    }

    try {
      if (isTeamNote) {
        await this.hackmdClient.deleteTeamNote(params.teamPath!, params.noteId);
      } else {
        await this.hackmdClient.deleteNote(params.noteId);
      }

      const output = isTeamNote
        ? `✅ Team note deleted successfully\n**ID:** \`${params.noteId}\`\n**Team:** ${params.teamPath}`
        : `✅ Note deleted successfully\n**ID:** \`${params.noteId}\``;

      return this.ok(
        output,
        `${isTeamNote ? "Team note" : "Note"} deleted`,
        "Deleted",
      );
    } catch (error) {
      const appError = handleHackMDError(
        error,
        `Failed to delete ${isTeamNote ? "team " : ""}note`,
      );
      return this.error(
        appError.toUserString(),
        appError.message,
        "Deletion failed",
      );
    }
  }
}
