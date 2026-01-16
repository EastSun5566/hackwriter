import { vi } from 'vitest';
import type { Anthropic } from '@anthropic-ai/sdk';

export function createMockAnthropicClient() {
  return {
    messages: {
      create: vi.fn(),
      stream: vi.fn(),
    },
  };
}

/**
 * Helper to create a mock streaming response
 */
export function createMockStream(events: any[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        yield event;
      }
    },
  };
}

/**
 * Create a simple text response stream
 */
export function createTextResponseStream(text: string, outputTokens?: number) {
  return createMockStream([
    {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    },
    {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text },
    },
    {
      type: 'content_block_stop',
      index: 0,
    },
    {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn' },
      usage: { output_tokens: outputTokens ?? text.split(' ').length },
    },
    {
      type: 'message_stop',
    },
  ]);
}

/**
 * Create a tool use response stream
 */
export function createToolUseStream(toolName: string, input: Record<string, unknown>) {
  const inputJson = JSON.stringify(input);
  return createMockStream([
    {
      type: 'content_block_start',
      index: 0,
      content_block: {
        type: 'tool_use',
        id: `call_${Date.now()}`,
        name: toolName,
        input: {},
      },
    },
    {
      type: 'content_block_delta',
      index: 0,
      delta: {
        type: 'input_json_delta',
        partial_json: inputJson,
      },
    },
    {
      type: 'content_block_stop',
      index: 0,
    },
    {
      type: 'message_delta',
      delta: { stop_reason: 'tool_use' },
      usage: { output_tokens: 50 },
    },
    {
      type: 'message_stop',
    },
  ]);
}
