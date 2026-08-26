import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  OAuthClientInformationFullSchema,
  OAuthClientInformationSchema,
  OAuthTokensSchema,
  type OAuthClientInformationMixed,
  type OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { z } from "zod";

import { CONFIG_DIR, HACKMD_OAUTH_FILE } from "../config/constants.ts";

export interface HackMDOAuthCredential {
  clientInformation?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
}

export interface HackMDOAuthStore {
  read(serverUrl: string): Promise<HackMDOAuthCredential | undefined>;
  update(
    serverUrl: string,
    update: (
      current: HackMDOAuthCredential | undefined,
    ) => HackMDOAuthCredential | undefined | Promise<HackMDOAuthCredential | undefined>,
  ): Promise<HackMDOAuthCredential | undefined>;
  delete(serverUrl: string): Promise<void>;
}

const CredentialSchema = z.object({
  clientInformation: z.union([
    OAuthClientInformationFullSchema,
    OAuthClientInformationSchema,
  ]).optional(),
  tokens: OAuthTokensSchema.optional(),
});

const CredentialFileSchema = z.object({
  version: z.literal(1),
  servers: z.record(z.string(), CredentialSchema),
});

type CredentialFile = z.infer<typeof CredentialFileSchema>;

const DEFAULT_OAUTH_PATH = path.join(
  os.homedir(),
  CONFIG_DIR,
  HACKMD_OAUTH_FILE,
);

export function normalizeMcpServerUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  url.pathname = url.pathname.replace(/\/+$/u, "") || "/";
  return url.toString().replace(/\/$/u, "");
}

export class FileHackMDOAuthStore implements HackMDOAuthStore {
  private operation: Promise<unknown> = Promise.resolve();

  constructor(
    readonly filePath = DEFAULT_OAUTH_PATH,
    private readonly readOnly = false,
  ) {}

  async read(serverUrl: string): Promise<HackMDOAuthCredential | undefined> {
    await this.operation;
    return structuredClone((await this.readAll()).servers[normalizeMcpServerUrl(serverUrl)]);
  }

  update(
    serverUrl: string,
    update: (
      current: HackMDOAuthCredential | undefined,
    ) => HackMDOAuthCredential | undefined | Promise<HackMDOAuthCredential | undefined>,
  ): Promise<HackMDOAuthCredential | undefined> {
    if (this.readOnly) {
      return this.read(serverUrl).then(update);
    }

    const key = normalizeMcpServerUrl(serverUrl);
    const next = this.operation.then(async () => {
      const file = await this.readAll();
      const credential = await update(structuredClone(file.servers[key]));
      if (credential) file.servers[key] = credential;
      else delete file.servers[key];
      await this.writeAll(file);
      return structuredClone(credential);
    });
    this.operation = next.catch(() => undefined);
    return next;
  }

  async delete(serverUrl: string): Promise<void> {
    if (this.readOnly) return;
    await this.update(serverUrl, () => undefined);
  }

  private async readAll(): Promise<CredentialFile> {
    try {
      const content = await fs.readFile(this.filePath, "utf8");
      if (!this.readOnly) await fs.chmod(this.filePath, 0o600);
      return CredentialFileSchema.parse(JSON.parse(content));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { version: 1, servers: {} };
      }
      throw error;
    }
  }

  private async writeAll(file: CredentialFile): Promise<void> {
    const directory = path.dirname(this.filePath);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    await fs.chmod(directory, 0o700);
    const temporaryPath = path.join(
      directory,
      `.${path.basename(this.filePath)}.${process.pid}.${Date.now()}.tmp`,
    );

    try {
      await fs.writeFile(temporaryPath, `${JSON.stringify(file, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      await fs.chmod(temporaryPath, 0o600);
      await fs.rename(temporaryPath, this.filePath);
      await fs.chmod(this.filePath, 0o600);
    } catch (error) {
      await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }
}
