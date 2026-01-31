import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Logger } from '../utils/Logger.js';

/**
 * HackMD CLI configuration structure
 * Located at ~/.hackmd/config.json
 */
export interface HackMDCLIConfig {
  accessToken?: string;
  hackmdAPIEndpointURL?: string;
}

/**
 * Load HackMD CLI configuration from ~/.hackmd/config.json
 * This provides compatibility with the official HackMD CLI tool
 * 
 * @returns HackMD CLI config object or null if not found
 */
export async function loadHackMDCLIConfig(): Promise<HackMDCLIConfig | null> {
  const configPath = path.join(os.homedir(), '.hackmd', 'config.json');
  
  try {
    const content = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(content) as HackMDCLIConfig;
    
    Logger.debug('HackMDConfigLoader', 'Loaded HackMD CLI config', {
      hasToken: !!config.accessToken,
      hasEndpoint: !!config.hackmdAPIEndpointURL,
    });
    
    return config;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      Logger.debug('HackMDConfigLoader', 'No HackMD CLI config found at ~/.hackmd/config.json');
      return null;
    }
    
    // Log parsing errors but don't throw
    if (error instanceof SyntaxError) {
      Logger.warn('HackMDConfigLoader', 'Failed to parse HackMD CLI config', {
        error: error.message,
      });
      return null;
    }
    
    // Re-throw other errors
    throw error;
  }
}

/**
 * Check if HackMD CLI config exists
 */
export async function hasHackMDCLIConfig(): Promise<boolean> {
  const configPath = path.join(os.homedir(), '.hackmd', 'config.json');
  
  try {
    await fs.access(configPath);
    return true;
  } catch {
    return false;
  }
}
