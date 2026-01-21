import { describe, it, expect, vi, beforeEach } from "vitest";
import { MCPToolAdapter } from "../../src/mcp/MCPToolAdapter.ts";

// Mock MCPClient
const createMockMCPClient = () => ({
  callTool: vi.fn(),
  listTools: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  isConnected: vi.fn(() => true),
});

describe("MCPToolAdapter", () => {
  let mockClient: ReturnType<typeof createMockMCPClient>;

  beforeEach(() => {
    mockClient = createMockMCPClient();
  });

  it("should create adapter with tool definition", () => {
    const toolDef = {
      name: "test-tool",
      description: "A test tool",
      inputSchema: { type: "object", properties: { foo: { type: "string" } } },
    };

    const adapter = new MCPToolAdapter(mockClient as any, toolDef);

    expect(adapter.name).toBe("test-tool");
    expect(adapter.description).toBe("A test tool");
    expect(adapter.inputSchema).toEqual(toolDef.inputSchema);
  });

  it("should call remote tool and return result", async () => {
    mockClient.callTool.mockResolvedValue({
      content: [{ type: "text", text: "Success result" }],
      isError: false,
    });

    const adapter = new MCPToolAdapter(mockClient as any, { name: "test" });
    const result = await adapter.call({ param: "value" });

    expect(mockClient.callTool).toHaveBeenCalledWith("test", { param: "value" });
    expect(result.ok).toBe(true);
    expect(result.output).toBe("Success result");
  });

  it("should handle error responses", async () => {
    mockClient.callTool.mockResolvedValue({
      content: [{ type: "text", text: "Error message" }],
      isError: true,
    });

    const adapter = new MCPToolAdapter(mockClient as any, { name: "test" });
    const result = await adapter.call({});

    expect(result.ok).toBe(false);
    expect(result.output).toBe("Error message");
    expect(result.brief).toBe("Error");
  });

  it("should handle exceptions", async () => {
    mockClient.callTool.mockRejectedValue(new Error("Network error"));

    const adapter = new MCPToolAdapter(mockClient as any, { name: "test" });
    const result = await adapter.call({});

    expect(result.ok).toBe(false);
    expect(result.message).toContain("Network error");
  });

  describe("extractBrief", () => {
    it("should extract name from JSON response", async () => {
      mockClient.callTool.mockResolvedValue({
        content: [{ type: "text", text: JSON.stringify({ name: "Michael", email: "test@test.com" }) }],
        isError: false,
      });

      const adapter = new MCPToolAdapter(mockClient as any, { name: "test" });
      const result = await adapter.call({});

      expect(result.brief).toBe("Michael");
    });

    it("should extract title from JSON response", async () => {
      mockClient.callTool.mockResolvedValue({
        content: [{ type: "text", text: JSON.stringify({ title: "My Note", id: "123" }) }],
        isError: false,
      });

      const adapter = new MCPToolAdapter(mockClient as any, { name: "test" });
      const result = await adapter.call({});

      expect(result.brief).toBe("My Note");
    });

    it("should show item count for arrays", async () => {
      mockClient.callTool.mockResolvedValue({
        content: [{ type: "text", text: JSON.stringify([{ id: 1 }, { id: 2 }, { id: 3 }]) }],
        isError: false,
      });

      const adapter = new MCPToolAdapter(mockClient as any, { name: "test" });
      const result = await adapter.call({});

      expect(result.brief).toBe("3 items");
    });

    it("should skip bracket-only lines for non-JSON", async () => {
      mockClient.callTool.mockResolvedValue({
        content: [{ type: "text", text: "{\n  \"key\": \"value\"\n}" }],
        isError: false,
      });

      const adapter = new MCPToolAdapter(mockClient as any, { name: "test" });
      const result = await adapter.call({});

      // Should find the first meaningful line
      expect(result.brief).toContain("key");
    });
  });
});
