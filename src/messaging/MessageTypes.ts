import type { ExecutorStatus } from '../agent/AgentExecutor.js';
import type { ToolResult } from '../tools/base/Tool.js';

export type AgentMessage =
  | { type: 'step_started'; stepNumber: number }
  | { type: 'step_completed' }
  | { type: 'step_interrupted' }
  | { type: 'compression_started' }
  | { type: 'compression_completed' }
  | { type: 'text_chunk'; text: string }
  | { type: 'tool_call_started'; toolCall: { id: string; name: string } }
  | { type: 'tool_arguments_chunk'; toolCallId: string; chunk: string }
  | { type: 'tool_completed'; toolCallId: string; result: ToolResult }
  | { type: 'tool_failed'; toolCallId: string; error: string }
  | { type: 'status_updated'; status: ExecutorStatus };
