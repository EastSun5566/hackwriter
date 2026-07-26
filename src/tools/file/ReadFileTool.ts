import { Tool, type ToolResult, type ToolSchema } from '../base/Tool.ts';
import { promises as fs } from 'node:fs';
import { MAX_FILE_DISPLAY_SIZE } from '../../config/constants.ts';
import { PathValidator, SecurityError } from '../../utils/PathValidator.ts';
import type { ApprovalManager } from '../../agent/ApprovalManager.ts';
import { isSensitiveFilePath } from '../../utils/SensitivePathPolicy.ts';
import { rethrowAbortError } from '../../utils/SafeError.ts';

interface ReadFileParams {
  filePath: string;
  [key: string]: unknown;
}

export class ReadFileTool extends Tool<ReadFileParams> {
  readonly name = 'read_file';
  readonly description = 'Read the content of a local file';
  readonly inputSchema: ToolSchema = {
    type: 'object',
    properties: {
      filePath: {
        type: 'string',
        description: 'Path to the file to read',
      },
    },
    required: ['filePath'],
  };

  constructor(
    private readonly workDir = process.cwd(),
    private readonly approvalManager?: ApprovalManager,
  ) {
    super();
  }

  async call(params: ReadFileParams, signal?: AbortSignal): Promise<ToolResult> {
    // Validate file path using PathValidator
    try {
      signal?.throwIfAborted();
      const validatedPath = await PathValidator.validateExisting(
        params.filePath,
        this.workDir,
      );
      if (isSensitiveFilePath(validatedPath)) {
        if (!this.approvalManager) {
          return this.error(
            'Sensitive file requires explicit approval',
            'Sensitive file read blocked',
            'Approval required',
          );
        }
        const approved = await this.approvalManager.request(
          this.name,
          'read_sensitive_file',
          `Read sensitive file "${params.filePath}" and send its contents to the model`,
          { scope: validatedPath, allowSession: false },
        );
        if (!approved) {
          return this.error('Operation rejected by user', 'Operation rejected by user', 'Rejected');
        }
      }
      return await this.read(validatedPath, params.filePath, signal);
    } catch (error) {
      rethrowAbortError(error);
      if (error instanceof SecurityError) {
        return this.error(
          error.message,
          `Security violation: ${error.violation}`,
          'Security error',
        );
      }
      return this.error(
        'Invalid file path',
        'File path validation failed',
        'Invalid path',
      );
    }

  }

  private async read(filePath: string, displayPath: string, signal?: AbortSignal): Promise<ToolResult> {
    try {
      signal?.throwIfAborted();
      const stats = await fs.stat(filePath);
      if (!stats.isFile()) {
        return this.error('Path is not a regular file', 'Only regular files can be read', 'Invalid file');
      }

      const content = stats.size > MAX_FILE_DISPLAY_SIZE
        ? await this.readPrefix(filePath, MAX_FILE_DISPLAY_SIZE)
        : await fs.readFile(filePath, 'utf-8');

      // Warn if file is very large
      if (stats.size > MAX_FILE_DISPLAY_SIZE) {
        const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
        return this.ok(
          `⚠️ File is very large (${sizeMB}MB)\n\n` +
          `**File:** ${displayPath}\n` +
          `**Size:** ${stats.size} bytes\n` +
          `**Modified:** ${stats.mtime.toLocaleString()}\n\n` +
          `**Content (truncated to 1MB):**\n\`\`\`\n${content.slice(0, MAX_FILE_DISPLAY_SIZE)}\n...\n[truncated]\n\`\`\``,
          `Read file (truncated): ${displayPath}`,
          'Read (truncated)',
        );
      }

      const output = 
        `**File:** ${displayPath}\n` +
        `**Size:** ${stats.size} bytes\n` +
        `**Modified:** ${stats.mtime.toLocaleString()}\n\n` +
        `**Content:**\n\`\`\`\n${content}\n\`\`\``;

      return this.ok(
        output,
        `Successfully read file: ${displayPath}`,
        'Read',
      );
    } catch (error) {
      rethrowAbortError(error);
      const errorMsg = `Failed to read file: ${this.formatError(error)}`;
      return this.error(
        errorMsg,
        errorMsg,
        'Read failed',
      );
    }
  }

  private async readPrefix(filePath: string, maxBytes: number): Promise<string> {
    const handle = await fs.open(filePath, 'r');
    try {
      const buffer = Buffer.allocUnsafe(maxBytes);
      const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
      return buffer.subarray(0, bytesRead).toString('utf8');
    } finally {
      await handle.close();
    }
  }
}
