import { Tool, type ToolResult, type ToolSchema } from '../base/Tool.js';
import { promises as fs } from 'node:fs';

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

  async call(params: ReadFileParams): Promise<ToolResult> {
    try {
      const content = await fs.readFile(params.filePath, 'utf-8');
      const stats = await fs.stat(params.filePath);

      const output = 
        `**File:** ${params.filePath}\n` +
        `**Size:** ${stats.size} bytes\n` +
        `**Modified:** ${stats.mtime.toLocaleString()}\n\n` +
        `**Content:**\n\`\`\`\n${content}\n\`\`\``;

      return this.ok(
        output,
        `Successfully read file: ${params.filePath}`,
        'Read',
      );
    } catch (error) {
      const errorMsg = `Failed to read file: ${this.formatError(error)}`;
      return this.error(
        errorMsg,
        errorMsg,
        'Read failed',
      );
    }
  }
}
