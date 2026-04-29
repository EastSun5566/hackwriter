import type { API } from "@hackmd/api";
import { Tool, type ToolResult, type ToolSchema } from "../base/Tool.ts";
import type { ApprovalManager } from "../../agent/ApprovalManager.ts";
import { handleHackMDError } from "./errorHandler.ts";
import { withRetry, shouldRetryHttpError } from "../../utils/retry.ts";
import {
  requestMutationApproval,
  validateNoteId,
} from "./mutationUtils.ts";

interface DeleteNoteParams {
  noteId: string;
  teamPath?: string;
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
    const noteIdError = validateNoteId(params.noteId);
    if (noteIdError) {
      return noteIdError;
    }

    const isTeamNote = Boolean(params.teamPath);
    const approvalError = await requestMutationApproval({
      approvalManager: this.approvalManager,
      toolName: this.name,
      teamPath: params.teamPath,
      personalAction: "delete_note",
      teamAction: "delete_team_note",
      personalDescription: `Delete note ${params.noteId}? This action cannot be undone.`,
      teamDescription: `Delete team note ${params.noteId} from team "${params.teamPath}"? This action cannot be undone.`,
      rejectedOutput: "Deletion cancelled by user",
      rejectedMessage: "Deletion cancelled by user",
      rejectedBrief: "Cancelled",
    });

    if (approvalError) {
      return approvalError;
    }

    try {
      await withRetry(
        async () => {
          if (isTeamNote) {
            await this.hackmdClient.deleteTeamNote(params.teamPath!, params.noteId);
          } else {
            await this.hackmdClient.deleteNote(params.noteId);
          }
        },
        {
          maxRetries: 3,
          shouldRetry: shouldRetryHttpError,
        }
      );

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
