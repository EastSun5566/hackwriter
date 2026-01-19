import { describe, it, expect } from 'vitest';
import { discoverOllamaModels } from '../../src/config/OllamaDiscovery.js';

describe('OllamaDiscovery', () => {
  it('should return array of models', async () => {
    const models = await discoverOllamaModels();
    
    // Either we get real models, or empty array if ollama not installed
    expect(Array.isArray(models)).toBe(true);
  });

  it('should have valid model structure', async () => {
    const models = await discoverOllamaModels();
    
    // All models should have required properties
    models.forEach((model) => {
      expect(model).toHaveProperty('id');
      expect(model).toHaveProperty('name');
      expect(model).toHaveProperty('contextWindow');
      expect(typeof model.id).toBe('string');
      expect(typeof model.contextWindow).toBe('number');
      expect(model.contextWindow).toBe(128000);
    });
  });
});
