import { promises as fs } from 'fs';
import type { ModelMessage, ToolContent, ToolResultPart } from 'ai';
import { Logger } from '../utils/Logger.js';

type ContextRecord =
  | { type: 'message'; data: ModelMessage }
  | { type: 'checkpoint'; id: number }
  | { type: 'usage'; tokenCount: number };

const SUPPORTED_ROLES = new Set<ModelMessage['role']>(['system', 'user', 'assistant', 'tool']);

function isSupportedRole(value: unknown): value is ModelMessage['role'] {
  return typeof value === 'string' && SUPPORTED_ROLES.has(value as ModelMessage['role']);
}

function isModelMessage(value: unknown): value is ModelMessage {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as { role?: unknown; content?: unknown };
  return isSupportedRole(candidate.role);
}

function coerceLegacyMessage(data: unknown): ModelMessage | undefined {
  if (isModelMessage(data)) {
    return data;
  }

  if (!data || typeof data !== 'object') {
    return undefined;
  }

  const { role, content } = data as { role?: string; content?: unknown };
  if (!isSupportedRole(role)) {
    return undefined;
  }

  if (role === 'tool') {
    const toolContent = coerceLegacyToolContent(content);
    if (toolContent) {
      return { role: 'tool', content: toolContent };
    }
    return undefined;
  }

  const textContent = coerceLegacyTextContent(content);
  if (textContent !== undefined) {
    return { role: role, content: textContent };
  }

  return undefined;
}

function coerceLegacyTextContent(content: unknown): string | undefined {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    const flattened = content
      .map(block => {
        if (!block || typeof block !== 'object') {
          return undefined;
        }

        const kind = (block as { type?: string }).type;
        if (kind === 'text' && typeof (block as { text?: string }).text === 'string') {
          return (block as { text: string }).text;
        }
        if (kind === 'tool_use') {
          const name = (block as { name?: string }).name ?? 'unknown-tool';
          return `[tool:${name}]`;
        }
        if (kind === 'tool_result') {
          return `[tool-result:${JSON.stringify(block)}]`;
        }
        return undefined;
      })
      .filter((val): val is string => typeof val === 'string');

    if (flattened.length > 0) {
      return flattened.join('\n');
    }
  }

  if (content !== undefined) {
    try {
      return JSON.stringify(content);
    } catch {
      return undefined;
    }
  }

  return undefined;
}

function coerceLegacyToolContent(content: unknown): ToolContent | undefined {
  if (!Array.isArray(content)) {
    return undefined;
  }

  const parts: ToolResultPart[] = [];

  for (const block of content) {
    if (!block || typeof block !== 'object') {
      continue;
    }

    const kind = (block as { type?: string }).type;
    if (kind !== 'tool_result') {
      continue;
    }

    const id =
      (block as { tool_call_id?: string }).tool_call_id ??
      (block as { tool_use_id?: string }).tool_use_id ??
      `legacy-tool-${parts.length}`;
    const name = (block as { tool_name?: string }).tool_name ?? (block as { name?: string }).name ?? 'legacy-tool';
    const isError = Boolean((block as { is_error?: boolean }).is_error);
    const value = (block as { content?: unknown }).content ?? (block as { output?: unknown }).output ?? null;
    const serializedValue = serializeLegacyValue(value);

    parts.push({
      type: 'tool-result',
      toolCallId: String(id),
      toolName: String(name),
      output: isError
        ? { type: 'error-json', value: { ok: false, content: serializedValue } }
        : { type: 'json', value: { ok: true, content: serializedValue } },
    });
  }

  return parts.length > 0 ? parts : undefined;
}

function serializeLegacyValue(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}
export class ConversationContext {
  private messages: ModelMessage[] = [];
  private _tokenCount = 0;
  private checkpointCounter = 0;
  private storageFile: string;
  private isMemoryMode: boolean;

  constructor(storageFile: string) {
    this.storageFile = storageFile;
    this.isMemoryMode = storageFile === ':memory:';
  }

  async loadFromDisk(): Promise<boolean> {
    if (this.isMemoryMode) {
      return false;
    }
    try {
      const content = await fs.readFile(this.storageFile, 'utf-8');
      const lines = content.split('\n').filter(l => l.trim());
      let corruptedLines = 0;

      for (const line of lines) {
        try {
          const record: ContextRecord = JSON.parse(line);
          
          if (record.type === 'usage') {
            this._tokenCount = record.tokenCount;
          } else if (record.type === 'checkpoint') {
            this.checkpointCounter = record.id + 1;
          } else if (record.type === 'message') {
            const normalized = coerceLegacyMessage(record.data);
            if (normalized) {
              this.messages.push(normalized);
            }
          }
        } catch (e) {
          corruptedLines++;
          Logger.warn('ConversationContext', 'Skipping corrupted history line', { 
            line: line.slice(0, 100),
            error: e instanceof Error ? e.message : String(e)
          });
          continue;
        }
      }

      Logger.debug('ConversationContext', `Loaded ${this.messages.length} messages, ${this._tokenCount} tokens`, 
        corruptedLines > 0 ? { corruptedLines } : undefined);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return false;
      }
      throw error;
    }
  }

  async createCheckpoint(): Promise<number> {
    const checkpointId = this.checkpointCounter++;
    await this.persistRecord({ type: 'checkpoint', id: checkpointId });
    return checkpointId;
  }

  async addMessage(
    message: ModelMessage | ModelMessage[]
  ): Promise<void> {
    const msgs = Array.isArray(message) ? message : [message];
    this.messages.push(...msgs);

    for (const msg of msgs) {
      await this.persistRecord({ type: 'message', data: msg });
    }
  }

  async setTokenCount(count: number): Promise<void> {
    this._tokenCount = count;
    await this.persistRecord({ type: 'usage', tokenCount: this._tokenCount });
  }

  async revertToCheckpoint(checkpointId: number): Promise<void> {
    if (this.isMemoryMode) {
      // In memory mode, just reset to initial state since we don't track checkpoints
      this.messages = [];
      this._tokenCount = 0;
      this.checkpointCounter = 0;
      return;
    }

    const originalContent = await fs.readFile(this.storageFile, 'utf-8');
    const lines = originalContent.split('\n').filter(l => l.trim());

    // Create backup
    const backupFile = `${this.storageFile}.${Date.now()}.backup`;
    await fs.rename(this.storageFile, backupFile);

    // Rebuild to checkpoint
    this.messages = [];
    this._tokenCount = 0;
    this.checkpointCounter = 0;

    for (const line of lines) {
      const record: ContextRecord = JSON.parse(line);

      if (record.type === 'checkpoint' && record.id === checkpointId) {
        break;
      }

      if (record.type === 'message') {
        const normalized = coerceLegacyMessage(record.data);
        if (!normalized) {
          continue;
        }
        await this.persistRecord({ type: 'message', data: normalized });
        this.messages.push(normalized);
      } else {
        await this.persistRecord(record);
        if (record.type === 'usage') {
          this._tokenCount = record.tokenCount;
        } else if (record.type === 'checkpoint') {
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
    await fs.appendFile(
      this.storageFile,
      JSON.stringify(data) + '\n',
      'utf-8'
    );
  }
}
