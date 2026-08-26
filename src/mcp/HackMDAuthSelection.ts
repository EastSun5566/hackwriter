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
