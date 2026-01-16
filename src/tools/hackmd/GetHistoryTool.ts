import type { API } from '@hackmd/api';
import { Tool, type ToolResult, type ToolSchema } from '../base/Tool';

interface GetHistoryParams {
  limit?: number;
  [key: string]: unknown;
}

interface HistoryEntry {
  id?: string;
  text?: string;
  time?: string | number | Date;
  tags?: string[];
  [key: string]: unknown;
}

export class GetHistoryTool extends Tool<GetHistoryParams> {
  readonly name = 'get_history';
  readonly description = 'Get the history of recently viewed notes';
  readonly inputSchema: ToolSchema = {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: 'Maximum number of history items to return (default: 20)',
      },
    },
  };

  constructor(private hackmdClient: API) {
    super();
  }

  async call(params: GetHistoryParams): Promise<ToolResult> {
    try {
      const history = await this.hackmdClient.getHistory() as HistoryEntry[];
      const limit = params.limit ?? 20;
      const limitedHistory = history.slice(0, limit);
      
      if (!limitedHistory || limitedHistory.length === 0) {
        return this.ok(
          'No history found',
          'No history found',
          'No history',
        );
      }

      const output = limitedHistory
        .map((item: HistoryEntry, index: number) => {
          const title = item.text ?? 'Untitled';
          const id = item.id ?? 'Unknown ID';
          const tags = Array.isArray(item.tags) && item.tags.length > 0
            ? item.tags.join(', ')
            : 'None';
          const lastVisited = item.time
            ? new Date(item.time).toLocaleString()
            : 'Unknown';

          return (
            `${index + 1}. **${title}**\n` +
            `   ID: \`${id}\`\n` +
            `   Last visited: ${lastVisited}\n` +
            `   Tags: ${tags}\n`
          );
        })
        .join('\n');

      return this.ok(
        output,
        `Found ${history.length} history items (showing ${limitedHistory.length})`,
        `${history.length} items`,
      );
    } catch (error) {
      const errorMsg = `Failed to get history: ${this.formatError(error)}`;
      return this.error(
        errorMsg,
        errorMsg,
        'Failed',
      );
    }
  }
}
