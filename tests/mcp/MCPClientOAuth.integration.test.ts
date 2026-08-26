import { promises as fs } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { MCPClient } from "../../src/mcp/MCPClient.ts";
import { createInteractiveHackMDOAuthSession } from "../../src/mcp/HackMDOAuthProvider.ts";
import { FileHackMDOAuthStore } from "../../src/mcp/HackMDOAuthStore.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true }),
  ));
});

describe("MCPClient OAuth integration", () => {
  it("completes discovery, DCR, PKCE callback, token exchange, and MCP reconnect", async () => {
    let origin = "";
    let registration: Record<string, unknown> | undefined;
    let tokenRequest: URLSearchParams | undefined;
    const server = createServer(async (request, response) => {
      const url = new URL(request.url ?? "/", origin || "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/.well-known/oauth-protected-resource/mcp") {
        return json(response, 200, {
          resource: `${origin}/mcp`,
          authorization_servers: [origin],
          scopes_supported: ["mcp"],
        });
      }
      if (request.method === "GET" && url.pathname === "/.well-known/oauth-authorization-server") {
        return json(response, 200, {
          issuer: origin,
          authorization_endpoint: `${origin}/authorize`,
          token_endpoint: `${origin}/token`,
          registration_endpoint: `${origin}/register`,
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code"],
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: ["none"],
          scopes_supported: ["mcp"],
        });
      }
      if (request.method === "POST" && url.pathname === "/register") {
        registration = JSON.parse(await readBody(request));
        return json(response, 201, {
          ...registration,
          client_id: "dynamic-client",
          client_id_issued_at: Math.floor(Date.now() / 1000),
          client_secret_expires_at: 0,
        });
      }
      if (request.method === "POST" && url.pathname === "/token") {
        tokenRequest = new URLSearchParams(await readBody(request));
        return json(response, 200, {
          access_token: "oauth-access-token",
          token_type: "Bearer",
          expires_in: 3600,
          scope: "mcp",
        });
      }
      if (request.method === "POST" && url.pathname === "/mcp") {
        if (request.headers.authorization !== "Bearer oauth-access-token") {
          response.setHeader(
            "WWW-Authenticate",
            `Bearer realm="mcp", resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp", scope="mcp"`,
          );
          return json(response, 401, {
            jsonrpc: "2.0",
            id: null,
            error: { code: -32000, message: "Authentication required" },
          });
        }
        const message = JSON.parse(await readBody(request));
        if (message.id === undefined) {
          response.writeHead(202).end();
          return;
        }
        if (message.method === "initialize") {
          return json(response, 200, {
            jsonrpc: "2.0",
            id: message.id,
            result: {
              protocolVersion: message.params.protocolVersion,
              capabilities: { tools: {} },
              serverInfo: { name: "mock-hackmd", version: "1" },
            },
          });
        }
        if (message.method === "tools/list") {
          return json(response, 200, {
            jsonrpc: "2.0",
            id: message.id,
            result: {
              tools: [{
                name: "list-notes",
                description: "List notes",
                inputSchema: { type: "object", properties: {} },
              }],
            },
          });
        }
      }
      response.writeHead(404).end();
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    origin = `http://127.0.0.1:${address.port}`;
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "hackwriter-oauth-e2e-"));
    temporaryDirectories.push(directory);
    const store = new FileHackMDOAuthStore(path.join(directory, "oauth.json"));
    const oauthSession = await createInteractiveHackMDOAuthSession(
      `${origin}/mcp`,
      store,
      {
        timeoutMs: 5_000,
        onRedirect: async (authorizationUrl) => {
          const callback = new URL(authorizationUrl.searchParams.get("redirect_uri")!);
          callback.searchParams.set("code", "authorization-code");
          callback.searchParams.set("state", authorizationUrl.searchParams.get("state")!);
          const response = await fetch(callback);
          expect(response.status).toBe(200);
        },
      },
    );
    const client = new MCPClient({
      serverUrl: `${origin}/mcp`,
      auth: {
        type: "oauth",
        provider: oauthSession.provider,
        completeAuthorization: () => oauthSession.completeAuthorization(),
      },
      maxRetries: 0,
    });

    try {
      await client.connect();
      await expect(client.listTools()).resolves.toEqual([
        expect.objectContaining({ name: "list-notes" }),
      ]);
      expect(registration).toMatchObject({
        client_name: "HackWriter",
        grant_types: ["authorization_code"],
        token_endpoint_auth_method: "none",
        scope: "mcp",
      });
      expect(tokenRequest?.get("grant_type")).toBe("authorization_code");
      expect(tokenRequest?.get("code")).toBe("authorization-code");
      expect(tokenRequest?.get("code_verifier")).toBeTruthy();
      expect((await store.read(`${origin}/mcp`))?.tokens?.access_token)
        .toBe("oauth-access-token");
    } finally {
      await client.dispose();
      await Promise.resolve(oauthSession.dispose());
      await new Promise<void>((resolve, reject) => server.close((error) =>
        error ? reject(error) : resolve()
      ));
    }
  });
});

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function json(
  response: ServerResponse,
  status: number,
  body: Record<string, unknown>,
): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}
