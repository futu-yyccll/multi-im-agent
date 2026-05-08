import fs from "node:fs/promises";
import path from "node:path";

import { buildPrompt } from "../agent/prompt.mjs";
import { runProvider } from "../agent/provider.mjs";
import { loadAgentConfig } from "../config/agent.mjs";
import { sendMessage } from "../feishu/replies.mjs";
import { choosePreferredFormat, parseAgentReply, replyToPlainText } from "../render/reply.mjs";
import { buildBriefingReply, buildWeeklyMemoryPrompt, createReportStore, isMarketReport } from "../runtime/reports.mjs";

export function startCronScheduler(config, { sessions, log = () => {} } = {}) {
  if (!config.cronEnabled) {
    log("cron scheduler disabled");
    return { stop() {} };
  }

  const scheduler = new CronScheduler(config, { sessions, log });
  scheduler.start();
  return scheduler;
}

export async function listCronJobs(config) {
  return loadJobs(config, () => {});
}

export async function upsertCronJob(config, job) {
  const jobs = await listCronJobs(config);
  const normalized = normalizeJobs([job])[0];
  if (!normalized?.id) {
    throw new Error("cron job requires an id");
  }

  const index = jobs.findIndex((item) => item.id === normalized.id);
  const nextJobs = index >= 0
    ? jobs.map((item, itemIndex) => (itemIndex === index ? normalized : item))
    : [...jobs, normalized];
  await writeJson(config.cronJobsPath, { jobs: nextJobs });
  return normalized;
}

export async function removeCronJob(config, id) {
  const jobs = await listCronJobs(config);
  const nextJobs = jobs.filter((job) => job.id !== id);
  if (nextJobs.length === jobs.length) {
    return false;
  }

  await writeJson(config.cronJobsPath, { jobs: nextJobs });
  return true;
}

export async function setCronJobEnabled(config, id, enabled) {
  const jobs = await listCronJobs(config);
  const index = jobs.findIndex((job) => job.id === id);
  if (index < 0) {
    return null;
  }

  const job = { ...jobs[index], enabled };
  const nextJobs = jobs.map((item, itemIndex) => (itemIndex === index ? job : item));
  await writeJson(config.cronJobsPath, { jobs: nextJobs });
  return job;
}

export async function runCronJobNow(config, job, { sessions, log = () => {} } = {}) {
  const normalized = normalizeJobs([{
    ...job,
    id: job.id || `test-${Date.now()}`,
    enabled: true,
  }])[0];
  if (!normalized) {
    throw new Error("cron test requires a job definition");
  }

  return runScheduledAgentJob(
    normalized,
    { runKey: `manual:${new Date().toISOString()}` },
    config,
    { sessions, log },
    1,
    {
      deliver: false,
      appendTranscript: false,
    },
  );
}

class CronScheduler {
  constructor(config, { sessions, log }) {
    this.config = config;
    this.sessions = sessions;
    this.log = log;
    this.timer = null;
    this.ticking = false;
    this.runningJobs = new Set();
  }

  start() {
    this.log(`cron scheduler starting jobs=${this.config.cronJobsPath}`);
    void this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, this.config.cronTickMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async tick() {
    if (this.ticking) {
      return;
    }

    this.ticking = true;
    try {
      const jobs = await loadJobs(this.config, this.log);
      if (jobs.length === 0) {
        return;
      }

      const now = new Date();
      const state = await readJson(this.config.cronStatePath, { jobs: {} });
      for (const job of jobs) {
        if (!job.enabled || this.runningJobs.has(job.id)) {
          continue;
        }

        const jobState = state.jobs[job.id] || {};
        const due = isJobDue(job, jobState, now, this.config);
        if (!due.due) {
          continue;
        }

        this.runningJobs.add(job.id);
        state.jobs[job.id] = {
          ...jobState,
          lastAttemptAt: now.toISOString(),
          lastRunKey: due.runKey,
          status: "running",
        };
        await writeJson(this.config.cronStatePath, state);

        try {
          const result = await runJobWithRetries(job, due, this.config, {
            sessions: this.sessions,
            log: this.log,
          });
          state.jobs[job.id] = {
            ...state.jobs[job.id],
            lastSuccessAt: new Date().toISOString(),
            lastErrorAt: "",
            lastError: "",
            status: "success",
            usedFormat: result.usedFormat || "",
          };
        } catch (error) {
          state.jobs[job.id] = {
            ...state.jobs[job.id],
            lastErrorAt: new Date().toISOString(),
            lastError: error.message,
            status: "error",
          };
          this.log(`cron job ${job.id} failed: ${error.stack || error.message}`);
        } finally {
          this.runningJobs.delete(job.id);
          await writeJson(this.config.cronStatePath, state);
        }
      }
    } catch (error) {
      this.log(`cron scheduler tick failed: ${error.stack || error.message}`);
    } finally {
      this.ticking = false;
    }
  }
}

async function runJobWithRetries(job, due, config, context) {
  const retries = Number(job.retries || 0);
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const result = await runScheduledAgentJob(job, due, config, context, attempt + 1);
      await appendRun(config, job.id, {
        ts: new Date().toISOString(),
        job_id: job.id,
        run_key: due.runKey,
        attempt: attempt + 1,
        status: "success",
        output: result.fullText || result.text,
        delivered_output: result.text,
        used_format: result.usedFormat || "",
      });
      return result;
    } catch (error) {
      lastError = error;
      await appendRun(config, job.id, {
        ts: new Date().toISOString(),
        job_id: job.id,
        run_key: due.runKey,
        attempt: attempt + 1,
        status: "error",
        error: error.message,
      });
      if (attempt < retries) {
        await delay(Number(job.retryDelayMs || 10000));
      }
    }
  }

  throw lastError;
}

async function runScheduledAgentJob(job, due, config, { sessions, log }, attempt, options = {}) {
  const agentConfig = loadAgentConfig(process.env, config.cwd);
  const contextFiles = job.contextFiles?.length ? job.contextFiles : agentConfig.contextFiles;
  const chatId = job.delivery?.chat_id || job.chat_id || "";
  const previousOutput = await readPreviousSuccessfulOutput(config, job.id);
  const message = buildJobMessage(job, previousOutput);
  const reports = createReportStore(config);
  const reportMemory = buildWeeklyMemoryPrompt(await reports.readReports(14), chatId);
  const sessionId = job.session === "main" && chatId ? chatId : `cron:${job.id}`;
  const session = chatId && sessions ? await sessions.getSession({ chat_id: chatId }) : null;
  const history = job.session === "main" && session ? await sessions.readHistory(session) : [];
  const envelope = {
    session: {
      id: sessionId,
      transcript_path: session?.transcriptPath || path.join(config.dataDir, "cron", "sessions", `${safeFileName(job.id)}.jsonl`),
      history,
    },
    report_memory: reportMemory,
    event: {
      id: `cron:${job.id}:${due.runKey}`,
      message_id: `cron:${job.id}:${due.runKey}`,
      chat_id: sessionId,
      chat_type: "cron",
      sender_id: "cron",
      content: message,
    },
    messages: [],
  };
  const prompt = await buildPrompt(
    envelope,
    {
      ...agentConfig,
      contextFiles,
      contextFile: "",
      outputFormat: job.outputFormat || agentConfig.outputFormat,
      workdir: job.workdir || agentConfig.workdir,
    },
  );

  log(`cron job ${job.id} running attempt=${attempt}`);
  const output = await runProvider(prompt, envelope, {
    ...agentConfig,
    outputFormat: job.outputFormat || agentConfig.outputFormat,
    workdir: job.workdir || agentConfig.workdir,
  });
  const reply = parseAgentReply(output);
  const fullText = replyToPlainText(reply).trim();
  if (!fullText) {
    throw new Error("scheduled agent produced an empty reply");
  }
  const deliveryReply = await prepareScheduledDeliveryReply(reply, {
    config,
    chatId,
    job,
    due,
  });
  const text = replyToPlainText(deliveryReply).trim();

  let usedFormat = "none";
  if (chatId) {
    if (options.deliver === false) {
      log(`cron test run skipped Feishu send job=${job.id} chat=${chatId}`);
    } else if (config.cronDryRun || job.delivery?.dry_run) {
      log(`cron dry run skipped Feishu send job=${job.id} chat=${chatId}`);
    } else {
      usedFormat = await sendMessage(
        chatId,
        deliveryReply,
        chooseScheduledReplyFormat(deliveryReply, job.replyFormat || config.replyFormat),
        log,
        {
          idempotencyKey: safeIdempotencyKey(`${job.id}-${due.runKey}`),
          larkProfile: config.larkProfile,
        },
      );
    }

    if (session && options.appendTranscript !== false) {
      await sessions.appendTranscript(session, "user", `Scheduled cron job: ${job.name || job.id}\n${job.message || ""}`.trim(), {
        cron_job_id: job.id,
        run_key: due.runKey,
      });
      await sessions.appendTranscript(session, "assistant", text, {
        cron_job_id: job.id,
        run_key: due.runKey,
        reply_format: usedFormat,
        stored_full_report: isMarketReport(reply),
      });
    }
  } else {
    log(`cron job ${job.id} has no Feishu chat delivery target`);
  }

  return { reply: deliveryReply, fullReply: reply, text, fullText, usedFormat };
}

function chooseScheduledReplyFormat(reply, configuredFormat) {
  return configuredFormat === "agent"
    ? choosePreferredFormat(reply, "agent")
    : configuredFormat || choosePreferredFormat(reply, "agent");
}

async function prepareScheduledDeliveryReply(reply, { config, chatId, job, due }) {
  if (!isMarketReport(reply)) {
    return reply;
  }

  const reports = createReportStore(config);
  await reports.appendReport({
    chatId,
    source: "cron",
    jobId: job.id,
    reply,
    meta: {
      run_key: due.runKey,
    },
  });
  return buildBriefingReply(reply);
}

function buildJobMessage(job, previousOutput) {
  const parts = [job.message || `Run scheduled job: ${job.name || job.id}`];
  if (previousOutput) {
    const limit = Number(job.previousOutputLimit || 12000);
    parts.push(
      [
        "Previous successful report for comparison:",
        truncateAtBoundary(previousOutput, limit),
      ].join("\n"),
    );
  }
  return parts.join("\n\n");
}

function truncateAtBoundary(text, limit) {
  if (text.length <= limit) {
    return text;
  }
  const cut = text.lastIndexOf("\n", limit);
  const truncated = cut > limit * 0.5 ? text.slice(0, cut) : text.slice(0, limit);
  return `${truncated}\n\n[... truncated, ${text.length - truncated.length} chars omitted]`;
}

async function loadJobs(config, log) {
  try {
    const data = await readJson(config.cronJobsPath, null);
    return normalizeJobs(Array.isArray(data) ? data : data?.jobs || []);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  const jobs = [];
  await writeJson(config.cronJobsPath, { jobs });
  log(`created empty cron jobs file at ${config.cronJobsPath}`);
  return jobs;
}

function normalizeJobs(jobs) {
  return jobs
    .filter((job) => job && typeof job === "object")
    .map((job) => ({
      ...job,
      id: job.id || safeFileName(job.name || "job"),
      enabled: job.enabled !== false,
      outputFormat: job.outputFormat || "json",
      contextFiles: Array.isArray(job.contextFiles) ? job.contextFiles : csvList(job.contextFiles || ""),
    }));
}

function isJobDue(job, state, now, config) {
  const schedule = normalizeSchedule(job.schedule || job);
  if (!schedule) {
    return { due: false };
  }

  if (schedule.type === "cron") {
    const timezone = schedule.timezone || config.cronTimezone;
    const parts = zonedDateParts(now, timezone);
    const runKey = `${timezone}:${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
    return {
      due: state.lastRunKey !== runKey && cronMatches(schedule.expression, parts),
      runKey,
    };
  }

  if (schedule.type === "every") {
    const intervalMs = parseDurationMs(schedule.interval);
    if (!intervalMs) {
      return { due: false };
    }
    const lastAttemptMs = state.lastAttemptAt ? Date.parse(state.lastAttemptAt) : 0;
    const runKey = `every:${Math.floor(now.getTime() / intervalMs)}`;
    return {
      due: !lastAttemptMs || now.getTime() - lastAttemptMs >= intervalMs,
      runKey,
    };
  }

  if (schedule.type === "at") {
    const atMs = Date.parse(schedule.time);
    const runKey = `at:${schedule.time}`;
    return {
      due: Number.isFinite(atMs) && now.getTime() >= atMs && state.lastRunKey !== runKey,
      runKey,
    };
  }

  return { due: false };
}

function normalizeSchedule(schedule) {
  if (typeof schedule === "string") {
    return { type: "cron", expression: schedule };
  }
  if (schedule.cron) {
    return { type: "cron", expression: schedule.cron, timezone: schedule.timezone };
  }
  if (schedule.every) {
    return { type: "every", interval: schedule.every };
  }
  if (schedule.at) {
    return { type: "at", time: schedule.at };
  }
  if (schedule.type) {
    return schedule;
  }
  return null;
}

function cronMatches(expression, parts) {
  const fields = String(expression || "").trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`unsupported cron expression "${expression}"; expected 5 fields`);
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  const minuteMatches = cronFieldMatches(minute, parts.minute, 0, 59);
  const hourMatches = cronFieldMatches(hour, parts.hour, 0, 23);
  const monthMatches = cronFieldMatches(month, parts.month, 1, 12);
  const domMatches = cronFieldMatches(dayOfMonth, parts.day, 1, 31);
  const dowMatches = cronFieldMatches(dayOfWeek, parts.dayOfWeek, 0, 7, (value) => (value === 7 ? 0 : value));
  const dayMatches = dayOfMonth === "*" && dayOfWeek === "*" ? true : domMatches && dowMatches;

  return minuteMatches && hourMatches && monthMatches && dayMatches;
}

function cronFieldMatches(field, value, min, max, normalize = (item) => item) {
  return String(field)
    .split(",")
    .some((part) => cronPartMatches(part.trim(), value, min, max, normalize));
}

function cronPartMatches(part, value, min, max, normalize) {
  if (!part) {
    return false;
  }

  const [rangePart, stepPart] = part.split("/");
  const step = stepPart ? Number(stepPart) : 1;
  if (!Number.isInteger(step) || step <= 0) {
    return false;
  }

  let start = min;
  let end = max;
  if (rangePart !== "*") {
    const range = rangePart.split("-").map((item) => Number(item));
    if (range.length === 1) {
      start = range[0];
      end = range[0];
    } else {
      [start, end] = range;
    }
  }

  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return false;
  }

  for (let item = start; item <= end; item += step) {
    if (normalize(item) === value) {
      return true;
    }
  }
  return false;
}

function zonedDateParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });
  const values = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  const year = Number(values.year);
  const month = Number(values.month);
  const day = Number(values.day);
  const hour = Number(values.hour);
  const minute = Number(values.minute);

  return {
    year,
    month,
    day,
    hour,
    minute,
    dayOfWeek: weekdayToNumber(values.weekday),
  };
}

const WEEKDAY_MAP = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function weekdayToNumber(weekday) {
  return WEEKDAY_MAP[weekday] ?? 0;
}

function parseDurationMs(value) {
  const match = String(value || "").trim().match(/^(\d+)\s*(ms|s|m|h|d)$/i);
  if (!match) {
    return 0;
  }

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multipliers = {
    ms: 1,
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };
  return amount * multipliers[unit];
}

async function readPreviousSuccessfulOutput(config, jobId) {
  try {
    const text = await fs.readFile(runLogPath(config, jobId), "utf8");
    const lines = text.trim().split("\n").filter(Boolean).reverse();
    for (const line of lines) {
      const record = JSON.parse(line);
      if (record.status === "success" && record.output) {
        return record.output;
      }
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
  return "";
}

async function appendRun(config, jobId, record) {
  await fs.mkdir(config.cronRunsDir, { recursive: true });
  const logPath = runLogPath(config, jobId);
  await fs.appendFile(logPath, `${JSON.stringify(record)}\n`);
  try {
    const stat = await fs.stat(logPath);
    if (stat.size > 512 * 1024) {
      const text = await fs.readFile(logPath, "utf8");
      const lines = text.trim().split("\n");
      await fs.writeFile(logPath, `${lines.slice(-200).join("\n")}\n`);
    }
  } catch {}
}

function runLogPath(config, jobId) {
  return path.join(config.cronRunsDir, `${safeFileName(jobId)}.jsonl`);
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT" && fallback !== null) {
      return fallback;
    }
    throw error;
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`);
  await fs.rename(tmpPath, filePath);
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function csvList(value = "") {
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function safeFileName(value) {
  return String(value).replace(/[^a-zA-Z0-9_.:-]/g, "_");
}

function safeIdempotencyKey(value) {
  return String(value)
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 64);
}

function pad(value) {
  return String(value).padStart(2, "0");
}
