import type { Wiki, WikiIndexEntry, WikiNoteType, WikiSession } from "hackwiki";
import { Tool, type ToolResult, type ToolSchema } from "../base/Tool.js";
import type { ToolRegistry, ToolLike } from "../base/ToolRegistry.js";
import type { ApprovalManager } from "../../agent/ApprovalManager.js";
import { Logger } from "../../utils/Logger.js";
import { withRetry, shouldRetryHttpError } from "../../utils/retry.js";
import { handleHackMDError } from "../hackmd/errorHandler.js";
import {
  requestMutationApproval,
  validateNoteContent,
  validateNoteContentSize,
  validateNoteId,
  validateNoteTitle,
} from "../hackmd/mutationUtils.js";
import { formatWikiMemoryContext } from "./HackwikiRuntime.js";

const WIKI_NOTE_TYPES = ["raw", "concept", "entity", "synthesis"] as const;
const DEFAULT_SEARCH_LIMIT = 10;
const MAX_SEARCH_LIMIT = 25;

interface WikiSearchIndexParams {
  query: string;
  limit?: number;
  [key: string]: unknown;
}

interface WikiReadPageParams {
  noteId: string;
  [key: string]: unknown;
}

interface WikiReadPagesParams {
  noteIds: string[];
  [key: string]: unknown;
}

interface WikiCreatePageParams {
  type: WikiNoteType;
  title: string;
  content: string;
  summary: string;
  [key: string]: unknown;
}

interface WikiUpdatePageParams {
  noteId: string;
  content: string;
  [key: string]: unknown;
}

function errorResult(output: string, message: string, brief: string): ToolResult {
  return {
    ok: false,
    output,
    message,
    brief,
  };
}

function validateRequiredString(
  value: string | undefined,
  output: string,
  message: string,
  brief: string,
): ToolResult | undefined {
  if (value?.trim()) {
    return undefined;
  }

  return errorResult(output, message, brief);
}

function validateSummary(summary: string | undefined): ToolResult | undefined {
  return validateRequiredString(
    summary,
    "Wiki page summary cannot be empty",
    "Summary is required",
    "Invalid summary",
  );
}

function validateQuery(query: string | undefined): ToolResult | undefined {
  return validateRequiredString(
    query,
    "Search query cannot be empty",
    "Query is required",
    "Invalid query",
  );
}

function validateWikiNoteType(type: string | undefined): ToolResult | undefined {
  if (type && WIKI_NOTE_TYPES.includes(type as WikiNoteType)) {
    return undefined;
  }

  return errorResult(
    `Wiki page type must be one of: ${WIKI_NOTE_TYPES.join(", ")}`,
    "Invalid wiki page type",
    "Invalid type",
  );
}

function normalizeLimit(limit: unknown): number {
  if (typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0) {
    return DEFAULT_SEARCH_LIMIT;
  }

  return Math.min(MAX_SEARCH_LIMIT, Math.floor(limit));
}

function parseNoteIds(noteIds: unknown): string[] | ToolResult {
  if (!Array.isArray(noteIds)) {
    return errorResult(
      "noteIds must be an array of wiki page IDs",
      "noteIds must be an array",
      "Invalid IDs",
    );
  }

  const normalizedIds = noteIds
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (normalizedIds.length === 0) {
    return errorResult(
      "At least one wiki page ID is required",
      "At least one wiki page ID is required",
      "Invalid IDs",
    );
  }

  return [...new Set(normalizedIds)];
}

function briefForEntries(entries: WikiIndexEntry[]): string {
  if (entries.length === 0) {
    return "No results";
  }

  if (entries.length === 1) {
    return entries[0].title;
  }

  return `${entries.length} results`;
}

function formatIndexEntries(entries: WikiIndexEntry[]): string {
  return entries
    .map(
      (entry, index) =>
        `${index + 1}. [${entry.type}] **${entry.title}**\n` +
        `   ID: \`${entry.noteId}\`\n` +
        `   Summary: ${entry.summary}`,
    )
    .join("\n\n");
}

function formatSessionMessage(session: WikiSession): string {
  return `Loaded wiki session with ${session.index.length} indexed page(s)`;
}

export class WikiStartSessionTool extends Tool<Record<string, never>> {
  readonly name = "wiki_start_session";
  readonly description =
    "Load the durable wiki memory session summary, including schema, indexed pages, and recent activity.";
  readonly inputSchema: ToolSchema = {
    type: "object",
    properties: {},
  };

  constructor(private wiki: Wiki) {
    super();
  }

  async call(_params: Record<string, never>): Promise<ToolResult> {
    try {
      const session = await this.wiki.startSession();

      return {
        ok: true,
        output: formatWikiMemoryContext(session),
        message: formatSessionMessage(session),
        brief: `${session.index.length} wiki pages`,
        json: session,
      };
    } catch (error) {
      const appError = handleHackMDError(error, "Failed to load wiki session");
      return this.error(
        appError.toUserString(),
        appError.message,
        "Wiki session failed",
      );
    }
  }
}

export class WikiSearchIndexTool extends Tool<WikiSearchIndexParams> {
  readonly name = "wiki_search_index";
  readonly description =
    "Search the durable wiki memory index by page title or summary. Use this before creating a new wiki page.";
  readonly inputSchema: ToolSchema = {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Keyword or phrase to search for in wiki page titles and summaries",
      },
      limit: {
        type: "number",
        description: `Maximum number of results to return (default: ${DEFAULT_SEARCH_LIMIT}, max: ${MAX_SEARCH_LIMIT})`,
      },
    },
    required: ["query"],
  };

  constructor(private wiki: Wiki) {
    super();
  }

  async call(params: WikiSearchIndexParams): Promise<ToolResult> {
    const queryError = validateQuery(params.query);
    if (queryError) {
      return queryError;
    }

    try {
      const hits = await this.wiki.searchIndex(params.query.trim());
      const limitedHits = hits.slice(0, normalizeLimit(params.limit));

      if (limitedHits.length === 0) {
        return {
          ok: true,
          output: `No wiki pages found matching "${params.query.trim()}"`,
          message: "No wiki matches found",
          brief: "No results",
          json: [],
        };
      }

      return {
        ok: true,
        output: formatIndexEntries(limitedHits),
        message: `Found ${hits.length} wiki page(s) matching "${params.query.trim()}" (showing ${limitedHits.length})`,
        brief: briefForEntries(limitedHits),
        json: limitedHits,
      };
    } catch (error) {
      const appError = handleHackMDError(error, "Failed to search wiki index");
      return this.error(
        appError.toUserString(),
        appError.message,
        "Wiki search failed",
      );
    }
  }
}

export class WikiReadPageTool extends Tool<WikiReadPageParams> {
  readonly name = "wiki_read_page";
  readonly description =
    "Read the full content of a wiki page by its noteId. Use noteIds returned from wiki_search_index.";
  readonly inputSchema: ToolSchema = {
    type: "object",
    properties: {
      noteId: {
        type: "string",
        description: "The wiki page noteId to read",
      },
    },
    required: ["noteId"],
  };

  constructor(private wiki: Wiki) {
    super();
  }

  async call(params: WikiReadPageParams): Promise<ToolResult> {
    const noteIdError = validateNoteId(params.noteId);
    if (noteIdError) {
      return noteIdError;
    }

    try {
      const content = await this.wiki.readPage(params.noteId);
      return {
        ok: true,
        output: `**Wiki page:** \`${params.noteId}\`\n\n${content}`,
        message: `Read wiki page ${params.noteId}`,
        brief: params.noteId,
        json: {
          noteId: params.noteId,
          content,
        },
      };
    } catch (error) {
      const appError = handleHackMDError(error, `Failed to read wiki page ${params.noteId}`);
      return this.error(
        appError.toUserString(),
        appError.message,
        "Wiki read failed",
      );
    }
  }
}

export class WikiReadPagesTool extends Tool<WikiReadPagesParams> {
  readonly name = "wiki_read_pages";
  readonly description =
    "Read multiple wiki pages in one call using an array of noteIds from wiki_search_index results.";
  readonly inputSchema: ToolSchema = {
    type: "object",
    properties: {
      noteIds: {
        type: "array",
        items: {
          type: "string",
        },
        description: "Array of wiki page noteIds to read",
      },
    },
    required: ["noteIds"],
  };

  constructor(private wiki: Wiki) {
    super();
  }

  async call(params: WikiReadPagesParams): Promise<ToolResult> {
    const parsedNoteIds = parseNoteIds(params.noteIds);
    if (!Array.isArray(parsedNoteIds)) {
      return parsedNoteIds;
    }

    try {
      const pages = await this.wiki.readPages(parsedNoteIds);
      const output = parsedNoteIds
        .map((noteId) => `## \`${noteId}\`\n\n${pages.get(noteId) ?? ""}`)
        .join("\n\n---\n\n");

      return {
        ok: true,
        output,
        message: `Read ${pages.size} wiki page(s)`,
        brief: `${pages.size} pages`,
        json: Object.fromEntries(pages.entries()),
      };
    } catch (error) {
      const appError = handleHackMDError(error, "Failed to read wiki pages");
      return this.error(
        appError.toUserString(),
        appError.message,
        "Wiki batch read failed",
      );
    }
  }
}

export class WikiCreatePageTool extends Tool<WikiCreatePageParams> {
  readonly name = "wiki_create_page";
  readonly description =
    "Create a durable wiki memory page. Use this for stable facts, decisions, entities, concepts, or synthesis summaries.";
  readonly inputSchema: ToolSchema = {
    type: "object",
    properties: {
      type: {
        type: "string",
        enum: [...WIKI_NOTE_TYPES],
        description: "Wiki page type: raw, concept, entity, or synthesis",
      },
      title: {
        type: "string",
        description: "Human-readable page title",
      },
      content: {
        type: "string",
        description: "Full markdown content for the wiki page",
      },
      summary: {
        type: "string",
        description: "Short summary stored in the wiki index for retrieval",
      },
    },
    required: ["type", "title", "content", "summary"],
  };

  constructor(
    private wiki: Wiki,
    private approvalManager: ApprovalManager,
  ) {
    super();
  }

  async call(params: WikiCreatePageParams): Promise<ToolResult> {
    const typeError = validateWikiNoteType(params.type);
    if (typeError) {
      return typeError;
    }

    const titleError = validateNoteTitle(params.title);
    if (titleError) {
      return titleError;
    }

    const contentError = validateNoteContent(params.content);
    if (contentError) {
      return contentError;
    }

    const sizeError = validateNoteContentSize(params.content);
    if (sizeError) {
      return sizeError;
    }

    const summaryError = validateSummary(params.summary);
    if (summaryError) {
      return summaryError;
    }

    const approvalError = await requestMutationApproval({
      approvalManager: this.approvalManager,
      toolName: this.name,
      personalAction: "wiki_create_page",
      teamAction: "wiki_create_page",
      personalDescription: `Create wiki page "${params.title}" (${params.type})`,
      teamDescription: `Create wiki page "${params.title}" (${params.type})`,
    });

    if (approvalError) {
      return approvalError;
    }

    try {
      const result = await withRetry(
        () => this.wiki.createPage(params.type, params.title, params.content, params.summary),
        {
          maxRetries: 3,
          shouldRetry: shouldRetryHttpError,
        },
      );

      return {
        ok: true,
        output:
          `✅ Wiki page created successfully!\n\n` +
          `**Title:** ${params.title}\n` +
          `**Type:** ${params.type}\n` +
          `**ID:** \`${result.noteId}\`\n` +
          `**Index size:** ${result.indexSize}`,
        message: `Wiki page "${params.title}" created successfully`,
        brief: `Created: ${params.title}`,
        json: {
          noteId: result.noteId,
          indexSize: result.indexSize,
          title: params.title,
          type: params.type,
          summary: params.summary,
        },
      };
    } catch (error) {
      const appError = handleHackMDError(error, `Failed to create wiki page "${params.title}"`);
      return this.error(
        appError.toUserString(),
        appError.message,
        "Wiki creation failed",
      );
    }
  }
}

export class WikiUpdatePageTool extends Tool<WikiUpdatePageParams> {
  readonly name = "wiki_update_page";
  readonly description =
    "Update an existing durable wiki memory page by noteId. Prefer this over creating duplicate pages.";
  readonly inputSchema: ToolSchema = {
    type: "object",
    properties: {
      noteId: {
        type: "string",
        description: "The wiki page noteId to update",
      },
      content: {
        type: "string",
        description: "Replacement markdown content for the wiki page",
      },
    },
    required: ["noteId", "content"],
  };

  constructor(
    private wiki: Wiki,
    private approvalManager: ApprovalManager,
  ) {
    super();
  }

  async call(params: WikiUpdatePageParams): Promise<ToolResult> {
    const noteIdError = validateNoteId(params.noteId);
    if (noteIdError) {
      return noteIdError;
    }

    const contentError = validateNoteContent(params.content);
    if (contentError) {
      return contentError;
    }

    const sizeError = validateNoteContentSize(params.content);
    if (sizeError) {
      return sizeError;
    }

    const targetLabel =
      typeof params.title === "string" && params.title.trim().length > 0
        ? `${params.title} (${params.noteId})`
        : params.noteId;

    const approvalError = await requestMutationApproval({
      approvalManager: this.approvalManager,
      toolName: this.name,
      personalAction: "wiki_update_page",
      teamAction: "wiki_update_page",
      personalDescription: `Update wiki page ${targetLabel}`,
      teamDescription: `Update wiki page ${targetLabel}`,
    });

    if (approvalError) {
      return approvalError;
    }

    try {
      await withRetry(
        () => this.wiki.updatePage(params.noteId, params.content),
        {
          maxRetries: 3,
          shouldRetry: shouldRetryHttpError,
        },
      );

      return {
        ok: true,
        output: `✅ Wiki page updated successfully!\n**ID:** \`${params.noteId}\``,
        message: `Wiki page ${params.noteId} updated successfully`,
        brief: "Updated",
        json: {
          noteId: params.noteId,
        },
      };
    } catch (error) {
      const appError = handleHackMDError(error, `Failed to update wiki page ${params.noteId}`);
      return this.error(
        appError.toUserString(),
        appError.message,
        "Wiki update failed",
      );
    }
  }
}

export function createLocalHackwikiTools(
  wiki: Wiki,
  approvalManager: ApprovalManager,
  options?: {
    includeWriteTools?: boolean;
  },
): ToolLike[] {
  const tools: ToolLike[] = [
    new WikiStartSessionTool(wiki),
    new WikiSearchIndexTool(wiki),
    new WikiReadPageTool(wiki),
    new WikiReadPagesTool(wiki),
  ];

  if (options?.includeWriteTools !== false) {
    tools.push(
      new WikiCreatePageTool(wiki, approvalManager),
      new WikiUpdatePageTool(wiki, approvalManager),
    );
  }

  return tools;
}

export function registerLocalHackwikiTools(
  toolRegistry: ToolRegistry,
  tools: ToolLike[],
): void {
  for (const tool of tools) {
    toolRegistry.register(tool);
  }

  Logger.debug("HackwikiTools", "Registered local Hackwiki tools");
}
