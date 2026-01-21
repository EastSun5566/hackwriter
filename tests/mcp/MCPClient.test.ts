import { describe, it, expect } from "vitest";
import { MCPClient } from "../../src/mcp/MCPClient.ts";

/**
 * MCPClient unit tests
 * Note: These tests focus on the client's state management without
 * mocking the external MCP SDK, as the SDK's module structure makes
 * mocking complex. Integration tests should be used for full coverage.
 */
describe("MCPClient", () => {
  describe("initialization", () => {
    it("should create client with config", () => {
      const client = new MCPClient({
        serverUrl: "https://test.example.com/mcp",
        apiToken: "test-token",
      });

      expect(client).toBeDefined();
      expect(client.isConnected()).toBe(false);
    });

    it("should accept different server URLs", () => {
      const client1 = new MCPClient({
        serverUrl: "https://mcp.hackmd.io",
        apiToken: "token1",
      });
      const client2 = new MCPClient({
        serverUrl: "https://mcp.local.localhost",
        apiToken: "token2",
      });

      expect(client1).toBeDefined();
      expect(client2).toBeDefined();
    });
  });

  describe("pre-connection state", () => {
    it("should throw on listTools when not connected", async () => {
      const client = new MCPClient({
        serverUrl: "https://test.example.com/mcp",
        apiToken: "test-token",
      });

      await expect(client.listTools()).rejects.toThrow("Not connected to MCP server");
    });

    it("should throw on callTool when not connected", async () => {
      const client = new MCPClient({
        serverUrl: "https://test.example.com/mcp",
        apiToken: "test-token",
      });

      await expect(client.callTool("test", {})).rejects.toThrow("Not connected to MCP server");
    });

    it("should throw on listResources when not connected", async () => {
      const client = new MCPClient({
        serverUrl: "https://test.example.com/mcp",
        apiToken: "test-token",
      });

      await expect(client.listResources()).rejects.toThrow("Not connected to MCP server");
    });

    it("should throw on readResource when not connected", async () => {
      const client = new MCPClient({
        serverUrl: "https://test.example.com/mcp",
        apiToken: "test-token",
      });

      await expect(client.readResource("hackmd://notes/123")).rejects.toThrow("Not connected to MCP server");
    });
  });

  describe("disconnect", () => {
    it("should handle disconnect when not connected", async () => {
      const client = new MCPClient({
        serverUrl: "https://test.example.com/mcp",
        apiToken: "test-token",
      });

      // Should not throw
      await client.disconnect();
      expect(client.isConnected()).toBe(false);
    });
  });
});
