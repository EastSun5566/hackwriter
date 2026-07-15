# HackWriter

> HackMD writing agent

## Requirements

- Node.js 24
- pnpm 11
- A HackMD API token
- Credentials for at least one model provider, or a running Ollama server

## Install and start

```sh
npm install --global hackwriter
hackwriter setup
hackwriter
```

`hackwriter setup` supports provider API-key login, OAuth login/logout, ambient credential status, and default-model selection. Secrets entered in setup are stored in `~/.hackwriter/auth.json`, not in `config.json`.

HackWriter also detects the provider environment variables supported by pi-ai, such as `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `AWS_PROFILE`, Google Application Default Credentials, and provider-specific variables.

```sh
export HACKMD_API_TOKEN=your-hackmd-token
export ANTHROPIC_API_KEY=your-anthropic-key
hackwriter
```

HackMD CLI-compatible `HMD_API_ACCESS_TOKEN` and `HMD_API_ENDPOINT_URL` are supported as fallbacks.

## Providers

HackWriter registers all 35 built-in pi-ai text providers:

- Amazon Bedrock, Ant Ling, Anthropic, Azure OpenAI Responses
- Cerebras, Cloudflare AI Gateway, Cloudflare Workers AI, DeepSeek, Fireworks
- GitHub Copilot, Google, Google Vertex AI, Groq, Hugging Face
- Kimi Coding, MiniMax and MiniMax CN, Mistral, Moonshot AI and Moonshot AI CN
- NVIDIA, OpenAI, OpenAI Codex, OpenCode and OpenCode Go, OpenRouter
- Together, Vercel AI Gateway, xAI
- Xiaomi and its AMS/CN/SGP token-plan variants
- ZAI and ZAI Coding CN

Ollama is an additional dynamic provider. HackWriter discovers its installed models from `/api/tags` and streams through its OpenAI-compatible `/v1` endpoint.

## Models

Canonical model IDs use `provider/model-id`:

```sh
hackwriter --model anthropic/claude-sonnet-4-5
hackwriter --command "summarize my latest note" --model openai/gpt-5
```

Legacy IDs such as `openai-gpt-5` and aliases in config remain accepted.

Interactive model commands:

```text
/model                       show the current model and configured provider counts
/model search sonnet         search provider, model ID, and display name (max 20 rows)
/model anthropic/model-id    switch and persist the default model
/setup                       login, logout, or change the default model
```

## Configuration

`~/.hackwriter/config.json` uses version 2. It contains non-LLM-secret settings and is written atomically with mode `0600`.

```json
{
  "version": 2,
  "defaultModel": "anthropic/claude-sonnet-4-5",
  "models": {
    "fast": {
      "provider": "anthropic",
      "model": "claude-haiku-4-5",
      "maxContextSize": 200000
    }
  },
  "providers": {
    "ollama": {
      "type": "ollama",
      "baseUrl": "http://localhost:11434"
    }
  },
  "services": {
    "hackmd": {
      "apiToken": "your-hackmd-token"
    }
  },
  "loopControl": {
    "maxStepsPerRun": 100,
    "maxRetriesPerStep": 3
  }
}
```

On first load, an unversioned config is migrated idempotently: legacy provider API keys move to `~/.hackwriter/auth.json`, while custom model aliases, endpoint overrides, OpenAI organization/project IDs, and the legacy default model are retained. Both secret-bearing files are forced to `0600`.

## Usage

```sh
hackwriter                         # interactive shell
hackwriter --continue              # resume the previous session
hackwriter --debug                 # redacted debug logs
hackwriter --command "list notes" # execute once and exit
hackwriter --yolo                  # auto-approve actions
```

Local `read_file`, `list_files`, and `write_file` operations are restricted to the startup working directory, including real-path and symlink checks. Writes outside that boundary are rejected before approval is requested.

## Development

```sh
pnpm install --frozen-lockfile
pnpm run check
pnpm test
pnpm run build
```

`lint` and `knip` are read-only CI checks. Use `lint:fix` or `knip:fix` for explicit rewrites.
