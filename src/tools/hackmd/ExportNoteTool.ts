import type { API } from '@hackmd/api';
import { Tool, type ToolResult, type ToolSchema } from '../base/Tool.ts';
import { promises as fs } from 'node:fs';
import type { ApprovalManager } from '../../agent/ApprovalManager.ts';
import { PathValidator, SecurityError } from '../../utils/PathValidator.ts';
import { rethrowAbortError } from '../../utils/SafeError.ts';
import { withReadRetry } from './readRetry.ts';

interface ExportNoteParams {
  noteId: string;
  outputPath: string;
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
    },
    required: ['noteId', 'outputPath'],
  };

  constructor(
    private hackmdClient: API,
    private approvalManager: ApprovalManager,
    private readonly workDir = process.cwd(),
    private readonly maxRetries = 3,
  ) {
    super();
  }

  async call(params: ExportNoteParams, signal?: AbortSignal): Promise<ToolResult> {
    try {
      signal?.throwIfAborted();
      const displayPath = params.outputPath.endsWith('.md')
        ? params.outputPath
        : `${params.outputPath}.md`;
      const filePath = await PathValidator.validateForWrite(displayPath, this.workDir);
      const note = await withReadRetry(
        () => this.hackmdClient.getNote(params.noteId),
        this.maxRetries,
        signal,
      );
      const approved = await this.approvalManager.request(
        this.name,
        'export_note',
        `Export note "${note.title}" to "${displayPath}"`,
        { scope: filePath },
      );
      if (!approved) {
        return this.error('Operation rejected by user', 'Operation rejected by user', 'Rejected');
      }

      signal?.throwIfAborted();
      await fs.writeFile(filePath, note.content, { encoding: 'utf8', mode: 0o600 });
      await fs.chmod(filePath, 0o600);

      const output = 
        `✅ Note exported successfully!\n\n` +
        `**Title:** ${note.title}\n` +
        `**Format:** Markdown\n` +
        `**Output:** ${displayPath}\n`;

      return this.ok(
        output,
        `Note exported to ${displayPath}`,
        'Exported',
      );
    } catch (error) {
      rethrowAbortError(error);
      if (error instanceof SecurityError) {
        return this.error(error.message, `Security violation: ${error.violation}`, 'Security error');
      }
      const errorMsg = `Failed to export note: ${this.formatError(error)}`;
      return this.error(
        errorMsg,
        errorMsg,
        'Export failed',
      );
    }
  }
}
