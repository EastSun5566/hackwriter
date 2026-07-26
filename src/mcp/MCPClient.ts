import { Client } from "@modelcontextprotocol/sdk/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Logger } from "../utils/Logger.ts";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { AsyncPackageLoader } from "../utils/AsyncPackageLoader.ts";
import type { Disposable } from "../utils/ResourceManager.ts";
import { RetryPolicy } from "../utils/RetryPolicy.ts";
import { isNetworkError } from "../utils/retry.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface MCPClientConfig {
  serverUrl: string;
  apiToken: string;
  timeoutMs?: number;
  maxRetries?: number;
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
  private sessionEstablished = false; // Track session state across retries

  constructor(config: MCPClientConfig) {
    this.config = config;
    this.retryPolicy = new RetryPolicy({
      maxRetries: config.maxRetries ?? 3,
      initialDelayMs: 1000,
      maxDelayMs: 10000,
      backoffMultiplier: 2,
      shouldRetry: isTransientMcpError,
    });
  }

  /**
   * Connect to MCP server with retry logic
   */
  async connect(signal?: AbortSignal): Promise<void> {
    if (this.connected) {
      Logger.debug("MCPClient", "Already connected");
      return;
    }

    await this.retryPolicy.execute(async () => {
      await this.connectInternal();
    }, signal);
  }

  /**
   * Internal connection logic (called by retry policy)
   */
  private async connectInternal(): Promise<void> {
    Logger.debug("MCPClient", `Connecting to ${this.config.serverUrl}`);
    
    // Reset session state for new connection attempt
    this.sessionEstablished = false;

    // Load package.json asynchronously
    const packagePath = join(__dirname, "../../package.json");
    const packageJson = await AsyncPackageLoader.load(packagePath);
    this.packageVersion = packageJson.version;

    // Create a custom fetch function that ensures Authorization header is included in all requests
    // Also handles server-side race conditions with session management
    const customFetch = async (url: string | URL, init?: RequestInit): Promise<Response> => {
      const headers = new Headers(init?.headers);
      
      // Always include the Authorization header if not already present
      if (!headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${this.config.apiToken}`);
      }
      
      Logger.debug("MCPClient", "Fetching MCP request", {
        method: init?.method ?? "GET",
        url: url.toString(),
        headerNames: [...headers.keys()],
      });
      
      const requestSignal = combineWithTimeout(init?.signal, this.config.timeoutMs ?? 5000);
      const response = await fetch(url, {
        ...init,
        headers,
        signal: requestSignal,
      });
      
      // Check for session-related errors (HackMD MCP server race condition workaround)
      if (!response.ok && init?.method === 'POST') {
        const contentType = response.headers.get('content-type');
        if (contentType?.includes('application/json')) {
          try {
            const clonedResponse = response.clone();
            const body = await clonedResponse.json() as { error?: { message?: string } };
            
            // Detect "Invalid session" error on first request after session creation
            if (body?.error?.message?.includes('Invalid session') && headers.has('mcp-session-id') && !this.sessionEstablished) {
              Logger.debug("MCPClient", "Detected session race condition, adding delay and retrying...");
              
              // Wait for server to fully establish session (300ms to be safe)
              await abortableDelay(300, requestSignal);
              
              // Retry the request
              const retryResponse = await fetch(url, {
                ...init,
                headers,
                signal: requestSignal,
              });
              
              if (retryResponse.ok) {
                this.sessionEstablished = true;
                Logger.debug("MCPClient", "Session established successfully after retry");
              }
              
              return retryResponse;
            }
          } catch {
            // If we can't parse the error, just return the original response
            Logger.debug("MCPClient", "Could not parse error response");
          }
        }
      }
      
      // Mark session as established after first successful request with session ID
      if (response.ok && headers.has('mcp-session-id')) {
        this.sessionEstablished = true;
      }
      
      return response;
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
  async listTools(signal?: AbortSignal): Promise<MCPToolDefinition[]> {
    if (!this.client) {
      throw new Error("Not connected to MCP server");
    }

    const response = await this.client.listTools(undefined, { signal });
    return (response.tools || []).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
  }

  /**
   * Call a tool on the MCP server
   */
  async callTool(
    name: string,
    args: Record<string, unknown> = {},
    signal?: AbortSignal,
  ): Promise<MCPToolCallResult> {
    if (!this.client) {
      throw new Error("Not connected to MCP server");
    }

    Logger.debug("MCPClient", `Calling tool: ${name}`);

    const response = await this.client.callTool(
      { name, arguments: args },
      undefined,
      { signal },
    );

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

function combineWithTimeout(
  signal: AbortSignal | null | undefined,
  timeoutMs: number,
): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function isTransientMcpError(error: Error): boolean {
  if (isNetworkError(error) || error.name === "TimeoutError") return true;
  return /\b(408|429|5\d\d)\b/u.test(error.message);
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(
        signal.reason instanceof Error
          ? signal.reason
          : new DOMException("The operation was aborted", "AbortError"),
      );
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
