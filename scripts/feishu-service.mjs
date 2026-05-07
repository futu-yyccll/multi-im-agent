#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sessionName = process.env.FEISHU_SERVICE_SESSION || "market-agent-feishu";
const logPath = process.env.FEISHU_SERVICE_LOG || path.join(rootDir, ".market-agent", "feishu-bot.log");
const command = process.argv[2] || "status";

switch (command) {
  case "start":
    start();
    break;
  case "stop":
    stop();
    break;
  case "restart":
    stop();
    start();
    break;
  case "status":
    status();
    break;
  default:
    usage();
    process.exitCode = 1;
}

function start() {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });

  if (daemonProcesses().length > 0) {
    console.log("Feishu service already appears to be running.");
    status();
    return;
  }

  const env = serviceEnv();
  const assignments = Object.entries(env)
    .filter(([key]) => key.startsWith("FEISHU_"))
    .map(([key, value]) => `${key}=${shellQuote(value)}`)
    .join(" ");
  const shellCommand = [
    `cd ${shellQuote(rootDir)}`,
    `unset CLAUDECODE && ${assignments} node scripts/feishu-bot-daemon.mjs >> ${shellQuote(logPath)} 2>&1`,
  ].join(" && ");

  run("screen", ["-dmS", sessionName, "zsh", "-lc", shellCommand]);
  sleep(800);
  status();
}

function stop() {
  run("screen", ["-S", sessionName, "-X", "quit"], { allowFailure: true });
  sleep(500);

  const processes = managedProcesses();
  if (processes.length > 0) {
    killProcesses(processes, "SIGTERM");
    sleep(1000);
  }

  const remaining = managedProcesses();
  if (remaining.length > 0) {
    killProcesses(remaining, "SIGKILL");
    sleep(300);
  }
}

function status() {
  const screens = screenSessions();
  const processes = managedProcesses();

  if (screens.length === 0 && processes.length === 0) {
    console.log("Feishu service is stopped.");
    return;
  }

  if (screens.length > 0) {
    console.log("Screen sessions:");
    for (const line of screens) {
      console.log(line);
    }
  }

  if (processes.length > 0) {
    console.log("Processes:");
    for (const item of processes) {
      console.log(`${item.pid} ${item.command}`);
    }
  }

  console.log(`Log: ${logPath}`);
}

function serviceEnv() {
  return {
    ...process.env,
    FEISHU_AGENT_PROVIDER: process.env.FEISHU_AGENT_PROVIDER || "claude",
    FEISHU_AGENT_MODEL: process.env.FEISHU_AGENT_MODEL || "claude-opus-4-6",
    FEISHU_AGENT_WORKDIR: process.env.FEISHU_AGENT_WORKDIR || rootDir,
    FEISHU_AGENT_SYSTEM_PROMPT:
      process.env.FEISHU_AGENT_SYSTEM_PROMPT || "You are a concise market-analysis assistant.",
    FEISHU_AGENT_CONTEXT_FILES:
      process.env.FEISHU_AGENT_CONTEXT_FILES || "prompts/market-personality.md,prompts/daily-sentiment-report.md",
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

function managedProcesses() {
  return ps().filter((item) => isManagedProcess(item.command));
}

function daemonProcesses() {
  return ps().filter((item) => item.command.includes("node scripts/feishu-bot-daemon.mjs"));
}

function isManagedProcess(commandLine) {
  return (
    commandLine.includes("node scripts/feishu-bot-daemon.mjs") ||
    commandLine.includes("lark-cli event +subscribe --event-types im.message.receive_v1") ||
    commandLine.includes("ft-lark-cli event +subscribe --event-types im.message.receive_v1")
  );
}

function ps() {
  const output = runOutput("ps", ["-axo", "pid,ppid,command"], { allowFailure: true });
  const ownPid = process.pid;
  const parentPid = process.ppid;
  return output
    .split("\n")
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(\d+)\s+(.+)$/);
      if (!match) {
        return null;
      }
      return {
        pid: Number(match[1]),
        ppid: Number(match[2]),
        command: match[3],
      };
    })
    .filter((item) => item && item.pid !== ownPid && item.pid !== parentPid)
    .filter((item) => !item.command.includes("scripts/feishu-service.mjs"));
}

function screenSessions() {
  return runOutput("screen", ["-ls"], { allowFailure: true })
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.includes(`.${sessionName}`));
}

function killProcesses(processes, signal) {
  for (const item of processes) {
    try {
      process.kill(item.pid, signal);
      console.log(`sent ${signal} to ${item.pid}`);
    } catch (error) {
      if (error.code !== "ESRCH") {
        console.error(`failed to kill ${item.pid}: ${error.message}`);
      }
    }
  }
}

function run(commandName, args, { allowFailure = false } = {}) {
  const result = spawnSync(commandName, args, {
    stdio: allowFailure ? "ignore" : "inherit",
  });
  if (!allowFailure && result.status !== 0) {
    throw new Error(`${commandName} exited ${result.status}`);
  }
}

function runOutput(commandName, args, { allowFailure = false } = {}) {
  try {
    return execFileSync(commandName, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", allowFailure ? "ignore" : "pipe"],
    });
  } catch (error) {
    if (allowFailure) {
      return error.stdout?.toString() || "";
    }
    throw error;
  }
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function usage() {
  console.log("Usage: node scripts/feishu-service.mjs <start|stop|restart|status>");
}
