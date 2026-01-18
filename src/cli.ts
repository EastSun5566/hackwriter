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

  const needsSetup =
    !config.services.hackmd?.apiToken ||
    (!config.defaultModel && !options.model);

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
  const hackmdClient = new API(config.services.hackmd.apiToken);

  const approvalManager = new ApprovalManager(undefined, options.yolo ?? false);

  const toolRegistry = new ToolRegistry();

  // Note tools (now support both personal and team notes via optional teamPath)
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

  // Start interactive shell
  const shell = new InteractiveShell(executor);
  await shell.start(options.command);
}

function buildSystemPrompt(workDir: string): string {
  return `You are a HackMD assistant. Help users manage their HackMD notes.

Available tools:
- list_notes, read_note, create_note, update_note, delete_note (use teamPath for team notes)
- get_user_info, list_teams, get_history
- search_notes, export_note

Guidelines:
- Use markdown formatting
- Be concise in responses
- Show note titles and IDs clearly
- For team notes, include teamPath parameter
- For file operations, use bash commands (cat, ls, echo, etc.)
- Combine tools for complex operations (e.g., clone = read + create)

Working directory: ${workDir}`;
}

program.parse();
