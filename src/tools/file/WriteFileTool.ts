import { Tool, type ToolResult, type ToolSchema } from '../base/Tool.js';
import type { ApprovalManager } from '../../agent/ApprovalManager.js';
import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';

interface WriteFileParams {
  filePath: string;
  content: string;
  createDirectories?: boolean;
  [key: string]: unknown;
}

export class WriteFileTool extends Tool<WriteFileParams> {
  readonly name = 'write_file';
  readonly description = 'Write content to a local file';
  readonly inputSchema: ToolSchema = {
    type: 'object',
    properties: {
      filePath: {
        type: 'string',
        description: 'Path to the file to write',
      },
      content: {
        type: 'string',
        description: 'Content to write to the file',
      },
      createDirectories: {
        type: 'boolean',
        description: 'Create parent directories if they don\'t exist (default: true)',
      },
    },
    required: ['filePath', 'content'],
  };

  constructor(private approvalManager: ApprovalManager) {
    super();
  }

  async call(params: WriteFileParams): Promise<ToolResult> {
    const approved = await this.approvalManager.request(
      this.name,
      'write_file',
      `Write to file "${params.filePath}"`,
    );

    if (!approved) {
      return this.error(
        'Operation rejected by user',
        'Operation rejected by user',
        'Rejected',
      );
    }

    try {
      const createDirs = params.createDirectories !== false;
      
      if (createDirs) {
        const dir = dirname(params.filePath);
        await fs.mkdir(dir, { recursive: true });
      }

      await fs.writeFile(params.filePath, params.content, 'utf-8');
      const stats = await fs.stat(params.filePath);

      const output = 
        `✅ File written successfully!\n\n` +
        `**Path:** ${params.filePath}\n` +
        `**Size:** ${stats.size} bytes\n`;

      return this.ok(
        output,
        `File written to ${params.filePath}`,
        'Written',
      );
    } catch (error) {
      const errorMsg = `Failed to write file: ${this.formatError(error)}`;
      return this.error(
        errorMsg,
        errorMsg,
        'Write failed',
      );
    }
  }
}
