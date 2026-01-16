import type { API } from "@hackmd/api";
import { Tool, type ToolResult, type ToolSchema } from "../base/Tool";
import type { ApprovalManager } from "../../agent/ApprovalManager";
import { handleHackMDError } from "./errorHandler";

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
