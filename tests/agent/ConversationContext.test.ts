import { promises as fs } from 'fs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Anthropic } from '@anthropic-ai/sdk';
import * as path from 'path';
import * as os from 'os';
import { ConversationContext } from '../../src/agent/ConversationContext';

describe('ConversationContext', () => {
  let tempDir: string;
  let tempFile: string;
  let context: ConversationContext;

  beforeEach(async () => {
    // Create temporary directory and file
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hackmd-test-'));
    tempFile = path.join(tempDir, 'context.jsonl');
    context = new ConversationContext(tempFile);
  });

  afterEach(async () => {
    // Cleanup temporary files
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('initialization', () => {
    it('should start with empty history', () => {
      expect(context.getHistory()).toEqual([]);
      expect(context.tokenCount).toBe(0);
      expect(context.checkpointCount).toBe(0);
    });

    it('should handle non-existent file on load', async () => {
      const loaded = await context.loadFromDisk();
      
      expect(loaded).toBe(false);
      expect(context.getHistory()).toEqual([]);
    });
  });

  describe('message management', () => {
    it('should add single message', async () => {
      const message: Anthropic.MessageParam = {
        role: 'user',
        content: 'Hello',
      };

      await context.addMessage(message);

      expect(context.getHistory()).toHaveLength(1);
      expect(context.getHistory()[0]).toEqual(message);
    });

    it('should add multiple messages', async () => {
      const messages: Anthropic.MessageParam[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ];

      await context.addMessage(messages);

      expect(context.getHistory()).toHaveLength(2);
      expect(context.getHistory()).toEqual(messages);
    });

    it('should persist messages to disk', async () => {
      await context.addMessage({ role: 'user', content: 'Test' });
      await context.flush(); // Wait for batch writer to flush

      const fileContent = await fs.readFile(tempFile, 'utf-8');
      expect(fileContent).toContain('"role":"user"');
      expect(fileContent).toContain('Test');
    });
  });

  describe('checkpoint management', () => {
    it('should create checkpoints with sequential IDs', async () => {
      const checkpoint1 = await context.createCheckpoint();
      const checkpoint2 = await context.createCheckpoint();
      const checkpoint3 = await context.createCheckpoint();

      expect(checkpoint1).toBe(0);
      expect(checkpoint2).toBe(1);
      expect(checkpoint3).toBe(2);
      expect(context.checkpointCount).toBe(3);
    });

    it('should persist checkpoints to disk', async () => {
      await context.createCheckpoint();
      await context.flush(); // Wait for batch writer to flush

      const fileContent = await fs.readFile(tempFile, 'utf-8');
      expect(fileContent).toContain('"type":"checkpoint"');
      expect(fileContent).toContain('"id":0');
    });

    it('should revert to checkpoint', async () => {
      await context.createCheckpoint(); // 0
      await context.addMessage({ role: 'user', content: 'Message 1' });
      await context.createCheckpoint(); // 1
      await context.addMessage({ role: 'user', content: 'Message 2' });
      await context.createCheckpoint(); // 2
      await context.addMessage({ role: 'user', content: 'Message 3' });
      await context.flush(); // Wait for batch writer to flush

      expect(context.getHistory()).toHaveLength(3);

      await context.revertToCheckpoint(1);

      expect(context.getHistory()).toHaveLength(1);
      expect(context.getHistory()[0].content).toBe('Message 1');
    });

    it('should create backup when reverting', async () => {
      await context.createCheckpoint();
      await context.addMessage({ role: 'user', content: 'Test' });
      await context.flush(); // Wait for batch writer to flush
      
      await context.revertToCheckpoint(0);

      const files = await fs.readdir(tempDir);
      const backupFiles = files.filter(f => f.includes('.backup'));
      expect(backupFiles.length).toBeGreaterThan(0);
    });
  });

  describe('token counting', () => {
    it('should track token count', async () => {
      expect(context.tokenCount).toBe(0);

      await context.setTokenCount(100);
      expect(context.tokenCount).toBe(100);

      await context.setTokenCount(150);
      expect(context.tokenCount).toBe(150);
    });

    it('should persist token count to disk', async () => {
      await context.setTokenCount(500);
      await context.flush(); // Wait for batch writer to flush

      const fileContent = await fs.readFile(tempFile, 'utf-8');
      expect(fileContent).toContain('"type":"usage"');
      expect(fileContent).toContain('"tokenCount":500');
    });
  });

  describe('persistence and loading', () => {
    it('should restore context from file', async () => {
      // Write test data directly
      const records = [
        { type: 'checkpoint', id: 0 },
        { type: 'message', data: { role: 'user', content: 'Hello' } },
        { type: 'usage', tokenCount: 100 },
        { type: 'checkpoint', id: 1 },
        { type: 'message', data: { role: 'assistant', content: 'Hi' } },
        { type: 'usage', tokenCount: 150 },
      ];

      await fs.writeFile(
        tempFile,
        records.map(r => JSON.stringify(r)).join('\n') + '\n',
        'utf-8'
      );

      const newContext = new ConversationContext(tempFile);
      const loaded = await newContext.loadFromDisk();

      expect(loaded).toBe(true);
      expect(newContext.getHistory()).toHaveLength(2);
      expect(newContext.tokenCount).toBe(150);
      expect(newContext.checkpointCount).toBe(2);
    });

    it('should handle corrupted lines gracefully', async () => {
      await fs.writeFile(
        tempFile,
        'invalid json\n{"type":"message","data":{"role":"user","content":"Valid"}}\n',
        'utf-8'
      );

      const newContext = new ConversationContext(tempFile);
      const loaded = await newContext.loadFromDisk();
      
      // Should succeed and skip the corrupted line
      expect(loaded).toBe(true);
      expect(newContext.getHistory()).toHaveLength(1);
      expect(newContext.getHistory()[0].content).toBe('Valid');
    });

    it('should preserve order when loading', async () => {
      await context.addMessage({ role: 'user', content: 'First' });
      await context.addMessage({ role: 'assistant', content: 'Second' });
      await context.addMessage({ role: 'user', content: 'Third' });
      await context.flush(); // Wait for batch writer to flush

      const newContext = new ConversationContext(tempFile);
      await newContext.loadFromDisk();

      const history = newContext.getHistory();
      expect(history[0].content).toBe('First');
      expect(history[1].content).toBe('Second');
      expect(history[2].content).toBe('Third');
    });
  });

  describe('edge cases', () => {
    it('should handle empty messages array', async () => {
      await context.addMessage([]);
      expect(context.getHistory()).toHaveLength(0);
    });

    it('should handle messages with complex content', async () => {
      const message: Anthropic.MessageParam = {
        role: 'user',
        content: [
          { type: 'text', text: 'Hello' },
          { type: 'text', text: 'World' },
        ],
      };

      await context.addMessage(message);

      expect(context.getHistory()).toHaveLength(1);
      expect(context.getHistory()[0]).toEqual(message);
    });

    it('should handle large token counts', async () => {
      await context.setTokenCount(1000000);
      expect(context.tokenCount).toBe(1000000);

      await context.setTokenCount(1999999);
      expect(context.tokenCount).toBe(1999999);
    });
  });
});
