export interface BuildSystemPromptOptions {
  workDir: string;
  wikiMemoryContext?: string;
  wikiToolsEnabled?: boolean;
}

function getAvailableToolsSection(wikiToolsEnabled: boolean): string {
  if (wikiToolsEnabled) {
    return `Available tools:
- wiki_start_session, wiki_search_index, wiki_read_page, wiki_read_pages (for durable wiki memory lookups)
- get_user_info, list_teams, get_history
- read_file, write_file, list_files (for local file operations)`;
  }

  return `Available tools:
- list_notes, read_note, create_note, update_note, delete_note (use teamPath for team notes)
- get_user_info, list_teams, get_history
- search_notes, export_note
- read_file, write_file, list_files (for local file operations)`;
}

function getGuidelinesSection(wikiToolsEnabled: boolean): string {
  if (wikiToolsEnabled) {
    return `Guidelines:
- Use markdown formatting
- Be concise in responses
- Show note titles and IDs clearly
- Prefer wiki_search_index before claiming something is new to this session
- For deeper retrieval, use wiki_read_page or wiki_read_pages with noteIds from wiki_search_index
- Focus on answering the user first; durable wiki writes happen after the response is complete
- Once hackwiki is enabled, the post-turn memory pass may save durable wiki updates automatically without another approval prompt
- Make the final answer clear and self-contained so a post-turn memory pass can save durable knowledge if it is valuable
- If a durable wiki memory section is present below, treat it as persistent background context for this session`;
  }

  return `Guidelines:
- Use markdown formatting
- Be concise in responses
- Show note titles and IDs clearly
- For team notes, include teamPath parameter
- ALWAYS use read_file tool to read local files before uploading to HackMD
- Combine tools for complex operations (e.g., upload local file = read_file + create_note)
- If a durable wiki memory section is present below, treat it as persistent background context for this session`;
}

export function buildSystemPrompt({
  workDir,
  wikiMemoryContext,
  wikiToolsEnabled = false,
}: BuildSystemPromptOptions): string {
  const basePrompt = `You are a HackMD assistant. Help users manage their HackMD notes.

${getAvailableToolsSection(wikiToolsEnabled)}

${getGuidelinesSection(wikiToolsEnabled)}

Working directory: ${workDir}`;

  if (!wikiMemoryContext?.trim()) {
    return basePrompt;
  }

  return `${basePrompt}

Durable wiki memory context:
${wikiMemoryContext}`;
}
