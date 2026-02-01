/**
 * Application-wide constants
 * Centralizes magic strings and configuration values
 */

// Directory and file paths
export const CONFIG_DIR = '.hackwriter';
export const CONFIG_FILE = 'config.json';
export const SESSIONS_DIR = 'sessions';

// File size limits
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB for local files
export const MAX_HACKMD_CONTENT_SIZE = 5 * 1024 * 1024; // 5MB for HackMD API
export const MAX_FILE_DISPLAY_SIZE = 1024 * 1024; // 1MB display limit

// Display limits
export const MAX_FILES_DISPLAY = 100; // Maximum files to display in list

// HackMD API defaults
export const DEFAULT_HACKMD_API_URL = 'https://api.hackmd.io/v1';
export const DEFAULT_HACKMD_MCP_URL = 'https://mcp.hackmd.io/v1';

// HackMD CLI compatibility - environment variable names
export const HACKMD_CLI_TOKEN_ENV = 'HMD_API_ACCESS_TOKEN';
export const HACKMD_CLI_ENDPOINT_ENV = 'HMD_API_ENDPOINT_URL';
export const HACKWRITER_TOKEN_ENV = 'HACKMD_API_TOKEN';
export const HACKWRITER_API_URL_ENV = 'HACKMD_API_URL';
export const HACKWRITER_MCP_URL_ENV = 'HACKMD_MCP_URL';

// Model defaults
export const DEFAULT_MODEL = 'anthropic-claude-3-5-haiku-latest';

// Loop control defaults
export const DEFAULT_MAX_STEPS_PER_RUN = 100;
export const DEFAULT_MAX_RETRIES_PER_STEP = 3;
