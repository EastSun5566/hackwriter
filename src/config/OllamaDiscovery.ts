import { exec } from 'child_process';
import { promisify } from 'util';
import { Logger } from '../utils/Logger.js';
import type { ModelDefinition } from './ProviderRegistry.js';

const execAsync = promisify(exec);

export interface OllamaModel {
  name: string;
  id: string;
  size: string;
  modified: string;
}

/**
 * Discover Ollama models by running `ollama list`
 */
export async function discoverOllamaModels(): Promise<ModelDefinition[]> {
  try {
    const { stdout } = await execAsync('ollama list');
    const lines = stdout.trim().split('\n');

    // Skip header line
    const modelLines = lines.slice(1);

    const models: ModelDefinition[] = [];

    for (const line of modelLines) {
      // Parse line: "qwen2.5-coder:7b    dae161e27b0e    4.7 GB    3 days ago"
      const regex = /^(\S+)\s+/;
      const match = regex.exec(line);
      if (!match) continue;

      const modelId = match[1];

      models.push({
        id: modelId,
        name: modelId, // Use ID as name for now
        contextWindow: 128000, // Default context window
      });

      Logger.debug('OllamaDiscovery', `Discovered Ollama model: ${modelId}`);
    }

    return models;
  } catch (error) {
    Logger.debug('OllamaDiscovery', `Failed to discover Ollama models: ${String(error)}`);
    return [];
  }
}
