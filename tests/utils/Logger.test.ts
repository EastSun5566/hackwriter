import { afterEach, describe, expect, it, vi } from "vitest";

import { Logger } from "../../src/utils/Logger.ts";

afterEach(() => {
  Logger.setLevel("silent");
  vi.restoreAllMocks();
});

describe("Logger redaction", () => {
  it("redacts secrets in messages and nested data at every log level", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    Logger.setLevel("debug");
    Logger.debug("test", "Bearer abc.def-123", {
      nested: { authorization: "Bearer raw-secret", value: "sk-abcdefghijklmnopqrstuvwxyz" },
    });
    Logger.info("test", "token=visible-secret");
    Logger.warn("test", "password=visible-secret");
    Logger.error("test", "authorization=visible-secret", new Error("Bearer abc.def-123"));

    const output = log.mock.calls.flat().join("\n");
    expect(output).not.toContain("raw-secret");
    expect(output).not.toContain("visible-secret");
    expect(output).not.toContain("sk-abcdefghijklmnopqrstuvwxyz");
    expect(output).toContain("[REDACTED]");
  });
});
