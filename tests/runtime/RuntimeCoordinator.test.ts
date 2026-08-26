import { describe, expect, it } from "vitest";

import {
  chooseHackMDMcpAuthSource,
  readHackMDOAuthCredential,
} from "../../src/mcp/HackMDAuthSelection.ts";
import type { HackMDOAuthStore } from "../../src/mcp/HackMDOAuthStore.ts";

describe("chooseHackMDMcpAuthSource", () => {
  it.each([
    {
      name: "prefers stored OAuth over an API token in non-interactive mode",
      input: { hasOAuthTokens: true, hasApiToken: true, allowOAuthLogin: false },
      expected: "oauth-stored",
    },
    {
      name: "allows an existing OAuth connection to recover interactively",
      input: { hasOAuthTokens: true, hasApiToken: true, allowOAuthLogin: true },
      expected: "oauth-interactive",
    },
    {
      name: "keeps legacy API-token bearer authentication",
      input: { hasOAuthTokens: false, hasApiToken: true, allowOAuthLogin: false },
      expected: "bearer",
    },
    {
      name: "starts OAuth for a new interactive user",
      input: { hasOAuthTokens: false, hasApiToken: false, allowOAuthLogin: true },
      expected: "oauth-interactive",
    },
    {
      name: "does not start OAuth for a one-shot command",
      input: { hasOAuthTokens: false, hasApiToken: false, allowOAuthLogin: false },
      expected: "unavailable",
    },
  ])("$name", ({ input, expected }) => {
    expect(chooseHackMDMcpAuthSource(input)).toBe(expected);
  });
});

describe("readHackMDOAuthCredential", () => {
  const unreadableStore: HackMDOAuthStore = {
    read: async () => { throw new Error("invalid OAuth file"); },
    update: async () => undefined,
    delete: async () => undefined,
  };

  it("falls back to an API token when the optional OAuth store is unreadable", async () => {
    await expect(readHackMDOAuthCredential({
      store: unreadableStore,
      serverUrl: "https://mcp.hackmd.io",
      hasApiToken: true,
    })).resolves.toBeUndefined();
  });

  it("keeps an unreadable OAuth store fatal for OAuth-only mode", async () => {
    await expect(readHackMDOAuthCredential({
      store: unreadableStore,
      serverUrl: "https://mcp.hackmd.io",
      hasApiToken: false,
    })).rejects.toThrow("invalid OAuth file");
  });
});
