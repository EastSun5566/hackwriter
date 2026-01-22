import type { API } from "@hackmd/api";
import { Tool, type ToolResult, type ToolSchema } from "../base/Tool.js";
import type { ApprovalManager } from "../../agent/ApprovalManager.js";
import { handleHackMDError } from "./errorHandler.js";
import { MAX_HACKMD_CONTENT_SIZE } from "../../config/constants.js";
import { withRetry, shouldRetryHttpError } from "../../utils/retry.js";

interface UpdateNoteParams {
  noteId: string;
  content: string;
  teamPath?: string; // Optional: if provided, updates a team note
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
    // Validate inputs
    if (!params.noteId || params.noteId.trim() === '') {
      return this.error(
        'Note ID cannot be empty',
        'Note ID is required',
        'Invalid ID',
      );
    }

    if (!params.content || params.content.trim() === '') {
      return this.error(
        'Note content cannot be empty',
        'Content is required',
        'Invalid content',
      );
    }

    // Check content size (5MB limit for HackMD)
    if (params.content.length > MAX_HACKMD_CONTENT_SIZE) {
      const sizeMB = (params.content.length / (1024 * 1024)).toFixed(2);
      return this.error(
        `Content too large (${sizeMB}MB, maximum ${MAX_HACKMD_CONTENT_SIZE / (1024 * 1024)}MB allowed)`,
        'Content exceeds HackMD size limit',
        'Too large',
      );
    }

    const isTeamNote = Boolean(params.teamPath);
    const actionDesc = isTeamNote
      ? `Update team note ${params.noteId} in team "${params.teamPath}"`
      : `Update note ${params.noteId}`;

    const approved = await this.approvalManager.request(
      this.name,
      isTeamNote ? "update_team_note" : "update_note",
      actionDesc,
    );

    if (!approved) {
      return this.error(
        "Operation rejected by user",
        "Operation rejected by user",
        "Rejected",
      );
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
