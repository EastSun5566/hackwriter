import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { discoverProviders, discoverModels, getShortModelName } from '../../src/config/ProviderDiscovery.js';

describe('ProviderDiscovery', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('discoverProviders', () => {
    it('should discover Anthropic provider from env', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test';

      const providers = discoverProviders();

      expect(providers.anthropic).toBeDefined();
      expect(providers.anthropic.type).toBe('anthropic');
      expect(providers.anthropic.apiKey).toBe('sk-ant-test');
    });

    it('should discover OpenAI provider from env', () => {
      process.env.OPENAI_API_KEY = 'sk-test';

      const providers = discoverProviders();

      expect(providers.openai).toBeDefined();
      expect(providers.openai.type).toBe('openai');
      expect(providers.openai.apiKey).toBe('sk-test');
    });

    it('should discover Ollama provider (no API key needed)', () => {
      const providers = discoverProviders();

      expect(providers.ollama).toBeDefined();
      expect(providers.ollama.type).toBe('ollama');
      expect(providers.ollama.baseUrl).toBe('http://localhost:11434/api');
    });

    it('should discover multiple providers', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
      process.env.OPENAI_API_KEY = 'sk-test';

      const providers = discoverProviders();

      expect(Object.keys(providers)).toContain('anthropic');
      expect(Object.keys(providers)).toContain('openai');
      expect(Object.keys(providers)).toContain('ollama');
    });

    it('should not discover providers without API keys', () => {
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.OPENAI_API_KEY;

      const providers = discoverProviders();

      expect(providers.anthropic).toBeUndefined();
      expect(providers.openai).toBeUndefined();
      // Ollama should still be present
      expect(providers.ollama).toBeDefined();
    });
  });

  describe('discoverModels', () => {
    it('should discover Anthropic models', async () => {
      const providers = {
        anthropic: {
          type: 'anthropic' as const,
          apiKey: 'test',
        },
      };

      const models = await discoverModels(providers);

      expect(models['anthropic-claude-3-5-haiku-latest']).toBeDefined();
      expect(models['anthropic-claude-3-5-haiku-latest'].provider).toBe('anthropic');
      expect(models['anthropic-claude-3-5-haiku-latest'].model).toBe('claude-3-5-haiku-latest');
      expect(models['anthropic-claude-3-5-sonnet-latest']).toBeDefined();
    });

    it('should discover OpenAI models', async () => {
      const providers = {
        openai: {
          type: 'openai' as const,
          apiKey: 'test',
        },
      };

      const models = await discoverModels(providers);

      expect(models['openai-gpt-4o-mini']).toBeDefined();
      expect(models['openai-gpt-4o']).toBeDefined();
      expect(models['openai-o1']).toBeDefined();
    });

    it('should return empty object for unknown providers', async () => {
      const providers = {
        unknown: {
          type: 'anthropic' as const,
          apiKey: 'test',
        },
      };

      const models = await discoverModels(providers);

      expect(Object.keys(models)).toHaveLength(0);
    });
  });

  describe('getShortModelName', () => {
    it('should extract "haiku" from Claude model', () => {
      expect(getShortModelName('claude-3-5-haiku-latest')).toBe('haiku');
      expect(getShortModelName('claude-3-5-haiku-20240307')).toBe('haiku');
    });

    it('should extract "sonnet" from Claude model', () => {
      expect(getShortModelName('claude-3-5-sonnet-latest')).toBe('sonnet');
    });

    it('should extract "opus" from Claude model', () => {
      expect(getShortModelName('claude-opus-4-latest')).toBe('opus');
    });

    it('should keep GPT model names', () => {
      expect(getShortModelName('gpt-4o-mini')).toBe('gpt-4o-mini');
      expect(getShortModelName('gpt-4o')).toBe('gpt-4o');
      expect(getShortModelName('o1')).toBe('o1');
    });

    it('should extract llama version', () => {
      expect(getShortModelName('llama3.1:8b')).toBe('llama3.1');
      expect(getShortModelName('llama3.2:7b')).toBe('llama3.2');
    });

    it('should return full ID for unknown models', () => {
      expect(getShortModelName('unknown-model-123')).toBe('unknown-model-123');
    });
  });
});
