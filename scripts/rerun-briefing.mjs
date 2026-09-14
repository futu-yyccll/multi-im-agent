#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadDaemonConfig } from "../src/config/daemon.mjs";
import { listCronJobs, runCronJobNow } from "../src/cron/scheduler.mjs";
import { createSessionStore } from "../src/runtime/sessions.mjs";
import { createLogger } from "../src/shared/log.mjs";

// A finished child (e.g. the `claude` CLI in --print mode) can close its stdin
// before our empty end() write flushes. Node then emits an unhandled 'error'
// event on the pipe socket, which escapes the normal promise try/catch and
// kills the whole run. Swallow that specific stray EPIPE; re-raise anything else.
process.on("uncaughtException", (err) => {
  if (err && err.code === "EPIPE") {
    process.stderr.write("warn: ignored stray EPIPE on a closed pipe\n");
    return;
  }
  process.stderr.write(`fatal: ${err?.stack || err}\n`);
  process.exit(1);
});

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configPath = path.join(rootDir, ".market-agent", "bots.json");

async function main() {
  const args = process.argv.slice(2);
  const botName = args[0];
  const jobId = args[1];
  const deliver = !args.includes("--dry-run");
  if (!botName || !jobId) {
    process.stderr.write("usage: rerun-briefing.mjs <botName> <jobId> [--dry-run]\n");
    process.exit(2);
  }

  const file = JSON.parse(await fs.readFile(configPath, "utf8"));
  const bot = file.bots.find((item) => item.name === botName);
  if (!bot) {
    throw new Error(`bot not found in ${configPath}: ${botName}`);
  }

  // Apply the bot's env onto process.env. runScheduledAgentJob resolves the
  // agent provider/model via loadAgentConfig(process.env, ...), so a local env
  // object alone would leave the provider at its default (codex) and fail.
  Object.assign(process.env, {
    ...bot.env,
    FEISHU_BOT_NAME: bot.name,
    FEISHU_LARK_PROFILE: bot.larkProfile,
    FEISHU_DATA_DIR: path.isAbsolute(bot.dataDir) ? bot.dataDir : path.join(rootDir, bot.dataDir),
    FEISHU_AGENT_WORKDIR: bot.env?.FEISHU_AGENT_WORKDIR || rootDir,
  });

  const config = loadDaemonConfig(process.env, rootDir);
  const sessions = createSessionStore(config);
  const log = createLogger(`rerun-briefing:${botName}`);

  const jobs = await listCronJobs(config);
  const job = jobs.find((item) => item.id === jobId);
  if (!job) {
    throw new Error(`job not found in ${config.cronJobsPath}: ${jobId}`);
  }

  log(`rerunning job ${job.id} deliver=${deliver} chat=${job.delivery?.chat_id || "(none)"}`);
  const result = await runCronJobNow(config, job, {
    sessions,
    log,
    deliver,
    appendTranscript: deliver,
  });

  log(`done usedFormat=${result.usedFormat || "(none)"} length=${(result.fullText || "").length}`);
  process.stdout.write(`${result.fullText || result.text || ""}\n`);
}

main().catch((error) => {
  process.stderr.write(`error: ${error.stack || error.message}\n`);
  process.exit(1);
});
