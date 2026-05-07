# Daily Crypto Market Sentiment & Campaign Scoring

Produce a daily morning briefing that tells the marketing team whether to launch, hold, or pause campaigns in three markets: Singapore (SG), Hong Kong (HK), and United States (US).

Use this report template only when the user asks for a daily report, market activation report, campaign readiness report, or when a scheduled report job invokes it. For normal market Q&A, answer the user's question directly and do not force this full report structure.

## Step 1: Gather Data

Fetch data from these sources in parallel. If a source fails, note it and continue with what you have.

**Market data:**
- https://www.coingecko.com - BTC, ETH, top 10 prices, 24h changes, total market cap, 24h volume, BTC dominance, top gainers/losers
- https://alternative.me/crypto/fear-and-greed-index/ - Current F&G value, classification, trend (today, yesterday, last week)

**News & catalysts:**
- https://www.coindesk.com - Top headlines, regulation news, institutional moves, macro events
- https://decrypt.co - Additional headlines, upcoming events, narrative trends

**Derivatives data:**
- https://www.coinglass.com - Liquidations, funding rates, open interest. This may be JS-rendered or unavailable; note the gap if it cannot be fetched.

## Step 2: Global Baseline

Compile a shared baseline table:

| Metric | Value |
|---|---|
| BTC Price | $X (+/-Y%) |
| ETH Price | $X (+/-Y%) |
| Total Market Cap | $X |
| 24h Volume | $X |
| BTC Dominance | X% |
| Fear & Greed Index | X - [classification] |
| F&G Yesterday | X |
| F&G Last Week | X |
| F&G Direction | Improving / Deteriorating / Flat |

Then summarize key narratives in two buckets:

- **Bullish signals** - institutional buying, ETF flows, adoption data, breakouts
- **Bearish headwinds** - exploits, regulatory actions, macro risk, liquidations

## Step 3: Trader Sentiment Read

Rate the overall trader opportunity as: Hot / Warm / Neutral / Cold.

## Step 4: Score Each Market

Score each market out of 100 using these weighted criteria. Each factor is scored 0-100 individually, then weighted.

| Factor | Weight | What to assess |
|---|---:|---|
| Volatility setup | 20% | Is there a breakout, range compression, or catalyst-driven move setting up? More volatility is better for active traders. |
| Volume / liquidity | 15% | Is 24h volume strong enough for traders to get filled? Is it trending up? |
| Regulatory environment | 20% | Can trader-focused campaigns legally run in this market right now? Any recent regulatory actions? |
| Derivatives access | 15% | Can perps, futures, options, or leverage be marketed in this market? Product restrictions directly limit campaign angles. |
| Trader sophistication | 15% | How valuable is the trader base? Consider sophistication, account size, frequency, and strategy complexity. |
| Competitive landscape | 15% | How crowded is the market? Can we differentiate? What are competitors doing? |

## Market-Specific Regulatory Baseline

Update this baseline if today's news shows a material regulatory change.

**Singapore (SG):**
- MAS restricts digital payment token marketing to the general public.
- Public speculative trading competitions and public incentives are high-risk and need legal review.
- Retail derivatives access and marketing are restricted.
- Safer campaign lanes: existing-user owned channels, fee changes to existing accounts, institutional outreach, API/product announcements, and education that does not promote speculation.
- Strength: sophisticated trader base, including prop desks, quant firms, high-net-worth individuals, and institutional users. Fewer traders but larger accounts.

**Hong Kong (HK):**
- SFC's licensed VATP regime is live and supports regulated virtual asset spot trading.
- Do not assume retail derivatives or perpetual futures are broadly permitted. Treat derivatives/perps as unavailable unless the platform and product are specifically approved under current SFC rules.
- Campaigns, KOL activity, trading competitions, incentives, derivatives, and leverage claims need legal review.
- Safer campaign lanes: licensed-spot trading campaigns, education, exchange-liquidity positioning, market-structure content, and compliant existing-user promotions.
- Strength: active retail and semi-professional trading culture with strong regional market relevance.

**United States (US):**
- No retail perpetual futures on normal spot crypto exchanges.
- SEC/CFTC jurisdictional split constrains derivatives innovation and campaign language.
- Spot, ETFs, CME futures/options, and other regulated products are the safer campaign anchors when available.
- Trading competitions with cash prizes or speculative incentives need legal review.
- Safer campaign lanes: spot fee promos, breakout narratives, ETF-flow angles, options/futures education only where product access and licensing support it.
- Strength: deepest liquidity pool globally and largest total trader population.

## Step 5: Output Format

Return only valid JSON. Do not use Markdown fences, progress notes, or surrounding commentary.

The bot will send only a briefing first and store the full report for follow-up questions such as `expand HK`, `expand US`, `expand SG`, `expand all`, or `weekly trend`.

Use this structure:

{
  "format": "card",
  "content": {
    "report_type": "market_activation_daily",
    "report_date": "YYYY-MM-DD",
    "title": "Daily Market Briefing - YYYY-MM-DD",
    "briefing": "One concise paragraph summarizing the global market regime and whether campaign planning is justified today.",
    "summary": "Same as briefing, concise and suitable for a Feishu card.",
    "global_regime": "Risk-on recovery / Fearful but tradable / Low-conviction chop / Deleveraging risk",
    "activation_read": "One sentence on overall market activation readiness.",
    "strongest_market": "HK / US / SG plus one-line reason, or None",
    "biggest_blocker": "The main risk blocking activation today",
    "briefing_card": {
      "headline": "One sentence summary of today's market activation picture.",
      "market_scoring": {
        "summary": "One sentence explaining the score ranking.",
        "rows": [
          {
            "market": "HK",
            "signal": "Strong / Watch / Hold",
            "score": 0,
            "trend": "Improving / Flat / Weakening",
            "reason": "Short reason for the score."
          }
        ]
      },
      "market_data": [
        "BTC / ETH / total market cap / 24h volume / Fear & Greed / dominance facts. Keep each bullet factual."
      ],
      "market_news": [
        "Major market, regulatory, institutional, macro, project, or risk news. Keep each bullet factual."
      ],
      "market_analysis": [
        "Interpret what the data and news imply for market sentiment and campaign readiness."
      ],
      "market_actions": [
        {
          "market": "HK",
          "campaign_type": "Education / Reactivation / Acquisition / Institutional / Product / Hold",
          "recommendation": "What type of market activity is most suitable, not a detailed campaign plan.",
          "reason": "One concise reason tied to today's signal and regulatory lane."
        }
      ],
      "watch_next": [
        "What to monitor in the next 24-72h."
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
        "key_risk": "Short main risk.",
        "what_changed": "Short explanation of score movement versus yesterday or weekly baseline.",
        "summary": "Concise expanded-market summary.",
        "sections": [
          {
            "title": "Trend Read",
            "items": ["Short trend fact or interpretation"]
          },
          {
            "title": "Market-Specific Catalysts",
            "items": ["New or persistent catalyst"]
          },
          {
            "title": "Risk Climate",
            "items": ["Market-specific risk"]
          }
        ],
        "score_breakdown": [
          {
            "factor": "Market momentum",
            "weight": "25%",
            "score": 0,
            "weighted": 0,
            "reasoning": "Short reason"
          }
        ]
      }
    ],
    "tables": [
      {
        "title": "Market Activation Dashboard",
        "columns": ["Market", "Signal", "Score", "Trend", "Confidence"],
        "rows": [
          ["HK", "Strong / Watch / Hold", "0-100", "Improving / Flat / Weakening", "High / Medium / Low"],
          ["US", "Strong / Watch / Hold", "0-100", "Improving / Flat / Weakening", "High / Medium / Low"],
          ["SG", "Strong / Watch / Hold", "0-100", "Improving / Flat / Weakening", "High / Medium / Low"]
        ]
      },
      {
        "title": "Weekly Consistency Check",
        "columns": ["Market", "7D Range", "Yesterday", "Today", "Reason"],
        "rows": [
          ["HK", "No baseline", "-", "0", "No weekly baseline available"]
        ]
      }
    ],
    "digest": {
      "market_watch": ["BTC $76,806 (+2.9%), ETH $2,290 (+4.4%)", "F&G: 33 (Fear), down from 47 yesterday", "..."],
      "key_moves": ["MicroStrategy adds 3,273 BTC (total 818,334)", "..."],
      "risk_signals": ["Kelp DAO exploit, $300M rescue fund raised", "..."],
      "regulation": ["Canada crypto donation ban Bill C-25 advances"],
      "projects_trends": ["Western Union stablecoin for global settlement", "..."]
    },
    "data_gaps": ["Missing or unreliable data source"],
    "sources": ["https://..."]
  }
}

### Digest formatting rules

The `briefing_card` object drives the default briefing card. It should be information-first and follow this exact order:

1. Market scoring
2. Market data
3. Market news
4. Market analysis and recommended market activity type

The formatter will render `briefing_card` directly, so do not rely on the formatter to infer scores, interpretations, or campaign types.

- `headline`: 1 sentence summary of today's market activation picture.
- `market_scoring.summary`: 1 sentence explaining score ranking and strongest/weakest market.
- `market_scoring.rows`: one row each for HK, US, SG. Keep scores consistent with `markets[]`.
- `market_data`: 4-6 factual bullets only. Prices, volume, F&G, dominance, liquidation/funding if available.
- `market_news`: 4-6 factual bullets only. Institutional, regulatory, macro, project, exploit/risk news.
- `market_analysis`: 2-4 interpretive bullets. Explain what the data/news mean for market readiness.
- `market_actions`: one row each for HK, US, SG. Recommend market activity type, not detailed campaign mechanics.
- `watch_next`: 2-4 bullets for the next 24-72h.

The `digest` object is still used as fallback and for stored detail. Each digest bullet is a **headline, not a paragraph** — max 1 line, ~80 characters.

- `market_watch`: 3-5 bullets on prices, Fear & Greed, volume, dominance
- `key_moves`: 2-4 bullets on institutional buys, DeFi events, funding news
- `risk_signals`: 2-4 bullets on bearish headwinds, exploits, macro risk
- `regulation`: 0-2 bullets only if today has regulatory news (omit if none)
- `projects_trends`: 0-3 bullets on protocol updates, launches, industry trends

Keep existing `briefing`, `markets[]`, `tables[]`, `score_breakdown`, and all other structured fields unchanged — they are used for `expand` and `weekly trend` follow-ups.

Do not place score tables only in Markdown text. Put score details in `markets[].score_breakdown`. Keep card tables to 5 columns or fewer.

The default sent briefing will use `briefing_card` first, then fall back to `digest` if `briefing_card` is missing. Full market detail is stored and sent only if requested.

## Weekly Consistency Layer

If prior reports are provided in the transcript or prompt, use the past 7 days as a consistency reference. Do not mechanically average scores; use the weekly history to reduce noise and explain trend direction.

For each market, compare today against the available weekly baseline:

- 7-day score range
- 7-day average score
- Yesterday's score
- Current score
- Signal changes during the week
- Recurring bullish factors
- Recurring bearish factors
- New catalysts today
- Expired or weakened catalysts
- Whether today's move is meaningful or normal noise

Score stability rules:

- If inputs are broadly unchanged from yesterday, keep score movement within ±3 points.
- If market trend improves or weakens moderately, move score by 4-7 points.
- If there is a major catalyst, regime shift, regulatory change, exploit, ETF shock, liquidity shock, or signal change, move score by 8+ points.
- Explain every score move of 5+ points in `what_changed`.
- Explain every signal change, such as `Hold -> Watch` or `Watch -> Strong`.
- If historical reports are unavailable, say `No weekly baseline available` and score from current data only.

## Calibration Notes

- Be honest about data gaps. If derivatives data cannot be fetched, say so and reduce confidence in derivatives-heavy scoring.
- Do not hallucinate prices or stats. If a source failed, use "Data unavailable" rather than guessing.
- The regulatory context above is a baseline. If today's news includes a regulatory change in any market, override the baseline and flag it prominently.
- Scores should move day to day only when inputs move. If nothing changed, scores should not change. If BTC drops 8% overnight, every market score should reflect it.
- Keep the report tight enough to complete in under five minutes of fetching and analysis.
