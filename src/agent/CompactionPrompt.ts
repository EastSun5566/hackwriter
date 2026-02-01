/**
 * System prompt template for context compaction
 *
 * This prompt instructs the model to compress conversation history while
 * preserving essential information for continued execution.
 */
const COMPACTION_PROMPT_TEMPLATE = `You are tasked with compacting a conversation context. Focus on:
1. Current task state and goals
2. Important errors and solutions
3. Key decisions made
4. Pending TODO items

Context to compress:
{{HISTORY}}

Provide a concise summary that preserves essential information.`;

/**
 * Build the compaction prompt with given history
 */
export function buildCompactionPrompt(historyText: string): string {
  return COMPACTION_PROMPT_TEMPLATE.replace("{{HISTORY}}", historyText);
}
