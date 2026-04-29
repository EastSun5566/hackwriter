import { complete, type AssistantMessage, type Message } from '@mariozechner/pi-ai';
import type { Wiki, WikiNoteType } from 'hackwiki';
import chalk from 'chalk';
import { buildLanguageModel } from '../../agent/ModelFactory.js';
import type { ApprovalManager } from '../../agent/ApprovalManager.js';
import type { Configuration } from '../../config/Configuration.js';
import { Logger } from '../../utils/Logger.js';
import type { ToolResult } from '../base/Tool.js';
import {
  WikiCreatePageTool,
  WikiUpdatePageTool,
} from './LocalHackwikiTools.js';

const MEMORY_SYSTEM_PROMPT = `You decide whether a completed assistant answer should be stored in durable wiki memory.

Only persist when the answer contains durable, reusable knowledge that will likely help future conversations, such as:
- stable facts or reference material
- reusable workflows or implementation guides
- summaries of APIs, schemas, concepts, entities, or decisions
- user preferences or conventions likely to matter later

Do NOT persist:
- chit-chat or acknowledgements
- transient status updates
- incomplete drafts or speculative ideas
- content that merely repeats existing short-term context without durable value

Return JSON only with this exact shape:
{
  "shouldPersist": boolean,
  "type": "raw" | "concept" | "entity" | "synthesis" | null,
  "title": string | null,
  "summary": string | null,
  "content": string | null
}

Rules:
- Prefer "synthesis" for synthesized guides, deep explanations, and cross-source summaries.
- Prefer "concept" for a single important concept.
- Prefer "entity" for a named product, API, system, team, or person.
- Prefer "raw" only for source-like notes.
- If shouldPersist is false, set the other fields to null.
- summary must be concise and under 160 characters.
- content must be polished standalone markdown that can live in a wiki page.
- Do not wrap the JSON in code fences.`;

interface PersistableMemoryDraft {
  shouldPersist: true;
  type: WikiNoteType;
  title: string;
  summary: string;
  content: string;
}

interface SkipMemoryDraft {
  shouldPersist: false;
  type: WikiNoteType | null;
  title: string | null;
  summary: string | null;
  content: string | null;
}

type MemoryDraftDecision = PersistableMemoryDraft | SkipMemoryDraft;

export interface PostTurnMemoryContext {
  currentModelName: string;
  config: Configuration;
  userInput: string;
  messages: Message[];
}

type PersistedMemoryAction = 'created' | 'updated';

function extractAssistantText(message: AssistantMessage): string {
  return message.content
    .filter(
      (block): block is Extract<AssistantMessage['content'][number], { type: 'text' }> =>
        block.type === 'text',
    )
    .map((block) => block.text)
    .join('')
    .trim();
}

function findFinalAssistantMessage(messages: Message[]): AssistantMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === 'assistant' && !message.errorMessage) {
      return message;
    }
  }

  return undefined;
}

function stripMarkdownFences(value: string): string {
  const fenced = /^```(?:json)?\s*([\s\S]+?)\s*```$/u.exec(value);
  if (fenced) {
    return fenced[1].trim();
  }

  return value.trim();
}

function extractJsonObject(value: string): string | undefined {
  const trimmed = stripMarkdownFences(value);
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return undefined;
  }

  return trimmed.slice(firstBrace, lastBrace + 1);
}

function parseDecision(rawText: string): MemoryDraftDecision | undefined {
  const jsonText = extractJsonObject(rawText);
  if (!jsonText) {
    return undefined;
  }

  const parsed = JSON.parse(jsonText) as Partial<MemoryDraftDecision>;
  const shouldPersist = parsed.shouldPersist === true;

  if (!shouldPersist) {
    return {
      shouldPersist: false,
      type: null,
      title: null,
      summary: null,
      content: null,
    };
  }

  if (
    (parsed.type !== 'raw' &&
      parsed.type !== 'concept' &&
      parsed.type !== 'entity' &&
      parsed.type !== 'synthesis') ||
    typeof parsed.title !== 'string' ||
    typeof parsed.summary !== 'string' ||
    typeof parsed.content !== 'string'
  ) {
    return undefined;
  }

  return {
    shouldPersist: true,
    type: parsed.type,
    title: parsed.title.trim(),
    summary: parsed.summary.trim().slice(0, 160),
    content: parsed.content.trim(),
  };
}

function normalizeTitle(value: string): string {
  return value.trim().replace(/\s+/gu, ' ').toLocaleLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function stripLeadingTitleHeading(content: string, title: string): string {
  return content
    .trim()
    .replace(new RegExp(`^#\\s+${escapeRegExp(title)}\\s*\\n+`, 'u'), '')
    .trim();
}

function normalizeContent(value: string): string {
  return value.replace(/\s+/gu, ' ').trim().toLocaleLowerCase();
}

function buildUpdatedContent(
  existingContent: string,
  draft: PersistableMemoryDraft,
): string {
  const trimmedExisting = existingContent.trim();
  const addendumBody = stripLeadingTitleHeading(draft.content, draft.title);

  if (!trimmedExisting) {
    return draft.content;
  }

  if (!addendumBody) {
    return trimmedExisting;
  }

  if (normalizeContent(trimmedExisting).includes(normalizeContent(addendumBody))) {
    return trimmedExisting;
  }

  const date = new Date().toISOString().slice(0, 10);
  return `${trimmedExisting}\n\n---\n\n## Update (${date})\n\n${addendumBody}`;
}

function resolveModelApiKey(config: Configuration, currentModelName: string): string | undefined {
  const modelConfig = config.models[currentModelName];
  if (!modelConfig) {
    return undefined;
  }

  const providerConfig = config.providers[modelConfig.provider];
  if (!providerConfig) {
    return undefined;
  }

  if (providerConfig.apiKey) {
    return providerConfig.apiKey;
  }

  if (providerConfig.type === 'ollama') {
    return 'ollama';
  }

  return undefined;
}

function extractNoteId(result: ToolResult): string | undefined {
  if (!result.json || typeof result.json !== 'object') {
    return undefined;
  }

  const noteId = (result.json as { noteId?: unknown }).noteId;
  return typeof noteId === 'string' && noteId.trim().length > 0
    ? noteId
    : undefined;
}

function formatPersistenceNotice(
  action: PersistedMemoryAction,
  title: string,
  noteId?: string,
): string {
  const detail = action === 'created' ? 'created' : 'updated';
  const noteIdSuffix = noteId ? ` · ${noteId}` : '';

  return `💾 Auto-saved wiki memory (${detail}): ${title}${noteIdSuffix}`;
}

export class HackwikiPostTurnMemoryWriter {
  private readonly createTool: WikiCreatePageTool;
  private readonly updateTool: WikiUpdatePageTool;

  constructor(
    private readonly wiki: Wiki,
    approvalManager: ApprovalManager,
  ) {
    this.createTool = new WikiCreatePageTool(wiki, approvalManager, {
      skipApproval: true,
    });
    this.updateTool = new WikiUpdatePageTool(wiki, approvalManager, {
      skipApproval: true,
    });
  }

  async maybePersistTurn(context: PostTurnMemoryContext): Promise<void> {
    const finalAssistantMessage = findFinalAssistantMessage(context.messages);
    if (!finalAssistantMessage) {
      return;
    }

    const assistantText = extractAssistantText(finalAssistantMessage);
    if (!assistantText) {
      return;
    }

    const memoryDraft = await this.generateDraft(context, assistantText);
    if (!memoryDraft?.shouldPersist) {
      return;
    }

    const persistableDraft = memoryDraft;

    try {
      const matches = await this.wiki.searchIndex(persistableDraft.title);
      const exactMatch = matches.find(
        (entry) => normalizeTitle(entry.title) === normalizeTitle(persistableDraft.title),
      );

      if (exactMatch) {
        const existingContent = await this.wiki.readPage(exactMatch.noteId);
        const nextContent = buildUpdatedContent(existingContent, persistableDraft);

        if (normalizeContent(nextContent) === normalizeContent(existingContent)) {
          Logger.debug(
            'HackwikiPostTurnMemoryWriter',
            `Skipping wiki update for ${persistableDraft.title} because no new content was produced`,
          );
          return;
        }

        const result = await this.updateTool.call({
          noteId: exactMatch.noteId,
          content: nextContent,
          title: persistableDraft.title,
        });

        if (result.ok) {
          console.log(
            chalk.gray(
              formatPersistenceNotice(
                'updated',
                persistableDraft.title,
                exactMatch.noteId,
              ),
            ),
          );
        }

        return;
      }

      const result = await this.createTool.call({
        type: persistableDraft.type,
        title: persistableDraft.title,
        summary: persistableDraft.summary,
        content: persistableDraft.content,
      });

      if (result.ok) {
        console.log(
          chalk.gray(
            formatPersistenceNotice(
              'created',
              persistableDraft.title,
              extractNoteId(result),
            ),
          ),
        );
      }
    } catch (error) {
      Logger.warn(
        'HackwikiPostTurnMemoryWriter',
        `Post-turn wiki persistence failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async generateDraft(
    context: PostTurnMemoryContext,
    assistantText: string,
  ): Promise<MemoryDraftDecision | undefined> {
    const modelConfig = context.config.models[context.currentModelName];
    if (!modelConfig) {
      Logger.warn(
        'HackwikiPostTurnMemoryWriter',
        `Model ${context.currentModelName} not found for post-turn memory writer`,
      );
      return undefined;
    }

    const providerConfig = context.config.providers[modelConfig.provider];
    if (!providerConfig) {
      Logger.warn(
        'HackwikiPostTurnMemoryWriter',
        `Provider ${modelConfig.provider} not found for post-turn memory writer`,
      );
      return undefined;
    }

    const model = buildLanguageModel(
      providerConfig,
      modelConfig.model,
      Math.min(modelConfig.maxContextSize, 32_000),
    );

    const response = await complete(
      model,
      {
        systemPrompt: MEMORY_SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text:
                  `User request:\n${context.userInput.trim()}\n\n` +
                  `Assistant final answer:\n${assistantText}`,
              },
            ],
            timestamp: Date.now(),
          },
        ],
      },
      {
        apiKey: resolveModelApiKey(context.config, context.currentModelName),
        temperature: 0,
        maxTokens: 1200,
      },
    );

    const responseText = extractAssistantText(response);
    const parsedDecision = parseDecision(responseText);

    if (!parsedDecision) {
      Logger.warn(
        'HackwikiPostTurnMemoryWriter',
        `Failed to parse post-turn memory decision: ${responseText.slice(0, 300)}`,
      );
      return undefined;
    }

    return parsedDecision;
  }
}