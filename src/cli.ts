#!/usr/bin/env node

import "dotenv/config";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

import { Command } from "commander";
import chalk from "chalk";
import { ConversationContext } from "./agent/ConversationContext.ts";
import { ApprovalManager } from "./agent/ApprovalManager.ts";
import { MessageBus } from "./messaging/MessageBus.ts";
import { ConfigurationLoader } from "./config/ConfigurationLoader.ts";
import { SessionManager } from "./session/SessionManager.ts";
import { InteractiveShell } from "./ui/shell/InteractiveShell.ts";
import { selectDefaultModel, setupCommand } from "./commands/setup.ts";
import { ModelService } from "./config/ModelService.ts";
import { Logger } from "./utils/Logger.ts";
import { ErrorFactory } from "./utils/ErrorTypes.ts";
import { SensitiveDataRedactor } from "./utils/SensitiveDataRedactor.ts";
import { formatSafeError } from "./utils/SafeError.ts";
import { loadHackMDCLIConfig } from "./config/HackMDConfigLoader.ts";
import { resolveHackMDServiceConfig } from "./config/HackMDServiceResolution.ts";
import { buildRuntime, type RuntimeBundle } from "./runtime/RuntimeCoordinator.ts";
import { doctorCommand } from "./commands/doctor.ts";
import { FileHackMDOAuthStore } from "./mcp/HackMDOAuthStore.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(
  readFileSync(join(__dirname, "../package.json"), "utf-8"),
);

const program = new Command();

program
  .name("hackwriter")
  .description("HackWriter - Writing agent for HackMD")
  .version(packageJson.version)
  .option("-c, --command <text>", "Execute a single command")
  .option("--continue", "Continue previous session")
  .option("--yolo", "Auto-approve all actions")
  .option("--debug", "Enable debug logging")
  .option("-m, --model <name>", "LLM model to use")
  .action(async (options) => {
    try {
      // Setup cleanup on exit
      setupCleanupHandlers();
      
      await runAgent(options);
    } catch (error) {
      // Handle AppError with user-friendly messages
      if (error instanceof Error && error.name === 'AppError') {
        // Type assertion is safe here because we checked error.name
        const appError = error as unknown as { toUserString: () => string };
        console.error(chalk.red('\n' + formatSafeError(appError.toUserString())));
        
        // Show stack trace in debug mode
        if (options.debug) {
          Logger.error('CLI', 'Fatal error details', error);
        }
      } else if (error instanceof Error) {
        console.error(chalk.red('\n❌ Fatal error: ' + formatSafeError(error)));
        
        if (options.debug) {
          console.error(chalk.gray('\nStack trace:'));
          console.error(chalk.gray(formatSafeError(error, true)));
        }
      } else {
        console.error(chalk.red('\n❌ Fatal error: ' + formatSafeError(error)));
      }
      
      process.exitCode = 1;
    }
  });

program
  .command("setup")
  .description("Configure HackWriter for first-time use")
  .action(() => setupCommand(false));

program
  .command("doctor")
  .description("Diagnose HackWriter configuration and connectivity")
  .option("--json", "Output a machine-readable report")
  .action((options) => doctorCommand(packageJson.version, options));

async function runAgent(options: {
  command?: string;
  continue?: boolean;
  yolo?: boolean;
  debug?: boolean;
  model?: string;
}): Promise<void> {
  let context: ConversationContext | undefined;
  let shell: InteractiveShell | undefined;
  let runtime: RuntimeBundle | undefined;
  let shuttingDown = false;
  let forcedExitTimer: NodeJS.Timeout | undefined;
  const beginShutdown = (exitCode: number): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.exitCode = exitCode;
    shell?.getExecutor().abort();
    shell?.exit();
    forcedExitTimer = setTimeout(() => process.exit(exitCode), 5_000);
    forcedExitTimer.unref();
  };
  const handleTermination = (): void => beginShutdown(143);
  const handleInterrupt = (): void => beginShutdown(130);
  process.once("SIGTERM", handleTermination);
  process.once("SIGINT", handleInterrupt);

  if (options.debug) {
    Logger.setLevel("debug");
    Logger.info("CLI", "Debug mode enabled");
  }

  try {
    const oauthStore = new FileHackMDOAuthStore();
    let config = await ConfigurationLoader.load();
    let modelService = new ModelService(config);
    await modelService.initialize();
    Logger.debug(
      "CLI",
      `Config loaded: ${config.defaultModel || "no default"}, ${Object.keys(config.models).length} model(s)`,
    );

    let availableModels = await modelService.availableModels();
    let resolvedHackMD = resolveHackMDServiceConfig(
      config.services.hackmd,
      await loadHackMDCLIConfig(),
    );
    let hasHackMDOAuth = Boolean(
      !resolvedHackMD.hackmd.apiToken &&
      resolvedHackMD.hackmd.mcpBaseUrl &&
      (await oauthStore.read(resolvedHackMD.hackmd.mcpBaseUrl))?.tokens,
    );
    const needsSetup = (
      !resolvedHackMD.hackmd.apiToken && !hasHackMDOAuth
    ) || availableModels.length === 0;

    if (needsSetup) {
      console.log(
        chalk.yellow("⚙️  Configuration needed. Starting setup wizard...\n"),
      );
      if (options.command || !process.stdin.isTTY) {
        throw ErrorFactory.configuration(
          "HackWriter has no usable HackMD token or model provider.",
          "Run 'hackwriter setup' in an interactive terminal first.",
        );
      }
      await setupCommand(true, oauthStore);

      config = await ConfigurationLoader.load();
      modelService = new ModelService(config);
      await modelService.initialize();
      availableModels = await modelService.availableModels();
      resolvedHackMD = resolveHackMDServiceConfig(
        config.services.hackmd,
        await loadHackMDCLIConfig(),
      );
      hasHackMDOAuth = Boolean(
        !resolvedHackMD.hackmd.apiToken &&
        resolvedHackMD.hackmd.mcpBaseUrl &&
        (await oauthStore.read(resolvedHackMD.hackmd.mcpBaseUrl))?.tokens,
      );

      if (
        (!resolvedHackMD.hackmd.apiToken && !hasHackMDOAuth) ||
        availableModels.length === 0
      ) {
        console.log(chalk.gray("\nSetup cancelled or incomplete."));
        return;
      }
    }

    const workDir = process.cwd();
    const session = options.continue
      ? ((await SessionManager.continue(workDir)) ??
        (await SessionManager.create(workDir)))
      : await SessionManager.create(workDir);
    Logger.debug("CLI", `Session: ${session.id.slice(0, 8)}...`);

    let modelMatch = modelService.resolve(options.model ?? config.defaultModel);
    if (modelMatch && !(await modelService.isAvailable(modelMatch.model))) {
      modelMatch = undefined;
    }
    if (!modelMatch && availableModels.length === 1 && !options.model) {
      modelMatch = availableModels[0];
      config.defaultModel = modelMatch.canonicalId;
      await ConfigurationLoader.save(config);
    }
    if (!modelMatch && !options.command && process.stdin.isTTY && !options.model) {
      const selected = await selectDefaultModel(config, modelService);
      modelMatch = selected ? modelService.resolve(selected) : undefined;
    }
    if (!modelMatch) {
      throw ErrorFactory.configuration(
        `Model "${options.model ?? config.defaultModel}" is unavailable or invalid.`,
        options.command || !process.stdin.isTTY
          ? "Pass a configured canonical model with --model provider/model-id."
          : "Run 'hackwriter setup' or choose a model with /model.",
      );
    }
    Logger.debug("CLI", `Model: ${modelMatch.canonicalId}`);

    const approvalManager = new ApprovalManager(undefined, options.yolo ?? false);

    // Create conversation context
    context = new ConversationContext(session.historyFile);
    await context.loadFromDisk();

    runtime = await buildRuntime({
      config,
      context,
      approvalManager,
      workDir,
      modelName: modelMatch.canonicalId,
      allowOAuthLogin: !options.command && process.stdin.isTTY,
      oauthStore,
    });

    shell = new InteractiveShell(runtime.executor, {
      currentModelName: runtime.modelMatch.canonicalId,
      config: runtime.config,
      modelService: runtime.modelService,
      context,
      toolRegistry: runtime.toolRegistry,
      systemPrompt: runtime.systemPrompt,
      approvalManager,
      reloadRuntime: async (nextConfig, requestedModel) => {
        return buildRuntime({
          config: nextConfig,
          context: context!,
          approvalManager,
          workDir,
          modelName: requestedModel,
          allowOAuthLogin: true,
          oauthStore,
        });
      },
      commitRuntime: async (next) => {
        const previous = runtime;
        runtime = next;
        await previous?.mcpClient?.dispose().catch(() => undefined);
      },
      disconnectMcp: async () => {
        await runtime?.mcpClient?.dispose().catch(() => undefined);
        if (runtime) runtime.mcpClient = undefined;
      },
    });

    // Connect approval manager to shell's readline to prevent stdin conflicts
    approvalManager.setMainRl(shell.getReadline());

    await shell.start(options.command);
  } finally {
    process.off("SIGTERM", handleTermination);
    process.off("SIGINT", handleInterrupt);
    if (forcedExitTimer) clearTimeout(forcedExitTimer);
    shell?.dispose();
    MessageBus.getInstance().dispose();

    if (context) {
      try {
        await context.close();
      } catch (error) {
        Logger.warn(
          "CLI",
          `Failed to close conversation context: ${formatSafeError(error)}`,
        );
      }
    }

    if (runtime?.mcpClient) {
      try {
        await runtime.mcpClient.dispose();
      } catch (error) {
        Logger.warn(
          "CLI",
          `Failed to dispose MCP client: ${formatSafeError(error)}`,
        );
      }
    }
  }
}

/**
 * Setup cleanup handlers to clear sensitive data on exit
 */
function setupCleanupHandlers(): void {
  const cleanup = () => {
    Logger.debug("CLI", "Cleaning up sensitive data from memory");
    
    // Clear environment variables containing sensitive data
    if (process.env.ANTHROPIC_API_KEY) {
      SensitiveDataRedactor.clearMemory({ ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY });
      delete process.env.ANTHROPIC_API_KEY;
    }
    if (process.env.OPENAI_API_KEY) {
      SensitiveDataRedactor.clearMemory({ OPENAI_API_KEY: process.env.OPENAI_API_KEY });
      delete process.env.OPENAI_API_KEY;
    }
    if (process.env.HACKMD_API_TOKEN) {
      SensitiveDataRedactor.clearMemory({ HACKMD_API_TOKEN: process.env.HACKMD_API_TOKEN });
      delete process.env.HACKMD_API_TOKEN;
    }
    if (process.env.HMD_API_ACCESS_TOKEN) {
      SensitiveDataRedactor.clearMemory({ HMD_API_ACCESS_TOKEN: process.env.HMD_API_ACCESS_TOKEN });
      delete process.env.HMD_API_ACCESS_TOKEN;
    }
  };

  // Register cleanup handler. Runtime signals are handled by runAgent so async
  // session and transport cleanup can complete.
  process.on('exit', cleanup);
}

try {
  await program.parseAsync();
} catch (error) {
  console.error(chalk.red(`\n❌ Fatal error: ${formatSafeError(error)}`));
  process.exitCode = 1;
}
