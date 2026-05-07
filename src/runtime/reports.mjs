import fs from "node:fs/promises";
import path from "node:path";

import { getReplyPayload } from "../render/reply.mjs";

export const MARKET_REPORT_TYPE = "market_activation_daily";

export function createReportStore({ dataDir }) {
  const reportDir = path.join(dataDir, "reports");
  const reportPath = path.join(reportDir, `${MARKET_REPORT_TYPE}.jsonl`);

  async function appendReport({ chatId, source = "chat", jobId = "", reply, meta = {} }) {
    const content = getReportContent(reply);
    if (!content) {
      return null;
    }

    await fs.mkdir(reportDir, { recursive: true });
    const record = {
      ts: new Date().toISOString(),
      report_type: content.report_type || MARKET_REPORT_TYPE,
      report_date: content.report_date || todayIsoDate(),
      chat_id: chatId || "",
      source,
      job_id: jobId,
      global_regime: stringValue(content.global_regime || content.regime),
      markets: normalizeMarkets(content.markets),
      data_gaps: normalizeList(content.data_gaps),
      reply,
      meta,
    };
    await fs.appendFile(reportPath, `${JSON.stringify(record)}\n`);
    return record;
  }

  async function readLatestReport({ chatId = "" } = {}) {
    const records = await readReports();
    return (
      records.find((record) => chatId && record.chat_id === chatId) ||
      records[0] ||
      null
    );
  }

  async function readReports(limit = 30) {
    try {
      const text = await fs.readFile(reportPath, "utf8");
      return text
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
        .reverse()
        .slice(0, limit);
    } catch (error) {
      if (error.code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  return {
    appendReport,
    readLatestReport,
    readReports,
  };
}

export function isMarketReport(reply) {
  return Boolean(getReportContent(reply));
}

export function getReportContent(reply) {
  const content = getReplyPayload(reply);
  if (!content || typeof content !== "object" || Array.isArray(content)) {
    return null;
  }

  if (content.report_type === MARKET_REPORT_TYPE) {
    return content;
  }

  if (Array.isArray(content.markets) && content.markets.length > 0) {
    return {
      ...content,
      report_type: MARKET_REPORT_TYPE,
    };
  }

  const title = stringValue(content.title);
  if (/market activation|crypto market sentiment|daily market/i.test(title) && Array.isArray(content.tables)) {
    return {
      ...content,
      report_type: MARKET_REPORT_TYPE,
    };
  }

  return null;
}

export function buildBriefingReply(reply) {
  const content = getReportContent(reply);
  if (!content) {
    return reply;
  }

  const digest = content.digest;
  const markets = normalizeMarkets(content.markets);
  const sources = normalizeList(content.sources);
  const briefingCard = normalizeBriefingCard(content.briefing_card);
  const sections = briefingCard
    ? buildBriefingCardSections(briefingCard)
    : buildBriefingSections(content, digest, markets);
  const tables = briefingCard
    ? buildBriefingCardTables(briefingCard)
    : buildBriefingTables(markets);
  const footer = buildBriefingFooter(sources);

  return {
    format: "card",
    content: {
      title: content.title || `Daily Market Briefing - ${content.report_date || todayIsoDate()}`,
      sections,
      tables,
      text: footer,
    },
  };
}

function buildBriefingCardSections(card) {
  const sections = [];

  appendTextSection(sections, "市场评分总结", marketScoringSummary(card.market_scoring));
  appendTableSection(sections, buildMarketScoringTable(card));
  appendListSection(sections, "行情信息", visibleBriefingList(card.market_data));
  appendListSection(sections, "市场新闻", visibleBriefingList(card.market_news));
  appendListSection(sections, "市场分析", visibleBriefingList(card.market_analysis));
  appendListSection(sections, "接下来观察", visibleBriefingList(card.watch_next));

  return sections;
}

function buildBriefingCardTables(card) {
  const tables = [];

  if (card.market_actions.length > 0) {
    tables.push({
      title: "市场活动类型建议",
      columns: ["市场", "活动类型", "建议", "原因"],
      rows: card.market_actions.map((item) => [
        item.market || "-",
        item.campaign_type || "-",
        item.recommendation || "-",
        item.reason || "-",
      ]),
    });
  }

  return tables;
}

function buildMarketScoringTable(card) {
  if (card.market_scoring.rows.length === 0) {
    return null;
  }

  return {
    title: "市场评分",
    columns: ["市场", "信号", "得分", "趋势", "原因"],
    rows: card.market_scoring.rows.map((item) => [
      item.market || "-",
      item.signal || "-",
      item.score || "-",
      item.trend || "-",
      item.reason || "-",
    ]),
  };
}

function buildBriefingSections(content, digest, markets) {
  const sections = [];

  appendTextSection(sections, "今日判断", content.activation_read);
  appendTextSection(sections, "最强市场", content.strongest_market);
  appendTextSection(sections, "主要阻碍", content.biggest_blocker);

  if (digest) {
    appendListSection(sections, "市场观察", digest.market_watch);
    appendListSection(sections, "关键动向", digest.key_moves);
    appendListSection(sections, "风险信号", digest.risk_signals);
    appendListSection(sections, "监管动态", digest.regulation);
    appendListSection(sections, "项目与趋势", digest.projects_trends);
  } else if (content.briefing || content.summary) {
    appendTextSection(sections, "市场简报", content.briefing || content.summary);
  }

  if (markets.length > 0) {
    sections.push({
      title: "市场结论",
      items: markets.map((m) => [
        `${m.market}: ${m.signal || "n/a"} ${m.score || "n/a"}`,
        m.trend ? `趋势 ${m.trend}` : "",
        m.one_line_reason || "",
      ].filter(Boolean).join(" - ")),
    });
  }

  return sections;
}

function appendTextSection(sections, title, value) {
  const text = stringValue(value);
  if (text) {
    sections.push({ title, text });
  }
}

function appendListSection(sections, title, value) {
  const items = normalizeList(value);
  if (items.length > 0) {
    sections.push({ title, items });
  }
}

function appendTableSection(sections, table) {
  if (table?.columns?.length && table?.rows?.length) {
    sections.push({ table });
  }
}

function buildBriefingTables(markets) {
  if (markets.length === 0) {
    return [];
  }

  return [{
    title: "市场激活概览",
    columns: ["市场", "信号", "得分", "趋势", "置信度"],
    rows: markets.map((m) => [
      m.market || "-",
      m.signal || "-",
      m.score || "-",
      m.trend || "-",
      m.confidence || "-",
    ]),
  }];
}

function buildBriefingFooter(sources) {
  const lines = [];
  if (sources.length > 0) {
    const domainNames = sources.map((s) => {
      try { return new URL(s).hostname.replace(/^www\./, ""); } catch { return s; }
    });
    lines.push(`Sources: ${[...new Set(domainNames)].join(" / ")}`);
  }
  lines.push('回复“展开香港 / 美国 / 新加坡 / 全部”或“查看周度趋势”获取详情。');
  return lines.join("\n");
}

function normalizeBriefingCard(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const card = {
    headline: stringValue(value.headline),
    market_scoring: normalizeMarketScoring(value.market_scoring),
    market_data: normalizeList(value.market_data),
    market_news: normalizeList(value.market_news),
    market_analysis: normalizeList(value.market_analysis),
    market_actions: normalizeMarketActions(value.market_actions),
    watch_next: normalizeList(value.watch_next),
  };

  const hasContent = (
    card.headline ||
    card.market_scoring.summary ||
    card.market_scoring.rows.length ||
    card.market_data.length ||
    card.market_news.length ||
    card.market_analysis.length ||
    card.market_actions.length ||
    card.watch_next.length
  );

  return hasContent ? card : null;
}

function normalizeMarketScoring(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { summary: "", rows: [] };
  }

  const rows = Array.isArray(value.rows)
    ? value.rows
      .filter((item) => item && typeof item === "object")
      .map((item) => ({
        market: normalizeMarketName(item.market || item.name || item.code || ""),
        signal: stringValue(item.signal),
        score: stringValue(item.score),
        trend: stringValue(item.trend),
        reason: stringValue(item.reason),
      }))
      .filter((item) => item.market || item.signal || item.score || item.trend || item.reason)
    : [];

  return {
    summary: stringValue(value.summary),
    rows,
  };
}

function marketScoringSummary(marketScoring) {
  const parts = marketScoring.rows.map(marketScorePhrase);
  if (parts.length === 0) {
    return marketScoring.summary;
  }
  return `${parts.join("；")}。`;
}

function marketScorePhrase(item, index) {
  const market = item.market || "该市场";
  const score = item.score ? `${item.score}分` : "评分待确认";
  const reason = item.reason ? `，${trimSentenceEnd(item.reason)}` : "";
  const rankHint = index === 0 ? "居首" : "";
  return `${market} ${score}${rankHint}${reason}`;
}

function trimSentenceEnd(value) {
  return String(value || "").trim().replace(/[。.!！]+$/g, "");
}

function normalizeMarketActions(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      market: normalizeMarketName(item.market || item.name || item.code || ""),
      campaign_type: stringValue(item.campaign_type || item.type),
      recommendation: stringValue(item.recommendation || item.action),
      reason: stringValue(item.reason),
    }))
    .filter((item) => item.market || item.campaign_type || item.recommendation || item.reason);
}

function visibleBriefingList(value) {
  return normalizeList(value).filter((item) => !isVisibleDataGap(item));
}

function isVisibleDataGap(value) {
  return /(不可用|无法获取|缺失|data unavailable|unavailable|failed|403|JS 渲染|数据缺口|data gap)/i.test(String(value || ""));
}

export function buildExpandedReportReply(reportRecord, marketRequest) {
  if (!reportRecord?.reply) {
    return "No stored daily report is available yet. Run the daily report first.";
  }

  const content = getReportContent(reportRecord.reply);
  if (!content) {
    return "The latest stored report is not structured enough to expand.";
  }

  const requested = String(marketRequest || "").trim().toUpperCase();
  if (requested === "ALL") {
    return buildAllMarketsReply(content);
  }

  const market = findMarket(content, requested);
  if (!market) {
    return `No stored detail found for ${requested}. Try "expand HK", "expand US", "expand SG", or "expand all".`;
  }

  return buildMarketReply(content, market);
}

export function buildWeeklyTrendReply(reportRecord) {
  if (!reportRecord?.reply) {
    return "No stored daily report is available yet. Run the daily report first.";
  }

  const content = getReportContent(reportRecord.reply);
  const weeklyTable = content && findNamedTable(content, /weekly/i);
  if (!weeklyTable) {
    return "No weekly consistency table is available in the latest report.";
  }

  return {
    format: "card",
    content: {
      title: "Weekly Trend",
      summary: "Score consistency and short-term market trend from the latest stored report.",
      tables: [weeklyTable],
    },
  };
}

export function buildWeeklyMemoryPrompt(records = [], chatId = "") {
  const relevant = records
    .filter((record) => !chatId || record.chat_id === chatId)
    .slice(0, 7)
    .reverse();
  if (relevant.length === 0) {
    return "No weekly baseline available.";
  }

  const markets = ["HK", "US", "SG"];
  const lines = [
    "Weekly market activation baseline from stored reports:",
  ];

  for (const market of markets) {
    const samples = relevant
      .map((record) => {
        const item = normalizeMarkets(record.markets).find((entry) => entry.market === market);
        return item ? { record, item } : null;
      })
      .filter(Boolean);
    if (samples.length === 0) {
      lines.push(`- ${market}: no stored scores.`);
      continue;
    }

    const numericScores = samples
      .map(({ item }) => Number(item.score))
      .filter((score) => Number.isFinite(score));
    const range = numericScores.length > 0
      ? `${Math.min(...numericScores)}-${Math.max(...numericScores)}`
      : "n/a";
    const average = numericScores.length > 0
      ? Math.round(numericScores.reduce((sum, score) => sum + score, 0) / numericScores.length)
      : "n/a";
    const latest = samples.at(-1);
    lines.push(
      `- ${market}: range=${range}; avg=${average}; latest=${latest.item.score || "n/a"} ${latest.item.signal || ""}; trend=${latest.item.trend || "n/a"}; reason=${latest.item.one_line_reason || "n/a"}`,
    );
  }

  return lines.join("\n");
}

export function parseReportFollowup(content) {
  const text = content.trim();
  const expand = text.match(/^(?:expand|show detail(?:s)? for|details? for)\s+(hk|hong kong|us|united states|sg|singapore|all)\b/i);
  if (expand) {
    return {
      type: "expand",
      market: normalizeMarketName(expand[1]),
    };
  }

  const expandChinese = text.match(/^展开\s*(香港|美国|新加坡|全部|HK|US|SG|ALL)\s*$/i);
  if (expandChinese) {
    return {
      type: "expand",
      market: normalizeMarketName(expandChinese[1]),
    };
  }

  if (/^(?:weekly trend|show weekly|weekly consistency)\b/i.test(text)) {
    return { type: "weekly" };
  }

  if (/^(?:查看)?周度趋势\s*$/.test(text)) {
    return { type: "weekly" };
  }

  return null;
}

function buildMarketReply(content, market) {
  const sections = [];
  const items = compactList([
    labelled("Signal", market.signal),
    labelled("Score", market.score),
    labelled("Trend", market.trend),
    labelled("Confidence", market.confidence),
    labelled("Reason", market.one_line_reason || market.reason),
    labelled("Key risk", market.key_risk),
    labelled("What changed", market.what_changed || market.delta_reason),
  ]);
  if (items.length > 0) {
    sections.push({ title: `${market.market} Read`, items });
  }

  for (const section of market.sections || market.details || []) {
    if (section?.title && (section.items?.length || section.text)) {
      sections.push(section);
    }
  }

  const tables = [];
  if (Array.isArray(market.score_breakdown) && market.score_breakdown.length > 0) {
    tables.push({
      title: `${market.market} Score Breakdown`,
      columns: ["Factor", "Weight", "Score", "Weighted", "Reasoning"],
      rows: market.score_breakdown.map((row) => Array.isArray(row)
        ? row
        : [
          row.factor,
          row.weight,
          row.score,
          row.weighted,
          row.reasoning || row.reason,
        ]),
    });
  }

  const namedTable = findNamedTable(content, new RegExp(`^${escapeRegex(market.market)} .*breakdown|${escapeRegex(market.market)} detail`, "i"));
  if (namedTable) {
    tables.push(namedTable);
  }

  return {
    format: "card",
    content: {
      title: `${market.market} Market Detail - ${content.report_date || todayIsoDate()}`,
      summary: market.expanded_summary || market.summary || market.one_line_reason || "",
      sections,
      tables,
      text: market.text || "",
    },
  };
}

function buildAllMarketsReply(content) {
  const markets = normalizeMarkets(content.markets);
  if (markets.length === 0) {
    return {
      format: "card",
      content,
    };
  }

  return {
    format: "card",
    content: {
      title: `All Market Details - ${content.report_date || todayIsoDate()}`,
      summary: "Expanded detail for all markets from the latest stored report.",
      sections: markets.map((market) => ({
        title: `${market.market}: ${market.signal || "Signal unavailable"}`,
        items: compactList([
          labelled("Score", market.score),
          labelled("Trend", market.trend),
          labelled("Confidence", market.confidence),
          labelled("Reason", market.one_line_reason || market.reason),
          labelled("Key risk", market.key_risk),
        ]),
      })),
      tables: markets.flatMap((market) => {
        if (!Array.isArray(market.score_breakdown) || market.score_breakdown.length === 0) {
          return [];
        }
        return [{
          title: `${market.market} Score Breakdown`,
          columns: ["Factor", "Weight", "Score", "Weighted", "Reasoning"],
          rows: market.score_breakdown.map((row) => Array.isArray(row)
            ? row
            : [row.factor, row.weight, row.score, row.weighted, row.reasoning || row.reason]),
        }];
      }),
    },
  };
}

function normalizeMarkets(markets = []) {
  return markets
    .filter((market) => market && typeof market === "object")
    .map((market) => ({
      ...market,
      market: normalizeMarketName(market.market || market.name || market.code || ""),
      signal: stringValue(market.signal || market.verdict),
      score: stringValue(market.score),
      trend: stringValue(market.trend || market.trend_direction),
      confidence: stringValue(market.confidence),
      one_line_reason: stringValue(market.one_line_reason || market.reason),
      key_risk: stringValue(market.key_risk || market.risk),
    }))
    .filter((market) => market.market);
}

function findMarket(content, marketName) {
  const normalized = normalizeMarketName(marketName);
  return normalizeMarkets(content.markets).find((market) => market.market === normalized);
}

function normalizeMarketName(value) {
  const text = String(value || "").trim().toUpperCase();
  if (["HK", "HONG KONG", "香港"].includes(text)) return "HK";
  if (["US", "USA", "UNITED STATES", "美国"].includes(text)) return "US";
  if (["SG", "SINGAPORE", "新加坡"].includes(text)) return "SG";
  if (["ALL", "全部"].includes(text)) return "ALL";
  return text;
}

function rowsFromNamedTable(content, pattern) {
  return findNamedTable(content, pattern)?.rows || [];
}

function findNamedTable(content, pattern) {
  return (content.tables || []).find((table) => pattern.test(String(table?.title || "")));
}

function normalizeList(value) {
  if (Array.isArray(value)) {
    return value.map(stringValue).filter(Boolean);
  }
  if (value) {
    return [stringValue(value)].filter(Boolean);
  }
  return [];
}

function compactList(items) {
  return items.filter(Boolean);
}

function labelled(label, value) {
  const text = stringValue(value);
  return text ? `${label}: ${text}` : "";
}

function stringValue(value) {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).trim();
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
