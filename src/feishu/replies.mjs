import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

import { compactArgs } from "../shared/process.mjs";
import { formatOrder, renderReplyParts, replyToPlainText } from "../render/reply.mjs";
import { larkProfileArgs } from "./cli.mjs";

const TEXT_CHUNK_SIZE = 2800;
const MAX_TEXT_CHUNKS = 200;
const CHUNK_DOCTOR_MAX_TRIES = 5;
const CHUNK_DOCTOR_TIMEOUT_MS = 90000;
const FAILED_CHUNKS_DIR = ".market-agent/failed-chunks";

export async function sendReply(messageId, reply, preferredFormat, log, options = {}) {
  const formats = formatOrder(reply, preferredFormat);
  const chunks = formats[0] === "card" ? [reply] : splitLargeTextReply(reply);
  if (chunks.length > 1) {
    log?.(`sending ${chunks.length} chunks to message ${messageId} as post`);
    for (const [index, chunk] of chunks.entries()) {
      await sendChunkWithDoctor({
        chunk,
        index,
        total: chunks.length,
        log,
        send: (rendered) => replyToMessage(messageId, rendered, options.larkProfile),
        target: `message ${messageId}`,
      });
    }
    return "post";
  }

  let lastError;

  for (const format of formats) {
    try {
      for (const rendered of renderReplyParts(reply, format)) {
        await replyToMessage(messageId, rendered, options.larkProfile);
      }
      return format;
    } catch (error) {
      lastError = error;
      log?.(`reply format ${format} failed: ${error.message}`);
    }
  }

  throw lastError;
}

export async function sendMessage(chatId, reply, preferredFormat, log, options = {}) {
  const formats = formatOrder(reply, preferredFormat);
  const chunks = formats[0] === "card" ? [reply] : splitLargeTextReply(reply);
  if (chunks.length > 1) {
    log?.(`sending ${chunks.length} chunks to chat ${chatId} as post`);
    for (const [index, chunk] of chunks.entries()) {
      await sendChunkWithDoctor({
        chunk,
        index,
        total: chunks.length,
        log,
        send: (rendered) =>
          messageToChat(chatId, rendered, partKey(options.idempotencyKey, index), options.larkProfile),
        target: `chat ${chatId}`,
      });
    }
    return "post";
  }

  let lastError;

  for (const format of formats) {
    try {
      const renderedParts = renderReplyParts(reply, format);
      for (const [index, rendered] of renderedParts.entries()) {
        await messageToChat(chatId, rendered, partKey(options.idempotencyKey, index), options.larkProfile);
      }
      return format;
    } catch (error) {
      lastError = error;
      log?.(`message format ${format} failed: ${error.message}`);
    }
  }

  throw lastError;
}

function splitLargeTextReply(reply) {
  const text = replyToPlainText(reply);
  if (text.length <= TEXT_CHUNK_SIZE) {
    return [reply];
  }

  const chunks = [];
  let current = "";
  for (const section of text.split(/\n---\n/g)) {
    const candidate = current ? `${current}\n---\n${section}` : section;
    if (candidate.length > TEXT_CHUNK_SIZE && current) {
      chunks.push(...hardSplit(current, TEXT_CHUNK_SIZE));
      current = section;
    } else {
      current = candidate;
    }
  }
  if (current) {
    chunks.push(...hardSplit(current, TEXT_CHUNK_SIZE));
  }

  if (chunks.length > MAX_TEXT_CHUNKS) {
    throw new Error(`reply too large: ${chunks.length} chunks exceeds limit ${MAX_TEXT_CHUNKS}`);
  }

  return chunks.map((chunk, index) => `#### Part ${index + 1}/${chunks.length}\n\n${chunk}`);
}

function hardSplit(text, maxLength) {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks = [];
  let remaining = text;
  while (remaining.length > maxLength) {
    let cut = remaining.lastIndexOf("\n", maxLength);
    if (cut < maxLength * 0.5) {
      cut = remaining.lastIndexOf(" ", maxLength);
    }
    if (cut <= 0) {
      cut = maxLength;
    }
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining) {
    chunks.push(remaining);
  }
  return chunks;
}

async function sendChunkWithDoctor({ chunk, index, total, send, target, log }) {
  let candidate = chunk;
  let lastError;
  const failedAttempts = [];

  for (let attemptIndex = 0; attemptIndex < CHUNK_DOCTOR_MAX_TRIES; attemptIndex += 1) {
    try {
      const renderedParts = renderReplyParts(candidate, "post");
      for (const rendered of renderedParts) {
        await send(rendered);
      }
      if (attemptIndex > 0) {
        log?.(
          `chunk doctor fixed part ${index + 1}/${total} for ${target} on attempt ${attemptIndex + 1}`,
        );
      }
      return;
    } catch (error) {
      lastError = error;
      failedAttempts.push({
        attempt: attemptIndex + 1,
        error: error.message,
        candidate,
      });
      log?.(
        `chunk doctor attempt ${attemptIndex + 1}/${CHUNK_DOCTOR_MAX_TRIES} failed for part ${index + 1}/${total} to ${target}: ${error.message}`,
      );
      if (attemptIndex < CHUNK_DOCTOR_MAX_TRIES - 1) {
        candidate = await repairChunkWithLlm(candidate, error, {
          attempt: attemptIndex + 2,
          part: index + 1,
          total,
          target,
          log,
        });
      }
    }
  }

  const failedChunkPath = await persistFailedChunk({
    originalChunk: chunk,
    failedAttempts,
    target,
    index,
    total,
    lastError,
  });
  log?.(`persisted failed chunk for ${target} part ${index + 1}/${total}: ${failedChunkPath}`);
  throw new Error(
    `chunk doctor failed part ${index + 1}/${total} for ${target} after ${CHUNK_DOCTOR_MAX_TRIES} attempts; saved=${failedChunkPath}: ${lastError?.message || "unknown error"}`,
  );
}

async function persistFailedChunk({ originalChunk, failedAttempts, target, index, total, lastError }) {
  await fs.mkdir(FAILED_CHUNKS_DIR, { recursive: true });
  const ts = new Date().toISOString();
  const fileName = `${safeFileName(ts)}-part-${index + 1}-of-${total}.json`;
  const filePath = path.join(FAILED_CHUNKS_DIR, fileName);
  const record = {
    ts,
    target,
    part: index + 1,
    total,
    last_error: lastError?.message || "",
    original_chunk: originalChunk,
    attempts: failedAttempts.map((attempt) => ({
      attempt: attempt.attempt,
      error: attempt.error,
      candidate_length: attempt.candidate.length,
      candidate: attempt.candidate,
    })),
  };
  await fs.writeFile(filePath, `${JSON.stringify(record, null, 2)}\n`);
  return filePath;
}

function safeFileName(value) {
  return String(value).replace(/[^a-zA-Z0-9_.-]+/g, "-");
}

function repairChunkWithLlm(chunk, error, { attempt, part, total, target, log }) {
  const prompt = [
    "Repair this Feishu/Lark post markdown chunk so it passes message field validation.",
    "",
    "Hard requirements:",
    "- Return only the repaired markdown chunk. No JSON. No code fence. No commentary.",
    "- Preserve the original report format and meaning as much as possible.",
    "- Keep headings, bullets, separators, and ordering when possible.",
    "- Keep it suitable for Feishu post/markdown delivery, not plain text fallback.",
    "- Remove or rewrite only content likely to break Feishu validation.",
    "- Keep the output under 2600 characters.",
    "- Avoid very long lines; keep each line under 500 characters.",
    "- Avoid raw HTML, malformed links, unbalanced markdown markers, tables wider than 5 columns, and control characters.",
    "",
    `Context: repairing part ${part}/${total} for ${target}; repair attempt ${attempt}/${CHUNK_DOCTOR_MAX_TRIES}.`,
    `Previous Feishu error: ${error.message}`,
    "",
    "Original chunk:",
    chunk,
  ].join("\n");

  const systemPrompt = [
    "You are a Feishu message delivery doctor.",
    "Your job is to minimally repair markdown that failed Feishu post validation.",
    "You must preserve the intended report format and content while making the chunk deliverable.",
  ].join(" ");

  return new Promise((resolve, reject) => {
    const args = [
      "--print",
      "--permission-mode",
      "dontAsk",
      "--system-prompt",
      systemPrompt,
    ];
    const model = process.env.FEISHU_CHUNK_DOCTOR_MODEL || process.env.FEISHU_AGENT_MODEL || "";
    if (model) {
      args.push("--model", model);
    }
    args.push(prompt);

    const { CLAUDECODE, ...doctorEnv } = process.env;
    const child = spawn("claude", args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: doctorEnv,
    });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`chunk doctor llm timed out after ${CHUNK_DOCTOR_TIMEOUT_MS}ms`));
    }, CHUNK_DOCTOR_TIMEOUT_MS);
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data;
    });
    child.stderr.on("data", (data) => {
      stderr += data;
    });
    child.on("error", (spawnError) => {
      clearTimeout(timer);
      reject(spawnError);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`chunk doctor llm exited ${code}: ${stderr.trim()}`));
        return;
      }
      const repaired = stripMarkdownFence(stdout).trim();
      if (!repaired) {
        reject(new Error("chunk doctor llm returned empty repair"));
        return;
      }
      log?.(`chunk doctor produced repair for part ${part}/${total}; chars=${repaired.length}`);
      resolve(repaired);
    });
  });
}

function stripMarkdownFence(text) {
  const trimmed = String(text || "").trim();
  const fenced = trimmed.match(/^```(?:markdown|md)?\s*([\s\S]*?)```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function replyToMessage(messageId, rendered, larkProfile = "") {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "lark-cli",
      compactArgs([
        ...larkProfileArgs(larkProfile),
        "im",
        "+messages-reply",
        "--message-id",
        messageId,
        rendered.flag,
        rendered.value,
        rendered.msgType ? "--msg-type" : "",
        rendered.msgType || "",
        "--as",
        "bot",
      ]),
      {
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`reply command exited ${code}: ${stderr.trim()}`));
    });
  });
}

function messageToChat(chatId, rendered, idempotencyKey = "", larkProfile = "") {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "lark-cli",
      compactArgs([
        ...larkProfileArgs(larkProfile),
        "im",
        "+messages-send",
        "--chat-id",
        chatId,
        rendered.flag,
        rendered.value,
        rendered.msgType ? "--msg-type" : "",
        rendered.msgType || "",
        idempotencyKey ? "--idempotency-key" : "",
        idempotencyKey,
        "--as",
        "bot",
      ]),
      {
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`send command exited ${code}: ${stderr.trim()}`));
    });
  });
}

function partKey(baseKey = "", index = 0) {
  if (!baseKey) {
    return "";
  }
  return index === 0 ? baseKey : `${baseKey}-${index + 1}`;
}
