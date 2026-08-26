import { describe, expect, it, vi } from "vitest";

import {
  HackMDOAuthProvider,
  LoopbackOAuthReceiver,
  OAuthInteractionRequiredError,
} from "../../src/mcp/HackMDOAuthProvider.ts";
import type {
  HackMDOAuthCredential,
  HackMDOAuthStore,
} from "../../src/mcp/HackMDOAuthStore.ts";

function memoryStore(): HackMDOAuthStore {
  const values = new Map<string, HackMDOAuthCredential>();
  return {
    read: async (key) => structuredClone(values.get(key)),
    update: async (key, update) => {
      const value = await update(structuredClone(values.get(key)));
      if (value) values.set(key, structuredClone(value));
      else values.delete(key);
      return structuredClone(value);
    },
    delete: async (key) => { values.delete(key); },
  };
}

describe("HackMDOAuthProvider", () => {
  it("exposes HackWriter public-client metadata and persists credentials", async () => {
    const store = memoryStore();
    const provider = new HackMDOAuthProvider({
      serverUrl: "https://mcp.example",
      redirectUrl: "http://127.0.0.1:1234/oauth/callback",
      state: "state-1",
      store,
    });

    expect(provider.clientMetadata).toEqual({
      client_name: "HackWriter",
      redirect_uris: ["http://127.0.0.1:1234/oauth/callback"],
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: "mcp",
    });
    expect(provider.state()).toBe("state-1");
    await provider.saveClientInformation({ client_id: "client-1" });
    await provider.saveTokens({ access_token: "token-1", token_type: "Bearer" });
    await expect(provider.clientInformation()).resolves.toEqual({ client_id: "client-1" });
    await expect(provider.tokens()).resolves.toEqual({
      access_token: "token-1",
      token_type: "Bearer",
    });

    await provider.invalidateCredentials("tokens");
    await expect(provider.tokens()).resolves.toBeUndefined();
    await expect(provider.clientInformation()).resolves.toEqual({ client_id: "client-1" });
    await provider.invalidateCredentials("all");
    await expect(provider.clientInformation()).resolves.toBeUndefined();
  });

  it("does not silently start an interactive authorization", async () => {
    const provider = new HackMDOAuthProvider({
      serverUrl: "https://mcp.example",
      redirectUrl: "http://127.0.0.1/oauth/callback",
      state: "state",
      store: memoryStore(),
    });
    await expect(provider.redirectToAuthorization(new URL("https://auth.example")))
      .rejects.toBeInstanceOf(OAuthInteractionRequiredError);
  });

  it("disables a completed interactive window for mid-session 401 responses", async () => {
    const onRedirect = vi.fn();
    const provider = new HackMDOAuthProvider({
      serverUrl: "https://mcp.example",
      redirectUrl: "http://127.0.0.1/oauth/callback",
      state: "state",
      store: memoryStore(),
      onRedirect,
    });
    provider.disableInteraction();

    await expect(provider.redirectToAuthorization(new URL("https://auth.example")))
      .rejects.toBeInstanceOf(OAuthInteractionRequiredError);
    expect(onRedirect).not.toHaveBeenCalled();
  });
});

describe("LoopbackOAuthReceiver", () => {
  it("accepts a valid state and returns the authorization code", async () => {
    const receiver = new LoopbackOAuthReceiver();
    await receiver.start({ timeoutMs: 2_000 });
    const callback = new URL(receiver.redirectUrl);
    callback.searchParams.set("code", "authorization-code");
    callback.searchParams.set("state", receiver.state);

    const response = await fetch(callback);
    await expect(receiver.waitForCode()).resolves.toBe("authorization-code");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await receiver.dispose();
  });

  it("rejects a mismatched state without exposing the code", async () => {
    const receiver = new LoopbackOAuthReceiver();
    await receiver.start({ timeoutMs: 2_000 });
    const callback = new URL(receiver.redirectUrl);
    callback.searchParams.set("code", "do-not-accept");
    callback.searchParams.set("state", "wrong-state");
    const result = expect(receiver.waitForCode()).rejects.toThrow("state did not match");

    expect((await fetch(callback)).status).toBe(400);
    await result;
    await receiver.dispose();
  });

  it("aborts cleanly", async () => {
    const receiver = new LoopbackOAuthReceiver();
    const controller = new AbortController();
    await receiver.start({ signal: controller.signal, timeoutMs: 2_000 });
    const result = expect(receiver.waitForCode()).rejects.toMatchObject({ name: "AbortError" });
    controller.abort(new DOMException("Cancelled", "AbortError"));
    await result;
    await receiver.dispose();
  });

  it("rejects an OAuth error callback", async () => {
    const receiver = new LoopbackOAuthReceiver();
    await receiver.start({ timeoutMs: 2_000 });
    const callback = new URL(receiver.redirectUrl);
    callback.searchParams.set("error", "access_denied");
    callback.searchParams.set("state", receiver.state);
    const result = expect(receiver.waitForCode()).rejects.toThrow("access_denied");

    expect((await fetch(callback)).status).toBe(400);
    await result;
    await receiver.dispose();
  });

  it("ignores requests to the wrong callback path", async () => {
    const receiver = new LoopbackOAuthReceiver();
    await receiver.start({ timeoutMs: 2_000 });
    const wrongPath = new URL("/wrong", receiver.redirectUrl);

    expect((await fetch(wrongPath)).status).toBe(404);
    const callback = new URL(receiver.redirectUrl);
    callback.searchParams.set("code", "authorization-code");
    callback.searchParams.set("state", receiver.state);
    await fetch(callback);
    await expect(receiver.waitForCode()).resolves.toBe("authorization-code");
    await receiver.dispose();
  });

  it("times out and allows multiple receivers to use distinct available ports", async () => {
    const first = new LoopbackOAuthReceiver();
    const second = new LoopbackOAuthReceiver();
    await Promise.all([
      first.start({ timeoutMs: 25 }),
      second.start({ timeoutMs: 2_000 }),
    ]);

    expect(new URL(first.redirectUrl).port).not.toBe(new URL(second.redirectUrl).port);
    await expect(first.waitForCode()).rejects.toThrow("timed out");
    const callback = new URL(second.redirectUrl);
    callback.searchParams.set("code", "second-code");
    callback.searchParams.set("state", second.state);
    await fetch(callback);
    await expect(second.waitForCode()).resolves.toBe("second-code");
    await Promise.all([first.dispose(), second.dispose()]);
  });

  it("disposes an unused callback receiver without an unhandled rejection", async () => {
    const receiver = new LoopbackOAuthReceiver();
    await receiver.start({ timeoutMs: 2_000 });

    await receiver.dispose();
    await new Promise<void>((resolve) => setImmediate(resolve));
  });

  it("calls the redirect handler without logging secrets itself", async () => {
    const onRedirect = vi.fn();
    const provider = new HackMDOAuthProvider({
      serverUrl: "https://mcp.example",
      redirectUrl: "http://127.0.0.1/oauth/callback",
      state: "state",
      store: memoryStore(),
      onRedirect,
    });
    const url = new URL("https://auth.example/authorize?state=state");
    await provider.redirectToAuthorization(url);
    expect(onRedirect).toHaveBeenCalledWith(url);
  });
});
