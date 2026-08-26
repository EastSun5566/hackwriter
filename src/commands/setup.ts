import { input, password, select } from "@inquirer/prompts";
import chalk from "chalk";
import type {
  AuthEvent,
  AuthInteraction,
  AuthPrompt,
  Credential,
  Provider,
} from "@earendil-works/pi-ai";

import { ConfigurationLoader } from "../config/ConfigurationLoader.ts";
import type { Configuration } from "../config/Configuration.ts";
import { ModelService } from "../config/ModelService.ts";
import { loadHackMDCLIConfig } from "../config/HackMDConfigLoader.ts";
import {
  describeHackMDTokenSource,
  resolveHackMDServiceConfig,
} from "../config/HackMDServiceResolution.ts";
import {
  FileHackMDOAuthStore,
  MCPClient,
  createInteractiveHackMDOAuthSession,
  type HackMDOAuthStore,
} from "../mcp/index.ts";
import { readHackMDOAuthCredential } from "../mcp/HackMDAuthSelection.ts";

function printSetupHeader(): void {
  console.log(chalk.bold.cyan("\n🔧 HackWriter Setup\n"));
}

function printAuthEvent(event: AuthEvent): void {
  switch (event.type) {
    case "auth_url":
      console.log(chalk.cyan(`Open: ${event.url}`));
      if (event.instructions) console.log(chalk.gray(event.instructions));
      break;
    case "device_code":
      console.log(chalk.cyan(`Open: ${event.verificationUri}`));
      console.log(chalk.bold(`Code: ${event.userCode}`));
      break;
    case "progress":
      console.log(chalk.gray(event.message));
      break;
  }
}

async function answerAuthPrompt(prompt: AuthPrompt): Promise<string> {
  if (prompt.signal?.aborted) throw new Error("Authentication cancelled");
  switch (prompt.type) {
    case "secret":
      return password({ message: prompt.message, mask: "*" });
    case "select":
      return select({
        message: prompt.message,
        choices: prompt.options.map((option) => ({
          name: option.label,
          value: option.id,
          description: option.description,
        })),
      });
    case "manual_code":
    case "text":
      return input({
        message: prompt.message,
        default: prompt.placeholder,
      });
  }
}

function authCallbacks(): AuthInteraction {
  return { prompt: answerAuthPrompt, notify: printAuthEvent };
}

async function loginProvider(
  service: ModelService,
  provider: Provider,
): Promise<boolean> {
  const methods: { name: string; value: "api_key" | "oauth" }[] = [];
  if (provider.auth.apiKey?.login) {
    methods.push({ name: provider.auth.apiKey.name, value: "api_key" });
  }
  if (provider.auth.oauth) {
    methods.push({ name: provider.auth.oauth.name, value: "oauth" });
  }

  if (methods.length === 0) {
    console.log(chalk.yellow(`${provider.name} uses ambient credentials.`));
    console.log(
      chalk.gray(
        `Configure ${provider.auth.apiKey?.name ?? "the provider's external credentials"} outside HackWriter, then retry.`,
      ),
    );
    return false;
  }

  const method = methods.length === 1
    ? methods[0].value
    : await select({ message: "Authentication method:", choices: methods });
  let credential: Credential;
  if (method === "oauth") {
    credential = await provider.auth.oauth!.login(authCallbacks());
  } else {
    credential = await provider.auth.apiKey!.login!(authCallbacks());
  }

  await service.credentials.modify(provider.id, () => Promise.resolve(credential));
  console.log(chalk.green(`✓ ${provider.name} authentication saved`));
  return true;
}

async function chooseProvider(
  service: ModelService,
  message: string,
): Promise<Provider | undefined> {
  const statuses = await service.providerStatuses();
  const id = await select({
    message,
    pageSize: 16,
    choices: [
      ...statuses.map((status) => ({
        name: `${status.name} (${status.id})${status.available ? ` — ${status.modelCount} models` : ""}`,
        value: status.id,
        description: status.authSource ?? status.error,
      })),
      { name: "Cancel", value: "__cancel" },
    ],
  });
  return id === "__cancel" ? undefined : service.models.getProvider(id);
}

export async function selectDefaultModel(
  config: Configuration,
  service: ModelService,
): Promise<string | undefined> {
  const available = await service.availableModels();
  const providerIds = [...new Set(available.map((match) => match.model.provider))];
  if (providerIds.length === 0) return undefined;

  const providerId = providerIds.length === 1
    ? providerIds[0]
    : await select({
        message: "Select model provider:",
        pageSize: 16,
        choices: providerIds.map((id) => ({
          name: `${service.models.getProvider(id)?.name ?? id} (${available.filter((match) => match.model.provider === id).length})`,
          value: id,
        })),
      });
  const candidates = available.filter((match) => match.model.provider === providerId);
  const canonicalId = await select({
    message: "Select default model:",
    pageSize: 20,
    choices: candidates.map((match) => ({
      name: `${match.model.name} (${match.model.id})`,
      value: match.canonicalId,
    })),
  });
  config.defaultModel = canonicalId;
  await ConfigurationLoader.save(config);
  return canonicalId;
}

async function connectHackMDWithOAuth(
  serverUrl: string,
  store: HackMDOAuthStore,
): Promise<boolean> {
  const session = await createInteractiveHackMDOAuthSession(serverUrl, store, {
    onRedirect: (authorizationUrl) => {
      console.log(chalk.cyan("\nOpen this URL to connect HackMD:"));
      console.log(authorizationUrl.toString());
    },
  });
  const client = new MCPClient({
    serverUrl,
    auth: {
      type: "oauth",
      provider: session.provider,
      completeAuthorization: () => session.completeAuthorization(),
    },
    maxRetries: 0,
  });
  try {
    await client.connect();
    await client.listTools();
    console.log(chalk.green("✓ HackMD connected with OAuth"));
    return true;
  } finally {
    await client.dispose().catch(() => undefined);
    await Promise.resolve(session.dispose()).catch(() => undefined);
  }
}

async function ensureHackMDAuth(
  config: Configuration,
  store: HackMDOAuthStore,
): Promise<boolean> {
  const cliConfig = await loadHackMDCLIConfig();
  const resolved = resolveHackMDServiceConfig(config.services.hackmd, cliConfig);
  if (resolved.hackmd.apiToken) {
    const source = describeHackMDTokenSource(resolved.tokenSource);
    console.log(chalk.green(`✓ HackMD token found${source ? ` in ${source}` : ""}`));
    return true;
  }

  const mcpBaseUrl = resolved.hackmd.mcpBaseUrl;
  if (mcpBaseUrl && (await store.read(mcpBaseUrl))?.tokens) {
    console.log(chalk.green("✓ HackMD OAuth connection found"));
    return true;
  }

  const method = await select({
    message: "Connect HackMD:",
    choices: [
      ...(mcpBaseUrl ? [{
        name: "Sign in with HackMD OAuth (recommended)",
        value: "oauth" as const,
      }] : []),
      { name: "Enter a HackMD API token", value: "token" as const },
      { name: "Cancel", value: "cancel" as const },
    ],
  });
  if (method === "oauth") {
    return mcpBaseUrl ? connectHackMDWithOAuth(mcpBaseUrl, store) : false;
  }
  if (method === "cancel") return false;

  const apiToken = await password({ message: "Enter HackMD API token", mask: "*" });
  if (!apiToken) return false;
  config.services.hackmd = { ...config.services.hackmd, apiToken };
  await ConfigurationLoader.save(config);
  return true;
}

async function configureLogin(service: ModelService): Promise<boolean> {
  const provider = await chooseProvider(service, "Select provider to configure:");
  return provider ? loginProvider(service, provider) : false;
}

export async function setupCommand(
  isAutoTriggered = false,
  oauthStore: HackMDOAuthStore = new FileHackMDOAuthStore(),
): Promise<void> {
  printSetupHeader();
  const config = await ConfigurationLoader.load();
  const service = new ModelService(config);
  await service.initialize();

  if (!(await ensureHackMDAuth(config, oauthStore))) {
    console.log(chalk.red("A HackMD OAuth connection or API token is required."));
    return;
  }

  let available = await service.availableModels();
  while (available.length === 0) {
    console.log(chalk.yellow("No configured model provider was detected."));
    if (!(await configureLogin(service))) return;
    available = await service.availableModels();
  }

  const current = service.resolve(config.defaultModel);
  if (!current || !(await service.isAvailable(current.model))) {
    await selectDefaultModel(config, service);
  }

  console.log(chalk.green("\n✅ Configuration saved!\n"));
  console.log(
    isAutoTriggered
      ? chalk.cyan("🚀 Starting HackWriter...\n")
      : chalk.gray('Run "hackwriter" to start the agent\n'),
  );
}

export async function runInteractiveSetup(
  config: Configuration,
  existingService?: ModelService,
  options: {
    oauthStore?: HackMDOAuthStore;
    onHackMDOAuthDisconnect?: () => void | Promise<void>;
  } = {},
): Promise<boolean> {
  printSetupHeader();
  const service = existingService ?? new ModelService(config);
  const oauthStore = options.oauthStore ?? new FileHackMDOAuthStore();
  await service.initialize();
  const resolved = resolveHackMDServiceConfig(
    config.services.hackmd,
    await loadHackMDCLIConfig(),
  );
  const mcpBaseUrl = resolved.hackmd.mcpBaseUrl;
  const oauthCredential = mcpBaseUrl
    ? await readHackMDOAuthCredential({
      store: oauthStore,
      serverUrl: mcpBaseUrl,
      hasApiToken: Boolean(resolved.hackmd.apiToken),
    })
    : undefined;
  const hasOAuth = Boolean(oauthCredential?.tokens);
  const action = await select({
    message: "What would you like to configure?",
    choices: [
      { name: "Log in to a provider", value: "login" },
      { name: "Log out of a provider", value: "logout" },
      { name: "Change default model", value: "model" },
      ...(mcpBaseUrl ? [{ name: "Connect HackMD with OAuth", value: "hackmd-oauth" }] : []),
      ...(hasOAuth ? [{
        name: "Disconnect HackMD OAuth on this device",
        value: "hackmd-oauth-disconnect",
      }] : []),
      { name: "HackMD API token", value: "hackmd" },
      { name: "Cancel", value: "cancel" },
    ],
  });

  if (action === "login") {
    return configureLogin(service);
  } else if (action === "logout") {
    const statuses = (await service.providerStatuses()).filter(
      (status) => status.available,
    );
    if (statuses.length === 0) {
      console.log(chalk.yellow("No authenticated providers."));
      return false;
    }
    const providerId = await select({
      message: "Select provider to log out:",
      choices: statuses.map((status) => ({ name: status.name, value: status.id })),
    });
    await service.credentials.delete(providerId);
    console.log(chalk.green(`✓ Logged out of ${providerId}`));
    return true;
  } else if (action === "model") {
    return (await selectDefaultModel(config, service)) !== undefined;
  } else if (action === "hackmd-oauth") {
    return mcpBaseUrl ? connectHackMDWithOAuth(mcpBaseUrl, oauthStore) : false;
  } else if (action === "hackmd-oauth-disconnect") {
    if (!mcpBaseUrl) return false;
    await options.onHackMDOAuthDisconnect?.();
    await oauthStore.delete(mcpBaseUrl);
    console.log(chalk.green("✓ HackMD OAuth disconnected on this device"));
    console.log(chalk.gray(
      "This does not revoke the remote connection. Revoke it from HackMD Connections if needed.",
    ));
    console.log(chalk.gray("Restart HackWriter or connect again before using HackMD tools."));
    return false;
  } else if (action === "hackmd") {
    const apiToken = await password({ message: "Enter HackMD API token", mask: "*" });
    if (!apiToken) return false;
    config.services.hackmd = { ...config.services.hackmd, apiToken };
    await ConfigurationLoader.save(config);
    console.log(chalk.green("✓ HackMD API token saved"));
    return true;
  }
  return false;
}
