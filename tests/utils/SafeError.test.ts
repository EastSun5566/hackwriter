import { describe, expect, it } from "vitest";

import { formatSafeError } from "../../src/utils/SafeError.ts";

describe("formatSafeError", () => {
  it("redacts credentials from messages and stack traces", () => {
    const secret = "sk-abcdefghijklmnopqrstuvwxyz123456";
    const error = new Error(`request failed: Bearer ${secret}`);

    expect(formatSafeError(error)).not.toContain(secret);
    expect(formatSafeError(error, true)).not.toContain(secret);
    expect(formatSafeError(error, true)).toContain("[REDACTED]");
  });
});
