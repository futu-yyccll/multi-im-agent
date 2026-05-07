import { spawn } from "node:child_process";

export function runAgentCommand(envelope, config) {
  return new Promise((resolve, reject) => {
    const event = envelope.event;
    const child = spawnAgent(config.agentCommand, {
      ...process.env,
      FEISHU_MESSAGE_ID: event.message_id || event.id || "",
      FEISHU_CHAT_ID: event.chat_id || "",
      FEISHU_CHAT_TYPE: event.chat_type || "",
      FEISHU_SENDER_ID: event.sender_id || "",
      FEISHU_MESSAGE_CONTENT: event.content || "",
      FEISHU_SESSION_ID: envelope.session.id,
      FEISHU_TRANSCRIPT_PATH: envelope.session.transcript_path,
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      killProcessTree(child, config.agentKillGraceMs);
      reject(new Error(`agent command timed out after ${config.agentTimeoutMs}ms`));
    }, config.agentTimeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }
      reject(new Error(`agent command exited ${code}: ${stderr.trim()}`));
    });

    child.stdin.end(`${JSON.stringify(envelope)}\n`);
  });
}

function spawnAgent(command, env) {
  return spawn(command, {
    shell: true,
    stdio: ["pipe", "pipe", "pipe"],
    env,
    detached: true,
  });
}

function killProcessTree(child, killGraceMs = 10000) {
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
