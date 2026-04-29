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