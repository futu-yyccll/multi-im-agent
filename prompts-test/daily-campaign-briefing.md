# Daily Crypto Market Campaign Briefing

Produce a daily morning briefing for the market team of a crypto trading broker.

The goal is not to write a generic market report. The goal is to help the market team decide:
- whether today is worth launching or preparing a campaign;
- which market deserves priority: HK, US, or SG;
- what market trend or trader narrative can support a campaign;
- what legal/compliance boundaries must be respected.

Use this template only when the user asks for a daily report, market activation report, campaign readiness report, or when a scheduled report job invokes it.

For normal market Q&A, answer the question directly and do not force this full structure.

## Audience

The audience is a market team, not end retail users.

They need:
- clear campaign-readiness signals;
- actionable market angles;
- trader behavior interpretation;
- risk and compliance boundaries;
- consistency versus the past week.

They do not need:
- long generic crypto summaries;
- raw data-source debugging;
- every market detail in the first message;
- basic education on crypto concepts.

## Data Collection

Fetch current data where available. If a source fails, continue without it.

Priority data:
- BTC, ETH, total market cap, 24h volume, BTC dominance, top movers
- Fear & Greed Index: today, yesterday, last week
- major market news from CoinDesk and Decrypt
- institutional activity, ETF flows, exchange/product launches
- regulation news affecting HK, US, SG
- derivatives/liquidation/funding/open interest if available

Data-source failures are internal quality notes. Do not include raw data-source failure messages in the public briefing unless the missing data materially changes the recommendation.

If data is unavailable:
- reduce `confidence`;
- mention uncertainty only if it affects the market team's decision;
- do not create a public "Data Gaps" section.

## Market Scoring

Score HK, US, and SG out of 100.

Use these factors consistently:

| Factor | Weight | What to assess |
|---|---:|---|
| Volatility setup | 20% | Breakout, range compression, pullback, catalyst-driven move, tradable volatility |
| Volume / liquidity | 15% | Can active traders get filled? Is volume improving? |
| Regulatory environment | 20% | Can trader-focused campaigns run legally and safely? |
| Derivatives access | 15% | Can futures/options/perps/leverage be marketed or discussed? |
| Trader sophistication | 15% | Account quality, trading frequency, strategy complexity |
| Campaign differentiation | 15% | Can we launch a distinct campaign angle today? |

Signals:
- `Strong`: launch or actively prepare a campaign now.
- `Watch`: good setup, but campaign should be targeted or conditional.
- `Hold`: do not run broad acquisition/activation campaigns today.

Trend:
- `Improving`: setup is better than recent baseline.
- `Flat`: no meaningful change.
- `Weakening`: setup is deteriorating.

## Market Regulatory Baseline

Update this baseline only if today's news shows a material change.

### SG
- MAS restricts digital payment token marketing to the general public.
- Public speculative trading competitions and public incentives are high-risk.
- Retail derivatives marketing is restricted.
- Safer lanes: existing-user channels, institutional outreach, API/product updates, non-speculative education.
- Strength: sophisticated traders, prop desks, quant firms, HNW and institutional users.

### HK
- SFC licensed VATP regime supports regulated virtual asset spot trading.
- Do not assume retail derivatives or perpetual futures are broadly permitted.
- Campaigns, KOLs, competitions, incentives, leverage, and derivatives claims need legal review.
- Safer lanes: licensed spot trading, education, liquidity positioning, compliant existing-user promotions.
- Strength: active retail and semi-professional trader culture.

### US
- No retail perpetual futures on normal spot crypto exchanges.
- SEC/CFTC split constrains derivatives campaign language.
- Safer lanes: spot, ETF-flow narratives, CME futures/options education where applicable.
- Trading competitions with cash prizes or speculative incentives need legal review.
- Strength: deepest liquidity and largest trader population.

## Output Contract

Return only valid JSON. No Markdown fences. No progress notes.

The first Feishu message will send only the public briefing.
Full market detail is stored for follow-up requests such as:
- `expand HK`
- `expand US`
- `expand SG`
- `expand all`
- `weekly trend`

Use this structure:

{
  "format": "card",
  "content": {
    "report_type": "market_activation_daily",
    "report_date": "YYYY-MM-DD",
    "title": "每日市场简报 - YYYY-MM-DD",

    "summary": "One concise public briefing paragraph. Focus on campaign readiness, strongest market, and biggest blocker.",
    "global_regime": "风险偏好回暖 / 恐慌但可交易 / 低信心震荡 / 去杠杆风险",
    "activation_read": "One sentence on whether the market team should launch, prepare, watch, or hold.",
    "strongest_market": "US / HK / SG plus one-line reason, or None",
    "biggest_blocker": "Main blocker for campaign activation today",

    "digest": {
      "market_watch": [
        "3-5 short bullets on BTC/ETH, F&G, volume, dominance, broad market tone"
      ],
      "campaign_angles": [
        "2-4 short bullets on campaign angles the market team can consider"
      ],
      "key_moves": [
        "2-4 short bullets on institutional moves, product launches, ETF flows, major catalysts"
      ],
      "risk_signals": [
        "2-4 short bullets on risks that could weaken campaign performance"
      ],
      "regulation": [
        "0-2 bullets only if there is relevant regulatory news"
      ]
    },

    "markets": [
      {
        "market": "HK",
        "signal": "Strong / Watch / Hold",
        "score": 0,
        "trend": "Improving / Flat / Weakening",
        "confidence": "High / Medium / Low",
        "expanded": true,
        "one_line_reason": "Short reason for the signal.",
        "campaign_angle": "Most suitable campaign angle, or 'No broad campaign recommended'.",
        "key_risk": "Main risk or compliance blocker.",
        "what_changed": "Change versus weekly baseline or yesterday.",
        "summary": "Expanded market summary for follow-up.",
        "sections": [
          {
            "title": "趋势解读",
            "items": ["Short trend facts and trader interpretation"]
          },
          {
            "title": "可用 Campaign 角度",
            "items": ["Specific campaign angles the market team can evaluate"]
          },
          {
            "title": "风险与合规边界",
            "items": ["Market-specific risk and legal-review boundaries"]
          }
        ],
        "score_breakdown": [
          {
            "factor": "波动率机会",
            "weight": "20%",
            "score": 0,
            "weighted": 0,
            "reasoning": "Short reason"
          }
        ]
      }
    ],

    "tables": [
      {
        "title": "市场激活仪表盘",
        "columns": ["市场", "信号", "得分", "趋势", "建议动作"],
        "rows": [
          ["HK", "Strong / Watch / Hold", "0-100", "Improving / Flat / Weakening", "Launch / Prepare / Watch / Hold"]
        ]
      },
      {
        "title": "周度一致性检查",
        "columns": ["市场", "7日区间", "昨日", "今日", "变化原因"],
        "rows": [
          ["HK", "No baseline", "-", "0", "No weekly baseline available"]
        ]
      }
    ],

    "internal_quality": {
      "data_gaps": ["Internal only. Do not render in public briefing."],
      "source_notes": ["Internal only. Keep concise."],
      "confidence_notes": ["Internal only. Explain what reduced confidence."]
    },

    "sources": ["https://..."]
  }
}

## Public Briefing Rules

The public briefing should be short and decision-oriented.

Prioritize:
- market regime;
- strongest market;
- campaign-readiness decision;
- 2-4 campaign angles;
- biggest blocker.

Do not include:
- raw data-source failures;
- long score explanations;
- full market detail;
- full legal analysis;
- "Data Gaps" section.

## Digest Rules

`digest` drives the Feishu briefing card.

Each bullet should be one line and useful to the market team.

- `market_watch`: price/sentiment/liquidity context
- `campaign_angles`: concrete campaign ideas or angles worth evaluating
- `key_moves`: institutional/product/news catalysts
- `risk_signals`: risks that could hurt campaign timing
- `regulation`: only if relevant today

Avoid generic bullets like "market remains volatile".
Prefer bullets like:
- "BTC 重回 $81K，F&G 周线从极度恐惧修复至恐惧，适合观察突破型活动"
- "US 可围绕 CME BTC 波动率期货做机构交易工具叙事"
- "HK 适合现货流动性/交易费活动，避免杠杆和 perps 表述"
- "SG 仅建议现有用户/API/机构渠道，不做公开投机活动"

## Weekly Consistency Layer

If prior reports are provided, use the past 7 days as a consistency reference.

Do not mechanically average scores. Use weekly history to reduce noise.

For each market, compare:
- 7-day score range
- yesterday's score
- current score
- signal changes
- recurring bullish factors
- recurring bearish factors
- new catalysts today
- expired or weakened catalysts

Score stability:
- If inputs are broadly unchanged, move scores within +/-3.
- Moderate improvement/weakening: move 4-7 points.
- Major catalyst/regulatory change/exploit/liquidity shock: move 8+ points.
- Explain every move of 5+ points in `what_changed`.
- Explain every signal change.
- If no baseline exists, say `No weekly baseline available`.

## Calibration Notes

- Separate facts from interpretation.
- Do not invent prices, stats, flows, regulatory changes, or headlines.
- If a data source fails, do not guess. Lower confidence instead.
- Legal review is required for promotions, competitions, incentives, derivatives, leverage, KOL campaigns, and retail targeting.
- Keep the report tight enough to complete in under five minutes.
