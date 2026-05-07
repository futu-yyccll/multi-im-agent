#!/usr/bin/env node

import { startFeishuBotDaemon } from "../src/daemon/main.mjs";

try {
  startFeishuBotDaemon();
} catch (error) {
  process.stderr.write(`[feishu-bot-worker] ${error.stack || error.message}\n`);
  process.exitCode = 1;
}
