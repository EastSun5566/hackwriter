import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import type {
  Credential,
  CredentialStore,
} from "@earendil-works/pi-ai";

import { CONFIG_DIR } from "./constants.ts";

type CredentialFile = Record<string, Credential>;

const DEFAULT_AUTH_PATH = path.join(
  os.homedir(),
  CONFIG_DIR,
  "auth.json",
);

/** File-backed pi credential storage owned exclusively by HackWriter. */
export class FileCredentialStore implements CredentialStore {
  private operation: Promise<unknown> = Promise.resolve();

  constructor(readonly filePath = DEFAULT_AUTH_PATH) {}

  async read(providerId: string): Promise<Credential | undefined> {
    await this.operation;
    return (await this.readAll())[providerId];
  }

  modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
  ): Promise<Credential | undefined> {
    const next = this.operation.then(async () => {
      const credentials = await this.readAll();
      const credential = await fn(credentials[providerId]);

      if (credential !== undefined) {
        credentials[providerId] = credential;
        await this.writeAll(credentials);
      }

      return credential ?? credentials[providerId];
    });

    this.operation = next.catch(() => undefined);
    return next;
  }

  delete(providerId: string): Promise<void> {
    const next = this.operation.then(async () => {
      const credentials = await this.readAll();
      if (!(providerId in credentials)) return;
      delete credentials[providerId];
      await this.writeAll(credentials);
    });

    this.operation = next.catch(() => undefined);
    return next;
  }

  private async readAll(): Promise<CredentialFile> {
    try {
      const content = await fs.readFile(this.filePath, "utf8");
      await fs.chmod(this.filePath, 0o600);
      const value: unknown = JSON.parse(content);
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Credential file must contain a JSON object");
      }
      return value as CredentialFile;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw error;
    }
  }

  private async writeAll(credentials: CredentialFile): Promise<void> {
    const directory = path.dirname(this.filePath);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    await fs.chmod(directory, 0o700);

    const temporaryPath = path.join(
      directory,
      `.${path.basename(this.filePath)}.${process.pid}.${Date.now()}.tmp`,
    );

    try {
      await fs.writeFile(
        temporaryPath,
        `${JSON.stringify(credentials, null, 2)}\n`,
        { encoding: "utf8", mode: 0o600 },
      );
      await fs.chmod(temporaryPath, 0o600);
      await fs.rename(temporaryPath, this.filePath);
      await fs.chmod(this.filePath, 0o600);
    } catch (error) {
      await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }
}
