# Multi IM Agent

A multi-bot Feishu/Lark agent runtime. Every bot runs through the same
**supervisor model**: one configured bot maps to one `lark-cli` profile and one
long-running worker process. Workers listen for Feishu messages, hand them to an
agent CLI (Claude by default), and render the reply back into the chat as text,
a post, or an interactive card.

The reference deployment is a **daily market briefing bot** (`market`) that
answers trader questions, produces a structured daily crypto-market sentiment
report, and can push that report on a schedule — but the runtime itself is
generic: point a bot at different prompt files and it becomes a different
assistant.

---

## Contents

- [Core Concepts](#core-concepts)
- [Message Lifecycle](#message-lifecycle)
- [Directory Structure](#directory-structure)
- [Requirements](#requirements)
- [Quick Start](#quick-start)
- [Commands](#commands)
- [Bot Configuration](#bot-configuration)
- [Reply Rendering](#reply-rendering)
- [Market Reports & Follow-ups](#market-reports--follow-ups)
- [Scheduled Jobs (Cron)](#scheduled-jobs-cron)
- [Chat Commands](#chat-commands)
- [Prompts & Personality](#prompts--personality)
- [Adding Another Bot](#adding-another-bot)
- [Data & State Layout](#data--state-layout)
- [Development & Checks](#development--checks)
- [Rollback](#rollback)

---

## Core Concepts

| Term | What it is |
| --- | --- |
| **Supervisor** | `scripts/feishu-bots.mjs` — starts, stops, restarts, and reports status for every bot in the config. It only tracks the PIDs it spawns. |
| **Bot** | One logical assistant, defined by an entry in `bots.json` (a unique `name`, `larkProfile`, `dataDir`, and an `env` block). |
| **Profile** | A named `lark-cli` credential set (`--profile <name>`) that binds a bot to a specific Feishu/Lark app. One profile per bot. |
| **Worker** | `scripts/feishu-bot-worker.mjs` — the per-bot process the supervisor launches. It subscribes to Feishu events, runs the agent, sends replies, and runs that bot's cron jobs. |
| **Agent** | `scripts/feishu-agent.mjs` — the command a worker invokes per message. It reads a JSON envelope from stdin, builds a prompt, calls a provider (Claude/Codex), and prints the reply to stdout. |

```text
Feishu app A ─▶ lark-cli profile A ─▶ worker A ─┐
Feishu app B ─▶ lark-cli profile B ─▶ worker B ─┼─▶ shared codebase + agent wrapper
Feishu app C ─▶ lark-cli profile C ─▶ worker C ─┘
```

Each bot is fully isolated: its own profile, data directory, transcripts,
reports, cron jobs, and log file. The supervisor never scans for or kills
unrelated `lark-cli` or `node` processes — it records only the PIDs it started
in `.market-agent/supervisor/state.json`.

---

## Message Lifecycle

1. The worker runs `lark-cli --profile <p> event +subscribe --event-types im.message.receive_v1 --as bot` and reads the compact NDJSON event stream.
2. Incoming `im.message.receive_v1` text events are de-duplicated by message id and filtered by `shouldRespond` (P2P always; groups only when `FEISHU_RESPOND_IN_GROUPS=1`; optional `FEISHU_ALLOWED_CHAT_IDS` allowlist).
3. A "working" reaction (default `Typing`) is added while the bot thinks.
4. Chat commands (`/help`, `/status`, `/cron …`) and report follow-ups (e.g. "expand HK", "查看周度趋势") are handled inline without invoking the agent.
5. Otherwise the message is queued into a per-`chat_id` session, debounced (`FEISHU_DEBOUNCE_MS`, default 1200 ms) so rapid-fire messages are batched, and processed **one batch at a time per chat**.
6. The worker builds an envelope (recent transcript history + weekly report memory + the batched message) and runs the agent command. The agent's stdout is parsed into a reply envelope.
7. The reply is rendered and sent with `lark-cli im +messages-reply`. The working reaction is cleared; an error reaction (default `ERROR`) is added on failure.
8. Both sides of the exchange are appended to the chat's JSONL transcript.

---

## Directory Structure

```text
scripts/
  feishu-bots.mjs         # supervisor: start/stop/restart/status for all bots
  feishu-bot-worker.mjs   # per-bot worker process (one per bot)
  feishu-agent.mjs        # agent command entrypoint (stdin envelope -> stdout reply)
  rerun-briefing.mjs      # re-run a saved cron job once from the CLI (deliver or --dry-run)
config/
  bots.example.json       # committed example config
src/
  daemon/                 # worker event loop, message batching, chat commands
  agent/                  # provider adapters (claude/codex/echo) and prompt construction
  cron/                   # file-based scheduler, schedule matching, run history
  feishu/                 # lark-cli wrappers: replies, reactions, JSON helpers
  render/                 # text/post/card rendering, chunking, format selection
  runtime/                # per-chat sessions and market-report persistence
  config/                 # env + bot config loaders and validation
  shared/                 # process spawn, stdin, and log helpers
prompts/
  market-personality.md       # trader-focused analyst persona
  daily-sentiment-report.md   # daily SG/HK/US campaign-scoring report template
  report-locale-zh.md         # forces user-facing report fields into 简体中文
  general-assistant.md        # generic Feishu assistant persona
  lark-cli-cheatsheet.md      # reference context for bots that call lark-cli via Bash
```

---

## Requirements

- **Node.js** with ES module support (the project is `"type": "module"` and uses `node --check` for linting).
- **`lark-cli`** on `PATH`, configured with one profile per bot. Used for event subscription, replies, and reactions.
- An **agent CLI** matching your provider:
  - `claude` on `PATH` for `FEISHU_AGENT_PROVIDER=claude` (the default).
  - `codex` on `PATH` for `FEISHU_AGENT_PROVIDER=codex`.
  - `echo` needs nothing — it just echoes input, useful for smoke tests.

There are no third-party npm dependencies; everything runs on the Node standard library plus the external CLIs above.

---

## Quick Start

> No `npm install` is required — the runtime has no third-party dependencies.
> You only need Node.js, `lark-cli`, and your agent CLI (`claude` by default) on
> `PATH`.

### 1. Configure a `lark-cli` profile

Create a Feishu/Lark app bot in the developer console, enable the bot
capability, grant message permissions, and subscribe to
`im.message.receive_v1`. Then register a named profile:

```bash
read -rsp "App Secret: " APP_SECRET; echo
printf "%s" "$APP_SECRET" | lark-cli config init \
  --name market-bot \
  --app-id cli_xxx \
  --app-secret-stdin \
  --brand feishu
unset APP_SECRET
```

Verify it:

```bash
lark-cli profile list
lark-cli --profile market-bot doctor
```

### 2. Create `bots.json`

Runtime config lives at `.market-agent/bots.json` and is ignored by Git. Start
from the committed example:

```bash
mkdir -p .market-agent
cp config/bots.example.json .market-agent/bots.json
```

The example defines a single `market` bot:

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
        "FEISHU_AGENT_MODEL": "claude-opus-4-7",
        "FEISHU_AGENT_CONTEXT_FILES": "prompts/market-personality.md,prompts/daily-sentiment-report.md",
        "FEISHU_AGENT_COMMAND": "node scripts/feishu-agent.mjs",
        "FEISHU_RESPOND_IN_GROUPS": "1"
      }
    }
  ]
}
```

Edit `larkProfile` to match the profile you created. To point the config
somewhere else, set `FEISHU_BOTS_CONFIG=/path/to/bots.json`.

### 3. Start the bots

```bash
npm run bots:start
npm run bots:status
```

Message the bot in Feishu (P2P, or in a group with `FEISHU_RESPOND_IN_GROUPS=1`)
and it should reply.

---

## Commands

Supervisor commands act on every bot in the config by default:

```bash
npm run bots:status    # show running/stopped state for all bots
npm run bots:start     # start every bot not already running
npm run bots:restart   # stop then start every bot
npm run bots:stop      # stop every bot the supervisor started
npm run check          # syntax-check every .mjs under scripts/ and src/
```

Target one or more specific bots by name:

```bash
node scripts/feishu-bots.mjs restart market
node scripts/feishu-bots.mjs status market research
```

`npm run agent` runs the agent entrypoint directly (it expects a JSON envelope
on stdin) — mostly useful for debugging prompt construction and providers.

---

## Bot Configuration

Each entry in `bots.json` requires a unique `name`, `larkProfile`, and
`dataDir`; the loader validates uniqueness and rejects duplicates. `logPath`
defaults to `<dataDir>/feishu-bot.log`, and `dataDir` defaults to
`.market-agent/bots/<name>`. Bot names may contain letters, numbers, dot,
underscore, and dash.

The optional top-level `supervisor.statePath` (or the `FEISHU_BOTS_STATE_PATH`
env var) overrides where the supervisor records started PIDs; it defaults to
`.market-agent/supervisor/state.json`.

Per-bot behavior is driven entirely by the `env` block. Values set there
override the supervisor defaults. Common variables:

> The defaults below are the **effective** values a worker sees when launched by
> the supervisor, which injects a baseline `env` (e.g. `FEISHU_AGENT_PROVIDER=claude`,
> `FEISHU_AGENT_MODEL=claude-opus-4-7`, `FEISHU_RESPOND_IN_GROUPS=1`) before your
> per-bot `env` is applied. The bare config loaders default differently
> (`src/config/agent.mjs` uses the `codex` provider; `src/config/daemon.mjs`
> leaves group replies off), which only matters if you run a worker without the
> supervisor.

### Agent / provider

| Variable | Default | Meaning |
| --- | --- | --- |
| `FEISHU_AGENT_COMMAND` | `node scripts/feishu-agent.mjs` | Command the worker spawns per message. Empty falls back to a static reply. |
| `FEISHU_AGENT_PROVIDER` | `claude` | Provider adapter: `claude`, `codex`, or `echo`. |
| `FEISHU_AGENT_MODEL` | `claude-opus-4-7` | Model passed to the provider CLI. |
| `FEISHU_AGENT_CONTEXT_FILES` | `prompts/market-personality.md,prompts/daily-sentiment-report.md` | Comma-separated prompt files prepended as context. |
| `FEISHU_AGENT_SYSTEM_PROMPT` | market-analysis assistant preset | System prompt for the provider. |
| `FEISHU_AGENT_OUTPUT_FORMAT` | `text` | `json` asks the agent to emit a `{format, content}` envelope (set to `json` for card/report output). |
| `FEISHU_AGENT_WORKDIR` | repo root | Working directory for the agent and relative context-file paths. |
| `FEISHU_OPERATOR_USER_ID` | _(unset)_ | Feishu open_id of the operator. When set and the sender matches, the agent may use `lark-cli --as user` for read-only actions ("operator gate"). |
| `FEISHU_AGENT_TIMEOUT_MS` | `7200000` | Hard timeout for a single agent run. |
| `FEISHU_AGENT_HEARTBEAT_TIMEOUT_MS` | `300000` | Max idle time between Claude stream events before aborting. |
| `FEISHU_AGENT_KILL_GRACE_MS` | `10000` | Grace period between SIGTERM and SIGKILL when killing an agent. |

### Claude provider

| Variable | Default | Meaning |
| --- | --- | --- |
| `FEISHU_CLAUDE_TOOLS` | `WebSearch,WebFetch` | Tools enabled for the `claude` CLI. |
| `FEISHU_CLAUDE_STREAM` | `1` | Use streaming (`stream-json`) mode with heartbeat monitoring. |
| `FEISHU_CHUNK_DOCTOR_MODEL` | falls back to `FEISHU_AGENT_MODEL` | Model used to repair post chunks that fail Feishu validation. |

### Delivery / behavior

| Variable | Default | Meaning |
| --- | --- | --- |
| `FEISHU_RESPOND_IN_GROUPS` | `1` (supervisor default) | Reply to group messages, not just P2P. |
| `FEISHU_ALLOWED_CHAT_IDS` | _(unset)_ | Comma-separated allowlist of `chat_id`s; when set, all others are ignored. |
| `FEISHU_REPLY_FORMAT` | `agent` | `agent` lets the model choose text/post/card; or force `text`/`post`/`card`. |
| `FEISHU_DEBOUNCE_MS` | `1200` | Batch window for rapid consecutive messages in a chat. |
| `FEISHU_HISTORY_LIMIT` | `30` | Transcript lines loaded as history per turn. |
| `FEISHU_EVENT_TYPES` | `im.message.receive_v1` | Event types subscribed via `lark-cli`. |
| `FEISHU_STATIC_REPLY` | `Bot daemon is online. I received: {content}` | Reply used when no agent command is configured. |

### Reactions

| Variable | Default | Meaning |
| --- | --- | --- |
| `FEISHU_REACTIONS_ENABLED` | `1` | Add/remove working and error reactions. |
| `FEISHU_WORKING_REACTION` | `Typing` | Emoji added while the bot is working. |
| `FEISHU_ERROR_REACTION` | `ERROR` | Emoji added when a turn fails. |

---

## Reply Rendering

Agents can return a plain string or a JSON envelope:

```json
{ "format": "text|post|card", "content": "string OR object" }
```

The renderer (`src/render/reply.mjs`) selects a concrete Feishu message type and
falls back gracefully (`card → post → text`):

- **text** — short conversational replies.
- **post** — long prose / Markdown; automatically chunked when it exceeds Feishu's size limits.
- **card** — interactive cards for structured summaries, status updates, and anything with tables. Wide or grouped metric tables are reshaped and split into narrower native card tables, and oversized cards are paginated.

When `FEISHU_REPLY_FORMAT=agent`, replies that look like posts but contain
tables are automatically promoted to cards. If a post chunk fails Feishu's field
validation, a **chunk doctor** asks a Claude model to minimally repair the
Markdown and retries; chunks that still fail are persisted under
`.market-agent/failed-chunks/` for inspection.

---

## Market Reports & Follow-ups

The `market` bot's daily report is a structured JSON payload (identified by
`report_type: "market_activation_daily"`, a `markets` array, or a matching
title). When one is detected, the worker:

- stores the full report as a JSONL record under `<dataDir>/reports/`, and
- sends a condensed **briefing card** to the chat instead of the raw payload.

Stored reports power lightweight follow-ups handled without a full agent run:

- `expand HK` / `expand US` / `expand SG` / `expand all` — or Chinese `展开香港 / 美国 / 新加坡 / 全部` — expand a single market from the latest stored report.
- `weekly trend` / `查看周度趋势` — show the weekly consistency table.

Recent reports (last 14) are also summarized into a "weekly baseline" that is
injected into each agent turn as report memory, so the model can reason about
score ranges and trends over time.

---

## Scheduled Jobs (Cron)

Each worker runs its own scheduler (`src/cron/scheduler.mjs`), enabled unless
`FEISHU_CRON_ENABLED=0`. Jobs are plain JSON files under the bot's data dir:

```text
<dataDir>/cron/jobs.json         # job definitions
<dataDir>/cron/jobs-state.json   # last-run bookkeeping (idempotency)
<dataDir>/cron/runs/<id>.jsonl   # per-job run history (auto-trimmed)
```

The scheduler ticks every `FEISHU_CRON_TICK_MS` (default 30 s) and supports three
schedule types:

- **cron** — a standard 5-field expression (`minute hour day-of-month month day-of-week`), evaluated in `FEISHU_CRON_TZ` (default `Asia/Hong_Kong`). Supports `*`, ranges, lists, and `/steps`.
- **every** — a fixed interval like `6h`, `30m`, `90s`.
- **at** — a single ISO timestamp for a one-off run.

Jobs run the agent with a job message (optionally including the previous
successful report for comparison), retry on failure, and deliver the result to a
target `chat_id` using an idempotency key so a retried tick doesn't double-post.
Set `FEISHU_CRON_DRY_RUN=1` (or `delivery.dry_run` on a job) to run without
sending.

Manage jobs from chat with `/cron`:

| Command | Description |
| --- | --- |
| `/cron list` | List scheduled jobs. |
| `/cron test --message "Generate today's report."` | Run a job's prompt once now (not saved). |
| `/cron add <id> --cron "0 9 * * *" --message "…"` | Add or replace a daily job for the current chat. |
| `/cron add <id> --cron "0 9 * * *" --chat-id oc_xxx --message "…"` | Deliver to a specific chat. |
| `/cron add <id> --every "6h" --message "…"` | Add an interval job. |
| `/cron add <id> --at "2026-04-29T09:00:00+08:00" --message "…"` | Add a one-off job. |
| `/cron remove <id>` | Remove a job. |
| `/cron enable <id>` / `/cron disable <id>` | Toggle a job. |

`--contexts` accepts `both` (default), `personality`, `report`, or a
comma-separated list of `.md` paths. Defaults: delivery goes to the current
chat, context is personality + report, output is a JSON card.

To re-run a saved job from the shell (e.g. to regenerate a briefing):

```bash
node scripts/rerun-briefing.mjs market daily-report          # deliver
node scripts/rerun-briefing.mjs market daily-report --dry-run # run without sending
```

---

## Chat Commands

| Command | Description |
| --- | --- |
| `/help` | Show available commands. |
| `/status` | Show bot, profile, session, transcript, pending count, and agent command. |
| `/chat-id` | Show the current Feishu chat ID. |
| `/new` | Reset the current chat's transcript. |
| `/cron …` | Manage scheduled jobs (see above). |

Commands work whether or not the message @-mentions the bot; a leading mention
is stripped before parsing.

---

## Prompts & Personality

A bot's behavior is shaped by the prompt files listed in
`FEISHU_AGENT_CONTEXT_FILES`, which are read and prepended as context each turn:

- **`market-personality.md`** — a concise, trader-focused crypto analyst persona.
- **`daily-sentiment-report.md`** — the daily SG/HK/US campaign-readiness report template (data sources, scoring, and the JSON output contract). Applied only when a daily/report is requested.
- **`report-locale-zh.md`** — forces user-facing report fields into 简体中文.
- **`general-assistant.md`** — a generic, language-matching Feishu assistant persona for non-market bots.
- **`lark-cli-cheatsheet.md`** — reference context for bots allowed to call `lark-cli` via a Bash tool, including the `--as bot` vs `--as user` distinction.

To create a different assistant, add a new bot entry pointing at different
prompt files — no code changes required.

---

## Adding Another Bot

1. Create a second Feishu app and a matching `lark-cli` profile (see [Quick Start](#quick-start)).
2. Add a new entry to `.market-agent/bots.json` with a unique `name`, `larkProfile`, and `dataDir`:

   ```json
   {
     "name": "research",
     "larkProfile": "research-bot",
     "dataDir": ".market-agent/bots/research",
     "logPath": ".market-agent/bots/research/feishu-bot.log",
     "env": {
       "FEISHU_AGENT_CONTEXT_FILES": "prompts/general-assistant.md",
       "FEISHU_AGENT_COMMAND": "node scripts/feishu-agent.mjs"
     }
   }
   ```

3. `node scripts/feishu-bots.mjs start research`.

> Do not run two `event +subscribe` processes for the same Feishu app. If you
> are migrating an existing single-bot deployment, stop the old service first
> and reuse its `dataDir` (e.g. `.market-agent`) to preserve its sessions,
> reports, cron jobs, and log file.

---

## Data & State Layout

```text
.market-agent/
  bots.json                         # your local config (gitignored)
  supervisor/state.json             # PIDs the supervisor started
  bots/<name>/
    feishu-bot.log                  # worker stdout/stderr
    sessions/<chat_id>.jsonl        # per-chat transcript
    reports/market_activation_daily.jsonl
    cron/jobs.json | jobs-state.json | runs/<id>.jsonl
  failed-chunks/                    # post chunks that failed Feishu validation
```

Everything under `.market-agent/` is local runtime state and is ignored by Git.

---

## Development & Checks

There is no build step and no test runner. Verify syntax across the codebase
with:

```bash
npm run check
```

This runs `node --check` on every `.mjs` file under `scripts/` and `src/`. For
manual debugging, the `echo` provider (`FEISHU_AGENT_PROVIDER=echo`) lets you
exercise the full message → render → reply path without calling a model.

---

## Rollback

The initial single-bot baseline is committed as `0d16d64 Initial project
baseline` on `main`. To return to the pushed baseline:

```bash
git switch main
```
