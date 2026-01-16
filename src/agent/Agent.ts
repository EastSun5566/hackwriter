import type { ToolRegistry } from '../tools/base/ToolRegistry.js';

export interface Agent {
  name: string;
  modelName: string;
  maxContextSize: number;
  systemPrompt: string;
  toolRegistry: ToolRegistry;
}
