#!/usr/bin/env node

import "dotenv/config";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

import { Command } from "commander";
import chalk from "chalk";
import { AgentExecutor } from "./agent/AgentExecutor.ts";
import { ConversationContext } from "./agent/ConversationContext.ts";
import { ApprovalManager } from "./agent/ApprovalManager.ts";
import { MessageBus } from "./messaging/MessageBus.ts";
import { ToolRegistry } from "./tools/base/ToolRegistry.ts";
import { ConfigurationLoader } from "./config/ConfigurationLoader.ts";
import { SessionManager } from "./session/SessionManager.ts";
import { InteractiveShell } from "./ui/shell/InteractiveShell.ts";
import { selectDefaultModel, setupCommand } from "./commands/setup.ts";
import { ModelService } from "./config/ModelService.ts";
import { Logger } from "./utils/Logger.ts";
import { ErrorFactory } from "./utils/ErrorTypes.ts";
import { SensitiveDataRedactor } from "./utils/SensitiveDataRedactor.ts";
import type { Agent } from "./agent/Agent.ts";

import {
  createLocalHackMDTools,
  registerLocalHackMDTools,
} from "./tools/hackmd/index.ts";

import {
  ReadFileTool,
  WriteFileTool,
  ListFilesTool,
} from "./tools/file/index.ts";

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
        console.error(chalk.red('\n' + appError.toUserString()));
        
        // Show stack trace in debug mode
        if (options.debug) {
          Logger.error('CLI', 'Fatal error details', error);
        }
      } else if (error instanceof Error) {
        console.error(chalk.red('\n❌ Fatal error: ' + error.message));
        
        if (options.debug) {
          console.error(chalk.gray('\nStack trace:'));
          console.error(chalk.gray(error.stack ?? 'No stack trace available'));
        }
      } else {
        console.error(chalk.red('\n❌ Fatal error: ' + String(error)));
      }
      
      process.exit(1);
    }
  });

program
  .command("setup")
  .description("Configure HackWriter for first-time use")
  .action(() => setupCommand(false));

async function runAgent(options: {
  command?: string;
  continue?: boolean;
  yolo?: boolean;
  debug?: boolean;
  model?: string;
}): Promise<void> {
  let context: ConversationContext | undefined;
  let shell: InteractiveShell | undefined;
  let runtimeMcpClient: { dispose(): Promise<void> } | undefined;

  if (options.debug) {
    Logger.setLevel("debug");
    Logger.info("CLI", "Debug mode enabled");
  }

  try {
    let config = await ConfigurationLoader.load();
    let modelService = new ModelService(config);
    await modelService.initialize();
    Logger.debug(
      "CLI",
      `Config loaded: ${config.defaultModel || "no default"}, ${Object.keys(config.models).length} model(s)`,
    );

    let availableModels = await modelService.availableModels();
    const needsSetup = !config.services.hackmd?.apiToken || availableModels.length === 0;

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
      await setupCommand(true);

      config = await ConfigurationLoader.load();
      modelService = new ModelService(config);
      await modelService.initialize();
      availableModels = await modelService.availableModels();

      if (!config.services.hackmd?.apiToken || availableModels.length === 0) {
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
    const languageModel = modelMatch.model;
    Logger.debug("CLI", `Model: ${modelMatch.canonicalId}`);

    if (!config.services.hackmd) {
      throw ErrorFactory.configuration(
        "HackMD service configuration is missing",
        "Please run 'hackwriter setup' to configure HackMD API token"
      );
    }

    const approvalManager = new ApprovalManager(undefined, options.yolo ?? false);
    const toolRegistry = new ToolRegistry();

    const hackmdConfig = config.services.hackmd;
    const localHackMDTools = createLocalHackMDTools(
      hackmdConfig.apiToken,
      approvalManager,
    );
    const localHackMDToolsByName = new Map(
      localHackMDTools.map((tool) => [tool.name, tool] as const),
    );
    let usedMcp = false;

    // Try MCP if mcpBaseUrl is configured
    if (hackmdConfig.mcpBaseUrl) {
      Logger.info("CLI", "Trying Remote MCP mode...");
      
      // Dynamic import to avoid loading MCP SDK when not needed
      const { MCPClient, MCPToolAdapter } = await import("./mcp/index.ts");
      const { buildHackMDMcpApproval, buildHackMDMcpFallback } = await import(
        "./mcp/HackMDMcpToolPolicies.ts"
      );
      
      const mcpClient = new MCPClient({
        serverUrl: hackmdConfig.mcpBaseUrl,
        apiToken: hackmdConfig.apiToken,
      });
      runtimeMcpClient = mcpClient;

      try {
        await mcpClient.connect();
        
        // Register MCP tools
        const mcpTools = await mcpClient.listTools();
        for (const toolDef of mcpTools) {
          toolRegistry.register(
            new MCPToolAdapter(
              mcpClient,
              toolDef,
              buildHackMDMcpFallback(toolDef.name, localHackMDToolsByName),
              buildHackMDMcpApproval(toolDef.name, approvalManager),
            ),
          );
          Logger.debug("CLI", `Registered MCP tool: ${toolDef.name}`);
        }

        Logger.info("CLI", `Connected to MCP server with ${mcpTools.length} tools`);
        usedMcp = true;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.warn(chalk.red(`Failed to connect to MCP server: ${msg}`));
        console.warn(chalk.yellow("Falling back use HackMD API"));
      }
    }

    // Use local HackMD API if MCP not used
    if (!usedMcp) {
      Logger.info("CLI", "Using Local HackMD API mode");
      registerLocalHackMDTools(toolRegistry, localHackMDTools);
    }

    // File tools (always local)
    toolRegistry.register(new ReadFileTool(workDir));
    toolRegistry.register(new WriteFileTool(approvalManager, workDir));
    toolRegistry.register(new ListFilesTool(workDir));

    Logger.debug("CLI", `Registered ${toolRegistry.getAll().length} tools`);

    // Create Agent
    const agent: Agent = {
      name: "HackMD Agent",
      modelName: languageModel.id,
      maxContextSize: languageModel.contextWindow,
      systemPrompt: buildSystemPrompt(workDir),
      toolRegistry,
    };

    // Create conversation context
    context = new ConversationContext(session.historyFile);
    await context.loadFromDisk();

    // Create executor
    const executor = new AgentExecutor(
      agent,
      context,
      languageModel,
      modelService.models,
    );

    shell = new InteractiveShell(executor, {
      currentModelName: modelMatch.canonicalId,
      config,
      modelService,
      context,
      toolRegistry,
      systemPrompt: agent.systemPrompt,
    });

    // Connect approval manager to shell's readline to prevent stdin conflicts
    approvalManager.setMainRl(shell.getReadline());

    await shell.start(options.command);
  } finally {
    shell?.dispose();
    MessageBus.getInstance().dispose();

    if (context) {
      try {
        await context.close();
      } catch (error) {
        Logger.warn(
          "CLI",
          `Failed to close conversation context: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    if (runtimeMcpClient) {
      try {
        await runtimeMcpClient.dispose();
      } catch (error) {
        Logger.warn(
          "CLI",
          `Failed to dispose MCP client: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
}

function buildSystemPrompt(workDir: string): string {
  return `You are a HackMD assistant. Help users manage their HackMD notes.

Available tools:
- list_notes, read_note, create_note, update_note, delete_note (use teamPath for team notes)
- get_user_info, list_teams, get_history
- search_notes, export_note
- read_file, write_file, list_files (for local file operations)

Guidelines:
- Use markdown formatting
- Be concise in responses
- Show note titles and IDs clearly
- For team notes, include teamPath parameter
- ALWAYS use read_file tool to read local files before uploading to HackMD
- Combine tools for complex operations (e.g., upload local file = read_file + create_note)

Working directory: ${workDir}`;
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

  // Register cleanup handlers
  process.on('exit', cleanup);
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(0);
  });
}

program.parse();
