export function loadAgentConfig(env = process.env, cwd = process.cwd()) {
  const contextFiles = csvList(env.FEISHU_AGENT_CONTEXT_FILES);
  const contextFile = env.FEISHU_AGENT_CONTEXT_FILE || "";
  return {
    provider: env.FEISHU_AGENT_PROVIDER || "codex",
    model: env.FEISHU_AGENT_MODEL || "",
    workdir: env.FEISHU_AGENT_WORKDIR || cwd,
    contextFile,
    contextFiles: contextFiles.length > 0 ? contextFiles : csvList(contextFile),
    outputFormat: env.FEISHU_AGENT_OUTPUT_FORMAT || "text",
    claudeTools: env.FEISHU_CLAUDE_TOOLS ?? "",
    claudeStream: env.FEISHU_CLAUDE_STREAM === "1",
    heartbeatTimeoutMs: Number(env.FEISHU_AGENT_HEARTBEAT_TIMEOUT_MS || 300000),
    killGraceMs: Number(env.FEISHU_AGENT_KILL_GRACE_MS || 10000),
    systemPrompt:
      env.FEISHU_AGENT_SYSTEM_PROMPT ||
      [
        "You are a pragmatic agent responding inside Feishu.",
        "Be concise and directly useful.",
        "If the user asks for code or file changes, explain that this Feishu bridge is currently read-only unless the operator enables write tooling.",
        "Do not claim you performed actions unless the provided context proves it.",
      ].join("\n"),
  };
}

function csvList(value = "") {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
