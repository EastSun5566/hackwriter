import { describe, expect, it } from "vitest";

import { classifyHackMDMcpTool } from "../../src/mcp/HackMDMcpToolPolicies.ts";

describe("HackMD MCP tool classification", () => {
  it("classifies known read and mutation tools", () => {
    expect(classifyHackMDMcpTool("get-note")).toBe("read");
    expect(classifyHackMDMcpTool("delete-note")).toBe("mutation");
  });

  it("rejects unknown tools", () => {
    expect(classifyHackMDMcpTool("publish-everything")).toBeUndefined();
  });
});
