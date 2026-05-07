# Market Agent

Minimal Feishu bot transport for a local agent loop.

## Project Structure

```text
scripts/
  feishu-bot-daemon.mjs   # compatibility entrypoint
  feishu-agent.mjs        # compatibility entrypoint
src/
  daemon/                 # event loop, batching, commands
  agent/                  # provider adapter and prompt construction
  cron/                   # persistent scheduled jobs and run history
  feishu/                 # lark-cli replies, reactions, JSON API helpers
  render/                 # text/post/card rendering and fallback choices
  runtime/                # sessions and transcript persistence
  config/                 # env config loaders
  shared/                 # process/stdin/log helpers
```

Useful commands:

```bash
npm run check
npm run start:feishu
npm run service:status
npm run service:restart
```

## Service Management

Use the service wrapper for the long-running Feishu bot. It runs the daemon inside a detached `screen` session named `market-agent-feishu`, cleans up orphaned Feishu event subscribers during restart, and writes logs to `.market-agent/feishu-bot.log`.

```bash
npm run service:status
npm run service:start
npm run service:restart
npm run service:stop
```

Default service env:

```bash
FEISHU_AGENT_PROVIDER=claude
FEISHU_AGENT_MODEL=claude-opus-4-6
FEISHU_AGENT_CONTEXT_FILES=prompts/market-personality.md
FEISHU_AGENT_OUTPUT_FORMAT=json
FEISHU_CLAUDE_TOOLS=WebSearch,WebFetch
FEISHU_CLAUDE_STREAM=1
FEISHU_REPLY_FORMAT=agent
FEISHU_AGENT_COMMAND='node scripts/feishu-agent.mjs'
```

Override any value inline when needed:

```bash
FEISHU_AGENT_CONTEXT_FILES=prompts/market-personality.md,prompts/daily-sentiment-report.md npm run service:restart
```

## Feishu Bot Daemon

Run the daemon:

```bash
node scripts/feishu-bot-daemon.mjs
```

Default behavior:

- Listens to `im.message.receive_v1` with `lark-cli event +subscribe`.
- Replies as the app bot with `lark-cli im +messages-reply`.
- Responds to P2P text messages only.
- Ignores group messages unless `FEISHU_RESPOND_IN_GROUPS=1` is set.
- Keeps one serialized session per Feishu `chat_id`.
- Debounces rapid messages and replies once to the latest message in the batch.
- Persists JSONL transcripts under `.market-agent/sessions/`.
- Uses a static reply unless `FEISHU_AGENT_COMMAND` is set.

Useful environment variables:

```bash
FEISHU_STATIC_REPLY='received: {content}' node scripts/feishu-bot-daemon.mjs
FEISHU_RESPOND_IN_GROUPS=1 node scripts/feishu-bot-daemon.mjs
FEISHU_ALLOWED_CHAT_IDS=oc_xxx node scripts/feishu-bot-daemon.mjs
FEISHU_DEBOUNCE_MS=1500 node scripts/feishu-bot-daemon.mjs
FEISHU_HISTORY_LIMIT=50 node scripts/feishu-bot-daemon.mjs
FEISHU_DATA_DIR=.market-agent node scripts/feishu-bot-daemon.mjs
FEISHU_REPLY_FORMAT=agent node scripts/feishu-bot-daemon.mjs
FEISHU_REACTIONS_ENABLED=1 node scripts/feishu-bot-daemon.mjs
FEISHU_WORKING_REACTION=Typing node scripts/feishu-bot-daemon.mjs
FEISHU_ERROR_REACTION=ERROR node scripts/feishu-bot-daemon.mjs
FEISHU_AGENT_COMMAND='node scripts/feishu-agent.mjs' node scripts/feishu-bot-daemon.mjs
```

Supported chat commands:

- `/help` - show available commands.
- `/status` - show session ID, transcript path, and agent command.
- `/chat-id` - show the current Feishu chat ID.
- `/new` - reset the current chat transcript.
- `/cron list` - list scheduled jobs.
- `/cron test --message "Generate today's report."` - run a scheduled-job prompt once without saving it.
- `/cron add <id> --cron "0 9 * * *" --message "Generate today's report."` - add or replace a scheduled job for the current chat.
- `/cron add <id> --cron "0 9 * * *" --chat-id oc_xxx --message "Generate today's report."` - add or replace a scheduled job for a specific chat.
- `/cron remove <id>` - remove a scheduled job.
- `/cron enable <id>` - enable a scheduled job.
- `/cron disable <id>` - disable a scheduled job.

`FEISHU_AGENT_COMMAND` receives a JSON envelope on stdin and should print the reply text to stdout:

```json
{
  "session": {
    "id": "oc_xxx",
    "transcript_path": ".market-agent/sessions/oc_xxx.jsonl",
    "history": []
  },
  "event": {
    "message_id": "om_xxx",
    "chat_id": "oc_xxx",
    "content": "latest debounced user content"
  },
  "messages": []
}
```

It also gets these environment variables:

- `FEISHU_MESSAGE_ID`
- `FEISHU_CHAT_ID`
- `FEISHU_CHAT_TYPE`
- `FEISHU_SENDER_ID`
- `FEISHU_MESSAGE_CONTENT`
- `FEISHU_SESSION_ID`
- `FEISHU_TRANSCRIPT_PATH`

The structure intentionally mirrors an agent loop:

```text
Feishu event -> session -> queue/debounce -> context envelope -> agent command -> Feishu reply -> transcript
```

Typing reactions:

- `FEISHU_REACTIONS_ENABLED=1` enables message reactions. Set `FEISHU_REACTIONS_ENABLED=0` to disable.
- `FEISHU_WORKING_REACTION=Typing` is added to each accepted inbound message while the agent is working.
- `FEISHU_ERROR_REACTION=ERROR` is added if the agent turn fails.
- For batched messages, the daemon adds `Typing` to every accepted message, replies once to the latest message, then clears all `Typing` reactions in that batch.
- Feishu requires reaction write permission, typically `im:message.reactions:write_only`.

## Agent Provider

The included agent wrapper uses Codex by default:

```bash
FEISHU_AGENT_COMMAND='node scripts/feishu-agent.mjs' node scripts/feishu-bot-daemon.mjs
```

Cheap local test mode:

```bash
FEISHU_AGENT_PROVIDER=echo FEISHU_AGENT_COMMAND='node scripts/feishu-agent.mjs' node scripts/feishu-bot-daemon.mjs
```

Useful provider variables:

```bash
FEISHU_AGENT_PROVIDER=codex
FEISHU_AGENT_PROVIDER=claude
FEISHU_AGENT_MODEL=gpt-5.4
FEISHU_AGENT_WORKDIR=/Users/admin/workspace/demos/market-agent
FEISHU_AGENT_SYSTEM_PROMPT='You are a concise market-analysis assistant.'
FEISHU_AGENT_CONTEXT_FILES=prompts/market-personality.md,prompts/daily-sentiment-report.md
FEISHU_AGENT_OUTPUT_FORMAT=json
FEISHU_CLAUDE_TOOLS=WebSearch,WebFetch
FEISHU_CLAUDE_STREAM=1
FEISHU_AGENT_TIMEOUT_MS=7200000
FEISHU_AGENT_HEARTBEAT_TIMEOUT_MS=300000
FEISHU_AGENT_KILL_GRACE_MS=10000
```

Run with a predefined Markdown role/context:

```bash
FEISHU_AGENT_PROVIDER=claude \
FEISHU_AGENT_CONTEXT_FILES=prompts/market-personality.md,prompts/daily-sentiment-report.md \
FEISHU_AGENT_OUTPUT_FORMAT=json \
FEISHU_REPLY_FORMAT=auto \
FEISHU_AGENT_COMMAND='node scripts/feishu-agent.mjs' \
node scripts/feishu-bot-daemon.mjs
```

Run as a market Q&A bot without forcing the daily report template:

```bash
FEISHU_AGENT_PROVIDER=claude \
FEISHU_AGENT_CONTEXT_FILES=prompts/market-personality.md \
FEISHU_AGENT_COMMAND='node scripts/feishu-agent.mjs' \
node scripts/feishu-bot-daemon.mjs
```

Reply formats:

- `FEISHU_REPLY_FORMAT=agent` lets the agent choose `text`, `post`, or `card` per reply.
- `FEISHU_REPLY_FORMAT=text` sends plain text.
- `FEISHU_REPLY_FORMAT=post` sends a Feishu post message and falls back to text.
- `FEISHU_REPLY_FORMAT=card` sends an interactive card and falls back to post then text.
- `FEISHU_REPLY_FORMAT=auto` uses card for structured JSON replies and post for text replies.

## Scheduled Reports

The daemon includes an OpenClaw-style internal cron scheduler. It runs inside the always-on Feishu daemon, persists job definitions, stores job state, records run history, and sends scheduled output directly to Feishu with `lark-cli im +messages-send`.

Default storage:

```text
.market-agent/cron/jobs.json
.market-agent/cron/jobs-state.json
.market-agent/cron/runs/*.jsonl
```

Start the daemon with the agent command enabled:

```bash
FEISHU_AGENT_PROVIDER=claude \
FEISHU_CLAUDE_TOOLS=WebSearch,WebFetch \
FEISHU_AGENT_COMMAND='node scripts/feishu-agent.mjs' \
node scripts/feishu-bot-daemon.mjs
```

No jobs are created automatically. Add scheduled reports from chat with `/cron add`, or edit `.market-agent/cron/jobs.json` manually.

Useful scheduler variables:

```bash
FEISHU_CRON_ENABLED=1
FEISHU_CRON_DRY_RUN=1
FEISHU_CRON_TICK_MS=30000
FEISHU_CRON_TZ=Asia/Hong_Kong
```

The scheduler supports:

- `{"type":"cron","expression":"0 9 * * *","timezone":"Asia/Hong_Kong"}`
- `{"type":"every","interval":"6h"}`
- `{"type":"at","time":"2026-04-29T09:00:00+08:00"}`

Set `FEISHU_CRON_DRY_RUN=1` to execute the agent and write run history without sending a Feishu message.

### Add Jobs From Chat

Use `/cron add` in any chat the bot can respond to. By default, the job delivers to the same chat, uses the personality and daily report prompts, returns JSON, and renders as an auto-selected Feishu card/post/text.

To get the current chat ID:

```text
/chat-id
```

Test a scheduled prompt before saving it:

```text
/cron test --contexts both --message "Generate today's daily crypto market sentiment report."
```

The test run executes immediately, uses the same agent path as scheduled jobs, replies with the generated output, and does not write to `.market-agent/cron/jobs.json`.

Daily 9am report:

```text
/cron add daily-sentiment --cron "0 9 * * *" --tz Asia/Hong_Kong --message "Generate today's daily crypto market sentiment report."
```

Every six hours:

```text
/cron add market-pulse --every "6h" --message "Summarize major crypto market changes since the last update."
```

One-off run:

```text
/cron add one-off-report --at "2026-04-29T09:00:00+08:00" --message "Generate a one-off crypto market report."
```

Send to another chat:

```text
/cron add hk-open --cron "0 9 * * 1-5" --chat-id oc_xxx --message "Generate the HK market open crypto brief."
```

Use only the personality prompt for a recurring Q&A-style note:

```text
/cron add trader-note --every "4h" --contexts personality --message "Give a short trader-focused read on the current crypto market."
```

Manage jobs:

```text
/cron list
/cron disable daily-sentiment
/cron enable daily-sentiment
/cron remove daily-sentiment
```
