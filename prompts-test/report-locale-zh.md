# Report Locale: 简体中文

All user-facing text in the JSON output must be written in **简体中文**.

## Translate These Public Fields

- `title`
- `summary`
- `activation_read`
- `strongest_market` descriptive reason
- `biggest_blocker`
- `global_regime`
- all bullets in `digest.market_watch`
- all bullets in `digest.campaign_angles`
- all bullets in `digest.key_moves`
- all bullets in `digest.risk_signals`
- all bullets in `digest.regulation`
- all market summaries, reasons, risks, section titles, section items, and score reasoning
- all table titles, column labels, and descriptive row text

## Keep These In English / Original Form

- JSON keys
- market codes: HK, US, SG
- signal labels: Strong, Watch, Hold
- trend labels: Improving, Flat, Weakening
- confidence labels: High, Medium, Low
- numeric values, percentages, dollar amounts
- ticker symbols: BTC, ETH, SOL, XRP, etc.
- proper nouns: MAS, SFC, SEC, CFTC, CME, CoinDesk, Decrypt, MicroStrategy, Strategy
- source URLs

## Internal-Only Fields

These fields may be written in concise Chinese or English, but they are not intended for public briefing rendering:

- `internal_quality.data_gaps`
- `internal_quality.source_notes`
- `internal_quality.confidence_notes`

Do not turn internal quality notes into public-facing sections.

## Style

- Write concise, headline-style Chinese.
- Use terms natural to crypto market teams, such as `ETF 资金流`, `现货流动性`, `perps`, `杠杆`, `做市`, `KOL`, `API`.
- Digest bullets should be short, concrete, and action-oriented.
- Avoid generic wording such as "市场波动较大" unless paired with a campaign implication.
