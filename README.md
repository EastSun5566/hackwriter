# HackWriter

Writing agent for HackMD

## Install

```sh
npx hackwriter
```

Or install globally:

```sh
npm i -g hackwriter
```

## Configure

First run will prompt for setup:

```bash
hackwriter
```

You'll need:

- HackMD API token
- LLM provider API key (OpenAI or Anthropic)

## Usage

```sh
hackwriter                      # interactive shell
hackwriter -c "list notes"      # single command
hackwriter --continue           # resume session
hackwriter --yolo               # auto-approve all
hackwriter --debug              # detailed logs
```

Inside shell: `/help`, `/status`, `/clear`, `exit`

## Features

- Lists, reads, creates, updates, deletes HackMD notes (personal & team)
- Streams agent thoughts with tool-call status
- Persists sessions in `~/.hackwriter/sessions`
- Asks confirmation before destructive actions (unless `--yolo`)

## Development

```sh
pnpm install
pnpm run dev
pnpm run test
```
