import type { API } from "@hackmd/api";
import { Tool, type ToolResult, type ToolSchema } from "../base/Tool.js";

type GetUserInfoParams = Record<string, unknown>;

export class GetUserInfoTool extends Tool<GetUserInfoParams> {
  readonly name = "get_user_info";
  readonly description = "Get information about the current HackMD user";
  readonly inputSchema: ToolSchema = {
    type: "object",
    properties: {},
  };

  constructor(private hackmdClient: API) {
    super();
  }

  async call(_params: GetUserInfoParams): Promise<ToolResult> {
    try {
      const user = await this.hackmdClient.getMe();

      const output =
        `**User Information**\n\n` +
        `**Name:** ${user.name ?? "N/A"}\n` +
        `**Email:** ${user.email ?? "N/A"}\n` +
        `**User Path:** ${user.userPath ?? "N/A"}\n` +
        `**Photo:** ${user.photo ?? "N/A"}\n`;

      return this.ok(
        output,
        "Successfully retrieved user information",
        user.name ?? "User info",
      );
    } catch (error) {
      const errorMsg = `Failed to get user info: ${this.formatError(error)}`;
      return this.error(errorMsg, errorMsg, "Failed");
    }
  }
}
