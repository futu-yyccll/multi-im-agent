import path from "node:path";

export function loadDaemonConfig(env = process.env, cwd = process.cwd()) {
  const dataDir = env.FEISHU_DATA_DIR || path.join(cwd, ".market-agent");
  return {
    cwd,
    eventTypes: env.FEISHU_EVENT_TYPES || "im.message.receive_v1",
    staticReply: env.FEISHU_STATIC_REPLY || "Bot daemon is online. I received: {content}",
    agentCommand: env.FEISHU_AGENT_COMMAND || "",
    agentTimeoutMs: Number(env.FEISHU_AGENT_TIMEOUT_MS || 7200000),
    agentKillGraceMs: Number(env.FEISHU_AGENT_KILL_GRACE_MS || 10000),
    debounceMs: Number(env.FEISHU_DEBOUNCE_MS || 1200),
    historyLimit: Number(env.FEISHU_HISTORY_LIMIT || 30),
    dataDir,
    replyFormat: env.FEISHU_REPLY_FORMAT || "agent",
    reactionsEnabled: env.FEISHU_REACTIONS_ENABLED !== "0",
    workingReaction: env.FEISHU_WORKING_REACTION || "Typing",
    errorReaction: env.FEISHU_ERROR_REACTION || "ERROR",
    respondInGroups: env.FEISHU_RESPOND_IN_GROUPS === "1",
    allowedChatIds: csvSet(env.FEISHU_ALLOWED_CHAT_IDS),
    cronEnabled: env.FEISHU_CRON_ENABLED !== "0",
    cronTickMs: Number(env.FEISHU_CRON_TICK_MS || 30000),
    cronTimezone: env.FEISHU_CRON_TZ || "Asia/Hong_Kong",
    cronJobsPath: env.FEISHU_CRON_JOBS_PATH || path.join(dataDir, "cron", "jobs.json"),
    cronStatePath: env.FEISHU_CRON_STATE_PATH || path.join(dataDir, "cron", "jobs-state.json"),
    cronRunsDir: env.FEISHU_CRON_RUNS_DIR || path.join(dataDir, "cron", "runs"),
    cronDryRun: env.FEISHU_CRON_DRY_RUN === "1",
  };
}

function csvSet(value = "") {
  return new Set(
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
}
