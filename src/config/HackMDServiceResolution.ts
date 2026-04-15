import type { HackMDConfig } from './Configuration.js';
import {
  DEFAULT_HACKMD_API_URL,
  DEFAULT_HACKMD_MCP_URL,
  HACKMD_CLI_ENDPOINT_ENV,
  HACKMD_CLI_TOKEN_ENV,
  HACKWRITER_API_URL_ENV,
  HACKWRITER_MCP_URL_ENV,
  HACKWRITER_TOKEN_ENV,
} from './constants.js';

export interface HackMDCLIConfigLike {
  accessToken?: string;
  hackmdAPIEndpointURL?: string;
}

export type HackMDTokenSource =
  | 'env-hackwriter'
  | 'env-cli'
  | 'config-hackwriter'
  | 'config-cli';

interface ResolvedValue<TSource extends string> {
  value?: string;
  source?: TSource;
}

function normalizeValue(value?: string): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed;
}

function firstDefined<TSource extends string>(
  entries: { value?: string; source: TSource }[],
): ResolvedValue<TSource> {
  const match = entries.find((entry) => entry.value !== undefined);
  return {
    value: match?.value,
    source: match?.source,
  };
}

export function resolveHackMDToken(
  userHackMDConfig?: Partial<HackMDConfig>,
  hackmdCLIConfig?: HackMDCLIConfigLike | null,
): { token?: string; source?: HackMDTokenSource } {
  const resolved = firstDefined<HackMDTokenSource>([
    {
      value: normalizeValue(process.env[HACKWRITER_TOKEN_ENV]),
      source: 'env-hackwriter',
    },
    {
      value: normalizeValue(process.env[HACKMD_CLI_TOKEN_ENV]),
      source: 'env-cli',
    },
    {
      value: normalizeValue(userHackMDConfig?.apiToken),
      source: 'config-hackwriter',
    },
    {
      value: normalizeValue(hackmdCLIConfig?.accessToken),
      source: 'config-cli',
    },
  ]);

  return {
    token: resolved.value,
    source: resolved.source,
  };
}

export function resolveHackMDApiBaseUrl(
  userHackMDConfig?: Partial<HackMDConfig>,
  hackmdCLIConfig?: HackMDCLIConfigLike | null,
): string {
  return (
    firstDefined([
      {
        value: normalizeValue(process.env[HACKWRITER_API_URL_ENV]),
        source: 'env-hackwriter',
      },
      {
        value: normalizeValue(process.env[HACKMD_CLI_ENDPOINT_ENV]),
        source: 'env-cli',
      },
      {
        value: normalizeValue(userHackMDConfig?.apiBaseUrl),
        source: 'config-hackwriter',
      },
      {
        value: normalizeValue(hackmdCLIConfig?.hackmdAPIEndpointURL),
        source: 'config-cli',
      },
    ]).value ?? DEFAULT_HACKMD_API_URL
  );
}

export function resolveHackMDMcpBaseUrl(
  userHackMDConfig?: Partial<HackMDConfig>,
): string {
  return (
    normalizeValue(process.env[HACKWRITER_MCP_URL_ENV]) ??
    normalizeValue(userHackMDConfig?.mcpBaseUrl) ??
    DEFAULT_HACKMD_MCP_URL
  );
}

export function resolveHackMDServiceConfig(
  userHackMDConfig?: Partial<HackMDConfig>,
  hackmdCLIConfig?: HackMDCLIConfigLike | null,
): {
  hackmd?: HackMDConfig;
  tokenSource?: HackMDTokenSource;
} {
  const { token, source } = resolveHackMDToken(userHackMDConfig, hackmdCLIConfig);

  if (!token) {
    return { tokenSource: source };
  }

  return {
    tokenSource: source,
    hackmd: {
      apiToken: token,
      apiBaseUrl: resolveHackMDApiBaseUrl(userHackMDConfig, hackmdCLIConfig),
      mcpBaseUrl: resolveHackMDMcpBaseUrl(userHackMDConfig),
    },
  };
}

export function describeHackMDTokenSource(
  source?: HackMDTokenSource,
): string | undefined {
  switch (source) {
    case 'env-hackwriter':
      return 'HACKMD_API_TOKEN';
    case 'env-cli':
      return 'HMD_API_ACCESS_TOKEN (HackMD CLI)';
    case 'config-hackwriter':
      return 'HackWriter config';
    case 'config-cli':
      return 'HackMD CLI config (~/.hackmd/config.json)';
    default:
      return undefined;
  }
}