# HackWriter

Writing agent for HackMD

## Requirements

- Node.js 18+
- `pnpm`
- HackMD API token
- LLM provider API key

## Install & Configure

```bash
pnpm install

pnpm run dev
```

## Run

```bash
pnpm run dev            # interactive shell
pnpm run dev -- -c "list notes"   # single command
pnpm run dev -- --continue        # resume previous session
pnpm run dev -- --yolo            # auto-approve destructive actions
pnpm run dev -- --debug           # show detailed logs
```

Inside the shell use `/help`, `/status`, `/clear`, and `exit`.

## What It Does

- Lists, reads, creates, updates, deletes HackMD notes (personal & team)
- Streams agent thoughts/output with tool-call status
- Persists session history + token usage in `~/.hackwriter/sessions`
- Asks for confirmation before destructive actions unless `--yolo`
