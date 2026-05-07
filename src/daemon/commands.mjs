import {
  listCronJobs,
  removeCronJob,
  runCronJobNow,
  setCronJobEnabled,
  upsertCronJob,
} from "../cron/scheduler.mjs";

export async function handleCommand(session, event, context) {
  const content = event.content.replace(/^@\S+\s+/, "").trim();
  if (!content.startsWith("/")) {
    return "";
  }

  const [command] = content.split(/\s+/, 1);
  if (command === "/help") {
    return [
      "Commands:",
      "/help - show commands",
      "/status - show session status",
      "/chat-id - show this chat ID",
      "/new - reset this chat session transcript",
      "/cron list - list scheduled jobs",
      '/cron test --message "Generate today\'s report." - run once now without saving a job',
      '/cron add <id> --cron "0 9 * * *" --message "Generate today\'s report." - add or replace a job for this chat',
      '/cron add <id> --cron "0 9 * * *" --chat-id oc_xxx --message "..." - send a job to a specific chat',
      "/cron remove <id> - remove a scheduled job",
      "/cron enable <id> - enable a scheduled job",
      "/cron disable <id> - disable a scheduled job",
    ].join("\n");
  }

  if (command === "/status") {
    return [
      `bot: ${context.config.botName}`,
      `lark_profile: ${context.config.larkProfile}`,
      `session: ${session.id}`,
      `chat_id: ${event.chat_id || session.id}`,
      `transcript: ${session.transcriptPath}`,
      `pending: ${session.pending.length}`,
      `agent_command: ${context.config.agentCommand || "(static reply)"}`,
      `reactions: ${context.config.reactionsEnabled ? context.config.workingReaction : "disabled"}`,
    ].join("\n");
  }

  if (command === "/chat-id") {
    return event.chat_id || session.id;
  }

  if (command === "/new") {
    await context.sessions.resetTranscript(session);
    return "Started a new session for this chat.";
  }

  if (command === "/cron") {
    return handleCronCommand(content, session, event, context);
  }

  return "Unknown command. Send /help for available commands.";
}

async function handleCronCommand(content, session, event, context) {
  const args = parseArgs(content);
  const subcommand = args.positionals[1] || "help";

  if (subcommand === "help") {
    return cronHelp();
  }

  if (subcommand === "list") {
    const jobs = await listCronJobs(context.config);
    if (jobs.length === 0) {
      return "No cron jobs configured.";
    }

    return [
      "Cron jobs:",
      ...jobs.map(formatCronJob),
    ].join("\n");
  }

  if (subcommand === "test") {
    const job = buildJobFromArgs(args, event, context, {
      requireId: false,
      requireSchedule: false,
      defaultId: `test-${Date.now()}`,
    });
    if (typeof job === "string") {
      return job;
    }

    const result = await runCronJobNow(context.config, job, {
      sessions: context.sessions,
      log: context.log,
    });
    return result.reply;
  }

  if (subcommand === "add") {
    const jobConfig = buildJobFromArgs(args, event, context, {
      requireId: true,
      requireSchedule: true,
    });
    if (typeof jobConfig === "string") {
      return jobConfig;
    }

    const job = await upsertCronJob(context.config, jobConfig);

    await context.sessions.appendTranscript(session, "system", `Cron job saved: ${job.id}`, {
      cron_job_id: job.id,
      command: true,
    });

    return [
      `Saved cron job: ${job.id}`,
      `schedule: ${formatSchedule(job.schedule)}`,
      `chat: ${job.delivery.chat_id}`,
      `contexts: ${job.contextFiles.join(", ")}`,
    ].join("\n");
  }

  if (subcommand === "remove" || subcommand === "delete") {
    const id = args.positionals[2];
    if (!id) {
      return "Usage: /cron remove <id>";
    }

    const removed = await removeCronJob(context.config, id);
    return removed ? `Removed cron job: ${id}` : `Cron job not found: ${id}`;
  }

  if (subcommand === "enable" || subcommand === "disable") {
    const id = args.positionals[2];
    if (!id) {
      return `Usage: /cron ${subcommand} <id>`;
    }

    const job = await setCronJobEnabled(context.config, id, subcommand === "enable");
    return job ? `${subcommand === "enable" ? "Enabled" : "Disabled"} cron job: ${id}` : `Cron job not found: ${id}`;
  }

  return `Unknown cron command: ${subcommand}\n\n${cronHelp()}`;
}

function buildSchedule({ expression, every, at, timezone }) {
  if (expression) {
    return {
      type: "cron",
      expression,
      timezone,
    };
  }
  if (every) {
    return {
      type: "every",
      interval: every,
    };
  }
  if (at) {
    return {
      type: "at",
      time: at,
    };
  }
  return null;
}

function buildJobFromArgs(args, event, context, options = {}) {
  const id = args.positionals[2] || options.defaultId;
  if (options.requireId && !id) {
    return 'Usage: /cron add <id> --cron "0 9 * * *" --message "Generate today\'s report."';
  }

  const expression = args.flags.cron || args.flags.schedule;
  const every = args.flags.every;
  const at = args.flags.at;
  const schedule = buildSchedule({ expression, every, at, timezone: args.flags.tz || args.flags.timezone || context.config.cronTimezone });
  if (options.requireSchedule && !schedule) {
    return 'Add a schedule with --cron "0 9 * * *", --every "6h", or --at "2026-04-29T09:00:00+08:00".';
  }

  const message = args.flags.message || args.flags.msg || args.rest.join(" ").trim();
  if (!message) {
    return 'Add a job message with --message "Generate today\'s report."';
  }

  const rawContexts = args.flags.contexts || args.flags.context || args.flags.contextFiles || args.flags["context-files"] || "both";
  const contextFiles = resolveContextFiles(rawContexts);
  if (rawContexts !== "both" && rawContexts !== "personality" && rawContexts !== "report" && contextFiles.length === 0) {
    return 'No valid context paths found. Use .md paths like "prompts/market-personality.md,prompts/daily-sentiment-report.md".';
  }

  const chatId = resolveChatId(args.flags["chat-id"] || args.flags.chat || args.flags.to, event.chat_id);
  return {
    id,
    name: args.flags.name || id,
    enabled: args.flags.enabled !== "false",
    schedule: schedule || {
      type: "at",
      time: new Date().toISOString(),
    },
    session: args.flags.session || "isolated",
    message,
    contextFiles,
    outputFormat: args.flags.output || "json",
    replyFormat: args.flags.format || "auto",
    retries: Number(args.flags.retries || 1),
    retryDelayMs: Number(args.flags.retryDelayMs || args.flags["retry-delay-ms"] || 10000),
    delivery: {
      channel: "feishu",
      chat_id: chatId,
    },
  };
}

function resolveChatId(value, currentChatId) {
  if (!value || value === "current" || value === "here") {
    return currentChatId;
  }
  return value;
}

function resolveContextFiles(value) {
  if (value === "personality") {
    return ["prompts/market-personality.md"];
  }
  if (value === "report") {
    return ["prompts/daily-sentiment-report.md"];
  }
  if (value === "both") {
    return ["prompts/market-personality.md", "prompts/daily-sentiment-report.md"];
  }
  const contexts = value
    .split(",")
    .map((item) => sanitizeContextPath(item))
    .filter(Boolean);
  return contexts;
}

function sanitizeContextPath(input) {
  const trimmed = String(input || "").trim();
  if (!trimmed) {
    return "";
  }

  const markdownLink = trimmed.match(/^(.+?)\[(.+?)\]\(([^)]+)\)(.*)$/);
  if (markdownLink) {
    const prefix = String(markdownLink[1] || "").trim();
    const label = String(markdownLink[2] || "").trim();
    const url = String(markdownLink[3] || "").trim();
    const suffix = String(markdownLink[4] || "").trim();
    const reconstructed = [prefix, extractPathHint(label, url), suffix].filter(Boolean).join("");
    return sanitizeContextPath(reconstructed);
  }

  const withoutQuotes = trimmed.replace(/^['"]|['"]$/g, "");
  const normalized = withoutQuotes.replace(/\\/g, "/");
  if (normalized.includes("://")) {
    return "";
  }
  if (!/^[a-zA-Z0-9._/\-]+$/.test(normalized)) {
    return "";
  }
  if (!normalized.endsWith(".md")) {
    return "";
  }
  return normalized;
}

function extractPathHint(label, url) {
  if (label && !label.includes("://")) {
    return label;
  }
  try {
    const parsed = new URL(url);
    const name = parsed.pathname.split("/").filter(Boolean).at(-1) || "";
    return name || label;
  } catch {
    return label;
  }
}

function formatCronJob(job) {
  return [
    `- ${job.id} [${job.enabled ? "enabled" : "disabled"}]`,
    `schedule=${formatSchedule(job.schedule)}`,
    `chat=${job.delivery?.chat_id || job.chat_id || "(none)"}`,
  ].join(" ");
}

function formatSchedule(schedule = {}) {
  if (schedule.type === "cron") {
    return `${schedule.expression} (${schedule.timezone || "default tz"})`;
  }
  if (schedule.type === "every") {
    return `every ${schedule.interval}`;
  }
  if (schedule.type === "at") {
    return `at ${schedule.time}`;
  }
  return JSON.stringify(schedule);
}

function cronHelp() {
  return [
    "Cron commands:",
    "/cron list",
    '/cron test --contexts both --message "Generate today\'s daily crypto market sentiment report."',
    '/cron add <id> --cron "0 9 * * *" --tz Asia/Hong_Kong --message "Generate today\'s daily crypto market sentiment report."',
    '/cron add <id> --cron "0 9 * * *" --chat-id oc_xxx --message "Send this report to another chat."',
    '/cron add <id> --every "6h" --message "Summarize market changes."',
    '/cron add <id> --at "2026-04-29T09:00:00+08:00" --message "Run one-off report."',
    "/cron remove <id>",
    "/cron enable <id>",
    "/cron disable <id>",
    "",
    "Defaults: delivery goes to the current chat, context is personality+report, output is JSON card.",
  ].join("\n");
}

function parseArgs(input) {
  const tokens = tokenize(input);
  const positionals = [];
  const flags = {};
  const rest = [];
  let restMode = false;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (restMode) {
      rest.push(token);
      continue;
    }

    if (token === "--") {
      restMode = true;
      continue;
    }

    if (token.startsWith("--")) {
      const [rawKey, inlineValue] = token.slice(2).split(/=(.*)/s, 2);
      const next = tokens[index + 1];
      if (inlineValue !== undefined) {
        flags[rawKey] = inlineValue;
      } else if (next && !next.startsWith("--")) {
        flags[rawKey] = next;
        index += 1;
      } else {
        flags[rawKey] = "true";
      }
      continue;
    }

    positionals.push(token);
  }

  return { positionals, flags, rest };
}

function tokenize(input) {
  const tokens = [];
  let current = "";
  let quote = "";
  let escaping = false;

  for (const char of input) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }

    if (char === "\\") {
      escaping = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = "";
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}
