import { promises as fs } from "fs";
import type { ModelMessage } from "ai";
import { Logger } from "../utils/Logger.js";

type ContextRecord =
  | { type: "message"; data: ModelMessage }
  | { type: "checkpoint"; id: number }
  | { type: "usage"; tokenCount: number };

export class ConversationContext {
  private messages: ModelMessage[] = [];
  private _tokenCount = 0;
  private checkpointCounter = 0;
  private storageFile: string;
  private isMemoryMode: boolean;

  constructor(storageFile: string) {
    this.storageFile = storageFile;
    this.isMemoryMode = storageFile === ":memory:";
  }

  async loadFromDisk(): Promise<boolean> {
    if (this.isMemoryMode) {
      return false;
    }
    try {
      const content = await fs.readFile(this.storageFile, "utf-8");
      const lines = content.split("\n").filter((l) => l.trim());
      let corruptedLines = 0;

      for (const line of lines) {
        try {
          const record: ContextRecord = JSON.parse(line);

          if (record.type === "usage") {
            this._tokenCount = record.tokenCount;
          } else if (record.type === "checkpoint") {
            this.checkpointCounter = record.id + 1;
          } else if (record.type === "message") {
            this.messages.push(record.data);
          }
        } catch (e) {
          corruptedLines++;
          Logger.warn(
            "ConversationContext",
            "Skipping corrupted history line",
            {
              line: line.slice(0, 100),
              error: e instanceof Error ? e.message : String(e),
            },
          );
          continue;
        }
      }

      Logger.debug(
        "ConversationContext",
        `Loaded ${this.messages.length} messages, ${this._tokenCount} tokens`,
        corruptedLines > 0 ? { corruptedLines } : undefined,
      );
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return false;
      }
      throw error;
    }
  }

  async createCheckpoint(): Promise<number> {
    const checkpointId = this.checkpointCounter++;
    await this.persistRecord({ type: "checkpoint", id: checkpointId });
    return checkpointId;
  }

  async addMessage(message: ModelMessage | ModelMessage[]): Promise<void> {
    const msgs = Array.isArray(message) ? message : [message];
    this.messages.push(...msgs);

    for (const msg of msgs) {
      await this.persistRecord({ type: "message", data: msg });
    }
  }

  async setTokenCount(count: number): Promise<void> {
    this._tokenCount = count;
    await this.persistRecord({ type: "usage", tokenCount: this._tokenCount });
  }

  async revertToCheckpoint(checkpointId: number): Promise<void> {
    if (this.isMemoryMode) {
      // In memory mode, just reset to initial state since we don't track checkpoints
      this.messages = [];
      this._tokenCount = 0;
      this.checkpointCounter = 0;
      return;
    }

    const originalContent = await fs.readFile(this.storageFile, "utf-8");
    const lines = originalContent.split("\n").filter((l) => l.trim());

    // Create backup
    const backupFile = `${this.storageFile}.${Date.now()}.backup`;
    await fs.rename(this.storageFile, backupFile);

    // Rebuild to checkpoint
    this.messages = [];
    this._tokenCount = 0;
    this.checkpointCounter = 0;

    for (const line of lines) {
      const record: ContextRecord = JSON.parse(line);

      if (record.type === "checkpoint" && record.id === checkpointId) {
        break;
      }

      if (record.type === "message") {
        await this.persistRecord({ type: "message", data: record.data });
        this.messages.push(record.data);
      } else {
        await this.persistRecord(record);
        if (record.type === "usage") {
          this._tokenCount = record.tokenCount;
        } else if (record.type === "checkpoint") {
          this.checkpointCounter = record.id + 1;
        }
      }
    }
  }

  getHistory(): ModelMessage[] {
    return this.messages;
  }

  get tokenCount(): number {
    return this._tokenCount;
  }

  get checkpointCount(): number {
    return this.checkpointCounter;
  }

  private async persistRecord(data: ContextRecord): Promise<void> {
    if (this.isMemoryMode) {
      return;
    }
    await fs.appendFile(this.storageFile, JSON.stringify(data) + "\n", "utf-8");
  }
}
