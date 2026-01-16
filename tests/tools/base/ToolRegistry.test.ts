import { describe, it, expect, beforeEach } from 'vitest';
import { ToolRegistry } from '../../../src/tools/base/ToolRegistry.ts';
import { Tool, type ToolResult, type ToolSchema } from '../../../src/tools/base/Tool.ts';

class MockTool extends Tool<Record<string, unknown>> {
  readonly name = 'mock_tool';
  readonly description = 'A mock tool for testing';
  readonly inputSchema: ToolSchema = {
    type: 'object',
    properties: {
      param: {
        type: 'string',
        description: 'A test parameter',
      },
    },
  };

  async call(params: Record<string, unknown>): Promise<ToolResult> {
    return this.ok('Mock result', 'Mock completed', 'Success');
  }
}

class AnotherMockTool extends Tool<Record<string, unknown>> {
  readonly name = 'another_tool';
  readonly description = 'Another mock tool';
  readonly inputSchema: ToolSchema = {
    type: 'object',
    properties: {},
  };

  async call(): Promise<ToolResult> {
    return this.ok('Another result');
  }
}

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  it('should register a tool', () => {
    const tool = new MockTool();
    registry.register(tool);

    expect(registry.has('mock_tool')).toBe(true);
    expect(registry.get('mock_tool')).toBe(tool);
  });

  it('should get all registered tools', () => {
    const tool1 = new MockTool();
    const tool2 = new AnotherMockTool();

    registry.register(tool1);
    registry.register(tool2);

    const allTools = registry.getAll();
    expect(allTools).toHaveLength(2);
    expect(allTools).toContain(tool1);
    expect(allTools).toContain(tool2);
  });

  it('should get tool schemas for Anthropic API', () => {
    const tool = new MockTool();
    registry.register(tool);

    const schemas = registry.getSchemas();

    expect(schemas).toHaveLength(1);
    expect(schemas[0]).toEqual({
      name: 'mock_tool',
      description: 'A mock tool for testing',
      input_schema: {
        type: 'object',
        properties: {
          param: {
            type: 'string',
            description: 'A test parameter',
          },
        },
      },
    });
  });

  it('should return undefined for non-existent tool', () => {
    expect(registry.get('non_existent')).toBeUndefined();
    expect(registry.has('non_existent')).toBe(false);
  });

  it('should allow registering multiple tools', () => {
    registry.register(new MockTool());
    registry.register(new AnotherMockTool());

    expect(registry.getAll()).toHaveLength(2);
    expect(registry.has('mock_tool')).toBe(true);
    expect(registry.has('another_tool')).toBe(true);
  });
});

describe('Tool Base Class', () => {
  class TestTool extends Tool<Record<string, unknown>> {
    readonly name = 'test_tool';
    readonly description = 'A test tool';
    readonly inputSchema: ToolSchema = {
      type: 'object',
      properties: {},
    };

    async call(): Promise<ToolResult> {
      return this.ok('Test result');
    }

    // Expose protected methods for testing
    public testOk(output: string, message?: string, brief?: string) {
      return this.ok(output, message, brief);
    }

    public testError(output: string, message: string, brief?: string) {
      return this.error(output, message, brief);
    }

    public testFormatError(error: unknown) {
      return this.formatError(error);
    }
  }

  let tool: TestTool;

  beforeEach(() => {
    tool = new TestTool();
  });

  it('should have correct metadata', () => {
    expect(tool.name).toBe('test_tool');
    expect(tool.description).toBe('A test tool');
    expect(tool.inputSchema.type).toBe('object');
  });

  it('should create success result with ok()', () => {
    const result = tool.testOk('Test output', 'Test message', 'Brief');

    expect(result.ok).toBe(true);
    expect(result.output).toBe('Test output');
    expect(result.message).toBe('Test message');
    expect(result.brief).toBe('Brief');
  });

  it('should create error result with error()', () => {
    const result = tool.testError('Error output', 'Error message', 'Failed');

    expect(result.ok).toBe(false);
    expect(result.output).toBe('Error output');
    expect(result.message).toBe('Error message');
    expect(result.brief).toBe('Failed');
  });

  it('should format errors correctly', () => {
    const error1 = new Error('Test error');
    expect(tool.testFormatError(error1)).toBe('Test error');

    const error2 = 'String error';
    expect(tool.testFormatError(error2)).toBe('String error');

    const error3 = { code: 'ERR_CODE', message: 'Custom error' };
    expect(tool.testFormatError(error3)).toBe('[object Object]');
  });
});
