import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import chalk from "chalk";
import { API } from "@hackmd/api";

import { ConfigurationLoader } from "../config/ConfigurationLoader.ts";
import { FileCredentialStore } from "../config/FileCredentialStore.ts";
import { loadHackMDCLIConfig } from "../config/HackMDConfigLoader.ts";
import {
  describeHackMDTokenSource,
  resolveHackMDApiBaseUrl,
  resolveHackMDMcpBaseUrl,
  resolveHackMDServiceConfig,
} from "../config/HackMDServiceResolution.ts";
import { ModelService } from "../config/ModelService.ts";
import {
  CONFIG_DIR,
  CONFIG_FILE,
  DEFAULT_HACKMD_API_URL,
  DEFAULT_HACKMD_MCP_URL,
  SESSIONS_DIR,
} from "../config/constants.ts";
import { MCPClient } from "../mcp/MCPClient.ts";
import { classifyHackMDMcpTool } from "../mcp/HackMDMcpToolPolicies.ts";
import { formatSafeError } from "../utils/SafeError.ts";

type DoctorStatus = "pass" | "warn" | "fail" | "skip";

interface DoctorCheck {
  id: string;
  status: DoctorStatus;
  summary: string;
  detail?: string;
  remediation?: string;
}

interface DoctorReport {
  version: string;
  ok: boolean;
  checks: DoctorCheck[];
}

interface DoctorOptions {
  homeDir?: string;
  network?: boolean;
}

export async function inspectDoctor(
  version: string,
  options: DoctorOptions = {},
): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const homeDir = options.homeDir ?? os.homedir();
  const network = options.network !== false;
  const configPath = path.join(homeDir, CONFIG_DIR, CONFIG_FILE);
  const authPath = path.join(homeDir, CONFIG_DIR, "auth.json");
  const sessionsPath = path.join(homeDir, CONFIG_DIR, SESSIONS_DIR);

  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  checks.push({
    id: "runtime.node",
    status: nodeMajor === 24 ? "pass" : "fail",
    summary: `Node.js ${process.versions.node}`,
    remediation: nodeMajor === 24 ? undefined : "Install and run HackWriter with Node.js 24.",
  });

  await inspectMode(configPath, 0o600, "files.config", checks);
  await inspectMode(authPath, 0o600, "files.auth", checks);
  await inspectMode(sessionsPath, 0o700, "files.sessions", checks);
  await inspectSessionContents(sessionsPath, checks);

  let config;
  try {
    config = await ConfigurationLoader.load({
      readOnly: true,
      configPath,
      credentials: new FileCredentialStore(authPath, true),
    });
    checks.push({ id: "config.valid", status: "pass", summary: "Configuration is valid" });
  } catch (error) {
    checks.push({
      id: "config.valid",
      status: "fail",
      summary: "Configuration could not be loaded",
      detail: formatSafeError(error),
      remediation: "Fix ~/.hackwriter/config.json or run hackwriter setup.",
    });
    return report(version, checks);
  }

  const cliConfig = await loadHackMDCLIConfig();
  const resolved = resolveHackMDServiceConfig(config.services.hackmd, cliConfig);
  const apiBaseUrl = resolveHackMDApiBaseUrl(config.services.hackmd, cliConfig);
  const mcpBaseUrl = resolveHackMDMcpBaseUrl(config.services.hackmd, apiBaseUrl);
  checks.push(endpointCheck(apiBaseUrl, mcpBaseUrl));
  if (!resolved.hackmd) {
    checks.push({
      id: "hackmd.credential",
      status: "fail",
      summary: "No HackMD credential is available",
      remediation: "Set HACKMD_API_TOKEN, configure HackMD CLI, or run hackwriter setup.",
    });
    checks.push({ id: "hackmd.api", status: "skip", summary: "HackMD API check requires a credential" });
    checks.push({ id: "hackmd.mcp", status: "skip", summary: "MCP check requires a credential" });
    checks.push({ id: "hackmd.mcp_tools", status: "skip", summary: "MCP tool classification requires a credential" });
  } else {
    checks.push({
      id: "hackmd.credential",
      status: "pass",
      summary: `HackMD credential found in ${describeHackMDTokenSource(resolved.tokenSource) ?? "configured source"}`,
    });
    if (network) {
      await inspectHackMD(resolved.hackmd.apiToken, resolved.hackmd.apiBaseUrl!, checks);
      await inspectMcp(resolved.hackmd.apiToken, resolved.hackmd.mcpBaseUrl, checks);
    } else {
      checks.push({ id: "hackmd.api", status: "skip", summary: "HackMD API network check disabled" });
      checks.push({ id: "hackmd.mcp", status: "skip", summary: "MCP network check disabled" });
      checks.push({ id: "hackmd.mcp_tools", status: "skip", summary: "MCP tool classification check disabled" });
    }
  }

  const credentials = new FileCredentialStore(authPath, true);
  const models = new ModelService(config, credentials);
  const refreshSignal = AbortSignal.timeout(5000);
  await models.initialize({ allowNetwork: network, signal: refreshSignal }).catch((error) => {
    checks.push({
      id: "models.refresh",
      status: "warn",
      summary: "Some dynamic model catalogs could not be refreshed",
      detail: formatSafeError(error),
    });
  });
  const statuses = await models.providerStatuses(false);
  const available = statuses.filter((status) => status.available && status.modelCount > 0);
  checks.push({
    id: "models.providers",
    status: available.length > 0 ? "pass" : "fail",
    summary: `${available.length} configured provider(s), ${statuses.length} registered provider(s)`,
    detail: statuses
      .filter((status) => status.available || status.error)
      .map((status) => `${status.id}: ${status.modelCount} model(s)${status.error ? ` (${formatSafeError(status.error)})` : ""}`)
      .join("; ") || undefined,
    remediation: available.length > 0 ? undefined : "Run hackwriter setup and configure a model provider.",
  });

  const current = models.resolve(config.defaultModel);
  const currentAuth = current
    ? await models.models.checkAuth(current.model.provider).catch(() => undefined)
    : undefined;
  checks.push({
    id: "models.default",
    status: current && currentAuth ? "pass" : "fail",
    summary: current && currentAuth
      ? `Default model is available: ${current.canonicalId}`
      : `Default model is unavailable: ${config.defaultModel || "not configured"}`,
    remediation: current && currentAuth ? undefined : "Choose a default model with hackwriter setup.",
  });

  const ollama = statuses.find((status) => status.id === "ollama");
  checks.push({
    id: "models.ollama",
    status: ollama?.available && ollama.modelCount > 0 ? "pass" : "skip",
    summary: ollama?.available && ollama.modelCount > 0
      ? `Ollama discovered ${ollama.modelCount} model(s)`
      : "Ollama is not running or has no installed models",
  });

  return report(version, checks);
}

async function inspectSessionContents(
  sessionsPath: string,
  checks: DoctorCheck[],
): Promise<void> {
  try {
    let checked = 0;
    let mismatches = 0;
    for (const workspace of await fs.readdir(sessionsPath, { withFileTypes: true })) {
      const workspacePath = path.join(sessionsPath, workspace.name);
      if (!workspace.isDirectory()) {
        mismatches++;
        continue;
      }
      checked++;
      if (((await fs.stat(workspacePath)).mode & 0o777) !== 0o700) mismatches++;
      for (const entry of await fs.readdir(workspacePath, { withFileTypes: true })) {
        checked++;
        if (!entry.isFile()) {
          mismatches++;
          continue;
        }
        if (((await fs.stat(path.join(workspacePath, entry.name))).mode & 0o777) !== 0o600) {
          mismatches++;
        }
      }
    }
    checks.push({
      id: "files.session_contents",
      status: mismatches === 0 ? "pass" : "fail",
      summary: mismatches === 0
        ? `${checked} session path(s) have secure permissions`
        : `${mismatches} session path(s) have unsafe permissions or types`,
      remediation: mismatches === 0
        ? undefined
        : "Set session workspace directories to 0700 and session files to 0600.",
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      checks.push({ id: "files.session_contents", status: "skip", summary: "No saved session contents" });
      return;
    }
    checks.push({
      id: "files.session_contents",
      status: "fail",
      summary: "Cannot inspect saved session contents",
      detail: formatSafeError(error),
    });
  }
}

export async function doctorCommand(
  version: string,
  options: { json?: boolean },
): Promise<void> {
  const result = await inspectDoctor(version);
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(chalk.bold.cyan("\n🩺 HackWriter Doctor\n"));
    for (const check of result.checks) {
      const marker = { pass: chalk.green("PASS"), warn: chalk.yellow("WARN"), fail: chalk.red("FAIL"), skip: chalk.gray("SKIP") }[check.status];
      console.log(`${marker} ${check.summary}`);
      if (check.detail) console.log(chalk.gray(`     ${check.detail}`));
      if (check.remediation) console.log(chalk.gray(`     Fix: ${check.remediation}`));
    }
    console.log();
  }
  if (!result.ok) process.exitCode = 1;
}

async function inspectMode(
  filePath: string,
  expected: number,
  id: string,
  checks: DoctorCheck[],
): Promise<void> {
  try {
    const mode = (await fs.stat(filePath)).mode & 0o777;
    checks.push({
      id,
      status: mode === expected ? "pass" : "fail",
      summary: `${path.basename(filePath)} permissions are ${mode.toString(8)}`,
      remediation: mode === expected ? undefined : `Run chmod ${expected.toString(8)} ${safePath(filePath)}.`,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      checks.push({ id, status: "skip", summary: `${path.basename(filePath)} does not exist yet` });
      return;
    }
    checks.push({ id, status: "fail", summary: `Cannot inspect ${path.basename(filePath)}`, detail: formatSafeError(error) });
  }
}

async function inspectHackMD(token: string, endpoint: string, checks: DoctorCheck[]): Promise<void> {
  try {
    const api = new API(token, endpoint, { wrapResponseErrors: true, timeout: 5000 });
    await api.getMe();
    checks.push({ id: "hackmd.api", status: "pass", summary: `HackMD API is reachable at ${safeUrl(endpoint)}` });
  } catch (error) {
    checks.push({ id: "hackmd.api", status: "fail", summary: `HackMD API check failed at ${safeUrl(endpoint)}`, detail: formatSafeError(error) });
  }
}

async function inspectMcp(token: string, endpoint: string | undefined, checks: DoctorCheck[]): Promise<void> {
  if (!endpoint) {
    checks.push({ id: "hackmd.mcp", status: "skip", summary: "MCP is not configured for this API endpoint" });
    checks.push({ id: "hackmd.mcp_tools", status: "skip", summary: "MCP tool classification is unavailable" });
    return;
  }
  const client = new MCPClient({ serverUrl: endpoint, apiToken: token, timeoutMs: 5000, maxRetries: 0 });
  try {
    await client.connect(AbortSignal.timeout(5000));
    const tools = await client.listTools(AbortSignal.timeout(5000));
    const unknown = tools.filter((tool) => !classifyHackMDMcpTool(tool.name));
    checks.push({
      id: "hackmd.mcp",
      status: "pass",
      summary: `MCP is reachable at ${safeUrl(endpoint)}`,
    });
    checks.push({
      id: "hackmd.mcp_tools",
      status: unknown.length === 0 ? "pass" : "warn",
      summary: `MCP exposed ${tools.length} tool(s); ${unknown.length} rejected as unclassified`,
      detail: unknown.length > 0 ? `Rejected: ${unknown.map((tool) => tool.name).join(", ")}` : undefined,
    });
  } catch (error) {
    checks.push({ id: "hackmd.mcp", status: "warn", summary: `MCP check failed at ${safeUrl(endpoint)}`, detail: formatSafeError(error) });
    checks.push({ id: "hackmd.mcp_tools", status: "skip", summary: "MCP tools could not be classified" });
  } finally {
    await client.dispose().catch(() => undefined);
  }
}

function endpointCheck(api: string, mcp?: string): DoctorCheck {
  if (!mcp) return { id: "hackmd.endpoints", status: "pass", summary: `Using local API mode for ${safeUrl(api)}` };
  if (safeUrl(api) === safeUrl(DEFAULT_HACKMD_API_URL) && safeUrl(mcp) === safeUrl(DEFAULT_HACKMD_MCP_URL)) {
    return {
      id: "hackmd.endpoints",
      status: "pass",
      summary: "Using the official HackMD API and MCP endpoints",
    };
  }
  const sameOrigin = new URL(api).origin === new URL(mcp).origin;
  return {
    id: "hackmd.endpoints",
    status: sameOrigin ? "pass" : "warn",
    summary: sameOrigin ? "HackMD API and MCP share an origin" : "HackMD API and MCP use different explicit origins",
    detail: `API ${safeUrl(api)}; MCP ${safeUrl(mcp)}`,
  };
}

function report(version: string, checks: DoctorCheck[]): DoctorReport {
  return { version, ok: checks.every((check) => check.status !== "fail"), checks };
}

function safeUrl(value: string): string {
  const url = new URL(value);
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/u, "")}`;
}

function safePath(value: string): string {
  return value.startsWith(os.homedir()) ? value.replace(os.homedir(), "~") : value;
}
