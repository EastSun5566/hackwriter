import type { ToolResult } from '../tools/base/Tool.js';

export type AgentMessage =
  | { type: 'step_started'; stepNumber: number }
  | { type: 'step_completed' }
  | { type: 'text_chunk'; text: string }
  | { type: 'tool_call_started'; toolCall: { id: string; name: string } }
  | { type: 'approval_requested'; toolName: string; action: string }
  | { type: 'approval_completed'; approved: boolean }
  | { type: 'tool_completed'; toolCallId: string; result: ToolResult }
  | { type: 'tool_failed'; toolCallId: string; error: string };

