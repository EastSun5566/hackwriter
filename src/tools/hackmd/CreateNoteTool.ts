import type { API } from "@hackmd/api";
import { Tool, type ToolResult, type ToolSchema } from "../base/Tool.js";
import type { ApprovalManager } from "../../agent/ApprovalManager.js";
import { handleHackMDError } from "./errorHandler.js";
import { MAX_HACKMD_CONTENT_SIZE } from "../../config/constants.js";
import { withRetry, shouldRetryHttpError } from "../../utils/retry.js";

// Re-define enum as the package doesn't export it properly
export enum NotePermissionRole {
  OWNER = "owner",
  SIGNED_IN = "signed_in",
  GUEST = "guest",
}

interface CreateNoteParams {
  title: string;
  content: string;
  teamPath?: string; // Optional: if provided, creates a team note
  readPermission?: NotePermissionRole;
  writePermission?: NotePermissionRole;
  [key: string]: unknown;
}

export class CreateNoteTool extends Tool<CreateNoteParams> {
  readonly name = "create_note";
  readonly description =
    "Create a new note in HackMD. Use teamPath to create a team note.";
  readonly inputSchema: ToolSchema = {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "The title of the new note",
      },
      content: {
        type: "string",
        description: "The markdown content of the note",
      },
      teamPath: {
        type: "string",
        description: "Optional: team path or ID to create a team note",
      },
      readPermission: {
        type: "string",
        enum: ["owner", "signed_in", "guest"],
        description: "Who can read the note (default: owner)",
      },
      writePermission: {
        type: "string",
        enum: ["owner", "signed_in", "guest"],
        description: "Who can write to the note (default: owner)",
      },
    },
    required: ["title", "content"],
  };

  constructor(
    private hackmdClient: API,
    private approvalManager: ApprovalManager,
  ) {
    super();
  }

  async call(params: CreateNoteParams): Promise<ToolResult> {
    // Validate inputs
    if (!params.title || params.title.trim() === '') {
      return this.error(
        'Note title cannot be empty',
        'Title is required',
        'Invalid title',
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
      ? `Create team note "${params.title}" in team "${params.teamPath}"`
      : `Create note "${params.title}"`;

    const approved = await this.approvalManager.request(
      this.name,
      isTeamNote ? "create_team_note" : "create_note",
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
      const noteData = {
        title: params.title,
        content: params.content,
        readPermission: params.readPermission ?? NotePermissionRole.OWNER,
        writePermission: params.writePermission ?? NotePermissionRole.OWNER,
      };

      const note = await withRetry(
        async () => {
          return isTeamNote
            ? await this.hackmdClient.createTeamNote(params.teamPath!, noteData)
            : await this.hackmdClient.createNote(noteData);
        },
        {
          maxRetries: 3,
          shouldRetry: shouldRetryHttpError,
        }
      );

      const output = isTeamNote
        ? `✅ Team note created successfully!\n\n` +
          `**Title:** ${note.title}\n` +
          `**ID:** \`${note.id}\`\n` +
          `**Team:** ${params.teamPath}\n` +
          `**Link:** ${note.publishLink}\n`
        : `✅ Note created successfully!\n\n` +
          `**Title:** ${note.title}\n` +
          `**ID:** \`${note.id}\`\n` +
          `**Link:** ${note.publishLink}\n`;

      return this.ok(
        output,
        `${isTeamNote ? "Team note" : "Note"} "${params.title}" created successfully`,
        `Created: ${params.title}`,
      );
    } catch (error) {
      const appError = handleHackMDError(
        error,
        `Failed to create ${isTeamNote ? "team " : ""}note`,
      );
      return this.error(
        appError.toUserString(),
        appError.message,
        "Creation failed",
      );
    }
  }
}
