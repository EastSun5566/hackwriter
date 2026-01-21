import type { ToolResult, ToolSchema } from "../tools/base/Tool.js";
import type { MCPClient, MCPToolDefinition } from "./MCPClient.js";
import { Logger } from "../utils/Logger.js";

/**
 * Interface matching Tool abstract class for compatibility
 */
export interface ToolLike {
  name: string;
  description: string;
  inputSchema: ToolSchema;
  call(params: Record<string, unknown>): Promise<ToolResult>;
}

/**
 * Adapter that wraps MCP remote tools to match our local Tool interface
 */
export class MCPToolAdapter implements ToolLike {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: ToolSchema;

  constructor(
    private mcpClient: MCPClient,
    private toolDef: MCPToolDefinition
  ) {
    this.name = toolDef.name;
    this.description = toolDef.description ?? "";
    this.inputSchema = (toolDef.inputSchema as ToolSchema) ?? {
      type: "object",
      properties: {},
    };
  }

  async call(params: Record<string, unknown>): Promise<ToolResult> {
    try {
      Logger.debug("MCPToolAdapter", `Calling remote tool: ${this.name}`);

      const response = await this.mcpClient.callTool(this.name, params);

      // Extract text content from MCP response
      const textContent = response.content
        .filter((c) => c.type === "text" && c.text)
        .map((c) => c.text!)
        .join("\n");

      if (response.isError) {
        return {
          ok: false,
          output: textContent || "Unknown error",
          message: textContent || "Tool call failed",
          brief: "Error",
        };
      }

      // Extract a meaningful brief from the response
      const brief = this.extractBrief(textContent);

      return {
        ok: true,
        output: textContent,
        message: "Success",
        brief,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      Logger.error("MCPToolAdapter", `Failed to call ${this.name}: ${message}`);
      return {
        ok: false,
        output: message,
        message,
        brief: "Error",
      };
    }
  }

  /**
   * Extract a meaningful brief from the response content
   */
  private extractBrief(content: string): string {
    // Try to parse as JSON and extract a meaningful field
    try {
      const json = JSON.parse(content);
      // Common fields that make good briefs
      if (json.name) return json.name;
      if (json.title) return json.title;
      if (json.email) return json.email;
      if (json.id) return `ID: ${json.id}`;
      if (Array.isArray(json)) return `${json.length} items`;
    } catch {
      // Not JSON, try to find first meaningful line
    }

    // Find first non-empty, non-bracket line
    const lines = content.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !["[", "]", "{", "}"].includes(trimmed)) {
        return trimmed.slice(0, 50);
      }
    }

    return "Done";
  }
}
