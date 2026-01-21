import type { ToolResult, ToolSchema } from './Tool.js';

/**
 * Interface for tool-like objects (compatible with both Tool class and MCPToolAdapter)
 */
export interface ToolLike {
  name: string;
  description: string;
  inputSchema: ToolSchema;
  call(params: Record<string, unknown>): Promise<ToolResult>;
}

export class ToolRegistry {
  private tools = new Map<string, ToolLike>();

  register(tool: ToolLike): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolLike | undefined {
    return this.tools.get(name);
  }

  getAll(): ToolLike[] {
    return Array.from(this.tools.values());
  }

  getSchemas(): {
    name: string;
    description: string;
    input_schema: unknown;
  }[] {
    return this.getAll().map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    }));
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  remove(name: string): boolean {
    return this.tools.delete(name);
  }

  clear(): void {
    this.tools.clear();
  }
}

