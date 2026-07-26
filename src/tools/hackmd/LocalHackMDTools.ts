import { API } from "@hackmd/api";
import type { ApprovalManager } from "../../agent/ApprovalManager.ts";
import type { ToolRegistry, ToolLike } from "../base/ToolRegistry.ts";
import { Logger } from "../../utils/Logger.ts";
import { CreateNoteTool } from "./CreateNoteTool.ts";
import { DeleteNoteTool } from "./DeleteNoteTool.ts";
import { ExportNoteTool } from "./ExportNoteTool.ts";
import { GetHistoryTool } from "./GetHistoryTool.ts";
import { GetUserInfoTool } from "./GetUserInfoTool.ts";
import { ListNotesTool } from "./ListNotesTool.ts";
import { ListTeamsTool } from "./ListTeamsTool.ts";
import { ReadNoteTool } from "./ReadNoteTool.ts";
import { SearchNotesTool } from "./SearchNotesTool.ts";
import { UpdateNoteTool } from "./UpdateNoteTool.ts";

export function createLocalHackMDTools(
  apiToken: string,
  approvalManager: ApprovalManager,
  apiBaseUrl?: string,
  workDir = process.cwd(),
  maxRetries = 3,
): ToolLike[] {
  const hackmdClient = new API(apiToken, apiBaseUrl);

  return [
    new ListNotesTool(hackmdClient, maxRetries),
    new ReadNoteTool(hackmdClient, maxRetries),
    new CreateNoteTool(hackmdClient, approvalManager),
    new UpdateNoteTool(hackmdClient, approvalManager, maxRetries),
    new DeleteNoteTool(hackmdClient, approvalManager, maxRetries),
    new GetUserInfoTool(hackmdClient, maxRetries),
    new ListTeamsTool(hackmdClient, maxRetries),
    new GetHistoryTool(hackmdClient, maxRetries),
    new SearchNotesTool(hackmdClient, maxRetries),
    new ExportNoteTool(hackmdClient, approvalManager, workDir, maxRetries),
  ];
}

export function registerLocalHackMDTools(
  toolRegistry: ToolRegistry,
  tools: ToolLike[],
): void {
  for (const tool of tools) {
    toolRegistry.register(tool);
  }

  Logger.debug("HackMDTools", "Registered local HackMD tools");
}
