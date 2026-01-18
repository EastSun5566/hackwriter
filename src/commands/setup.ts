import { input, password, select } from "@inquirer/prompts";
import chalk from "chalk";
import { ConfigurationLoader } from "../config/ConfigurationLoader.js";
import type {
  Configuration,
  LLMProviderType,
} from "../config/Configuration.js";

export async function setupCommand(isAutoTriggered = false): Promise<void> {
  console.log(chalk.bold.cyan("\n🔧 HackWriter Setup\n"));

  const providerType = await select<LLMProviderType>({
    message: "Select your primary LLM provider",
    choices: [
      { name: "Anthropic (Claude)", value: "anthropic" },
      { name: "OpenAI (GPT-4/5)", value: "openai" },
      { name: "Ollama (Local LLM)", value: "ollama" },
    ],
    default: "anthropic",
  });

  const providerName = await input({
    message: "Name this provider configuration",
    default: `${providerType}-default`,
  });

  const providerLabel =
    providerType === "anthropic"
      ? "Anthropic (Claude)"
      : providerType === "openai"
        ? "OpenAI"
        : "Ollama";

  let llmApiKey: string | undefined;
  if (providerType !== "ollama") {
    llmApiKey = await password({
      message: `Enter ${providerLabel} API key`,
      mask: "*",
    });

    if (!llmApiKey) {
      console.log(chalk.red("\n❌ API key is required"));
      process.exit(1);
    }
  }

  // Model
  const modelDefault =
    providerType === "anthropic"
      ? "claude-3-5-haiku-latest"
      : providerType === "openai"
        ? "gpt-4.1-mini"
        : "phi3";

  const model = await input({
    message: "Enter model name",
    default: modelDefault,
  });

  // Max context size
  const contextDefault =
    providerType === "anthropic"
      ? 200000
      : providerType === "openai"
        ? 128000
        : 128000;
  const maxContextSizeStr = await input({
    message: "Maximum context size (tokens)",
    default: String(contextDefault),
  });
  const parsedContextSize = Number.parseInt(maxContextSizeStr, 10);
  const maxContextSize = Number.isFinite(parsedContextSize)
    ? parsedContextSize
    : contextDefault;

  const baseUrlDefault =
    providerType === "ollama" ? "http://localhost:11434/api" : "";
  const baseUrl = await input({
    message:
      providerType === "ollama"
        ? "Ollama API URL"
        : "Custom base URL (optional)",
    default: baseUrlDefault,
  });

  let organizationId: string | undefined;
  let projectId: string | undefined;

  if (providerType === "openai") {
    organizationId =
      (
        await input({
          message: "OpenAI organization ID (optional)",
          default: "",
        })
      ).trim() || undefined;

    projectId =
      (
        await input({
          message: "OpenAI project ID (optional)",
          default: "",
        })
      ).trim() || undefined;
  }

  // HackMD Token
  const hackmdToken = await password({
    message: "Enter HackMD API token",
    mask: "*",
  });

  if (!hackmdToken) {
    console.log(chalk.red("\n❌ HackMD token is required"));
    process.exit(1);
  }

  const answers = {
    provider: providerName,
    llmApiKey,
    model,
    maxContextSize,
    hackmdToken,
  };

  const config: Configuration = {
    defaultModel: "default",
    models: {
      default: {
        provider: answers.provider,
        model: answers.model,
        maxContextSize: answers.maxContextSize,
      },
    },
    providers: {
      [answers.provider]: {
        type: providerType,
        apiKey: answers.llmApiKey,
        baseUrl: baseUrl.trim() || undefined,
        organizationId,
        projectId,
      },
    },
    services: {
      hackmd: {
        baseUrl: "https://api.hackmd.io/v1",
        apiToken: answers.hackmdToken,
      },
    },
    loopControl: {
      maxStepsPerRun: 100,
      maxRetriesPerStep: 3,
    },
  };

  await ConfigurationLoader.save(config);

  console.log(chalk.green("\n✅ Configuration saved!"));

  if (isAutoTriggered) {
    console.log(chalk.cyan("\n🚀 Starting HackMD Agent...\n"));
  } else {
    console.log(chalk.gray("\nYou can now run: hackmd-agent\n"));
  }
}
