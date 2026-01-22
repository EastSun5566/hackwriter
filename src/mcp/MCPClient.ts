import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Logger } from "../utils/Logger.js";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(
  readFileSync(join(__dirname, "../../package.json"), "utf-8")
) as { version: string };

export interface MCPClientConfig {
  serverUrl: string;
  apiToken: string;
}

export interface MCPToolDefinition {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface MCPToolCallResult {
  content: { type: string; text?: string }[];
  isError?: boolean;
}

export class MCPClient {
  private client: Client | null = null;
  private transport: StreamableHTTPClientTransport | null = null;
  private config: MCPClientConfig;
  private connected = false;

  constructor(config: MCPClientConfig) {
    this.config = config;
  }

  /**
   * Connect to MCP server
   */
  async connect(): Promise<void> {
    if (this.connected) {
      Logger.debug("MCPClient", "Already connected");
      return;
    }

    Logger.debug("MCPClient", `Connecting to ${this.config.serverUrl}`);

    this.transport = new StreamableHTTPClientTransport(
      new URL(this.config.serverUrl),
      {
        requestInit: {
          headers: {
            Authorization: `Bearer ${this.config.apiToken}`,
          },
        },
      }
    );

    this.client = new Client(
      {
        name: "hackwriter-cli",
        version: packageJson.version,
      },
      {
        capabilities: {},
      }
    );

    await this.client.connect(this.transport);
    this.connected = true;

    Logger.info("MCPClient", "Connected to MCP server");
  }

  /**
   * Disconnect from MCP server
   */
  async disconnect(): Promise<void> {
    if (!this.connected) return;

    try {
      if (this.client) {
        await this.client.close();
        this.client = null;
      }
      if (this.transport) {
        await this.transport.close();
        this.transport = null;
      }
      this.connected = false;
      Logger.debug("MCPClient", "Disconnected from MCP server");
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      Logger.warn("MCPClient", `Error during disconnect: ${msg}`);
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * List available tools from MCP server
   */
  async listTools(): Promise<MCPToolDefinition[]> {
    if (!this.client) {
      throw new Error("Not connected to MCP server");
    }

    const response = await this.client.listTools();
    return (response.tools || []).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema as Record<string, unknown>,
    }));
  }

  /**
   * Call a tool on the MCP server
   */
  async callTool(name: string, args: Record<string, unknown> = {}): Promise<MCPToolCallResult> {
    if (!this.client) {
      throw new Error("Not connected to MCP server");
    }

    Logger.debug("MCPClient", `Calling tool: ${name}`);

    const response = await this.client.callTool({
      name,
      arguments: args,
    });

    return {
      content: response.content as { type: string; text?: string }[],
      isError: response.isError === true,
    };
  }

  /**
   * List available resources from MCP server
   */
  async listResources(): Promise<{ uri: string; name?: string; mimeType?: string }[]> {
    if (!this.client) {
      throw new Error("Not connected to MCP server");
    }

    const response = await this.client.listResources();
    return (response.resources || []).map((r) => ({
      uri: r.uri,
      name: r.name,
      mimeType: r.mimeType,
    }));
  }

  /**
   * Read a resource from MCP server
   */
  async readResource(uri: string): Promise<string> {
    if (!this.client) {
      throw new Error("Not connected to MCP server");
    }

    Logger.debug("MCPClient", `Reading resource: ${uri}`);

    const response = await this.client.readResource({ uri });

    const textContents = response.contents
      .filter((c): c is { uri: string; text: string; mimeType?: string } => "text" in c)
      .map((c) => c.text)
      .join("\n");

    return textContents;
  }
}
