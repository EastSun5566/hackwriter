import type { API } from "@hackmd/api";
import { Tool, type ToolResult, type ToolSchema } from "../base/Tool.js";
import type { ApprovalManager } from "../../agent/ApprovalManager.js";
import { handleHackMDError } from "./errorHandler.js";
import { withRetry, shouldRetryHttpError } from "../../utils/retry.js";
import {
  requestMutationApproval,
  validateNoteContent,
  validateNoteContentSize,
  validateNoteId,
} from "./mutationUtils.js";

interface UpdateNoteParams {
  noteId: string;
  content: string;
  teamPath?: string;
  [key: string]: unknown;
}

export class UpdateNoteTool extends Tool<UpdateNoteParams> {
  readonly name = "update_note";
  readonly description =
    "Update an existing HackMD note. Use teamPath for team notes.";
  readonly inputSchema: ToolSchema = {
    type: "object",
    properties: {
      noteId: {
        type: "string",
        description: "The ID of the note to update",
      },
      content: {
        type: "string",
        description: "New markdown content for the note",
      },
      teamPath: {
        type: "string",
        description: "Optional: team path or ID for team notes",
      },
    },
    required: ["noteId", "content"],
  };

  constructor(
    private hackmdClient: API,
    private approvalManager: ApprovalManager,
  ) {
    super();
  }

  async call(params: UpdateNoteParams): Promise<ToolResult> {
    const noteIdError = validateNoteId(params.noteId);
    if (noteIdError) {
      return noteIdError;
    }

    const contentError = validateNoteContent(params.content);
    if (contentError) {
      return contentError;
    }

    const sizeError = validateNoteContentSize(params.content);
    if (sizeError) {
      return sizeError;
    }

    const isTeamNote = Boolean(params.teamPath);
    const approvalError = await requestMutationApproval({
      approvalManager: this.approvalManager,
      toolName: this.name,
      teamPath: params.teamPath,
      personalAction: "update_note",
      teamAction: "update_team_note",
      personalDescription: `Update note ${params.noteId}`,
      teamDescription: `Update team note ${params.noteId} in team "${params.teamPath}"`,
    });

    if (approvalError) {
      return approvalError;
    }

    try {
      await withRetry(
        async () => {
          if (isTeamNote) {
            await this.hackmdClient.updateTeamNote(
              params.teamPath!,
              params.noteId,
              {
                content: params.content,
              },
            );
          } else {
            await this.hackmdClient.updateNote(params.noteId, {
              content: params.content,
            });
          }
        },
        {
          maxRetries: 3,
          shouldRetry: shouldRetryHttpError,
        }
      );

      const output = isTeamNote
        ? `✅ Team note updated successfully!\n**ID:** \`${params.noteId}\`\n**Team:** ${params.teamPath}`
        : `✅ Note updated successfully!\n**ID:** \`${params.noteId}\``;

      return this.ok(
        output,
        `${isTeamNote ? "Team note" : "Note"} updated successfully`,
        "Updated",
      );
    } catch (error) {
      const appError = handleHackMDError(
        error,
        `Failed to update ${isTeamNote ? "team " : ""}note`,
      );
      return this.error(
        appError.toUserString(),
        appError.message,
        "Update failed",
      );
    }
  }
}
