import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import readline from "node:readline";

import { runCommand, runCommandForOutput } from "../shared/process.mjs";

export async function runProvider(prompt, envelope, config) {
  if (config.provider === "echo") {
    const content = envelope.event?.content || "";
    return `Echo agent received: ${content}\n`;
  }

  if (config.provider === "codex") {
    return runCodex(prompt, config);
  }

  if (config.provider === "claude") {
    return runClaude(prompt, config);
  }

  throw new Error(`Unsupported FEISHU_AGENT_PROVIDER: ${config.provider}`);
}

async function runCodex(prompt, config) {
  const outputPath = path.join(
    os.tmpdir(),
    `feishu-agent-${process.pid}-${Date.now()}.txt`,
  );
  const args = [
    "exec",
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "--ask-for-approval",
    "never",
    "--cd",
    config.workdir,
    "--output-last-message",
    outputPath,
  ];

  if (config.model) {
    args.push("--model", config.model);
  }

  args.push("-");
  await runCommand("codex", args, prompt);

  try {
    return await fs.readFile(outputPath, "utf8");
  } finally {
    await fs.rm(outputPath, { force: true });
  }
}

function runClaude(prompt, config) {
  if (config.claudeStream) {
    return runClaudeStream(prompt, config);
  }

  const args = [
    "--print",
    "--permission-mode",
    "dontAsk",
    "--tools",
    config.claudeTools,
    "--system-prompt",
    config.systemPrompt,
  ];

  if (config.model) {
    args.push("--model", config.model);
  }

  args.push(prompt);
  return runCommandForOutput("claude", args, "");
}

function runClaudeStream(prompt, config) {
  const args = [
    "--print",
    "--output-format",
    "stream-json",
    "--include-partial-messages",
    "--verbose",
    "--permission-mode",
    "dontAsk",
    "--tools",
    config.claudeTools,
    "--system-prompt",
    config.systemPrompt,
  ];

  if (config.model) {
    args.push("--model", config.model);
  }

  args.push(prompt);

  return new Promise((resolve, reject) => {
    const child = spawn("claude", args, {
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    const startedAt = Date.now();
    let lastEventAt = Date.now();
    let stderr = "";
    let finalResult = "";
    let resultEvent = null;
    let settled = false;

    const heartbeatTimer = setInterval(() => {
      if (Date.now() - lastEventAt <= config.heartbeatTimeoutMs) {
        return;
      }

      fail(
        new Error(
          `Claude stream heartbeat timed out after ${config.heartbeatTimeoutMs}ms without events`,
        ),
      );
    }, Math.min(config.heartbeatTimeoutMs, 30000));

    const lines = readline.createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      if (!line.trim().startsWith("{")) {
        return;
      }

      lastEventAt = Date.now();
      const event = JSON.parse(line);
      if (event.type === "result") {
        resultEvent = event;
        finalResult = event.result || "";
      }
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", fail);
    child.on("exit", (code) => {
      clearInterval(heartbeatTimer);
      if (settled) {
        return;
      }

      settled = true;
      if (code === 0 && resultEvent?.is_error === false) {
        resolve(finalResult.trim());
        return;
      }

      const durationMs = Date.now() - startedAt;
      reject(
        new Error(
          `Claude stream exited ${code} after ${durationMs}ms: ${
            resultEvent?.result || stderr.trim() || "no result"
          }`,
        ),
      );
    });

    function fail(error) {
      if (settled) {
        return;
      }

      settled = true;
      clearInterval(heartbeatTimer);
      terminateProcessGroup(child, config.killGraceMs);
      reject(error);
    }
  });
}

function terminateProcessGroup(child, killGraceMs) {
  if (!child.pid) {
    return;
  }

  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }

  setTimeout(() => {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      // Process already exited.
    }
  }, killGraceMs).unref();
}
