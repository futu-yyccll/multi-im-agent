import fs from "node:fs/promises";
import path from "node:path";

export function createSessionStore({ dataDir, historyLimit }) {
  const sessions = new Map();

  async function getSession(event) {
    const id = event.chat_id;
    if (sessions.has(id)) {
      return sessions.get(id);
    }

    const sessionDir = path.join(dataDir, "sessions");
    await fs.mkdir(sessionDir, { recursive: true });
    const session = {
      id,
      pending: [],
      running: false,
      timer: null,
      transcriptPath: path.join(sessionDir, `${safeFileName(id)}.jsonl`),
    };
    sessions.set(id, session);
    return session;
  }

  async function appendTranscript(session, role, content, meta = {}) {
    const record = {
      ts: new Date().toISOString(),
      session_id: session.id,
      role,
      content,
      meta,
    };
    await fs.appendFile(session.transcriptPath, `${JSON.stringify(record)}\n`);
  }

  async function readHistory(session) {
    try {
      const text = await fs.readFile(session.transcriptPath, "utf8");
      return text
        .trim()
        .split("\n")
        .filter(Boolean)
        .slice(-historyLimit)
        .map((line) => JSON.parse(line));
    } catch (error) {
      if (error.code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  async function resetTranscript(session) {
    await fs.writeFile(session.transcriptPath, "");
    await appendTranscript(session, "system", "Session reset", {
      reset_at: new Date().toISOString(),
    });
  }

  return {
    getSession,
    appendTranscript,
    readHistory,
    resetTranscript,
  };
}

function safeFileName(value) {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

