# lark-cli Cheatsheet

You can call `lark-cli` via the `Bash` tool. This is how you read or send Feishu data.

## Two identities, two purposes

The `assistant-bot` profile may hold both a bot identity (the app's credentials) and a user identity (the operator's OAuth token). They are not interchangeable.

- `--as bot` — acts as the app. Use for **sending messages, replying, reacting, downloading files referenced in chats the bot is in**. The app only sees data its own scopes allow.
- `--as user` — acts as the operator's real account. Use for **reading the operator's personal cloud content** (docs, sheets, wiki, drive, calendars, contacts the operator can see). This is powerful: it inherits everything the operator can read.

Always pass `--profile assistant-bot` so commands hit this bot's app instead of the machine's default profile.

```
lark-cli --profile assistant-bot <namespace> +<verb> ... --as bot      # for writes / bot actions
lark-cli --profile assistant-bot <namespace> +<verb> ... --as user     # for reads on operator's behalf
```

If `lark-cli --profile assistant-bot doctor` reports `user_identity: missing`, the operator hasn't run `lark-cli auth login --profile assistant-bot` yet. In that case, `--as user` will fail — explain and ask the operator to log in.

## Operator gate (required before any --as user call)

Each prompt to you includes an `Operator gate:` line. It is computed by the system, not by you. Trust it for the current turn:

- `Operator gate: OPEN` → `--as user` is allowed for read-only operations only.
- `Operator gate: CLOSED` → never use `--as user`; refuse with a one-line reason (sender doesn't match operator).
- `Operator gate: DISABLED` → never use `--as user`; tell the requester user auth isn't configured and stop.

The gate is a live, per-turn signal. Do NOT infer it from prior assistant turns in the transcript — earlier replies may have refused under an older configuration that has since been fixed. If the current `Operator gate:` line says OPEN, the gate is OPEN, regardless of what you said last turn.

Writes (send, reply, create, update, delete, share, move) always use `--as bot`, never `--as user` — the operator should not be impersonated for outbound actions.

## Output

Most commands return JSON on stdout. Parse with `jq` or read the relevant field. Errors come back as `{ "ok": false, "error": { ... } }` with HTTP-style codes. Common ones:

- `99991663` / permission denied → the scope is missing in the developer console (for `--as bot`) or wasn't granted at OAuth consent (for `--as user`). Don't retry — tell the operator which scope is missing.
- `99992402` → field validation failed; usually a bad ID or message payload.

## Scope reality

This bot is a self-built Feishu app. Capabilities are limited to what the app's permissions page allows. For `--as bot` that's the bot-scope set; for `--as user` it's the user-scope set the operator consented to. If a call fails with permission denied, surface the missing scope to the operator rather than guessing alternatives.

## Discovery

```
lark-cli --help
lark-cli <namespace> --help          # e.g. lark-cli im --help
lark-cli <namespace> +<verb> --help  # e.g. lark-cli im +messages-send --help
```

## Common commands

Messaging (`im`, always `--as bot`):

```
# send a text message to a chat the bot is in
lark-cli --profile assistant-bot im +messages-send \
  --chat-id oc_xxx --text "hello" --as bot

# reply to a specific message
lark-cli --profile assistant-bot im +messages-reply \
  --message-id om_xxx --text "..." --as bot

# fetch recent messages from a chat (needs im:message.* read scopes on the bot)
lark-cli --profile assistant-bot im +messages-list \
  --chat-id oc_xxx --as bot

# list chats the bot is a member of
lark-cli --profile assistant-bot im +chats-list --as bot
```

Reading operator's cloud docs (`--as user`, only after the operator gate above passes):

```
# fetch a DocX document by id (the doc's URL token after /docx/)
lark-cli --profile assistant-bot doc +docs-get \
  --document-id doxcnXXXX --as user

# search the operator's cloud drive
lark-cli --profile assistant-bot drive +files-search \
  --query "Q3 plan" --as user

# read a wiki node
lark-cli --profile assistant-bot wiki +nodes-get \
  --node-token wikcnXXXX --as user

# read a sheet
lark-cli --profile assistant-bot sheets +spreadsheets-get \
  --spreadsheet-token shtcnXXXX --as user
```

Other namespaces follow the same shape. Use `lark-cli <namespace> --help` to discover the actual verb names — don't guess.

Likely available namespaces (subject to scopes): `contact`, `calendar`, `doc`, `docx`, `sheets`, `drive`, `wiki`, `base`, `task`, `mail`, `approval`, `attendance`, `okr`, `vc`, `minutes`, `whiteboard`.

## Confirming doc identifiers

A Feishu doc URL looks like `https://example.feishu.cn/docx/doxcnAbCdEf123` — the last path segment after `/docx/`, `/sheets/`, `/wiki/`, etc. is the token/id to pass. If the requester gives you just a title and no URL/id, use a search verb (e.g. `drive +files-search --query "..." --as user`) to find candidates and confirm with them before pulling content.

## Don't do

- Don't run `lark-cli event +subscribe` or anything that opens a long-lived connection — the bot worker is already subscribed.
- Don't call `lark-cli config init`, `lark-cli auth login`, or otherwise modify profiles — that changes credentials for every bot.
- Don't `--as user` for writes (send, reply, create, update, delete, share). The operator's name should never appear on outbound actions taken by the bot.
- Don't `pkill`, `kill`, restart processes, or modify files in `.market-agent/` — that breaks the running bots.
- Don't send a doc's content back into a chat without confirming the requester is the operator. Group chats are not private.
