import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ApprovalManager } from '../../src/agent/ApprovalManager';
import * as readline from 'readline';

// Mock readline module
vi.mock('readline', () => ({
  createInterface: vi.fn(),
}));

describe('ApprovalManager', () => {
  let manager: ApprovalManager;
  let mockRl: {
    question: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    // Setup mock readline interface
    mockRl = {
      question: vi.fn(),
      close: vi.fn(),
    };
    
    (readline.createInterface as any).mockReturnValue(mockRl);
  });

  describe('yolo mode', () => {
    it('should auto-approve when yolo is true', async () => {
      manager = new ApprovalManager(true);

      const result = await manager.request(
        'test_tool',
        'test_action',
        'Test description',
      );

      expect(result).toBe(true);
      expect(mockRl.question).not.toHaveBeenCalled();
    });

    it('should prompt when yolo is false', async () => {
      manager = new ApprovalManager(false);
      
      // Mock user choosing option 1 (approve once)
      mockRl.question.mockImplementation((_, callback) => callback('1'));

      const result = await manager.request(
        'test_tool',
        'test_action',
        'Test description',
      );

      expect(result).toBe(true);
      expect(mockRl.question).toHaveBeenCalledTimes(1);
      expect(mockRl.close).toHaveBeenCalled();
    });

    it('should toggle yolo mode', async () => {
      manager = new ApprovalManager(false);

      // Initially requires approval
      mockRl.question.mockImplementation((_, callback) => callback('1'));
      await manager.request('tool', 'action', 'desc');
      expect(mockRl.question).toHaveBeenCalled();

      // Clear mock calls
      mockRl.question.mockClear();

      // Enable yolo mode
      manager.setYolo(true);
      const result = await manager.request('tool', 'action', 'desc');

      expect(result).toBe(true);
      expect(mockRl.question).not.toHaveBeenCalled();
    });
  });

  describe('approval options', () => {
    beforeEach(() => {
      manager = new ApprovalManager(false);
    });

    it('should approve once when user chooses 1', async () => {
      mockRl.question.mockImplementation((_, callback) => callback('1'));

      const result1 = await manager.request('tool', 'action', 'First request');
      expect(result1).toBe(true);

      // Reset mock to verify second call
      mockRl.question.mockClear();
      mockRl.question.mockImplementation((_, callback) => callback('1'));

      const result2 = await manager.request('tool', 'action', 'Second request');
      expect(result2).toBe(true);
      
      // Should ask again for the same action
      expect(mockRl.question).toHaveBeenCalledTimes(1);
    });

    it('should approve for session when user chooses 2', async () => {
      mockRl.question.mockImplementation((_, callback) => callback('2'));

      const result1 = await manager.request('tool', 'test_action', 'First');
      expect(result1).toBe(true);
      expect(mockRl.question).toHaveBeenCalledTimes(1);

      // Clear mock calls
      mockRl.question.mockClear();

      // Second request with same action should auto-approve
      const result2 = await manager.request('tool', 'test_action', 'Second');
      expect(result2).toBe(true);
      expect(mockRl.question).not.toHaveBeenCalled();
    });

    it('should reject when user chooses 3', async () => {
      mockRl.question.mockImplementation((_, callback) => callback('3'));

      const result = await manager.request('tool', 'action', 'desc');

      expect(result).toBe(false);
      expect(mockRl.close).toHaveBeenCalled();
    });

    it('should reject on invalid input', async () => {
      mockRl.question.mockImplementation((_, callback) => callback('invalid'));

      const result = await manager.request('tool', 'action', 'desc');

      expect(result).toBe(false);
    });

    it('should reject on empty input', async () => {
      mockRl.question.mockImplementation((_, callback) => callback(''));

      const result = await manager.request('tool', 'action', 'desc');

      expect(result).toBe(false);
    });

    it('should handle whitespace in input', async () => {
      mockRl.question.mockImplementation((_, callback) => callback('  1  '));

      const result = await manager.request('tool', 'action', 'desc');

      expect(result).toBe(true);
    });
  });

  describe('session-based auto-approval', () => {
    beforeEach(() => {
      manager = new ApprovalManager(false);
    });

    it('should only auto-approve the same action', async () => {
      // Approve action1 for session
      mockRl.question.mockImplementation((_, callback) => callback('2'));
      await manager.request('tool', 'action1', 'desc');

      mockRl.question.mockClear();

      // action1 should auto-approve
      const result1 = await manager.request('tool', 'action1', 'desc');
      expect(result1).toBe(true);
      expect(mockRl.question).not.toHaveBeenCalled();

      // action2 should still prompt
      mockRl.question.mockImplementation((_, callback) => callback('1'));
      const result2 = await manager.request('tool', 'action2', 'desc');
      expect(result2).toBe(true);
      expect(mockRl.question).toHaveBeenCalledTimes(1);
    });

    it('should auto-approve multiple actions independently', async () => {
      // Approve action1 for session
      mockRl.question.mockImplementation((_, callback) => callback('2'));
      await manager.request('tool', 'action1', 'desc');

      mockRl.question.mockClear();

      // Approve action2 for session
      mockRl.question.mockImplementation((_, callback) => callback('2'));
      await manager.request('tool', 'action2', 'desc');

      mockRl.question.mockClear();

      // Both should auto-approve now
      const result1 = await manager.request('tool', 'action1', 'desc');
      const result2 = await manager.request('tool', 'action2', 'desc');

      expect(result1).toBe(true);
      expect(result2).toBe(true);
      expect(mockRl.question).not.toHaveBeenCalled();
    });
  });

  describe('console output', () => {
    beforeEach(() => {
      manager = new ApprovalManager(false);
      vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should display approval prompt with tool info', async () => {
      mockRl.question.mockImplementation((_, callback) => callback('1'));

      await manager.request('create_note', 'create_action', 'Create a new note');

      expect(console.log).toHaveBeenCalledWith('\n⚠️  Approval Required');
      expect(console.log).toHaveBeenCalledWith('Tool: create_note');
      expect(console.log).toHaveBeenCalledWith('Action: Create a new note');
    });

    it('should display options', async () => {
      mockRl.question.mockImplementation((_, callback) => callback('1'));

      await manager.request('tool', 'action', 'desc');

      expect(console.log).toHaveBeenCalledWith('\nOptions:');
      expect(console.log).toHaveBeenCalledWith('  1. Approve once');
      expect(console.log).toHaveBeenCalledWith('  2. Approve for this session');
      expect(console.log).toHaveBeenCalledWith('  3. Reject');
    });
  });

  describe('readline interface management', () => {
    beforeEach(() => {
      manager = new ApprovalManager(false);
    });

    it('should create readline interface for each request', async () => {
      mockRl.question.mockImplementation((_, callback) => callback('1'));

      await manager.request('tool', 'action', 'desc');

      expect(readline.createInterface).toHaveBeenCalledWith({
        input: process.stdin,
        output: process.stdout,
      });
    });

    it('should close readline interface after use', async () => {
      mockRl.question.mockImplementation((_, callback) => callback('1'));

      await manager.request('tool', 'action', 'desc');

      expect(mockRl.close).toHaveBeenCalled();
    });

    it('should close readline interface even on rejection', async () => {
      mockRl.question.mockImplementation((_, callback) => callback('3'));

      await manager.request('tool', 'action', 'desc');

      expect(mockRl.close).toHaveBeenCalled();
    });
  });
});
