export function parseAgentReply(output) {
  const trimmed = output.trim();
  const jsonText = extractJsonObject(trimmed);
  if (!jsonText) {
    return trimmed;
  }

  const parsed = tryParseJson(jsonText);
  if (parsed && typeof parsed === "object") {
    return parsed;
  }

  return trimmed;
}

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    // LLM sometimes emits extra trailing braces — strip them one at a time.
    let candidate = text;
    for (let i = 0; i < 3; i++) {
      if (candidate.endsWith("}")) {
        candidate = candidate.slice(0, -1);
        try {
          return JSON.parse(candidate);
        } catch {
          // continue stripping
        }
      }
    }
    return null;
  }
}

function extractJsonObject(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]?.trim().startsWith("{")) {
    return fenced[1].trim();
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1);
  }

  return "";
}

export function choosePreferredFormat(reply, configuredFormat) {
  if (configuredFormat !== "agent") {
    return configuredFormat;
  }

  const format = getReplyFormat(reply) || "auto";
  if ((format === "post" || format === "auto") && replyHasTables(reply)) {
    return "card";
  }
  return format;
}

export function getReplyFormat(reply) {
  if (!reply || typeof reply !== "object") {
    return "";
  }

  const format = reply.format || reply.reply_format || reply.delivery?.format;
  if (["text", "post", "card", "auto"].includes(format)) {
    return format;
  }
  return "";
}

export function getReplyPayload(reply) {
  if (!reply || typeof reply !== "object") {
    return reply;
  }

  if ("content" in reply) {
    return reply.content;
  }
  if ("reply" in reply) {
    return reply.reply;
  }
  if ("message" in reply) {
    return reply.message;
  }

  const { format, reply_format, delivery, ...payload } = reply;
  return payload;
}

function replyHasTables(reply) {
  const payload = getReplyPayload(reply);
  if (typeof payload === "string") {
    return hasMarkdownTable(payload);
  }

  if (!payload || typeof payload !== "object") {
    return false;
  }

  if (payload.table?.columns?.length && payload.table?.rows?.length) {
    return true;
  }
  if ((payload.tables || []).some((table) => table?.columns?.length && table?.rows?.length)) {
    return true;
  }
  return typeof payload.text === "string" && hasMarkdownTable(payload.text);
}

function hasMarkdownTable(text) {
  const lines = text.split("\n");
  return lines.some((_, index) => isMarkdownTableStart(lines, index));
}

export function formatOrder(reply, preferredFormat) {
  if (preferredFormat === "text") {
    return ["text"];
  }

  if (preferredFormat === "post") {
    return ["post", "text"];
  }

  if (preferredFormat === "card") {
    return ["card", "post", "text"];
  }

  if (preferredFormat === "auto") {
    const payload = getReplyPayload(reply);
    return typeof payload === "object" ? ["card", "post", "text"] : ["post", "text"];
  }

  return ["post", "text"];
}

export function renderReply(reply, format) {
  return renderReplyParts(reply, format)[0];
}

export function renderReplyParts(reply, format) {
  const payload = getReplyPayload(reply);
  if (format === "text") {
    return [{
      flag: "--text",
      value: replyToPlainText(payload),
    }];
  }

  if (format === "post") {
    if (typeof payload === "string") {
      return [{
        flag: "--markdown",
        value: payload,
      }];
    }

    return [{
      flag: "--content",
      msgType: "post",
      value: JSON.stringify(replyToPost(payload)),
    }];
  }

  if (format === "card") {
    return replyToCards(payload).map((card) => ({
      flag: "--content",
      msgType: "interactive",
      value: JSON.stringify(card),
    }));
  }

  throw new Error(`unsupported reply format: ${format}`);
}

export function replyToPlainText(reply) {
  if (reply && typeof reply === "object" && getReplyFormat(reply)) {
    return replyToPlainText(getReplyPayload(reply));
  }

  if (typeof reply === "string") {
    return reply;
  }

  const lines = [];
  if (reply.title) lines.push(reply.title);
  if (reply.summary) lines.push("", reply.summary);
  for (const section of reply.sections || []) {
    if (section.table?.columns?.length && section.table?.rows?.length) {
      if (section.table.title) lines.push("", section.table.title);
      lines.push(section.table.columns.join(" | "));
      for (const row of section.table.rows) {
        lines.push(row.join(" | "));
      }
      continue;
    }
    lines.push("", section.title || "Section");
    for (const item of section.items || []) {
      lines.push(`- ${item}`);
    }
    if (section.text) lines.push(section.text);
  }
  if (reply.table?.columns?.length && reply.table?.rows?.length) {
    lines.push("", reply.table.columns.join(" | "));
    for (const row of reply.table.rows) {
      lines.push(row.join(" | "));
    }
  }
  for (const table of reply.tables || []) {
    if (!table?.columns?.length || !table?.rows?.length) continue;
    if (table.title) lines.push("", table.title);
    lines.push(table.columns.join(" | "));
    for (const row of table.rows) {
      lines.push(row.join(" | "));
    }
  }
  if (reply.text) lines.push("", reply.text);
  return lines.filter((line, index) => line !== "" || lines[index - 1] !== "").join("\n");
}

function replyToPost(reply) {
  const blocks = [];
  const title = typeof reply === "object" && reply.title ? reply.title : "Reply";
  const text = replyToPlainText(reply);
  for (const line of text.split("\n")) {
    if (!line.trim()) {
      blocks.push([{ tag: "text", text: "\n" }]);
      continue;
    }
    blocks.push([{ tag: "md", text: line }]);
  }

  return {
    zh_cn: {
      title,
      content: blocks,
    },
  };
}

function replyToCards(reply) {
  const title = typeof reply === "object" && reply.title ? reply.title : "Agent Reply";
  const elements = [];

  if (typeof reply === "string") {
    elements.push(...markdownToCardElements(reply));
  } else {
    if (reply.summary) {
      elements.push(markdownElement(`**Summary**\n${reply.summary}`));
    }
    for (const section of reply.sections || []) {
      if (section.table?.columns?.length && section.table?.rows?.length) {
        elements.push(...tableElements(section.table));
        continue;
      }
      const items = (section.items || []).map((item) => `- ${item}`).join("\n");
      elements.push(markdownElement(`**${section.title || "Section"}**\n${items || section.text || ""}`));
    }
    if (reply.table?.columns?.length && reply.table?.rows?.length) {
      elements.push(...tableElements(reply.table));
    }
    for (const table of reply.tables || []) {
      if (table?.columns?.length && table?.rows?.length) {
        elements.push(...tableElements(table));
      }
    }
    if (reply.text) {
      elements.push(...markdownToCardElements(reply.text));
    }
  }

  return splitCardElements(elements.length > 0 ? elements : [markdownElement(replyToPlainText(reply))]).map(
    (part, index, parts) => buildCard(title, part, index, parts.length),
  );
}

function buildCard(title, elements, index, total) {
  const displayTitle = total > 1 ? `${title} (${index + 1}/${total})` : title;
  return {
    schema: "2.0",
    config: {
      update_multi: true,
      width_mode: "fill",
      summary: {
        content: displayTitle,
      },
    },
    header: {
      template: "blue",
      title: {
        tag: "plain_text",
        content: displayTitle,
      },
    },
    body: {
      direction: "vertical",
      vertical_spacing: "8px",
      elements,
    },
  };
}

function markdownElement(content) {
  return {
    tag: "markdown",
    content,
    text_size: "normal",
    text_align: "left",
  };
}

function markdownToCardElements(markdown) {
  const elements = [];
  const lines = markdown.split("\n");
  let buffer = [];
  let index = 0;

  while (index < lines.length) {
    if (/^\s*-{3,}\s*$/.test(lines[index])) {
      flushMarkdownBuffer(elements, buffer);
      buffer = [];
      elements.push({ tag: "hr" });
      index += 1;
      continue;
    }

    if (isMarkdownTableStart(lines, index)) {
      flushMarkdownBuffer(elements, buffer);
      buffer = [];

      const tableLines = [];
      while (index < lines.length && lines[index].includes("|")) {
        tableLines.push(lines[index]);
        index += 1;
      }
      elements.push(...tableElements(parseMarkdownTable(tableLines)));
      continue;
    }

    buffer.push(lines[index]);
    index += 1;
  }

  flushMarkdownBuffer(elements, buffer);
  return elements;
}

function flushMarkdownBuffer(elements, buffer) {
  const content = buffer.join("\n").trim();
  if (content) {
    elements.push(markdownElement(content));
  }
}

function isMarkdownTableStart(lines, index) {
  return (
    lines[index]?.includes("|") &&
    lines[index + 1]?.includes("|") &&
    /^[-|:\s]+$/.test(lines[index + 1].trim())
  );
}

function parseMarkdownTable(lines) {
  const rows = lines
    .filter((line, index) => index !== 1)
    .map((line) =>
      line
        .trim()
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((cell) => cell.trim()),
    );

  return {
    columns: rows[0] || [],
    rows: rows.slice(1),
  };
}

function tableElements(table) {
  const tables = reshapeTable(table);
  const elements = [];

  for (const item of tables) {
    if (item.title) {
      elements.push(markdownElement(`**${item.title}**`));
    }
    elements.push(nativeTableElement(item));
  }

  return elements;
}

function reshapeTable(table) {
  const columns = normalizeHeaders(table.columns || []);
  const rows = (table.rows || []).map((row) => normalizeRow(row, columns.length));
  if (columns.length === 0 || rows.length === 0) {
    return [];
  }

  const grouped = splitGroupedMetricTable({ ...table, columns, rows });
  if (grouped.length > 0) {
    return grouped;
  }

  if (columns.length > 5) {
    return [compactWideTable({ ...table, columns, rows })];
  }

  return [{ ...table, columns, rows }];
}

function splitGroupedMetricTable(table) {
  const columns = table.columns || [];
  for (let descriptorCount = 1; descriptorCount <= Math.min(3, columns.length - 2); descriptorCount += 1) {
    const parsed = columns.slice(descriptorCount).map(parseGroupedColumn);
    if (parsed.some((item) => !item)) {
      continue;
    }

    const groupNames = [...new Set(parsed.map((item) => item.group))];
    const metricNames = [...new Set(parsed.map((item) => item.metric))];
    if (groupNames.length < 2 || metricNames.length < 2) {
      continue;
    }

    const completeGroups = groupNames.filter((group) =>
      metricNames.every((metric) => parsed.some((item) => item.group === group && item.metric === metric)),
    );
    if (completeGroups.length < 2) {
      continue;
    }

    const descriptorColumns = columns.slice(0, descriptorCount);
    return completeGroups.map((group) => {
      const groupedColumns = parsed
        .map((item, index) => ({ ...item, sourceIndex: descriptorCount + index }))
        .filter((item) => item.group === group);
      return {
        title: [table.title, group].filter(Boolean).join(" - "),
        columns: [...descriptorColumns, ...groupedColumns.map((item) => item.metric)],
        rows: table.rows.map((row) => [
          ...row.slice(0, descriptorCount),
          ...groupedColumns.map((item) => row[item.sourceIndex] || ""),
        ]),
      };
    });
  }

  return [];
}

function parseGroupedColumn(column) {
  const match = String(column).trim().match(/^(.+?)\s+([^\s].*)$/);
  if (!match) {
    return null;
  }
  const group = match[1].trim();
  const metric = match[2].trim();
  if (!group || !metric) {
    return null;
  }
  return { group, metric };
}

function compactWideTable(table) {
  const [primaryColumn, ...detailColumns] = table.columns;
  return {
    title: table.title,
    columns: [primaryColumn || "Item", "Details"],
    rows: table.rows.map((row) => [
      row[0] || "",
      detailColumns
        .map((column, index) => `**${column}:** ${row[index + 1] || "-"}`)
        .join("\n"),
    ]),
  };
}

function nativeTableElement(table) {
  const columns = normalizeHeaders(table.columns || []);
  const rows = (table.rows || []).map((row) => normalizeRow(row, columns.length));
  return {
    tag: "table",
    page_size: Math.min(Math.max(rows.length, 5), 10),
    row_height: table.row_height || "auto",
    columns: columns.map((column, index) => ({
      name: `col_${index}`,
      display_name: stripMarkdown(column),
      data_type: "lark_md",
      width: index === columns.length - 1 && columns.length > 2 ? "300px" : "auto",
    })),
    rows: rows.map((row) =>
      Object.fromEntries(row.map((cell, index) => [`col_${index}`, sanitizeTableCell(cell)])),
    ),
  };
}

function normalizeRow(row, columnCount) {
  return Array.from({ length: columnCount }, (_, index) => row[index] || "");
}

function normalizeHeaders(columns) {
  return columns.map((column, index) => String(column || `Column ${index + 1}`).trim());
}

function stripMarkdown(value) {
  return String(value)
    .replace(/\*\*/g, "")
    .replace(/[`_~]/g, "")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
    .trim();
}

function sanitizeTableCell(value) {
  const text = String(value ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .trim();
  if (text.length <= 700) {
    return text || "-";
  }
  return `${text.slice(0, 697)}...`;
}

function splitCardElements(elements) {
  const parts = [];
  let current = [];
  let tableCount = 0;

  for (const element of elements) {
    const nextTableCount = tableCount + (element.tag === "table" ? 1 : 0);
    const next = [...current, element];
    if (current.length > 0 && (nextTableCount > 5 || estimatedCardBodySize(next) > 26000)) {
      parts.push(trimTrailingDividers(current));
      current = [];
      tableCount = 0;
    }

    current.push(element);
    tableCount += element.tag === "table" ? 1 : 0;
  }

  if (current.length > 0) {
    parts.push(trimTrailingDividers(current));
  }

  return parts.length > 0 ? parts : [[markdownElement("")]];
}

function trimTrailingDividers(elements) {
  const trimmed = [...elements];
  while (trimmed[0]?.tag === "hr") trimmed.shift();
  while (trimmed[trimmed.length - 1]?.tag === "hr") trimmed.pop();
  return trimmed.length > 0 ? trimmed : [markdownElement("")];
}

function estimatedCardBodySize(elements) {
  const json = JSON.stringify(elements);
  let bytes = 0;
  for (let i = 0; i < json.length; i++) {
    bytes += json.charCodeAt(i) > 127 ? 3 : 1;
  }
  return bytes;
}

function tableToMarkdown(table) {
  const columns = table.columns || [];
  const rows = table.rows || [];
  return [
    columns.join(" | "),
    columns.map(() => "---").join(" | "),
    ...rows.map((row) => row.join(" | ")),
  ].join("\n");
}
