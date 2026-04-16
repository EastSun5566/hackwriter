import type { ApprovalManager } from "../agent/ApprovalManager.js";
import { requestMutationApproval } from "../tools/hackmd/mutationUtils.js";
import type { ToolResult } from "../tools/base/Tool.js";
import type { ToolLike } from "../tools/base/ToolRegistry.js";
import type { MCPToolApproval, MCPToolFallback } from "./MCPToolAdapter.js";

export function buildHackMDMcpFallback(
  mcpToolName: string,
  localHackMDToolsByName: Map<string, ToolLike>,
): MCPToolFallback | undefined {
  switch (mcpToolName) {
    case "get-note": {
      const localReadTool = localHackMDToolsByName.get("read_note");
      if (!localReadTool) {
        return undefined;
      }

      return {
        tool: localReadTool,
        shouldFallback: (_params, _response, result) =>
          isLikelyTruncatedHackMDNoteResult(result),
      };
    }

    default:
      return undefined;
  }
}

export function buildHackMDMcpApproval(
  mcpToolName: string,
  approvalManager: ApprovalManager,
): MCPToolApproval | undefined {
  switch (mcpToolName) {
    case "create-note":
      return {
        request: (params) =>
          requestMutationApproval({
            approvalManager,
            toolName: mcpToolName,
            teamPath: getTeamTarget(params),
            personalAction: "create_note",
            teamAction: "create_team_note",
            personalDescription: `Create note "${getNoteTitle(params)}"`,
            teamDescription: `Create team note "${getNoteTitle(params)}" in team "${getTeamLabel(params)}"`,
          }),
      };

    case "update-note":
      return {
        request: (params) =>
          requestMutationApproval({
            approvalManager,
            toolName: mcpToolName,
            teamPath: getTeamTarget(params),
            personalAction: "update_note",
            teamAction: "update_team_note",
            personalDescription: `Update note ${getNoteId(params)}`,
            teamDescription: `Update team note ${getNoteId(params)} in team "${getTeamLabel(params)}"`,
          }),
      };

    case "delete-note":
      return {
        request: (params) =>
          requestMutationApproval({
            approvalManager,
            toolName: mcpToolName,
            teamPath: getTeamTarget(params),
            personalAction: "delete_note",
            teamAction: "delete_team_note",
            personalDescription: `Delete note ${getNoteId(params)}? This action cannot be undone.`,
            teamDescription: `Delete team note ${getNoteId(params)} from team "${getTeamLabel(params)}"? This action cannot be undone.`,
            rejectedOutput: "Deletion cancelled by user",
            rejectedMessage: "Deletion cancelled by user",
            rejectedBrief: "Cancelled",
          }),
      };

    case "create-team-note":
      return {
        request: (params) =>
          requestMutationApproval({
            approvalManager,
            toolName: mcpToolName,
            teamPath: getTeamTarget(params) ?? "unknown team",
            personalAction: "create_team_note",
            teamAction: "create_team_note",
            personalDescription: `Create team note "${getNoteTitle(params)}" in team "${getTeamLabel(params)}"`,
            teamDescription: `Create team note "${getNoteTitle(params)}" in team "${getTeamLabel(params)}"`,
          }),
      };

    case "update-team-note":
      return {
        request: (params) =>
          requestMutationApproval({
            approvalManager,
            toolName: mcpToolName,
            teamPath: getTeamTarget(params) ?? "unknown team",
            personalAction: "update_team_note",
            teamAction: "update_team_note",
            personalDescription: `Update team note ${getNoteId(params)} in team "${getTeamLabel(params)}"`,
            teamDescription: `Update team note ${getNoteId(params)} in team "${getTeamLabel(params)}"`,
          }),
      };

    case "delete-team-note":
      return {
        request: (params) =>
          requestMutationApproval({
            approvalManager,
            toolName: mcpToolName,
            teamPath: getTeamTarget(params) ?? "unknown team",
            personalAction: "delete_team_note",
            teamAction: "delete_team_note",
            personalDescription: `Delete team note ${getNoteId(params)} from team "${getTeamLabel(params)}"? This action cannot be undone.`,
            teamDescription: `Delete team note ${getNoteId(params)} from team "${getTeamLabel(params)}"? This action cannot be undone.`,
            rejectedOutput: "Deletion cancelled by user",
            rejectedMessage: "Deletion cancelled by user",
            rejectedBrief: "Cancelled",
          }),
      };

    default:
      return undefined;
  }
}

function getOptionalStringParam(
  params: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = params[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return undefined;
}

function getTeamTarget(params: Record<string, unknown>): string | undefined {
  return getOptionalStringParam(params, "teamPath", "teamId", "team");
}

function getTeamLabel(params: Record<string, unknown>): string {
  return getTeamTarget(params) ?? "unknown team";
}

function getNoteTitle(params: Record<string, unknown>): string {
  return getOptionalStringParam(params, "title") ?? "Untitled note";
}

function getNoteId(params: Record<string, unknown>): string {
  return getOptionalStringParam(params, "noteId", "id") ?? "unknown note";
}

function isLikelyTruncatedHackMDNoteResult(result: ToolResult): boolean {
  if (!result.ok) {
    return false;
  }

  const nonEmptyLines = result.output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return (
    nonEmptyLines.length === 1 &&
    /^#{1,6}\s/u.test(nonEmptyLines[0])
  );
}