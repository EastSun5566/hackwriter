import type { API } from '@hackmd/api';
import type { Team } from '@hackmd/api/dist/type.js';
import { Tool, type ToolResult, type ToolSchema } from '../base/Tool.js';

type ListTeamsParams = Record<string, unknown>;

export class ListTeamsTool extends Tool<ListTeamsParams> {
  readonly name = 'list_teams';
  readonly description = 'List all teams the user belongs to';
  readonly inputSchema: ToolSchema = {
    type: 'object',
    properties: {},
  };

  constructor(private hackmdClient: API) {
    super();
  }

  async call(_params: ListTeamsParams): Promise<ToolResult> {
    try {
      const teams = await this.hackmdClient.getTeams();
      
      if (!teams || teams.length === 0) {
        return this.ok(
          'No teams found',
          'No teams found',
          'No teams',
        );
      }

      const output = teams
        .map((team: Team, index: number) => 
          `${index + 1}. **${team.name}**\n` +
          `   Path: \`${team.path}\`\n` +
          `   Logo: ${team.logo ?? 'N/A'}\n` +
          `   Description: ${team.description ?? 'N/A'}\n`
        )
        .join('\n');

      return this.ok(
        output,
        `Found ${teams.length} teams`,
        `${teams.length} teams`,
      );
    } catch (error) {
      const errorMsg = `Failed to list teams: ${this.formatError(error)}`;
      return this.error(
        errorMsg,
        errorMsg,
        'List failed',
      );
    }
  }
}
