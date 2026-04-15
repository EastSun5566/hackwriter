import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadHackMDCLIConfig, hasHackMDCLIConfig } from '../../src/config/HackMDConfigLoader.js';

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();

  return {
    ...actual,
    promises: {
      ...actual.promises,
      readFile: vi.fn(),
      access: vi.fn(),
    },
  };
});

describe('HackMDConfigLoader', () => {
  const mockConfigPath = path.join(os.homedir(), '.hackmd', 'config.json');
  const readFileMock = fs.readFile as unknown as Mock;
  const accessMock = fs.access as unknown as Mock;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('loadHackMDCLIConfig', () => {
    it('should load valid HackMD CLI config', async () => {
      const mockConfig = {
        accessToken: 'test-token',
        hackmdAPIEndpointURL: 'https://api.hackmd.io/v1',
      };

      readFileMock.mockResolvedValue(JSON.stringify(mockConfig));

      const result = await loadHackMDCLIConfig();

      expect(result).toEqual(mockConfig);
      expect(fs.readFile).toHaveBeenCalledWith(mockConfigPath, 'utf-8');
    });

    it('should return null when config file does not exist', async () => {
      const error = new Error('ENOENT') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      readFileMock.mockRejectedValue(error);

      const result = await loadHackMDCLIConfig();

      expect(result).toBeNull();
    });

    it('should return null when config file has invalid JSON', async () => {
      readFileMock.mockResolvedValue('invalid json{');

      const result = await loadHackMDCLIConfig();

      expect(result).toBeNull();
    });

    it('should handle config with only accessToken', async () => {
      const mockConfig = {
        accessToken: 'test-token',
      };

      readFileMock.mockResolvedValue(JSON.stringify(mockConfig));

      const result = await loadHackMDCLIConfig();

      expect(result).toEqual(mockConfig);
      expect(result?.accessToken).toBe('test-token');
      expect(result?.hackmdAPIEndpointURL).toBeUndefined();
    });

    it('should handle config with only hackmdAPIEndpointURL', async () => {
      const mockConfig = {
        hackmdAPIEndpointURL: 'https://custom.hackmd.io/v1',
      };

      readFileMock.mockResolvedValue(JSON.stringify(mockConfig));

      const result = await loadHackMDCLIConfig();

      expect(result).toEqual(mockConfig);
      expect(result?.accessToken).toBeUndefined();
      expect(result?.hackmdAPIEndpointURL).toBe('https://custom.hackmd.io/v1');
    });

    it('should handle empty config object', async () => {
      const mockConfig = {};

      readFileMock.mockResolvedValue(JSON.stringify(mockConfig));

      const result = await loadHackMDCLIConfig();

      expect(result).toEqual(mockConfig);
    });

    it('should throw on unexpected errors', async () => {
      const error = new Error('Permission denied');
      readFileMock.mockRejectedValue(error);

      await expect(loadHackMDCLIConfig()).rejects.toThrow('Permission denied');
    });
  });

  describe('hasHackMDCLIConfig', () => {
    it('should return true when config file exists', async () => {
      accessMock.mockResolvedValue(undefined);

      const result = await hasHackMDCLIConfig();

      expect(result).toBe(true);
      expect(fs.access).toHaveBeenCalledWith(mockConfigPath);
    });

    it('should return false when config file does not exist', async () => {
      accessMock.mockRejectedValue(new Error('ENOENT'));

      const result = await hasHackMDCLIConfig();

      expect(result).toBe(false);
    });

    it('should return false on permission errors', async () => {
      accessMock.mockRejectedValue(new Error('EACCES'));

      const result = await hasHackMDCLIConfig();

      expect(result).toBe(false);
    });
  });
});
