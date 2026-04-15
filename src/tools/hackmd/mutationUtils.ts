import type { ApprovalManager } from "../../agent/ApprovalManager.js";
import { MAX_HACKMD_CONTENT_SIZE } from "../../config/constants.js";
import type { ToolResult } from "../base/Tool.js";

// The HackMD SDK accepts these values, but does not export the enum.
export enum NotePermissionRole {
  OWNER = "owner",
  SIGNED_IN = "signed_in",
  GUEST = "guest",
}

interface MutationApprovalOptions {
  approvalManager: ApprovalManager;
  toolName: string;
  teamPath?: string;
  personalAction: string;
  teamAction: string;
  personalDescription: string;
  teamDescription: string;
  rejectedOutput?: string;
  rejectedMessage?: string;
  rejectedBrief?: string;
}

function errorResult(output: string, message: string, brief: string): ToolResult {
  return {
    ok: false,
    output,
    message,
    brief,
  };
}

function validateRequiredString(
  value: string | undefined,
  output: string,
  message: string,
  brief: string,
): ToolResult | undefined {
  if (value?.trim()) {
    return undefined;
  }

  return errorResult(output, message, brief);
}

export function validateNoteTitle(title: string | undefined): ToolResult | undefined {
  return validateRequiredString(
    title,
    "Note title cannot be empty",
    "Title is required",
    "Invalid title",
  );
}

export function validateNoteId(noteId: string | undefined): ToolResult | undefined {
  return validateRequiredString(
    noteId,
    "Note ID cannot be empty",
    "Note ID is required",
    "Invalid ID",
  );
}

export function validateNoteContent(
  content: string | undefined,
): ToolResult | undefined {
  return validateRequiredString(
    content,
    "Note content cannot be empty",
    "Content is required",
    "Invalid content",
  );
}

export function validateNoteContentSize(content: string): ToolResult | undefined {
  if (content.length <= MAX_HACKMD_CONTENT_SIZE) {
    return undefined;
  }

  const sizeMB = (content.length / (1024 * 1024)).toFixed(2);

  return errorResult(
    `Content too large (${sizeMB}MB, maximum ${MAX_HACKMD_CONTENT_SIZE / (1024 * 1024)}MB allowed)`,
    "Content exceeds HackMD size limit",
    "Too large",
  );
}

export async function requestMutationApproval(
  options: MutationApprovalOptions,
): Promise<ToolResult | undefined> {
  const approved = await options.approvalManager.request(
    options.toolName,
    options.teamPath ? options.teamAction : options.personalAction,
    options.teamPath ? options.teamDescription : options.personalDescription,
  );

  if (approved) {
    return undefined;
  }

  return errorResult(
    options.rejectedOutput ?? "Operation rejected by user",
    options.rejectedMessage ?? "Operation rejected by user",
    options.rejectedBrief ?? "Rejected",
  );
}