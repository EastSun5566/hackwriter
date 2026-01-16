import type { LanguageModel, ModelMessage } from 'ai';
import { generateText } from 'ai';

export class ContextCompressor {
  constructor(private readonly model: LanguageModel) {}

  async compress(
    history: ModelMessage[],
    _systemPrompt: string,
  ): Promise<string> {
    const compactionPrompt = this.buildCompactionPrompt(history);
    const response = await generateText({
      model: this.model,
      maxOutputTokens: 1024,
      prompt: compactionPrompt,
    });
    return response.text.trim();
  }

  private buildCompactionPrompt(history: ModelMessage[]): string {
    const historyText = history
      .map((msg, i) => `## Message ${i + 1}\nRole: ${msg.role}\nContent: ${this.formatContent(msg.content)}`)
      .join('\n\n');

    return `You are tasked with compacting a conversation context. Focus on:
1. Current task state and goals
2. Important errors and solutions
3. Key decisions made
4. Pending TODO items

Context to compress:
${historyText}

Provide a concise summary that preserves essential information.`;
  }

  private formatContent(content: ModelMessage['content']): string {
    if (typeof content === 'string') {
      return content;
    }

    if (Array.isArray(content)) {
      return content
        .map(part => {
          if (typeof part !== 'object' || !part) {
            return undefined;
          }
          if ('text' in part && typeof part.text === 'string') {
            return part.text;
          }
          if ('type' in part && part.type === 'tool-call') {
            return `[tool:${part.toolName}] ${JSON.stringify(part.input)}`;
          }
          if ('type' in part && part.type === 'tool-result') {
            return `[tool-result:${part.toolName}] ${JSON.stringify(part.output)}`;
          }
          return `[${(part as { type?: string }).type ?? 'unknown-part'}]`;
        })
        .filter((value): value is string => typeof value === 'string')
        .join('\n');
    }

    return JSON.stringify(content);
  }
}
