import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";

import type { Disposable } from "../utils/ResourceManager.ts";
import type { HackMDOAuthStore } from "./HackMDOAuthStore.ts";

const CALLBACK_HOST = "127.0.0.1";
const CALLBACK_PATH = "/oauth/callback";
const DEFAULT_CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;

export class OAuthInteractionRequiredError extends Error {
  constructor() {
    super("HackMD OAuth authorization is required; run hackwriter setup or /setup.");
    this.name = "OAuthInteractionRequiredError";
  }
}

interface HackMDOAuthProviderOptions {
  serverUrl: string;
  redirectUrl: string;
  state: string;
  store: HackMDOAuthStore;
  onRedirect?: (authorizationUrl: URL) => void | Promise<void>;
}

export class HackMDOAuthProvider implements OAuthClientProvider {
  private verifier?: string;

  constructor(private readonly options: HackMDOAuthProviderOptions) {}

  get redirectUrl(): string {
    return this.options.redirectUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "HackWriter",
      redirect_uris: [this.redirectUrl],
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: "mcp",
    };
  }

  state(): string {
    return this.options.state;
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    return (await this.options.store.read(this.options.serverUrl))?.clientInformation;
  }

  async saveClientInformation(value: OAuthClientInformationMixed): Promise<void> {
    await this.options.store.update(this.options.serverUrl, (current) => ({
      ...current,
      clientInformation: value,
    }));
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    return (await this.options.store.read(this.options.serverUrl))?.tokens;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    await this.options.store.update(this.options.serverUrl, (current) => ({
      ...current,
      tokens,
    }));
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    if (!this.options.onRedirect) throw new OAuthInteractionRequiredError();
    await this.options.onRedirect(authorizationUrl);
  }

  disableInteraction(): void {
    this.options.onRedirect = undefined;
  }

  saveCodeVerifier(codeVerifier: string): void {
    this.verifier = codeVerifier;
  }

  codeVerifier(): string {
    if (!this.verifier) throw new Error("No OAuth PKCE verifier is available");
    return this.verifier;
  }

  async invalidateCredentials(
    scope: "all" | "client" | "tokens" | "verifier" | "discovery",
  ): Promise<void> {
    if (scope === "verifier" || scope === "all") this.verifier = undefined;
    if (scope === "discovery" || scope === "verifier") return;
    if (scope === "all") {
      await this.options.store.delete(this.options.serverUrl);
      return;
    }
    await this.options.store.update(this.options.serverUrl, (current) => {
      if (!current) return undefined;
      if (scope === "client") {
        const { clientInformation: _discarded, ...rest } = current;
        return Object.keys(rest).length > 0 ? rest : undefined;
      }
      const { tokens: _discarded, ...rest } = current;
      return Object.keys(rest).length > 0 ? rest : undefined;
    });
  }
}

interface LoopbackOAuthReceiverOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export class LoopbackOAuthReceiver implements Disposable {
  readonly state = randomBytes(32).toString("base64url");
  private server?: Server;
  private serverClosePromise?: Promise<void>;
  private timer?: NodeJS.Timeout;
  private callbackPromise?: Promise<string>;
  private resolveCallback?: (code: string) => void;
  private rejectCallback?: (error: Error) => void;
  private abortHandler?: () => void;
  private signal?: AbortSignal;
  private _redirectUrl?: string;

  get redirectUrl(): string {
    if (!this._redirectUrl) throw new Error("OAuth callback receiver has not started");
    return this._redirectUrl;
  }

  async start(options: LoopbackOAuthReceiverOptions = {}): Promise<void> {
    if (this.server) return;
    options.signal?.throwIfAborted();
    this.callbackPromise = new Promise<string>((resolve, reject) => {
      this.resolveCallback = resolve;
      this.rejectCallback = reject;
    });
    // A valid stored token can make the callback unnecessary. Keep the
    // cancellation rejection observed even when waitForCode() is never called.
    void this.callbackPromise.catch(() => undefined);
    this.server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", `http://${CALLBACK_HOST}`);
      if (url.pathname !== CALLBACK_PATH) {
        response.writeHead(404).end("Not found");
        return;
      }

      const error = url.searchParams.get("error");
      const returnedState = url.searchParams.get("state");
      const code = url.searchParams.get("code");
      if (error) {
        this.fail(
          new Error(`HackMD OAuth authorization failed: ${error}`),
          response,
          400,
          "Authorization failed. You can close this window.",
        );
        return;
      }
      if (returnedState !== this.state) {
        this.fail(
          new Error("HackMD OAuth callback state did not match"),
          response,
          400,
          "Authorization could not be verified. You can close this window.",
        );
        return;
      }
      if (!code) {
        this.fail(
          new Error("HackMD OAuth callback did not include a code"),
          response,
          400,
          "Authorization code is missing. You can close this window.",
        );
        return;
      }

      response.writeHead(200, this.responseHeaders()).end(
        "HackWriter is connected to HackMD. You can close this window.",
      );
      this.resolveCallback?.(code);
      this.settled();
    });

    try {
      await new Promise<void>((resolve, reject) => {
        const server = this.server!;
        const onError = (error: Error) => reject(error);
        server.once("error", onError);
        server.listen(0, CALLBACK_HOST, () => {
          server.off("error", onError);
          resolve();
        });
      });
    } catch (error) {
      this.server = undefined;
      this.callbackPromise = undefined;
      this.resolveCallback = undefined;
      this.rejectCallback = undefined;
      throw error;
    }
    const address = this.server.address() as AddressInfo;
    this._redirectUrl = `http://${CALLBACK_HOST}:${address.port}${CALLBACK_PATH}`;

    this.timer = setTimeout(() => {
      this.rejectCallback?.(new Error("HackMD OAuth authorization timed out"));
      this.settled();
    }, options.timeoutMs ?? DEFAULT_CALLBACK_TIMEOUT_MS);
    this.timer.unref();

    if (options.signal) {
      this.signal = options.signal;
      this.abortHandler = () => {
        const reason = options.signal?.reason;
        this.rejectCallback?.(
          reason instanceof Error ? reason : new DOMException("The operation was aborted", "AbortError"),
        );
        this.settled();
      };
      options.signal.addEventListener("abort", this.abortHandler, { once: true });
    }
  }

  waitForCode(): Promise<string> {
    if (!this.callbackPromise) throw new Error("OAuth callback receiver has not started");
    return this.callbackPromise;
  }

  async dispose(): Promise<void> {
    this.rejectCallback?.(new Error("HackMD OAuth callback receiver was closed"));
    this.resolveCallback = undefined;
    this.rejectCallback = undefined;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.signal && this.abortHandler) {
      this.signal.removeEventListener("abort", this.abortHandler);
    }
    this.signal = undefined;
    this.abortHandler = undefined;
    await this.closeServer();
  }

  private fail(
    error: Error,
    response: import("node:http").ServerResponse,
    status: number,
    message: string,
  ): void {
    response.writeHead(status, this.responseHeaders()).end(message);
    this.rejectCallback?.(error);
    this.settled();
  }

  private responseHeaders(): Record<string, string> {
    return {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'",
      "X-Content-Type-Options": "nosniff",
    };
  }

  private settled(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.resolveCallback = undefined;
    this.rejectCallback = undefined;
    if (this.signal && this.abortHandler) {
      this.signal.removeEventListener("abort", this.abortHandler);
    }
    this.signal = undefined;
    this.abortHandler = undefined;
    void this.closeServer();
  }

  private async closeServer(): Promise<void> {
    if (this.serverClosePromise) return this.serverClosePromise;
    const server = this.server;
    this.server = undefined;
    if (!server) return;
    const closing = new Promise<void>((resolve) => server.close(() => resolve()));
    this.serverClosePromise = closing;
    try {
      await closing;
    } finally {
      if (this.serverClosePromise === closing) this.serverClosePromise = undefined;
    }
  }
}

export interface InteractiveHackMDOAuthSession extends Disposable {
  provider: HackMDOAuthProvider;
  completeAuthorization(): Promise<string>;
}

export async function createInteractiveHackMDOAuthSession(
  serverUrl: string,
  store: HackMDOAuthStore,
  options: LoopbackOAuthReceiverOptions & {
    onRedirect?: (authorizationUrl: URL) => void | Promise<void>;
  } = {},
): Promise<InteractiveHackMDOAuthSession> {
  const receiver = new LoopbackOAuthReceiver();
  await receiver.start(options);
  const provider = new HackMDOAuthProvider({
    serverUrl,
    redirectUrl: receiver.redirectUrl,
    state: receiver.state,
    store,
    onRedirect: options.onRedirect,
  });
  return {
    provider,
    completeAuthorization: () => receiver.waitForCode(),
    dispose: async () => {
      provider.disableInteraction();
      await receiver.dispose();
    },
  };
}

export async function createStoredHackMDOAuthProvider(
  serverUrl: string,
  store: HackMDOAuthStore,
): Promise<HackMDOAuthProvider | undefined> {
  const credential = await store.read(serverUrl);
  if (!credential?.tokens) return undefined;
  const savedRedirect = credential.clientInformation && "redirect_uris" in credential.clientInformation
    ? credential.clientInformation.redirect_uris[0]
    : undefined;
  return new HackMDOAuthProvider({
    serverUrl,
    redirectUrl: savedRedirect ?? `http://${CALLBACK_HOST}${CALLBACK_PATH}`,
    state: randomBytes(32).toString("base64url"),
    store,
  });
}
