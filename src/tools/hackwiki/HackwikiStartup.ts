import { select } from '@inquirer/prompts';
import { API } from '@hackmd/api';
import type { Configuration, HackwikiConfig } from '../../config/Configuration.js';
import { ConfigurationLoader } from '../../config/ConfigurationLoader.js';
import { Logger } from '../../utils/Logger.js';

interface NoteSummary {
  title?: string;
}

const RESERVED_TITLES = [
  '[hackwiki] schema',
  '[hackwiki] index',
  '[hackwiki] log',
] as const;

export type HackwikiBootstrapState = 'ready' | 'needs-bootstrap' | 'invalid';
type HackwikiBootstrapChoice =
  | 'enable_once'
  | 'enable_always'
  | 'skip_once'
  | 'disable_always';

export interface HackwikiStartupResolution {
  enabled: boolean;
  bootstrapState?: HackwikiBootstrapState;
  warning?: string;
  persistedChoice?: 'enabled' | 'disabled';
}

function sanitizeHackwikiConfig(config?: HackwikiConfig): HackwikiConfig {
  return Object.fromEntries(
    Object.entries(config ?? {}).filter(([, value]) => value !== undefined),
  ) as HackwikiConfig;
}

async function persistHackwikiPreference(
  config: Configuration,
  enabled: boolean,
): Promise<void> {
  const nextHackwikiConfig = sanitizeHackwikiConfig({
    ...config.services.hackwiki,
    enabled,
  });

  config.services.hackwiki = nextHackwikiConfig;

  await ConfigurationLoader.updateUserConfig((userConfig) => {
    userConfig.services = {
      ...userConfig.services,
      hackwiki: {
        ...userConfig.services?.hackwiki,
        ...nextHackwikiConfig,
      },
    };
  });
}

export async function inspectHackwikiBootstrapState(
  config: Configuration,
): Promise<HackwikiBootstrapState> {
  const hackmdConfig = config.services.hackmd;
  if (!hackmdConfig) {
    return 'needs-bootstrap';
  }

  const api = new API(
    hackmdConfig.apiToken,
    config.services.hackwiki?.apiUrl ?? hackmdConfig.apiBaseUrl,
  );
  const notes = await api.getNoteList();

  let hasDuplicate = false;
  let missingReservedNote = false;

  for (const title of RESERVED_TITLES) {
    const matchCount = notes.filter(
      (note: NoteSummary) => note.title === title,
    ).length;
    if (matchCount > 1) {
      hasDuplicate = true;
    }
    if (matchCount !== 1) {
      missingReservedNote = true;
    }
  }

  if (hasDuplicate) {
    return 'invalid';
  }

  return missingReservedNote ? 'needs-bootstrap' : 'ready';
}

async function promptForHackwikiBootstrapChoice(): Promise<HackwikiBootstrapChoice> {
  return select({
    message:
      'Hackwiki durable memory is available. The first enable will create 3 reserved HackMD notes ([hackwiki] schema/index/log). Once enabled, HackWriter may automatically save or update durable memory after answers complete. How would you like to proceed?',
    choices: [
      {
        name: 'Enable once (allow automatic post-turn saves this session)',
        value: 'enable_once',
      },
      {
        name: 'Always enable and remember this choice',
        value: 'enable_always',
      },
      {
        name: 'Not now',
        value: 'skip_once',
      },
      {
        name: 'Always keep disabled',
        value: 'disable_always',
      },
    ],
  });
}

export async function resolveHackwikiStartup(
  config: Configuration,
  options: { yolo?: boolean },
): Promise<HackwikiStartupResolution> {
  const configuredPreference = config.services.hackwiki?.enabled;

  if (configuredPreference === false) {
    return { enabled: false };
  }

  if (configuredPreference === true) {
    return { enabled: true };
  }

  let bootstrapState: HackwikiBootstrapState;
  try {
    bootstrapState = await inspectHackwikiBootstrapState(config);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    Logger.warn('HackwikiStartup', `Failed to inspect Hackwiki bootstrap state: ${message}`);
    return {
      enabled: false,
      warning: `Failed to inspect Hackwiki startup state, continuing without wiki memory: ${message}`,
    };
  }

  if (bootstrapState !== 'needs-bootstrap') {
    return {
      enabled: true,
      bootstrapState,
    };
  }

  if (options.yolo) {
    return {
      enabled: true,
      bootstrapState,
    };
  }

  const choice = await promptForHackwikiBootstrapChoice();
  switch (choice) {
    case 'enable_once':
      return {
        enabled: true,
        bootstrapState,
      };

    case 'enable_always':
      await persistHackwikiPreference(config, true);
      return {
        enabled: true,
        bootstrapState,
        persistedChoice: 'enabled',
      };

    case 'disable_always':
      await persistHackwikiPreference(config, false);
      return {
        enabled: false,
        bootstrapState,
        persistedChoice: 'disabled',
      };

    case 'skip_once':
    default:
      return {
        enabled: false,
        bootstrapState,
      };
  }
}