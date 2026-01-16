import type { API } from '@hackmd/api';
import { Tool, type ToolResult, type ToolSchema } from '../base/Tool.js';
import { promises as fs } from 'node:fs';

interface ExportNoteParams {
  noteId: string;
  outputPath: string;
  format?: 'md' | 'html' | 'pdf';
  [key: string]: unknown;
}

export class ExportNoteTool extends Tool<ExportNoteParams> {
  readonly name = 'export_note';
  readonly description = 'Export a HackMD note to a local file';
  readonly inputSchema: ToolSchema = {
    type: 'object',
    properties: {
      noteId: {
        type: 'string',
        description: 'The ID of the note to export',
      },
      outputPath: {
        type: 'string',
        description: 'The local file path to export to',
      },
      format: {
        type: 'string',
        enum: ['md', 'html', 'pdf'],
        description: 'Export format (default: md)',
      },
    },
    required: ['noteId', 'outputPath'],
  };

  constructor(private hackmdClient: API) {
    super();
  }

  async call(params: ExportNoteParams): Promise<ToolResult> {
    try {
      const note = await this.hackmdClient.getNote(params.noteId);
      const format = params.format ?? 'md';
      
      let content: string;
      let filePath = params.outputPath;

      if (format === 'md') {
        content = note.content;
        if (!filePath.endsWith('.md')) {
          filePath = `${filePath}.md`;
        }
      } else if (format === 'html') {
        // Basic markdown to HTML conversion (simplified)
        content = `<!DOCTYPE html>
<html>
<head>
  <title>${note.title}</title>
  <meta charset="utf-8">
</head>
<body>
  <h1>${note.title}</h1>
  <pre>${note.content}</pre>
</body>
</html>`;
        if (!filePath.endsWith('.html')) {
          filePath = `${filePath}.html`;
        }
      } else {
        return this.error(
          'PDF export is not yet implemented',
          'PDF export is not yet implemented',
          'Not implemented',
        );
      }

      await fs.writeFile(filePath, content, 'utf-8');

      const output = 
        `✅ Note exported successfully!\n\n` +
        `**Title:** ${note.title}\n` +
        `**Format:** ${format}\n` +
        `**Output:** ${filePath}\n`;

      return this.ok(
        output,
        `Note exported to ${filePath}`,
        'Exported',
      );
    } catch (error) {
      const errorMsg = `Failed to export note: ${this.formatError(error)}`;
      return this.error(
        errorMsg,
        errorMsg,
        'Export failed',
      );
    }
  }
}
