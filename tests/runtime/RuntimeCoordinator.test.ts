import { describe, expect, it } from "vitest";

import { chooseHackMDMcpAuthSource } from "../../src/mcp/HackMDAuthSelection.ts";

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
