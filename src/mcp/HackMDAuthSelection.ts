import { Logger } from "../utils/Logger.ts";
import type {
  HackMDOAuthCredential,
  HackMDOAuthStore,
} from "./HackMDOAuthStore.ts";

export type HackMDMcpAuthSource =
  | "oauth-interactive"
  | "oauth-stored"
  | "bearer"
  | "unavailable";

export function chooseHackMDMcpAuthSource(options: {
  hasOAuthTokens: boolean;
  hasApiToken: boolean;
  allowOAuthLogin: boolean;
}): HackMDMcpAuthSource {
  if (options.hasOAuthTokens) {
    return options.allowOAuthLogin ? "oauth-interactive" : "oauth-stored";
  }
  if (options.hasApiToken) return "bearer";
  return options.allowOAuthLogin ? "oauth-interactive" : "unavailable";
}

export async function readHackMDOAuthCredential(options: {
  store: HackMDOAuthStore;
  serverUrl: string;
  hasApiToken: boolean;
}): Promise<HackMDOAuthCredential | undefined> {
  try {
    return await options.store.read(options.serverUrl);
  } catch (error) {
    if (!options.hasApiToken) throw error;
    Logger.warn(
      "HackMDOAuth",
      "Stored OAuth credentials are unreadable; using the available HackMD API token",
    );
    return undefined;
  }
}
