import { describe, expect, it, vi } from "vitest";

import { RetryPolicy } from "../../src/utils/RetryPolicy.ts";

describe("RetryPolicy", () => {
  it("does not retry errors rejected by the safety predicate", async () => {
    const operation = vi.fn().mockRejectedValue(new Error("ambiguous create failure"));
    const policy = new RetryPolicy({
      maxRetries: 3,
      shouldRetry: () => false,
    });

    await expect(policy.execute(operation)).rejects.toThrow("ambiguous create failure");
    expect(operation).toHaveBeenCalledOnce();
  });

  it("stops retry delay when the active run is aborted", async () => {
    const controller = new AbortController();
    const operation = vi.fn().mockRejectedValue(new Error("transient"));
    const policy = new RetryPolicy({ maxRetries: 3 });

    const pending = policy.execute(operation, controller.signal);
    controller.abort(new DOMException("cancelled", "AbortError"));

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(operation).toHaveBeenCalledOnce();
  });
});
