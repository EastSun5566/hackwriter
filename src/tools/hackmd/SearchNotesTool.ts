import type { API } from '@hackmd/api';
import type { Note } from '@hackmd/api/dist/type.js';
import { Tool, type ToolResult, type ToolSchema } from '../base/Tool';

interface SearchNotesParams {
  query: string;
  limit?: number;
  [key: string]: unknown;
}

export class SearchNotesTool extends Tool<SearchNotesParams> {
  readonly name = 'search_notes';
  readonly description = 'Search for notes by keyword in title. Provide a search query to find matching notes.';
  readonly inputSchema: ToolSchema = {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query or keyword to look for in note titles (required)',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results to return (default: 20)',
      },
    },
    required: ['query'],
  };

  constructor(private hackmdClient: API) {
    super();
  }

  async call(params: SearchNotesParams): Promise<ToolResult> {
    try {
      const allNotes = await this.hackmdClient.getNoteList();
      const searchTerm = params.query.toLowerCase();
      
      const matchedNotes = allNotes.filter((note) => 
        note.title?.toLowerCase().includes(searchTerm) ||
        note.tags?.some((tag: string) => tag.toLowerCase().includes(searchTerm))
      );

      const limit = params.limit ?? 20;
      const limitedNotes = matchedNotes.slice(0, limit);
      
      if (limitedNotes.length === 0) {
        return this.ok(
          `No notes found matching "${searchTerm}"`,
          'No matches found',
          'No results',
        );
      }

      const output = limitedNotes
        .map((note: Note, index: number) => 
          `${index + 1}. **${note.title}**\n` +
          `   ID: \`${note.id}\`\n` +
          `   Last changed: ${new Date(note.lastChangedAt).toLocaleString()}\n` +
          `   Link: ${note.publishLink ?? 'N/A'}\n`
        )
        .join('\n');

      return this.ok(
        output,
        `Found ${matchedNotes.length} notes matching "${searchTerm}" (showing ${limitedNotes.length})`,
        `${matchedNotes.length} results`,
      );
    } catch (error) {
      const errorMsg = `Failed to search notes: ${this.formatError(error)}`;
      return this.error(
        errorMsg,
        errorMsg,
        'Search failed',
      );
    }
  }
}
