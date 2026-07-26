import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConversationContext } from "../../src/agent/ConversationContext.ts";
import { SessionManager } from "../../src/session/SessionManager.ts";

describe("session permissions", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("creates session directories as 0700 and history as 0600", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "hackwriter-home-"));
    vi.stubEnv("HOME", home);
    try {
      const session = await SessionManager.create("/workspace");
      const context = new ConversationContext(session.historyFile);
      await context.addMessage({ role: "user", content: "secret draft", timestamp: Date.now() });
      await context.close();

      expect((await fs.stat(path.dirname(session.historyFile))).mode & 0o777).toBe(0o700);
      expect((await fs.stat(session.historyFile)).mode & 0o777).toBe(0o600);
    } finally {
      await fs.rm(home, { recursive: true, force: true });
    }
  });
});
