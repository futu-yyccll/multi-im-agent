import fs from "node:fs/promises";
import path from "node:path";

export async function loadBotsConfig(env = process.env, cwd = process.cwd()) {
  const configPath = path.resolve(env.FEISHU_BOTS_CONFIG || path.join(cwd, ".market-agent", "bots.json"));
  let raw;
  try {
    raw = await fs.readFile(configPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(
        `multi-bot config not found: ${configPath}. Create it from config/bots.example.json or set FEISHU_BOTS_CONFIG.`,
      );
    }
    throw error;
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    throw new Error(`failed to parse bot config ${configPath}: ${error.message}`);
  }

  const bots = Array.isArray(data.bots) ? data.bots.map((bot) => normalizeBot(bot, cwd)) : [];
  if (bots.length === 0) {
    throw new Error(`bot config ${configPath} must contain at least one bot`);
  }

  validateUnique(bots, "name");
  validateUnique(bots, "larkProfile");
  validateUnique(bots, "dataDir");

  return {
    configPath,
    statePath: path.resolve(
      env.FEISHU_BOTS_STATE_PATH ||
        data.supervisor?.statePath ||
        path.join(cwd, ".market-agent", "supervisor", "state.json"),
    ),
    bots,
  };
}

function normalizeBot(bot, cwd) {
  if (!bot || typeof bot !== "object") {
    throw new Error("each bot config entry must be an object");
  }

  const name = requiredString(bot.name, "bot.name");
  if (!/^[a-zA-Z0-9_.-]+$/.test(name)) {
    throw new Error(`bot name "${name}" may only contain letters, numbers, dot, underscore, and dash`);
  }

  const larkProfile = requiredString(bot.larkProfile, `bot ${name}.larkProfile`);
  const dataDir = path.resolve(cwd, bot.dataDir || path.join(".market-agent", "bots", name));
  const logPath = path.resolve(cwd, bot.logPath || path.join(dataDir, "feishu-bot.log"));

  return {
    name,
    larkProfile,
    dataDir,
    logPath,
    env: normalizeEnv(bot.env || {}, name),
  };
}

function requiredString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is required`);
  }
  return value.trim();
}

function normalizeEnv(env, botName) {
  if (!env || typeof env !== "object" || Array.isArray(env)) {
    throw new Error(`bot ${botName}.env must be an object when provided`);
  }

  return Object.fromEntries(
    Object.entries(env).map(([key, value]) => {
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
        throw new Error(`bot ${botName}.env contains invalid environment key: ${key}`);
      }
      return [key, String(value)];
    }),
  );
}

function validateUnique(bots, field) {
  const seen = new Map();
  for (const bot of bots) {
    const value = bot[field];
    if (seen.has(value)) {
      throw new Error(`duplicate bot ${field}: ${value} (${seen.get(value)} and ${bot.name})`);
    }
    seen.set(value, bot.name);
  }
}
