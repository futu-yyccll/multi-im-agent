#!/usr/bin/env node

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { loadBotsConfig } from "../src/config/bots.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const command = process.argv[2] || "status";
const targetNames = process.argv.slice(3);
const stopGraceMs = Number(process.env.FEISHU_BOTS_STOP_GRACE_MS || 5000);

try {
  const config = await loadBotsConfig(process.env, rootDir);
  const bots = selectBots(config.bots, targetNames);

  if (command === "start") {
    await startBots(config, bots);
  } else if (command === "stop") {
    await stopBots(config, bots);
  } else if (command === "restart") {
    await stopBots(config, bots);
    await startBots(config, bots);
  } else if (command === "status") {
    await statusBots(config, bots.length ? bots : config.bots);
  } else {
    usage();
    process.exitCode = 1;
  }
} catch (error) {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
}

async function startBots(config, bots) {
  const state = await readState(config.statePath);
  for (const bot of bots) {
    const current = state.bots[bot.name];
    if (current?.pid && isPidRunning(current.pid)) {
      console.log(`${bot.name}: already running pid=${current.pid}`);
      continue;
    }

    await fsp.mkdir(bot.dataDir, { recursive: true });
    await fsp.mkdir(path.dirname(bot.logPath), { recursive: true });
    await fsp.mkdir(path.dirname(config.statePath), { recursive: true });

    const logFd = fs.openSync(bot.logPath, "a");
    const child = spawn(process.execPath, ["scripts/feishu-bot-worker.mjs"], {
      cwd: rootDir,
      detached: true,
      env: workerEnv(bot),
      stdio: ["ignore", logFd, logFd],
    });
    fs.closeSync(logFd);
    child.unref();

    state.bots[bot.name] = {
      pid: child.pid,
      name: bot.name,
      larkProfile: bot.larkProfile,
      dataDir: bot.dataDir,
      logPath: bot.logPath,
      startedAt: new Date().toISOString(),
    };
    console.log(`${bot.name}: started pid=${child.pid} profile=${bot.larkProfile} log=${bot.logPath}`);
  }
  await writeState(config.statePath, state);
}

async function stopBots(config, bots) {
  const state = await readState(config.statePath);
  for (const bot of bots) {
    const current = state.bots[bot.name];
    if (!current?.pid) {
      console.log(`${bot.name}: stopped`);
      continue;
    }

    if (!isPidRunning(current.pid)) {
      console.log(`${bot.name}: stale pid=${current.pid}`);
      delete state.bots[bot.name];
      continue;
    }

    killProcessGroup(current.pid, "SIGTERM");
    const stopped = await waitUntilStopped(current.pid, stopGraceMs);
    if (!stopped) {
      killProcessGroup(current.pid, "SIGKILL");
      await waitUntilStopped(current.pid, 1000);
    }
    delete state.bots[bot.name];
    console.log(`${bot.name}: stopped pid=${current.pid}`);
  }
  await writeState(config.statePath, state);
}

async function statusBots(config, bots) {
  const state = await readState(config.statePath);
  console.log(`Config: ${config.configPath}`);
  console.log(`State: ${config.statePath}`);
  for (const bot of bots) {
    const current = state.bots[bot.name];
    if (current?.pid && isPidRunning(current.pid)) {
      console.log(`${bot.name}: running pid=${current.pid} profile=${bot.larkProfile} log=${bot.logPath}`);
    } else if (current?.pid) {
      console.log(`${bot.name}: stopped stale_pid=${current.pid} profile=${bot.larkProfile} log=${bot.logPath}`);
    } else {
      console.log(`${bot.name}: stopped profile=${bot.larkProfile} log=${bot.logPath}`);
    }
  }
}

function workerEnv(bot) {
  return {
    ...process.env,
    ...defaultBotEnv(),
    ...bot.env,
    FEISHU_BOT_NAME: bot.name,
    FEISHU_LARK_PROFILE: bot.larkProfile,
    FEISHU_DATA_DIR: bot.dataDir,
    FEISHU_AGENT_WORKDIR: bot.env.FEISHU_AGENT_WORKDIR || process.env.FEISHU_AGENT_WORKDIR || rootDir,
  };
}

function defaultBotEnv() {
  return {
    FEISHU_AGENT_PROVIDER: process.env.FEISHU_AGENT_PROVIDER || "claude",
    FEISHU_AGENT_MODEL: process.env.FEISHU_AGENT_MODEL || "claude-opus-4-7",
    FEISHU_AGENT_SYSTEM_PROMPT:
      process.env.FEISHU_AGENT_SYSTEM_PROMPT || "You are a concise market-analysis assistant.",
    FEISHU_AGENT_CONTEXT_FILES:
      process.env.FEISHU_AGENT_CONTEXT_FILES ||
      "prompts/market-personality.md,prompts/daily-sentiment-report.md",
    FEISHU_AGENT_OUTPUT_FORMAT: process.env.FEISHU_AGENT_OUTPUT_FORMAT || "text",
    FEISHU_CLAUDE_TOOLS: process.env.FEISHU_CLAUDE_TOOLS || "WebSearch,WebFetch",
    FEISHU_CLAUDE_STREAM: process.env.FEISHU_CLAUDE_STREAM || "1",
    FEISHU_AGENT_TIMEOUT_MS: process.env.FEISHU_AGENT_TIMEOUT_MS || "7200000",
    FEISHU_AGENT_HEARTBEAT_TIMEOUT_MS: process.env.FEISHU_AGENT_HEARTBEAT_TIMEOUT_MS || "300000",
    FEISHU_AGENT_KILL_GRACE_MS: process.env.FEISHU_AGENT_KILL_GRACE_MS || "10000",
    FEISHU_REPLY_FORMAT: process.env.FEISHU_REPLY_FORMAT || "agent",
    FEISHU_REACTIONS_ENABLED: process.env.FEISHU_REACTIONS_ENABLED || "1",
    FEISHU_WORKING_REACTION: process.env.FEISHU_WORKING_REACTION || "Typing",
    FEISHU_ERROR_REACTION: process.env.FEISHU_ERROR_REACTION || "ERROR",
    FEISHU_RESPOND_IN_GROUPS: process.env.FEISHU_RESPOND_IN_GROUPS || "1",
    FEISHU_AGENT_COMMAND: process.env.FEISHU_AGENT_COMMAND || "node scripts/feishu-agent.mjs",
  };
}

function selectBots(bots, names) {
  if (names.length === 0 || names[0] === "--all") {
    return bots;
  }

  const byName = new Map(bots.map((bot) => [bot.name, bot]));
  return names.map((name) => {
    const bot = byName.get(name);
    if (!bot) {
      throw new Error(`unknown bot: ${name}`);
    }
    return bot;
  });
}

async function readState(statePath) {
  try {
    const state = JSON.parse(await fsp.readFile(statePath, "utf8"));
    return {
      bots: state.bots && typeof state.bots === "object" ? state.bots : {},
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      return { bots: {} };
    }
    throw error;
  }
}

async function writeState(statePath, state) {
  await fsp.mkdir(path.dirname(statePath), { recursive: true });
  await fsp.writeFile(
    statePath,
    `${JSON.stringify({ updatedAt: new Date().toISOString(), bots: state.bots }, null, 2)}\n`,
  );
}

function isPidRunning(pid) {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function killProcessGroup(pid, signal) {
  try {
    process.kill(-Number(pid), signal);
  } catch {
    try {
      process.kill(Number(pid), signal);
    } catch {
      // Already stopped.
    }
  }
}

async function waitUntilStopped(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isPidRunning(pid)) {
      return true;
    }
    await delay(100);
  }
  return !isPidRunning(pid);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function usage() {
  console.log("Usage: node scripts/feishu-bots.mjs <start|stop|restart|status> [bot-name ...]");
}
