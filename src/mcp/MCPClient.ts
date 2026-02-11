import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Logger } from "../utils/Logger.js";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { AsyncPackageLoader } from "../utils/AsyncPackageLoader.js";
import type { Disposable } from "../utils/ResourceManager.js";
import { RetryPolicy } from "../utils/RetryPolicy.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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

export class MCPClient implements Disposable {
  private client: Client | null = null;
  private transport: StreamableHTTPClientTransport | null = null;
  private config: MCPClientConfig;
  private connected = false;
  private packageVersion = "unknown";
  private retryPolicy: RetryPolicy;

  constructor(config: MCPClientConfig) {
    this.config = config;
    this.retryPolicy = new RetryPolicy({
      maxRetries: 3,
      initialDelayMs: 1000,
      maxDelayMs: 10000,
      backoffMultiplier: 2,
    });
  }

  /**
   * Connect to MCP server with retry logic
   */
  async connect(): Promise<void> {
    if (this.connected) {
      Logger.debug("MCPClient", "Already connected");
      return;
    }

    await this.retryPolicy.execute(async () => {
      await this.connectInternal();
    });
  }

  /**
   * Internal connection logic (called by retry policy)
   */
  private async connectInternal(): Promise<void> {
    Logger.debug("MCPClient", `Connecting to ${this.config.serverUrl}`);

    // Load package.json asynchronously
    const packagePath = join(__dirname, "../../package.json");
    const packageJson = await AsyncPackageLoader.load(packagePath);
    this.packageVersion = packageJson.version;

    // Create a custom fetch function that ensures Authorization header is included in all requests
    const customFetch = async (url: string | URL, init?: RequestInit): Promise<Response> => {
      const headers = new Headers(init?.headers);
      
      // Always include the Authorization header if not already present
      if (!headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${this.config.apiToken}`);
      }
      
      Logger.debug("MCPClient", `Fetching ${url.toString()} with headers: ${JSON.stringify(Object.fromEntries(headers.entries()))}`);
      
      return fetch(url, {
        ...init,
        headers,
      });
    };

    this.transport = new StreamableHTTPClientTransport(
      new URL(this.config.serverUrl),
      {
        fetch: customFetch,
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
        version: this.packageVersion,
      },
      {
        capabilities: {},
      }
    );

    try {
      await this.client.connect(this.transport);
      this.connected = true;
      Logger.info("MCPClient", "Connected to MCP server");
    } catch (error) {
      // Clean up partial state on failure
      if (this.client) {
        try {
          await this.client.close();
        } catch {
          // Ignore cleanup errors
        }
        this.client = null;
      }
      if (this.transport) {
        try {
          await this.transport.close();
        } catch {
          // Ignore cleanup errors
        }
        this.transport = null;
      }
      throw error;
    }
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

  /**
   * Dispose of resources (implements Disposable interface)
   */
  async dispose(): Promise<void> {
    Logger.debug("MCPClient", "Disposing resources");
    await this.disconnect();
  }
}
