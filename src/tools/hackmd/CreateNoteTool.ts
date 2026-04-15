import type { API } from "@hackmd/api";
import { Tool, type ToolResult, type ToolSchema } from "../base/Tool.js";
import type { ApprovalManager } from "../../agent/ApprovalManager.js";
import { handleHackMDError } from "./errorHandler.js";
import { withRetry, shouldRetryHttpError } from "../../utils/retry.js";
import {
  NotePermissionRole,
  requestMutationApproval,
  validateNoteContent,
  validateNoteContentSize,
  validateNoteTitle,
} from "./mutationUtils.js";

export { NotePermissionRole } from "./mutationUtils.js";

interface CreateNoteParams {
  title: string;
  content: string;
  teamPath?: string;
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
    const titleError = validateNoteTitle(params.title);
    if (titleError) {
      return titleError;
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
      personalAction: "create_note",
      teamAction: "create_team_note",
      personalDescription: `Create note "${params.title}"`,
      teamDescription: `Create team note "${params.title}" in team "${params.teamPath}"`,
    });

    if (approvalError) {
      return approvalError;
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
