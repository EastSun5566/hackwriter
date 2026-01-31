import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  HACKMD_CLI_TOKEN_ENV,
  HACKMD_CLI_ENDPOINT_ENV,
  HACKWRITER_TOKEN_ENV,
  HACKWRITER_API_URL_ENV,
  DEFAULT_HACKMD_API_URL,
} from '../../src/config/constants.js';

describe('HackMD CLI Compatibility', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear relevant environment variables before each test
    delete process.env[HACKWRITER_TOKEN_ENV];
    delete process.env[HACKMD_CLI_TOKEN_ENV];
    delete process.env[HACKWRITER_API_URL_ENV];
    delete process.env[HACKMD_CLI_ENDPOINT_ENV];
  });

  afterEach(() => {
    // Restore original environment
    process.env = { ...originalEnv };
  });

  describe('Environment Variable Priority', () => {
    it('should prioritize HackWriter token over HackMD CLI token', () => {
      process.env[HACKWRITER_TOKEN_ENV] = 'hackwriter-token';
      process.env[HACKMD_CLI_TOKEN_ENV] = 'hackmd-cli-token';

      const token = 
        process.env[HACKWRITER_TOKEN_ENV] ?? 
        process.env[HACKMD_CLI_TOKEN_ENV];

      expect(token).toBe('hackwriter-token');
    });

    it('should use HackMD CLI token when HackWriter token is not set', () => {
      process.env[HACKMD_CLI_TOKEN_ENV] = 'hackmd-cli-token';

      const token = 
        process.env[HACKWRITER_TOKEN_ENV] ?? 
        process.env[HACKMD_CLI_TOKEN_ENV];

      expect(token).toBe('hackmd-cli-token');
    });

    it('should prioritize HackWriter API URL over HackMD CLI endpoint', () => {
      process.env[HACKWRITER_API_URL_ENV] = 'https://hackwriter.example.com';
      process.env[HACKMD_CLI_ENDPOINT_ENV] = 'https://hackmd-cli.example.com';

      const url = 
        process.env[HACKWRITER_API_URL_ENV] ?? 
        process.env[HACKMD_CLI_ENDPOINT_ENV] ??
        DEFAULT_HACKMD_API_URL;

      expect(url).toBe('https://hackwriter.example.com');
    });

    it('should use HackMD CLI endpoint when HackWriter URL is not set', () => {
      process.env[HACKMD_CLI_ENDPOINT_ENV] = 'https://hackmd-cli.example.com';

      const url = 
        process.env[HACKWRITER_API_URL_ENV] ?? 
        process.env[HACKMD_CLI_ENDPOINT_ENV] ??
        DEFAULT_HACKMD_API_URL;

      expect(url).toBe('https://hackmd-cli.example.com');
    });

    it('should use default URL when neither is set', () => {
      const url = 
        process.env[HACKWRITER_API_URL_ENV] ?? 
        process.env[HACKMD_CLI_ENDPOINT_ENV] ??
        DEFAULT_HACKMD_API_URL;

      expect(url).toBe(DEFAULT_HACKMD_API_URL);
    });
  });

  describe('Environment Variable Names', () => {
    it('should have correct HackWriter token variable name', () => {
      expect(HACKWRITER_TOKEN_ENV).toBe('HACKMD_API_TOKEN');
    });

    it('should have correct HackMD CLI token variable name', () => {
      expect(HACKMD_CLI_TOKEN_ENV).toBe('HMD_API_ACCESS_TOKEN');
    });

    it('should have correct HackWriter API URL variable name', () => {
      expect(HACKWRITER_API_URL_ENV).toBe('HACKMD_API_URL');
    });

    it('should have correct HackMD CLI endpoint variable name', () => {
      expect(HACKMD_CLI_ENDPOINT_ENV).toBe('HMD_API_ENDPOINT_URL');
    });
  });

  describe('Compatibility Scenarios', () => {
    it('should work with only HackMD CLI variables set', () => {
      process.env[HACKMD_CLI_TOKEN_ENV] = 'cli-token';
      process.env[HACKMD_CLI_ENDPOINT_ENV] = 'https://cli.example.com';

      const token = 
        process.env[HACKWRITER_TOKEN_ENV] ?? 
        process.env[HACKMD_CLI_TOKEN_ENV];
      
      const url = 
        process.env[HACKWRITER_API_URL_ENV] ?? 
        process.env[HACKMD_CLI_ENDPOINT_ENV] ??
        DEFAULT_HACKMD_API_URL;

      expect(token).toBe('cli-token');
      expect(url).toBe('https://cli.example.com');
    });

    it('should work with only HackWriter variables set', () => {
      process.env[HACKWRITER_TOKEN_ENV] = 'writer-token';
      process.env[HACKWRITER_API_URL_ENV] = 'https://writer.example.com';

      const token = 
        process.env[HACKWRITER_TOKEN_ENV] ?? 
        process.env[HACKMD_CLI_TOKEN_ENV];
      
      const url = 
        process.env[HACKWRITER_API_URL_ENV] ?? 
        process.env[HACKMD_CLI_ENDPOINT_ENV] ??
        DEFAULT_HACKMD_API_URL;

      expect(token).toBe('writer-token');
      expect(url).toBe('https://writer.example.com');
    });

    it('should work with mixed variables (HackWriter token, CLI endpoint)', () => {
      process.env[HACKWRITER_TOKEN_ENV] = 'writer-token';
      process.env[HACKMD_CLI_ENDPOINT_ENV] = 'https://cli.example.com';

      const token = 
        process.env[HACKWRITER_TOKEN_ENV] ?? 
        process.env[HACKMD_CLI_TOKEN_ENV];
      
      const url = 
        process.env[HACKWRITER_API_URL_ENV] ?? 
        process.env[HACKMD_CLI_ENDPOINT_ENV] ??
        DEFAULT_HACKMD_API_URL;

      expect(token).toBe('writer-token');
      expect(url).toBe('https://cli.example.com');
    });

    it('should handle empty string values correctly', () => {
      process.env[HACKWRITER_TOKEN_ENV] = '';
      process.env[HACKMD_CLI_TOKEN_ENV] = 'fallback-token';

      // Empty string is falsy, should fall back to CLI token
      const token = 
        process.env[HACKWRITER_TOKEN_ENV] || 
        process.env[HACKMD_CLI_TOKEN_ENV];

      expect(token).toBe('fallback-token');
    });
  });
});
