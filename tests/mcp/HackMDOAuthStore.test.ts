import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  FileHackMDOAuthStore,
  normalizeMcpServerUrl,
} from "../../src/mcp/HackMDOAuthStore.ts";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "hackwriter-oauth-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true }),
  ));
});

describe("FileHackMDOAuthStore", () => {
  it("stores credentials by normalized MCP endpoint with secure permissions", async () => {
    const directory = await temporaryDirectory();
    const filePath = path.join(directory, ".hackwriter", "hackmd-oauth.json");
    const store = new FileHackMDOAuthStore(filePath);

    await store.update("https://MCP.HackMD.io/", () => ({
      clientInformation: { client_id: "client-1" },
      tokens: { access_token: "oauth-secret", token_type: "Bearer" },
    }));

    await expect(store.read("https://mcp.hackmd.io")).resolves.toEqual({
      clientInformation: { client_id: "client-1" },
      tokens: { access_token: "oauth-secret", token_type: "Bearer" },
    });
    expect((await fs.stat(path.dirname(filePath))).mode & 0o777).toBe(0o700);
    expect((await fs.stat(filePath)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await fs.readFile(filePath, "utf8"))).toMatchObject({
      version: 1,
      servers: { "https://mcp.hackmd.io": {} },
    });
  });

  it("isolates credentials for custom MCP endpoints", async () => {
    const directory = await temporaryDirectory();
    const store = new FileHackMDOAuthStore(path.join(directory, "oauth.json"));
    await store.update("https://one.example/mcp", () => ({
      tokens: { access_token: "one", token_type: "Bearer" },
    }));
    await store.update("https://two.example/mcp", () => ({
      tokens: { access_token: "two", token_type: "Bearer" },
    }));

    expect((await store.read("https://one.example/mcp"))?.tokens?.access_token).toBe("one");
    expect((await store.read("https://two.example/mcp"))?.tokens?.access_token).toBe("two");
  });

  it("serializes concurrent updates without losing fields", async () => {
    const directory = await temporaryDirectory();
    const store = new FileHackMDOAuthStore(path.join(directory, "oauth.json"));
    await Promise.all([
      store.update("https://mcp.example", (current) => ({
        ...current,
        clientInformation: { client_id: "client" },
      })),
      store.update("https://mcp.example", (current) => ({
        ...current,
        tokens: { access_token: "token", token_type: "Bearer" },
      })),
    ]);

    await expect(store.read("https://mcp.example")).resolves.toEqual({
      clientInformation: { client_id: "client" },
      tokens: { access_token: "token", token_type: "Bearer" },
    });
  });

  it("rejects malformed credential files", async () => {
    const directory = await temporaryDirectory();
    const filePath = path.join(directory, "oauth.json");
    await fs.writeFile(filePath, "not-json");
    await expect(new FileHackMDOAuthStore(filePath).read("https://mcp.example"))
      .rejects.toThrow();
  });

  it("normalizes trailing slashes without merging distinct paths", () => {
    expect(normalizeMcpServerUrl("https://MCP.Example/mcp/"))
      .toBe("https://mcp.example/mcp");
    expect(normalizeMcpServerUrl("https://mcp.example/other"))
      .toBe("https://mcp.example/other");
  });
});
