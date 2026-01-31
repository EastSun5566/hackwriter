# HackWriter

**Writing Agent for HackMD** - Zero-config, multi-provider LLM support

## Quick Start

```bash
npx hackwriter
```

If you don't have API keys configured, the setup wizard will guide you through it.

**That's it!** No config files needed.

---

## Installation

**One-time use**:
```bash
npx hackwriter
```

**Global install**:
```bash
npm i -g hackwriter

hackwriter
```

---

## Features

✅ **Zero-Config** - detected existing environment variables
✅ **Multi-Provider** - Anthropic, OpenAI, Ollama (auto-detected)
✅ **Model Switching** - Switch models on-the-fly with `/model`
✅ **Session Persistence** - Resume your work anytime
✅ **Smart Approvals** - Confirms destructive actions

**HackMD Operations**:
- List, read, create, update, delete notes
- Personal & team notes support
- Search and export notes

---

## Configuration

### Automatic Setup

Run `hackwriter` and follow the setup wizard. It will ask for:
- LLM provider (Anthropic, OpenAI, or Ollama) API key (if needed)
- HackMD API token

### Manual Setup (Optional)

**Environment Variables** - Skip setup wizard by setting these:

```bash
export ANTHROPIC_API_KEY=sk-ant-xxx  # or OPENAI_API_KEY
export HACKMD_API_TOKEN=your-token
hackwriter  # Starts immediately!
```

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic API key (optional) |
| `OPENAI_API_KEY` | OpenAI API key (optional) |
| `HACKMD_API_TOKEN` | HackMD API token (required) |
| `HACKMD_API_URL` | HackMD API URL (optional, default: https://api.hackmd.io/v1) |

**HackMD CLI Compatibility** - Also supports HackMD CLI environment variables:

```bash
export HMD_API_ACCESS_TOKEN=your-token    # Same as HACKMD_API_TOKEN
export HMD_API_ENDPOINT_URL=https://...   # Same as HACKMD_API_URL
```

> **Note:** If you're already using [HackMD CLI](https://github.com/hackmdio/hackmd-cli), HackWriter will automatically detect and use your existing `HMD_API_ACCESS_TOKEN` environment variable. No additional configuration needed!

**Config File** - Override defaults with `~/.hackwriter/config.json`:

```json
{
  "defaultModel": "anthropic-claude-3-5-sonnet-latest",
  "models": {
    "fast": {
      "provider": "anthropic",
      "model": "claude-3-5-haiku-latest",
      "maxContextSize": 200000
    }
  }
}
```

---

## Usage

### Interactive Shell

```bash
hackwriter                    # Start interactive mode
hackwriter --continue         # Resume last session
hackwriter --debug            # Enable debug logging
hackwriter -m gpt-4o          # Use specific model
```

### Shell Commands

```bash
/help                         # Show available commands
/model                        # List/switch models
/model openai-gpt-4o          # Switch to GPT-4o
/status                       # Show current status
/exit                         # Exit (or /quit, /q)
```

### Single Command

```bash
hackwriter -c "list my notes"
hackwriter -c "create a note titled 'Meeting Notes'"
```

### Auto-Approve Mode

```bash
hackwriter --yolo             # Skip all confirmations
```

---

## Supported Providers

### Anthropic
```bash
export ANTHROPIC_API_KEY=sk-ant-xxx
```
Models: Claude 3.5 Haiku, Sonnet, Opus 4

### OpenAI
```bash
export OPENAI_API_KEY=sk-xxx
```
Models: GPT-4o, GPT-4o-mini, o1

### Ollama (Local)
```bash
# Ollama auto-detected if running
ollama serve
```
All local models automatically discovered

---

## Advanced

### Custom Ollama Models

```json
{
  "models": {
    "llama": {
      "provider": "ollama",
      "model": "llama3.1:70b",
      "maxContextSize": 128000
    }
  },
  "providers": {
    "ollama": {
      "type": "ollama",
      "baseUrl": "http://localhost:11434/api"
    }
  }
}
```

### Model Management

```bash
/model                        # Show all available models
/model anthropic-*            # List Anthropic models
/model ollama-llama3.1        # Switch to specific model
```