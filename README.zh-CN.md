# Multi IM Agent

[English](README.md) | **简体中文**

一个多机器人的飞书/Lark（Feishu/Lark）agent 运行时。每个机器人都遵循同一套
**supervisor（主控)模型**：一个配置好的机器人对应一个 `lark-cli` profile 和一个
常驻的 worker 进程。worker 监听飞书消息，将其交给 agent CLI（默认是 Claude）处理，
再把回复以文本、富文本（post）或交互卡片（card）的形式渲染回聊天。

参考部署是一个 **每日市场简报机器人**（`market`）：它回答交易者的问题、生成结构化的
每日加密市场情绪报告，并可按计划定时推送该报告。但运行时本身是通用的——只要让机器人
指向不同的 prompt 文件，它就会变成另一个助手。

---

## 目录

- [核心概念](#核心概念)
- [消息生命周期](#消息生命周期)
- [目录结构](#目录结构)
- [环境要求](#环境要求)
- [快速开始](#快速开始)
- [常用命令](#常用命令)
- [机器人配置](#机器人配置)
- [回复渲染](#回复渲染)
- [市场报告与追问](#市场报告与追问)
- [定时任务（Cron）](#定时任务cron)
- [聊天命令](#聊天命令)
- [Prompt 与人设](#prompt-与人设)
- [新增一个机器人](#新增一个机器人)
- [数据与状态布局](#数据与状态布局)
- [开发与检查](#开发与检查)
- [回滚](#回滚)

---

## 核心概念

| 术语 | 含义 |
| --- | --- |
| **Supervisor（主控）** | `scripts/feishu-bots.mjs` —— 负责启动、停止、重启配置中的每个机器人并汇报状态。它只跟踪自己启动的进程 PID。 |
| **Bot（机器人）** | 一个逻辑上的助手，由 `bots.json` 中的一条记录定义（唯一的 `name`、`larkProfile`、`dataDir` 以及一个 `env` 块）。 |
| **Profile（配置档案）** | 一组具名的 `lark-cli` 凭证（`--profile <name>`），把机器人绑定到具体的飞书/Lark 应用。每个机器人一个 profile。 |
| **Worker（工作进程）** | `scripts/feishu-bot-worker.mjs` —— supervisor 为每个机器人启动的进程。它订阅飞书事件、运行 agent、发送回复，并运行该机器人的定时任务。 |
| **Agent** | `scripts/feishu-agent.mjs` —— worker 每收到一条消息时调用的命令。它从 stdin 读取一个 JSON envelope，构造 prompt，调用 provider（Claude/Codex），并把回复打印到 stdout。 |

```text
飞书应用 A ─▶ lark-cli profile A ─▶ worker A ─┐
飞书应用 B ─▶ lark-cli profile B ─▶ worker B ─┼─▶ 共享代码库 + agent 封装
飞书应用 C ─▶ lark-cli profile C ─▶ worker C ─┘
```

每个机器人都是完全隔离的：拥有自己的 profile、数据目录、会话记录、报告、定时任务和日志
文件。supervisor 从不扫描或杀掉无关的 `lark-cli` 或 `node` 进程——它只在
`.market-agent/supervisor/state.json` 中记录自己启动的 PID。

---

## 消息生命周期

1. worker 运行 `lark-cli --profile <p> event +subscribe --event-types im.message.receive_v1 --as bot`，并读取紧凑（compact）的 NDJSON 事件流。
2. 收到的 `im.message.receive_v1` 文本事件会按 message id 去重，并经 `shouldRespond` 过滤（单聊 P2P 始终响应；群聊仅在 `FEISHU_RESPOND_IN_GROUPS=1` 时响应；可选的 `FEISHU_ALLOWED_CHAT_IDS` 白名单）。
3. 机器人思考期间会加上一个“正在处理”表情（默认 `Typing`）。
4. 聊天命令（`/help`、`/status`、`/cron …`）以及报告追问（如“expand HK”“查看周度趋势”）会就地处理，不调用 agent。
5. 否则消息会进入以 `chat_id` 为单位的会话队列，并做防抖（`FEISHU_DEBOUNCE_MS`，默认 1200 毫秒）以合并连续快速的消息，**每个聊天一次只处理一批**。
6. worker 构造一个 envelope（近期会话历史 + 周度报告记忆 + 合并后的消息）并运行 agent 命令。agent 的 stdout 会被解析成一个回复 envelope。
7. 回复经渲染后用 `lark-cli im +messages-reply` 发送。“正在处理”表情被清除；若失败则加上错误表情（默认 `ERROR`）。
8. 本轮对话的双方内容都会追加写入该聊天的 JSONL 会话记录。

---

## 目录结构

```text
scripts/
  feishu-bots.mjs         # supervisor：对所有机器人执行 start/stop/restart/status
  feishu-bot-worker.mjs   # 单机器人 worker 进程（每个机器人一个）
  feishu-agent.mjs        # agent 命令入口（stdin envelope -> stdout 回复）
  rerun-briefing.mjs      # 从命令行单次重跑已保存的定时任务（发送或 --dry-run）
config/
  bots.example.json       # 已提交的示例配置
src/
  daemon/                 # worker 事件循环、消息合并、聊天命令
  agent/                  # provider 适配（claude/codex/echo）与 prompt 构造
  cron/                   # 基于文件的调度器、调度匹配、运行历史
  feishu/                 # lark-cli 封装：回复、表情、JSON 辅助
  render/                 # 文本/富文本/卡片渲染、分片、格式选择
  runtime/                # 每聊天会话与市场报告持久化
  config/                 # env + 机器人配置加载与校验
  shared/                 # 进程 spawn、stdin、日志辅助
prompts/
  market-personality.md       # 面向交易者的分析师人设
  daily-sentiment-report.md   # 每日 SG/HK/US 活动评分报告模板
  report-locale-zh.md         # 强制报告中面向用户的字段使用简体中文
  general-assistant.md        # 通用飞书助手人设
  lark-cli-cheatsheet.md      # 供通过 Bash 调用 lark-cli 的机器人参考的上下文
```

---

## 环境要求

- **Node.js**，需支持 ES module（本项目为 `"type": "module"`，并使用 `node --check` 做语法检查）。
- `PATH` 中的 **`lark-cli`**，且为每个机器人配置一个 profile。用于事件订阅、回复和表情。
- 与所选 provider 匹配的 **agent CLI**：
  - `FEISHU_AGENT_PROVIDER=claude`（默认）需要 `PATH` 中有 `claude`。
  - `FEISHU_AGENT_PROVIDER=codex` 需要 `PATH` 中有 `codex`。
  - `echo` 无需任何依赖——它只回显输入，适合做冒烟测试。

项目没有任何第三方 npm 依赖；一切都运行在 Node 标准库加上上述外部 CLI 之上。

---

## 快速开始

> 无需 `npm install`——运行时没有第三方依赖。你只需要在 `PATH` 中准备好 Node.js、
> `lark-cli` 以及你的 agent CLI（默认 `claude`）。

### 1. 配置一个 `lark-cli` profile

在开发者后台创建一个飞书/Lark 应用机器人，开启机器人能力，授予消息权限，并订阅
`im.message.receive_v1`。然后注册一个具名 profile：

```bash
read -rsp "App Secret: " APP_SECRET; echo
printf "%s" "$APP_SECRET" | lark-cli config init \
  --name market-bot \
  --app-id cli_xxx \
  --app-secret-stdin \
  --brand feishu
unset APP_SECRET
```

验证：

```bash
lark-cli profile list
lark-cli --profile market-bot doctor
```

### 2. 创建 `bots.json`

运行时配置位于 `.market-agent/bots.json`，且被 Git 忽略。从已提交的示例开始：

```bash
mkdir -p .market-agent
cp config/bots.example.json .market-agent/bots.json
```

示例定义了单个 `market` 机器人：

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

把 `larkProfile` 改成你创建的 profile。若要把配置放到别处，设置
`FEISHU_BOTS_CONFIG=/path/to/bots.json`。

### 3. 启动机器人

```bash
npm run bots:start
npm run bots:status
```

在飞书里给机器人发消息（单聊，或在 `FEISHU_RESPOND_IN_GROUPS=1` 的群里），它应当会回复。

---

## 常用命令

supervisor 命令默认作用于配置中的每个机器人：

```bash
npm run bots:status    # 显示所有机器人的运行/停止状态
npm run bots:start     # 启动所有尚未运行的机器人
npm run bots:restart   # 停止后再启动所有机器人
npm run bots:stop      # 停止所有由 supervisor 启动的机器人
npm run check          # 对 scripts/ 和 src/ 下每个 .mjs 做语法检查
```

按名字指定一个或多个机器人：

```bash
node scripts/feishu-bots.mjs restart market
node scripts/feishu-bots.mjs status market research
```

`npm run agent` 直接运行 agent 入口（它期望从 stdin 读取一个 JSON envelope）——主要用于
调试 prompt 构造和 provider。

---

## 机器人配置

`bots.json` 中的每条记录都需要唯一的 `name`、`larkProfile` 和 `dataDir`；加载器会校验
唯一性并拒绝重复项。`logPath` 默认为 `<dataDir>/feishu-bot.log`，`dataDir` 默认为
`.market-agent/bots/<name>`。机器人名称只能包含字母、数字、点、下划线和短横线。

可选的顶层 `supervisor.statePath`（或 `FEISHU_BOTS_STATE_PATH` 环境变量）可覆盖 supervisor
记录已启动 PID 的位置；默认为 `.market-agent/supervisor/state.json`。

每个机器人的行为完全由 `env` 块驱动。在这里设置的值会覆盖 supervisor 的默认值。常见变量：

> 下面列出的默认值是 worker 由 supervisor 启动时看到的**实际生效值**。supervisor 会在应用
> 你的机器人 `env` 之前注入一个基线 `env`（例如 `FEISHU_AGENT_PROVIDER=claude`、
> `FEISHU_AGENT_MODEL=claude-opus-4-7`、`FEISHU_RESPOND_IN_GROUPS=1`）。裸配置加载器的默认值
> 不同（`src/config/agent.mjs` 默认使用 `codex` provider；`src/config/daemon.mjs` 默认关闭
> 群聊回复），这仅在你不经 supervisor 直接运行 worker 时才有影响。

### Agent / provider

| 变量 | 默认值 | 含义 |
| --- | --- | --- |
| `FEISHU_AGENT_COMMAND` | `node scripts/feishu-agent.mjs` | worker 每条消息 spawn 的命令。为空则回退到静态回复。 |
| `FEISHU_AGENT_PROVIDER` | `claude` | provider 适配：`claude`、`codex` 或 `echo`。 |
| `FEISHU_AGENT_MODEL` | `claude-opus-4-7` | 传给 provider CLI 的模型。 |
| `FEISHU_AGENT_CONTEXT_FILES` | `prompts/market-personality.md,prompts/daily-sentiment-report.md` | 以逗号分隔、作为上下文前置的 prompt 文件。 |
| `FEISHU_AGENT_SYSTEM_PROMPT` | 市场分析助手预设 | provider 的 system prompt。 |
| `FEISHU_AGENT_OUTPUT_FORMAT` | `text` | 设为 `json` 时要求 agent 输出 `{format, content}` envelope（卡片/报告输出请用 `json`）。 |
| `FEISHU_AGENT_WORKDIR` | 仓库根目录 | agent 的工作目录以及相对 context 文件路径的基准。 |
| `FEISHU_OPERATOR_USER_ID` | _(未设置)_ | operator 的飞书 open_id。设置且发送者匹配时，agent 可用 `lark-cli --as user` 执行只读操作（“operator gate”）。 |
| `FEISHU_AGENT_TIMEOUT_MS` | `7200000` | 单次 agent 运行的硬超时。 |
| `FEISHU_AGENT_HEARTBEAT_TIMEOUT_MS` | `300000` | Claude 流式事件之间的最大空闲时间，超过则中止。 |
| `FEISHU_AGENT_KILL_GRACE_MS` | `10000` | 杀 agent 时 SIGTERM 与 SIGKILL 之间的宽限期。 |

### Claude provider

| 变量 | 默认值 | 含义 |
| --- | --- | --- |
| `FEISHU_CLAUDE_TOOLS` | `WebSearch,WebFetch` | 为 `claude` CLI 启用的工具。 |
| `FEISHU_CLAUDE_STREAM` | `1` | 使用带心跳监控的流式（`stream-json`）模式。 |
| `FEISHU_CHUNK_DOCTOR_MODEL` | 回退到 `FEISHU_AGENT_MODEL` | 用于修复未通过飞书校验的 post 分片的模型。 |

### 投递 / 行为

| 变量 | 默认值 | 含义 |
| --- | --- | --- |
| `FEISHU_RESPOND_IN_GROUPS` | `1`（supervisor 默认） | 回复群聊消息，而不仅是单聊。 |
| `FEISHU_ALLOWED_CHAT_IDS` | _(未设置)_ | 逗号分隔的 `chat_id` 白名单；设置后其余聊天都会被忽略。 |
| `FEISHU_REPLY_FORMAT` | `agent` | `agent` 让模型自行选择 text/post/card；也可强制 `text`/`post`/`card`。 |
| `FEISHU_DEBOUNCE_MS` | `1200` | 聊天中连续消息的合并窗口。 |
| `FEISHU_HISTORY_LIMIT` | `30` | 每轮作为历史加载的会话行数。 |
| `FEISHU_EVENT_TYPES` | `im.message.receive_v1` | 通过 `lark-cli` 订阅的事件类型。 |
| `FEISHU_STATIC_REPLY` | `Bot daemon is online. I received: {content}` | 未配置 agent 命令时使用的回复。 |

### 表情（Reactions）

| 变量 | 默认值 | 含义 |
| --- | --- | --- |
| `FEISHU_REACTIONS_ENABLED` | `1` | 添加/移除“处理中”和“错误”表情。 |
| `FEISHU_WORKING_REACTION` | `Typing` | 机器人处理期间添加的表情。 |
| `FEISHU_ERROR_REACTION` | `ERROR` | 某轮失败时添加的表情。 |

---

## 回复渲染

agent 可以返回纯字符串，或一个 JSON envelope：

```json
{ "format": "text|post|card", "content": "string OR object" }
```

渲染器（`src/render/reply.mjs`）会选择具体的飞书消息类型，并优雅回退
（`card → post → text`）：

- **text** —— 简短的对话式回复。
- **post** —— 长文/Markdown；超过飞书大小限制时自动分片。
- **card** —— 用于结构化摘要、状态更新以及包含表格的内容的交互卡片。过宽或分组的指标表会被重排并拆分为更窄的原生卡片表格，过大的卡片会被分页。

当 `FEISHU_REPLY_FORMAT=agent` 时，看起来像 post 但包含表格的回复会被自动提升为 card。
若某个 post 分片未通过飞书的字段校验，会由一个 **chunk doctor** 请求 Claude 模型对
Markdown 做最小化修复并重试；仍然失败的分片会被保存到 `.market-agent/failed-chunks/`
以便排查。

---

## 市场报告与追问

`market` 机器人的每日报告是一个结构化 JSON 载荷（通过 `report_type: "market_activation_daily"`、
`markets` 数组或匹配的标题来识别）。检测到报告时，worker 会：

- 把完整报告以 JSONL 记录的形式存到 `<dataDir>/reports/`，并
- 向聊天发送一张精简的**简报卡片（briefing card）**，而不是原始载荷。

已存储的报告可支撑一些无需完整 agent 运行的轻量追问：

- `expand HK` / `expand US` / `expand SG` / `expand all`——或中文 `展开香港 / 美国 / 新加坡 / 全部`——从最近存储的报告中展开单个市场。
- `weekly trend` / `查看周度趋势`——显示周度一致性表格。

近期报告（最近 14 条）还会被汇总成一份“周度基线（weekly baseline）”，作为报告记忆注入到每次
agent 交互中，使模型能够对评分区间与趋势进行推理。

---

## 定时任务（Cron）

每个 worker 都运行自己的调度器（`src/cron/scheduler.mjs`），除非设置 `FEISHU_CRON_ENABLED=0`，
否则默认启用。任务是机器人数据目录下的普通 JSON 文件：

```text
<dataDir>/cron/jobs.json         # 任务定义
<dataDir>/cron/jobs-state.json   # 上次运行记录（用于幂等）
<dataDir>/cron/runs/<id>.jsonl   # 每个任务的运行历史（自动裁剪）
```

调度器每隔 `FEISHU_CRON_TICK_MS`（默认 30 秒）滴答一次，支持三种调度类型：

- **cron** —— 标准 5 字段表达式（`分 时 日 月 周`），在 `FEISHU_CRON_TZ`（默认 `Asia/Hong_Kong`）时区求值。支持 `*`、区间、列表和 `/步长`。
- **every** —— 固定间隔，如 `6h`、`30m`、`90s`。
- **at** —— 单个 ISO 时间戳，用于一次性运行。

任务会带着一条任务消息运行 agent（可选地附带上一份成功报告用于对比），失败时重试，并使用
幂等键把结果投递到目标 `chat_id`，从而避免重试的滴答重复发送。设置
`FEISHU_CRON_DRY_RUN=1`（或任务上的 `delivery.dry_run`）可只运行而不发送。

在聊天中用 `/cron` 管理任务：

| 命令 | 说明 |
| --- | --- |
| `/cron list` | 列出定时任务。 |
| `/cron test --message "Generate today's report."` | 立即运行一次任务的 prompt（不保存）。 |
| `/cron add <id> --cron "0 9 * * *" --message "…"` | 为当前聊天新增或替换一个每日任务。 |
| `/cron add <id> --cron "0 9 * * *" --chat-id oc_xxx --message "…"` | 投递到指定聊天。 |
| `/cron add <id> --every "6h" --message "…"` | 新增一个按间隔运行的任务。 |
| `/cron add <id> --at "2026-04-29T09:00:00+08:00" --message "…"` | 新增一个一次性任务。 |
| `/cron remove <id>` | 删除任务。 |
| `/cron enable <id>` / `/cron disable <id>` | 启用/停用任务。 |

`--contexts` 接受 `both`（默认）、`personality`、`report`，或以逗号分隔的 `.md` 路径列表。
默认：投递到当前聊天，上下文为 personality + report，输出为 JSON 卡片。

从命令行单次重跑一个已保存的任务（例如重新生成简报）：

```bash
node scripts/rerun-briefing.mjs market daily-report          # 发送
node scripts/rerun-briefing.mjs market daily-report --dry-run # 只运行不发送
```

---

## 聊天命令

| 命令 | 说明 |
| --- | --- |
| `/help` | 显示可用命令。 |
| `/status` | 显示机器人、profile、会话、会话记录、待处理数量和 agent 命令。 |
| `/chat-id` | 显示当前飞书 chat ID。 |
| `/new` | 重置当前聊天的会话记录。 |
| `/cron …` | 管理定时任务（见上文）。 |

无论消息是否 @ 机器人，命令都能生效；解析前会先去掉开头的 @ 提及。

---

## Prompt 与人设

机器人的行为由 `FEISHU_AGENT_CONTEXT_FILES` 中列出的 prompt 文件塑造，这些文件会在每轮被
读取并作为上下文前置：

- **`market-personality.md`** —— 简洁、面向交易者的加密市场分析师人设。
- **`daily-sentiment-report.md`** —— 每日 SG/HK/US 活动就绪度报告模板（数据来源、评分和 JSON 输出契约）。仅在请求每日报告时套用。
- **`report-locale-zh.md`** —— 强制报告中面向用户的字段使用简体中文。
- **`general-assistant.md`** —— 面向非市场机器人的通用、随用户语言应答的飞书助手人设。
- **`lark-cli-cheatsheet.md`** —— 供被允许通过 Bash 工具调用 `lark-cli` 的机器人参考的上下文，包含 `--as bot` 与 `--as user` 的区别。

要创建另一个助手，只需新增一条指向不同 prompt 文件的机器人记录——无需改动代码。

---

## 新增一个机器人

1. 创建第二个飞书应用及对应的 `lark-cli` profile（见[快速开始](#快速开始)）。
2. 在 `.market-agent/bots.json` 中新增一条记录，`name`、`larkProfile`、`dataDir` 均需唯一：

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

3. `node scripts/feishu-bots.mjs start research`。

> 不要为同一个飞书应用运行两个 `event +subscribe` 进程。如果你在迁移一个现有的单机器人
> 部署，请先停掉旧服务，并复用其 `dataDir`（例如 `.market-agent`），以保留其会话、报告、
> 定时任务和日志文件。

---

## 数据与状态布局

```text
.market-agent/
  bots.json                         # 你的本地配置（被 gitignore）
  supervisor/state.json             # supervisor 启动的 PID
  bots/<name>/
    feishu-bot.log                  # worker 的 stdout/stderr
    sessions/<chat_id>.jsonl        # 每聊天会话记录
    reports/market_activation_daily.jsonl
    cron/jobs.json | jobs-state.json | runs/<id>.jsonl
  failed-chunks/                    # 未通过飞书校验的 post 分片
```

`.market-agent/` 下的所有内容都是本地运行时状态，且被 Git 忽略。

---

## 开发与检查

没有构建步骤，也没有测试运行器。用以下命令对整个代码库做语法检查：

```bash
npm run check
```

它会对 `scripts/` 和 `src/` 下每个 `.mjs` 文件运行 `node --check`。做手动调试时，`echo`
provider（`FEISHU_AGENT_PROVIDER=echo`）可以在不调用模型的情况下，走通完整的
消息 → 渲染 → 回复链路。

---

## 回滚

最初的单机器人基线已作为 `0d16d64 Initial project baseline` 提交在 `main` 分支上。要回到已推送
的基线：

```bash
git switch main
```
