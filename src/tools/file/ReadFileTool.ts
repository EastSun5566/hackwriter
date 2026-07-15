import { Tool, type ToolResult, type ToolSchema } from '../base/Tool.ts';
import { promises as fs } from 'node:fs';
import { MAX_FILE_DISPLAY_SIZE } from '../../config/constants.ts';
import { PathValidator, SecurityError } from '../../utils/PathValidator.ts';

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

  constructor(private readonly workDir = process.cwd()) {
    super();
  }

  async call(params: ReadFileParams): Promise<ToolResult> {
    // Validate file path using PathValidator
    try {
      const validatedPath = await PathValidator.validateExisting(
        params.filePath,
        this.workDir,
      );
      return await this.read(validatedPath, params.filePath);
    } catch (error) {
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

  private async read(filePath: string, displayPath: string): Promise<ToolResult> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const stats = await fs.stat(filePath);

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
      const errorMsg = `Failed to read file: ${this.formatError(error)}`;
      return this.error(
        errorMsg,
        errorMsg,
        'Read failed',
      );
    }
  }
}
