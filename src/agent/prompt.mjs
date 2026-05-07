import fs from "node:fs/promises";
import path from "node:path";

export async function buildPrompt(envelope, config) {
  const fileContexts = await readContextFiles(config.contextFiles || csvList(config.contextFile), config.workdir);
  const history = (envelope.session?.history || [])
    .slice(-12)
    .map((item) => `${item.role}: ${item.content}`)
    .join("\n");
  const latest = envelope.event?.content || "";
  const sessionId = envelope.session?.id || "unknown";
  const reportMemory = envelope.report_memory || "";

  return [
    config.systemPrompt,
    fileContexts.length > 0 ? `\nPredefined context:\n${fileContexts.join("\n\n---\n\n")}` : "",
    structuredOutputInstructions(config.outputFormat),
    "",
    `Session: ${sessionId}`,
    "",
    "Recent transcript:",
    history || "(none)",
    reportMemory ? "\nReport memory:" : "",
    reportMemory,
    "",
    "Latest user message:",
    latest,
    "",
    finalOutputInstruction(config.outputFormat),
  ].join("\n");
}

function structuredOutputInstructions(outputFormat) {
  if (outputFormat !== "json") {
    return "";
  }

  return [
    "",
    "Output contract:",
    "Return only valid JSON, with no Markdown fences, no progress notes, and no surrounding commentary.",
    "Do not say you are compiling, fetching, or thinking in the final answer.",
    "Choose the reply format yourself:",
    "- text: short conversational replies.",
    "- post: long prose, Markdown-style reports, explanations, or code blocks.",
    "- card: structured summaries, status updates, market briefings, scorecards, any answer with tables, or action-oriented output.",
    "For market reports with score tables or metric tables, choose card.",
    "Return this envelope. Do not emit raw Feishu/Lark card JSON; the daemon renders the channel payload:",
    '{"format":"text|post|card","content":"string OR object"}',
    "For card or post replies that are already well-structured Markdown, content may be a plain Markdown string.",
    "For structured object replies, content may use: {\"title\":\"string\",\"summary\":\"string\",\"sections\":[{\"title\":\"string\",\"items\":[\"string\"],\"text\":\"string\"}],\"table\":{\"columns\":[\"string\"],\"rows\":[[\"string\"]]},\"tables\":[{\"title\":\"string\",\"columns\":[\"string\"],\"rows\":[[\"string\"]]}],\"text\":\"string\"}.",
    "For card tables, prefer at most 5 columns. Split wide market comparison tables into multiple narrower tables when possible.",
    "For text replies, content may be a plain string.",
    "Omit fields that are not useful for the answer.",
  ].join("\n");
}

function finalOutputInstruction(outputFormat) {
  if (outputFormat === "json") {
    return "Reply with only the JSON envelope that should be rendered back to Feishu.";
  }

  return "Reply with only the message that should be sent back to Feishu.";
}

async function readContextFile(filePath, workdir) {
  if (!filePath) {
    return "";
  }

  const resolvedPath = path.resolve(workdir, filePath);
  return fs.readFile(resolvedPath, "utf8");
}

async function readContextFiles(filePaths = [], workdir) {
  const contexts = [];
  for (const filePath of filePaths) {
    const content = await readContextFile(filePath, workdir);
    if (content.trim()) {
      contexts.push(`# Context file: ${filePath}\n\n${content}`);
    }
  }
  return contexts;
}

function csvList(value = "") {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
