import { createWiki, type Wiki, type WikiIndexEntry, type WikiSession } from "hackwiki";
import type {
  HackMDConfig,
  HackwikiConfig,
} from "../../config/Configuration.js";

const DEFAULT_SCHEMA_CHAR_LIMIT = 600;
const DEFAULT_INDEX_ENTRY_LIMIT = 8;
const DEFAULT_INDEX_FIELD_CHAR_LIMIT = 140;
const DEFAULT_LOG_ENTRY_LIMIT = 5;
const DEFAULT_LOG_CHAR_LIMIT = 180;

export interface HackwikiRuntime {
  readonly wiki: Wiki;
  loadPromptContext(): Promise<string>;
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

function formatIndexEntry(entry: WikiIndexEntry): string {
  const title = truncate(collapseWhitespace(entry.title), 80);
  const summary = truncate(
    collapseWhitespace(entry.summary),
    DEFAULT_INDEX_FIELD_CHAR_LIMIT,
  );

  return `  - [${entry.type}] ${title} — ${summary}`;
}

export function formatWikiMemoryContext(session: WikiSession): string {
  const lines = [
    `Schema: ${truncate(collapseWhitespace(session.schema), DEFAULT_SCHEMA_CHAR_LIMIT) || "(empty)"}`,
  ];

  if (session.index.length === 0) {
    lines.push("Indexed pages (0): none yet");
  } else {
    lines.push(`Indexed pages (${session.index.length}):`);
    lines.push(
      ...session.index
        .slice(0, DEFAULT_INDEX_ENTRY_LIMIT)
        .map((entry) => formatIndexEntry(entry)),
    );

    const remainingEntries = session.index.length - DEFAULT_INDEX_ENTRY_LIMIT;
    if (remainingEntries > 0) {
      lines.push(`  - … ${remainingEntries} more page(s)`);
    }
  }

  if (session.recentLog.length === 0) {
    lines.push("Recent activity: none yet");
  } else {
    lines.push("Recent activity:");
    lines.push(
      ...session.recentLog
        .slice(-DEFAULT_LOG_ENTRY_LIMIT)
        .map((entry) => `  - ${truncate(collapseWhitespace(entry), DEFAULT_LOG_CHAR_LIMIT)}`),
    );
  }

  return lines.join("\n");
}

export function createHackwikiRuntime(
  hackmdConfig: HackMDConfig,
  hackwikiConfig?: HackwikiConfig,
): HackwikiRuntime | undefined {
  if (!hackwikiConfig?.enabled) {
    return undefined;
  }

  const wiki = createWiki({
    token: hackmdConfig.apiToken,
    initialSchema: hackwikiConfig.initialSchema,
    apiUrl: hackwikiConfig.apiUrl ?? hackmdConfig.apiBaseUrl,
  });

  return {
    wiki,
    async loadPromptContext(): Promise<string> {
      const session = await wiki.startSession();
      return formatWikiMemoryContext(session);
    },
  };
}
