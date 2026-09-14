import { spawn } from "node:child_process";
import readline from "node:readline";

import { runAgentCommand } from "../agent/command.mjs";
import { loadDaemonConfig } from "../config/daemon.mjs";
import { startCronScheduler } from "../cron/scheduler.mjs";
import { handleCommand } from "./commands.mjs";
import { larkProfileArgs } from "../feishu/cli.mjs";
import { addErrorReactions, addWorkingReaction, clearWorkingReactions } from "../feishu/reactions.mjs";
import { sendReply } from "../feishu/replies.mjs";
import {
  buildBriefingReply,
  buildExpandedReportReply,
  buildWeeklyMemoryPrompt,
  buildWeeklyTrendReply,
  createReportStore,
  isMarketReport,
  parseReportFollowup,
} from "../runtime/reports.mjs";
import { createSessionStore } from "../runtime/sessions.mjs";
import { createLogger } from "../shared/log.mjs";
import { compactArgs } from "../shared/process.mjs";
import {
  choosePreferredFormat,
  getReplyFormat,
  parseAgentReply,
  replyToPlainText,
} from "../render/reply.mjs";

export function startFeishuBotDaemon(config = loadDaemonConfig()) {
  const log = createLogger(`feishu-bot:${config.botName}`);
  const sessions = createSessionStore(config);
  const reports = createReportStore(config);
  const seenMessages = new Set();
  const eventProcess = spawn(
    "lark-cli",
    compactArgs([
      ...larkProfileArgs(config.larkProfile),
      "event",
      "+subscribe",
      "--event-types",
      config.eventTypes,
      "--compact",
      "--quiet",
      "--as",
      "bot",
    ]),
    {
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  eventProcess.stderr.on("data", (chunk) => {
    process.stderr.write(chunk);
  });

  eventProcess.on("exit", (code, signal) => {
    log(`event subscriber exited code=${code ?? "null"} signal=${signal ?? "null"}`);
    process.exit(code ?? (signal ? 1 : 0));
  });

  const lines = readline.createInterface({ input: eventProcess.stdout });
  const context = { config, sessions, reports, log };
  const cronScheduler = startCronScheduler(config, { sessions, log });

  lines.on("line", (line) => {
    void handleLine(line, context, seenMessages).catch((error) => {
      log(`failed to handle event: ${error.stack || error.message}`);
    });
  });

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      log(`received ${signal}; stopping event subscriber`);
      cronScheduler.stop();
      eventProcess.kill(signal);
    });
  }

  log(`listening for ${config.eventTypes} profile=${config.larkProfile}`);
  return eventProcess;
}

async function handleLine(line, context, seenMessages) {
  const { config, sessions, reports, log } = context;
  if (!line.trim().startsWith("{")) {
    return;
  }

  const event = JSON.parse(line);
  if (event.type !== "im.message.receive_v1") {
    return;
  }

  const messageId = event.message_id || event.id;
  if (!messageId || seenMessages.has(messageId)) {
    return;
  }
  seenMessages.add(messageId);

  if (!shouldRespond(event, config)) {
    log(`ignored message ${messageId} chat=${event.chat_id} type=${event.chat_type}`);
    return;
  }

  const session = await sessions.getSession(event);
  event.workingReaction = await addWorkingReaction(messageId, config, log);
  await sessions.appendTranscript(session, "user", event.content, {
    message_id: messageId,
    sender_id: event.sender_id,
    chat_type: event.chat_type,
    working_reaction_id: event.workingReaction?.reaction_id || "",
  });

  const reportFollowupReply = await handleReportFollowup(session, event, context);
  if (reportFollowupReply) {
    try {
      await sendReply(
        messageId,
        reportFollowupReply,
        choosePreferredFormat(reportFollowupReply, config.replyFormat),
        log,
        { larkProfile: config.larkProfile },
      );
      await sessions.appendTranscript(session, "assistant", replyToPlainText(reportFollowupReply), {
        message_id: messageId,
        report_followup: true,
      });
      log(`handled report follow-up for ${messageId}`);
    } finally {
      await clearWorkingReactions([event], config, log);
    }
    return;
  }

  const commandReply = await handleCommand(session, event, context);
  if (commandReply) {
    try {
      const usedFormat = await sendReply(
        messageId,
        commandReply,
        choosePreferredFormat(commandReply, config.replyFormat),
        log,
        { larkProfile: config.larkProfile },
      );
      await sessions.appendTranscript(session, "assistant", commandReply, {
        message_id: messageId,
        command: true,
        reply_format: usedFormat,
      });
      log(`handled command for ${messageId}`);
    } finally {
      await clearWorkingReactions([event], config, log);
    }
    return;
  }

  enqueueMessage(session, event, context);
}

function enqueueMessage(session, event, context) {
  session.pending.push(event);
  clearTimeout(session.timer);
  session.timer = setTimeout(() => {
    void processSession(session, context).catch((error) => {
      session.running = false;
      context.log(`session ${session.id} failed: ${error.stack || error.message}`);
    });
  }, context.config.debounceMs);
}

async function processSession(session, context) {
  const { config, sessions, reports, log } = context;
  if (session.running) {
    return;
  }

  session.running = true;
  try {
    while (session.pending.length > 0) {
      const batch = session.pending.splice(0);
      const lastEvent = batch.at(-1);
      const messageId = lastEvent.message_id || lastEvent.id;
      let failed = false;
      try {
        const content = batch.map((item) => item.content).join("\n");
        const history = await sessions.readHistory(session);
        const reportMemory = buildWeeklyMemoryPrompt(await reports.readReports(14), session.id);
        const envelope = {
          session: {
            id: session.id,
            transcript_path: session.transcriptPath,
            history,
          },
          report_memory: reportMemory,
          event: {
            ...lastEvent,
            content,
          },
          messages: batch,
        };

        const reply = await buildReply(envelope, config);
        const deliveryReply = await prepareDeliveryReply(reply, {
          reports,
          session,
          event: lastEvent,
          source: "chat",
        });
        const isEmpty = !replyToPlainText(deliveryReply).trim();
        const finalReply = isEmpty ? buildEmptyReplyFallback() : deliveryReply;
        if (isEmpty) {
          log(`empty reply for ${messageId}; sending fallback`);
          failed = true;
        }

        const usedFormat = await sendReply(
          messageId,
          finalReply,
          choosePreferredFormat(finalReply, config.replyFormat),
          log,
          { larkProfile: config.larkProfile },
        );
        await sessions.appendTranscript(session, "assistant", replyToPlainText(finalReply), {
          reply_to_message_id: messageId,
          batch_size: batch.length,
          reply_format: usedFormat,
          requested_format: getReplyFormat(finalReply) || config.replyFormat,
          stored_full_report: isMarketReport(reply),
          empty_fallback: isEmpty || undefined,
        });
        log(`replied to ${messageId} session=${session.id} batch=${batch.length}`);
      } catch (error) {
        failed = true;
        await sendFailureReply(messageId, error, context);
        throw error;
      } finally {
        await clearWorkingReactions(batch, config, log);
        if (failed) {
          await addErrorReactions(batch, config, log);
        }
      }
    }
  } finally {
    session.running = false;
    if (session.pending.length > 0) {
      enqueueMessage(session, session.pending.pop(), context);
    }
  }
}

async function handleReportFollowup(session, event, context) {
  const request = parseReportFollowup(event.content || "");
  if (!request) {
    return "";
  }

  const latestReport = await context.reports.readLatestReport({ chatId: session.id });
  if (request.type === "weekly") {
    return buildWeeklyTrendReply(latestReport);
  }
  if (request.type === "expand") {
    return buildExpandedReportReply(latestReport, request.market);
  }
  return "";
}

async function prepareDeliveryReply(reply, { reports, session, event, source }) {
  if (!isMarketReport(reply)) {
    return reply;
  }

  await reports.appendReport({
    chatId: session.id,
    source,
    reply,
    meta: {
      message_id: event.message_id || event.id || "",
    },
  });
  return buildBriefingReply(reply);
}

function buildEmptyReplyFallback() {
  return {
    format: "text",
    content:
      "I didn't produce a usable answer this turn (the model returned only meta-text or empty output). Please retry or rephrase.",
  };
}

async function sendFailureReply(messageId, error, context) {
  const hint = classifyFailureHint(error);
  const message = [
    "The agent run failed before it could produce a reply.",
    "",
    `Reason: ${error.message}`,
    "",
    hint,
  ].join("\n");

  try {
    await sendReply(messageId, { format: "text", content: message }, "text", context.log, {
      larkProfile: context.config.larkProfile,
    });
  } catch (replyError) {
    context.log(`failed to send failure reply for ${messageId}: ${replyError.message}`);
  }
}

function classifyFailureHint(error) {
  const text = String(error?.message || "").toLowerCase();
  if (text.includes("heartbeat timed out")) {
    return "The upstream model stream stalled. Retry, or increase FEISHU_AGENT_HEARTBEAT_TIMEOUT_MS if long-running tasks are expected.";
  }

  return "Try a narrower request, or ask the operator to increase FEISHU_AGENT_TIMEOUT_MS if this was a web-heavy report.";
}

function shouldRespond(event, config) {
  if (event.message_type !== "text") {
    return false;
  }

  if (!event.content || typeof event.content !== "string") {
    return false;
  }

  if (config.allowedChatIds.size > 0 && !config.allowedChatIds.has(event.chat_id)) {
    return false;
  }

  if (event.chat_type === "p2p") {
    return true;
  }

  return config.respondInGroups;
}

async function buildReply(envelope, config) {
  if (!config.agentCommand) {
    return config.staticReply.replaceAll("{content}", envelope.event.content);
  }

  const output = await runAgentCommand(envelope, config);
  return parseAgentReply(output);
}
