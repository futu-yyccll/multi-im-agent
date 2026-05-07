# Multi IM Agent

Multi-bot Feishu/Lark agent runtime. The project runs every bot through the same supervisor model: one configured bot maps to one `lark-cli` profile and one worker process.

## Project Structure

```text
scripts/
  feishu-bots.mjs        # supervisor: start/stop/restart/status for all bots
  feishu-bot-worker.mjs  # internal one-bot worker process
  feishu-agent.mjs       # agent command entrypoint
config/
  bots.example.json      # committed example config
src/
  daemon/                # event loop, batching, commands
  agent/                 # provider adapter and prompt construction
  cron/                  # persistent scheduled jobs and run history
  feishu/                # lark-cli replies, reactions, JSON API helpers
  render/                # text/post/card rendering and fallback choices
  runtime/               # sessions and transcript persistence
  config/                # env and bot config loaders
  shared/                # process/stdin/log helpers
prompts/
  market-personality.md
  daily-sentiment-report.md
  report-locale-zh.md
```

## Commands

```bash
npm run check
npm run bots:status
npm run bots:start
npm run bots:restart
npm run bots:stop
```

Manage a single configured bot by passing its name:

```bash
node scripts/feishu-bots.mjs restart market
node scripts/feishu-bots.mjs status market
```

## Bot Config

Runtime config is local and ignored by Git:

```text
.market-agent/bots.json
```

Start from the committed example:

```bash
mkdir -p .market-agent
cp config/bots.example.json .market-agent/bots.json
```

Example:

```json
{
  "bots": [
    {
      "name": "market",
      "larkProfile": "market-bot",
      "dataDir": ".market-agent/bots/market",
      "logPath": ".market-agent/bots/market/feishu-bot.log",
      "env": {
        "FEISHU_AGENT_PROVIDER": "claude",
        "FEISHU_AGENT_MODEL": "claude-opus-4-6",
        "FEISHU_AGENT_CONTEXT_FILES": "prompts/market-personality.md,prompts/daily-sentiment-report.md",
        "FEISHU_AGENT_COMMAND": "node scripts/feishu-agent.mjs",
        "FEISHU_RESPOND_IN_GROUPS": "1"
      }
    }
  ]
}
```

Each bot requires a unique:

- `name`
- `larkProfile`
- `dataDir`

The current market bot keeps the existing prompt paths:

```text
prompts/market-personality.md,prompts/daily-sentiment-report.md
```

If you are migrating an existing single market bot and want to preserve its current sessions, reports, cron jobs, and log file, keep that bot on the old runtime directory:

```json
{
  "name": "market",
  "larkProfile": "cli_xxx",
  "dataDir": ".market-agent",
  "logPath": ".market-agent/feishu-bot.log",
  "env": {
    "FEISHU_AGENT_CONTEXT_FILES": "prompts/market-personality.md,prompts/daily-sentiment-report.md",
    "FEISHU_AGENT_COMMAND": "node scripts/feishu-agent.mjs"
  }
}
```

## Add A Feishu Bot

Create a new Feishu/Lark app bot in the developer console, enable the bot capability, grant message permissions, subscribe to `im.message.receive_v1`, then configure a named `lark-cli` profile:

```bash
read -rsp "App Secret: " APP_SECRET; echo
printf "%s" "$APP_SECRET" | lark-cli config init \
  --name research-bot \
  --app-id cli_xxx \
  --app-secret-stdin \
  --brand feishu
unset APP_SECRET
```

Verify:

```bash
lark-cli profile list
lark-cli --profile research-bot doctor
```

Add a bot entry to `.market-agent/bots.json`:

```json
{
  "name": "research",
  "larkProfile": "research-bot",
  "dataDir": ".market-agent/bots/research",
  "logPath": ".market-agent/bots/research/feishu-bot.log",
  "env": {
    "FEISHU_AGENT_CONTEXT_FILES": "prompts/research-personality.md",
    "FEISHU_AGENT_COMMAND": "node scripts/feishu-agent.mjs"
  }
}
```

## Runtime Model

```text
feishu app A -> lark-cli profile A -> worker A
feishu app B -> lark-cli profile B -> worker B
                               \-> shared codebase and agent wrapper
```

The supervisor records only the PIDs it starts:

```text
.market-agent/supervisor/state.json
```

It does not scan for and kill unrelated `lark-cli` or node processes.

Before starting the supervisor for a migrated bot, stop any old single-bot service for the same Feishu app/profile. Do not run two `event +subscribe` processes for the same app.

## Feishu Bot Behavior

Workers:

- listen to `im.message.receive_v1` with `lark-cli --profile <profile> event +subscribe`
- reply as the app bot with `lark-cli --profile <profile> im +messages-reply`
- respond to P2P text messages by default
- respond to group messages when `FEISHU_RESPOND_IN_GROUPS=1`
- keep one serialized session per Feishu `chat_id`
- persist JSONL transcripts under each bot's `dataDir`
- run scheduled jobs from each bot's isolated `dataDir`

Useful per-bot env values:

```bash
FEISHU_AGENT_PROVIDER=claude
FEISHU_AGENT_MODEL=claude-opus-4-6
FEISHU_AGENT_CONTEXT_FILES=prompts/market-personality.md,prompts/daily-sentiment-report.md
FEISHU_AGENT_OUTPUT_FORMAT=json
FEISHU_CLAUDE_TOOLS=WebSearch,WebFetch
FEISHU_CLAUDE_STREAM=1
FEISHU_REPLY_FORMAT=agent
FEISHU_AGENT_COMMAND='node scripts/feishu-agent.mjs'
FEISHU_RESPOND_IN_GROUPS=1
FEISHU_ALLOWED_CHAT_IDS=oc_xxx
FEISHU_REACTIONS_ENABLED=1
```

## Chat Commands

- `/help` - show available commands
- `/status` - show bot, profile, session, transcript, and agent command
- `/chat-id` - show the current Feishu chat ID
- `/new` - reset the current chat transcript
- `/cron list` - list scheduled jobs
- `/cron test --message "Generate today's report."` - run a scheduled-job prompt once without saving it
- `/cron add <id> --cron "0 9 * * *" --message "Generate today's report."` - add or replace a job for the current chat
- `/cron add <id> --cron "0 9 * * *" --chat-id oc_xxx --message "Generate today's report."` - add or replace a job for a specific chat
- `/cron remove <id>` - remove a scheduled job
- `/cron enable <id>` - enable a scheduled job
- `/cron disable <id>` - disable a scheduled job

## Rollback

The initial single-bot project baseline is committed as:

```text
0d16d64 Initial project baseline
```

Switch back to `main` to return to the pushed baseline:

```bash
git switch main
```
