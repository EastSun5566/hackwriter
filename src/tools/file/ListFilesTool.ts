import { promises as fs, type Stats } from 'node:fs';
import { join, relative } from 'node:path';
import { Tool, type ToolResult, type ToolSchema } from '../base/Tool.js';

interface ListFilesParams {
  directoryPath: string;
  recursive?: boolean;
  pattern?: string;
  [key: string]: unknown;
}

export class ListFilesTool extends Tool<ListFilesParams> {
  readonly name = 'list_files';
  readonly description = 'List files in a local directory';
  readonly inputSchema: ToolSchema = {
    type: 'object',
    properties: {
      directoryPath: {
        type: 'string',
        description: 'Path to the directory to list',
      },
      recursive: {
        type: 'boolean',
        description: 'List files recursively (default: false)',
      },
      pattern: {
        type: 'string',
        description: 'Filter files by pattern (e.g., "*.md", "*.txt")',
      },
    },
    required: ['directoryPath'],
  };

  async call(params: ListFilesParams): Promise<ToolResult> {
    try {
      const files = await this.listFiles(
        params.directoryPath,
        params.recursive ?? false,
        params.pattern
      );

      if (files.length === 0) {
        return this.ok(
          'No files found',
          'No files found',
          'Empty',
        );
      }

      const output = files
        .map((file, index) => {
          const stats = file.stats;
          const type = stats.isDirectory() ? '📁' : '📄';
          return `${index + 1}. ${type} ${file.relativePath}\n` +
                 `   Size: ${stats.size} bytes\n` +
                 `   Modified: ${stats.mtime.toLocaleString()}`;
        })
        .join('\n\n');

      return this.ok(
        output,
        `Found ${files.length} items in ${params.directoryPath}`,
        `${files.length} items`,
      );
    } catch (error) {
      const errorMsg = `Failed to list files: ${this.formatError(error)}`;
      return this.error(
        errorMsg,
        errorMsg,
        'List failed',
      );
    }
  }

  private async listFiles(
    dir: string,
    recursive: boolean,
    pattern?: string
  ): Promise<{ relativePath: string; stats: Stats }[]> {
    const results: { relativePath: string; stats: Stats }[] = [];
    
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const stats = await fs.stat(fullPath);
      const relativePath = relative(dir, fullPath);

      if (entry.isDirectory()) {
        if (recursive) {
          results.push({ relativePath, stats });
          const subFiles = await this.listFiles(fullPath, true, pattern);
          results.push(...subFiles.map(f => ({
            relativePath: join(relativePath, f.relativePath),
            stats: f.stats,
          })));
        } else {
          results.push({ relativePath, stats });
        }
      } else {
        if (!pattern || this.matchPattern(entry.name, pattern)) {
          results.push({ relativePath, stats });
        }
      }
    }

    return results;
  }

  private matchPattern(filename: string, pattern: string): boolean {
    const regex = new RegExp(
      '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
    );
    return regex.test(filename);
  }
}
