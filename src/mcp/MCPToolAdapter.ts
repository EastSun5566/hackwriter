import type { ToolResult, ToolSchema } from "../tools/base/Tool.js";
import type { ToolLike } from "../tools/base/ToolRegistry.js";
import type { MCPClient, MCPToolDefinition } from "./MCPClient.js";
import { Logger } from "../utils/Logger.js";

export interface MCPToolFallback {
  tool: ToolLike;
  shouldFallback?: (
    params: Record<string, unknown>,
    response: Awaited<ReturnType<MCPClient["callTool"]>>,
    result: ToolResult,
  ) => Promise<boolean> | boolean;
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
    private toolDef: MCPToolDefinition,
    private fallback?: MCPToolFallback,
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
      const result = this.toToolResult(response);

      if (await this.shouldUseFallback(params, response, result)) {
        const fallbackResult = await this.tryFallback(
          params,
          "Remote response matched fallback predicate",
        );

        if (fallbackResult?.ok) {
          return fallbackResult;
        }

        if (fallbackResult && !fallbackResult.ok) {
          Logger.warn(
            "MCPToolAdapter",
            `Fallback tool ${this.fallback?.tool.name} returned an error; keeping remote response for ${this.name}`,
          );
        }
      }

      return result;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      Logger.error("MCPToolAdapter", `Failed to call ${this.name}: ${message}`);

      const fallbackResult = await this.tryFallback(
        params,
        `Remote tool call failed: ${message}`,
      );
      if (fallbackResult) {
        return fallbackResult;
      }

      return {
        ok: false,
        output: message,
        message,
        brief: "Error",
      };
    }
  }

  private toToolResult(
    response: Awaited<ReturnType<MCPClient["callTool"]>>,
  ): ToolResult {
    const textContent = this.getTextContent(response);

    if (response.isError) {
      return {
        ok: false,
        output: textContent || "Unknown error",
        message: textContent || "Tool call failed",
        brief: "Error",
      };
    }

    return {
      ok: true,
      output: textContent,
      message: "Success",
      brief: this.extractBrief(textContent),
    };
  }

  private getTextContent(
    response: Awaited<ReturnType<MCPClient["callTool"]>>,
  ): string {
    return response.content
      .filter((c) => c.type === "text" && c.text)
      .map((c) => c.text!)
      .join("\n");
  }

  private async shouldUseFallback(
    params: Record<string, unknown>,
    response: Awaited<ReturnType<MCPClient["callTool"]>>,
    result: ToolResult,
  ): Promise<boolean> {
    if (!this.fallback?.shouldFallback) {
      return false;
    }

    try {
      return await this.fallback.shouldFallback(params, response, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      Logger.warn(
        "MCPToolAdapter",
        `Fallback predicate failed for ${this.name}: ${message}`,
      );
      return false;
    }
  }

  private async tryFallback(
    params: Record<string, unknown>,
    reason: string,
  ): Promise<ToolResult | null> {
    if (!this.fallback) {
      return null;
    }

    Logger.warn(
      "MCPToolAdapter",
      `Falling back from remote tool ${this.name} to local tool ${this.fallback.tool.name}: ${reason}`,
    );

    try {
      return await this.fallback.tool.call(params);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      Logger.warn(
        "MCPToolAdapter",
        `Fallback tool ${this.fallback.tool.name} failed for ${this.name}: ${message}`,
      );
      return null;
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
