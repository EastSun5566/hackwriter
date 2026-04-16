import { API } from "@hackmd/api";
import type { ApprovalManager } from "../../agent/ApprovalManager.js";
import type { ToolRegistry, ToolLike } from "../base/ToolRegistry.js";
import { Logger } from "../../utils/Logger.js";
import { CreateNoteTool } from "./CreateNoteTool.js";
import { DeleteNoteTool } from "./DeleteNoteTool.js";
import { ExportNoteTool } from "./ExportNoteTool.js";
import { GetHistoryTool } from "./GetHistoryTool.js";
import { GetUserInfoTool } from "./GetUserInfoTool.js";
import { ListNotesTool } from "./ListNotesTool.js";
import { ListTeamsTool } from "./ListTeamsTool.js";
import { ReadNoteTool } from "./ReadNoteTool.js";
import { SearchNotesTool } from "./SearchNotesTool.js";
import { UpdateNoteTool } from "./UpdateNoteTool.js";

export function createLocalHackMDTools(
  apiToken: string,
  approvalManager: ApprovalManager,
): ToolLike[] {
  const hackmdClient = new API(apiToken);

  return [
    new ListNotesTool(hackmdClient),
    new ReadNoteTool(hackmdClient),
    new CreateNoteTool(hackmdClient, approvalManager),
    new UpdateNoteTool(hackmdClient, approvalManager),
    new DeleteNoteTool(hackmdClient, approvalManager),
    new GetUserInfoTool(hackmdClient),
    new ListTeamsTool(hackmdClient),
    new GetHistoryTool(hackmdClient),
    new SearchNotesTool(hackmdClient),
    new ExportNoteTool(hackmdClient),
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