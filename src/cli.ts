#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import { API } from "@hackmd/api";
import { AgentExecutor } from "./agent/AgentExecutor.js";
import { ConversationContext } from "./agent/ConversationContext.js";
import { ApprovalManager } from "./agent/ApprovalManager.js";
import { ToolRegistry } from "./tools/base/ToolRegistry.js";
import { ConfigurationLoader } from "./config/ConfigurationLoader.js";
import { SessionManager } from "./session/SessionManager.js";
import { InteractiveShell } from "./ui/shell/InteractiveShell.js";
import { setupCommand } from "./commands/setup.js";
import type { Agent } from "./agent/Agent.js";
import { buildLanguageModel } from "./agent/ModelFactory.js";
import { Logger } from "./utils/Logger.js";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

import {
  ListNotesTool,
  ReadNoteTool,
  CreateNoteTool,
  UpdateNoteTool,
  DeleteNoteTool,
  GetUserInfoTool,
  ListTeamsTool,
  GetHistoryTool,
  SearchNotesTool,
  ExportNoteTool,
} from "./tools/hackmd/index.js";

import {
  ReadFileTool,
  WriteFileTool,
  ListFilesTool,
} from "./tools/file/index.js";

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
      await runAgent(options);
    } catch (error) {
      console.error(chalk.red("Fatal error:"), error);
      process.exit(1);
    }
  });

program
  .command("setup")
  .description("Configure HackWriter for first-time use")
  .action(setupCommand);

async function runAgent(options: {
  command?: string;
  continue?: boolean;
  yolo?: boolean;
  debug?: boolean;
  model?: string;
}): Promise<void> {
  if (options.debug) {
    Logger.setLevel("debug");
    Logger.info("CLI", "Debug mode enabled");
  }

  const config = await ConfigurationLoader.load();
  Logger.debug(
    "CLI",
    `Config loaded: ${config.defaultModel || "no default"}, ${Object.keys(config.models).length} model(s)`,
  );

  // Check if we have discovered providers from environment
  const hasDiscoveredProviders = Object.keys(config.providers).some(
    (name) => config.providers[name].apiKey
  );

  const needsSetup =
    !config.services.hackmd?.apiToken ||
    (!config.defaultModel && !options.model && !hasDiscoveredProviders);

  if (needsSetup) {
    console.log(
      chalk.yellow("⚙️  Configuration needed. Starting setup wizard...\n"),
    );
    await setupCommand(true);

    const newConfig = await ConfigurationLoader.load();

    if (!newConfig.services.hackmd?.apiToken || !newConfig.defaultModel) {
      console.log(chalk.gray("\nSetup cancelled or incomplete."));
      process.exit(0);
    }

    Object.assign(config, newConfig);
  }

  const workDir = process.cwd();
  const session = options.continue
    ? ((await SessionManager.continue(workDir)) ??
      (await SessionManager.create(workDir)))
    : await SessionManager.create(workDir);
  Logger.debug("CLI", `Session: ${session.id.slice(0, 8)}...`);

  const modelName = options.model ?? config.defaultModel;
  const modelConfig = config.models[modelName];
  Logger.debug("CLI", `Model: ${modelConfig.provider}/${modelConfig.model}`);
  const providerConfig = config.providers[modelConfig.provider];
  if (!providerConfig) {
    throw new Error(
      `Provider configuration '${modelConfig.provider}' is missing`,
    );
  }
  const languageModel = buildLanguageModel(providerConfig, modelConfig.model);

  if (!config.services.hackmd) {
    throw new Error("HackMD service configuration is missing");
  }

  const approvalManager = new ApprovalManager(undefined, options.yolo ?? false);
  const toolRegistry = new ToolRegistry();

  const hackmdConfig = config.services.hackmd;
  let usedMcp = false;

  // Try MCP if mcpBaseUrl is configured
  if (hackmdConfig.mcpBaseUrl) {
    Logger.info("CLI", "Trying Remote MCP mode...");
    
    // Dynamic import to avoid loading MCP SDK when not needed
    const { MCPClient, MCPToolAdapter } = await import("./mcp/index.js");
    
    const mcpClient = new MCPClient({
      serverUrl: hackmdConfig.mcpBaseUrl,
      apiToken: hackmdConfig.apiToken,
    });

    try {
      await mcpClient.connect();
      
      // Register MCP tools
      const mcpTools = await mcpClient.listTools();
      for (const toolDef of mcpTools) {
        toolRegistry.register(new MCPToolAdapter(mcpClient, toolDef));
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
    registerLocalHackMDTools(toolRegistry, hackmdConfig.apiToken, approvalManager);
  }

  // File tools (always local)
  toolRegistry.register(new ReadFileTool());
  toolRegistry.register(new WriteFileTool(approvalManager));
  toolRegistry.register(new ListFilesTool());

  Logger.debug("CLI", `Registered ${toolRegistry.getAll().length} tools`);

  // Create Agent
  const agent: Agent = {
    name: "HackMD Agent",
    modelName: modelConfig.model,
    maxContextSize: modelConfig.maxContextSize,
    systemPrompt: buildSystemPrompt(workDir),
    toolRegistry,
  };

  // Create conversation context
  const context = new ConversationContext(session.historyFile);
  await context.loadFromDisk();

  // Create executor
  const executor = new AgentExecutor(
    agent,
    context,
    languageModel,
    config.loopControl,
  );

  const shell = new InteractiveShell(executor, {
    currentModelName: options.model ?? config.defaultModel,
    config,
    context,
    toolRegistry,
    systemPrompt: agent.systemPrompt,
  });

  // Connect approval manager to shell's readline to prevent stdin conflicts
  approvalManager.setMainRl(shell.getReadline());

  await shell.start(options.command);
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

function registerLocalHackMDTools(
  toolRegistry: ToolRegistry,
  apiToken: string,
  approvalManager: ApprovalManager
): void {
  const hackmdClient = new API(apiToken);

  // Note tools (support both personal and team notes via optional teamPath)
  toolRegistry.register(new ListNotesTool(hackmdClient));
  toolRegistry.register(new ReadNoteTool(hackmdClient));
  toolRegistry.register(new CreateNoteTool(hackmdClient, approvalManager));
  toolRegistry.register(new UpdateNoteTool(hackmdClient, approvalManager));
  toolRegistry.register(new DeleteNoteTool(hackmdClient, approvalManager));

  // User & team management
  toolRegistry.register(new GetUserInfoTool(hackmdClient));
  toolRegistry.register(new ListTeamsTool(hackmdClient));
  toolRegistry.register(new GetHistoryTool(hackmdClient));

  // Advanced features
  toolRegistry.register(new SearchNotesTool(hackmdClient));
  toolRegistry.register(new ExportNoteTool(hackmdClient));

  Logger.debug("CLI", "Registered local HackMD tools");
}

program.parse();
