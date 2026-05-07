# Report Locale: 简体中文

All user-facing text in the JSON output must be written in **简体中文**.

## Scope — translate these fields into Chinese

### Top-level fields
- `title` (e.g. "每日市场简报 - 2026-04-28")
- `briefing`
- `summary`
- `activation_read`
- `strongest_market` (the descriptive reason, not the market code)
- `biggest_blocker`
- `global_regime` (e.g. "风险偏好回暖" / "恐慌但可交易" / "低信心震荡" / "去杠杆风险")

### Briefing card fields
- `briefing_card.headline`
- `briefing_card.market_scoring.summary`
- `briefing_card.market_scoring.rows[].reason`
- Every item in `briefing_card.market_data[]`
- Every item in `briefing_card.market_news[]`
- Every item in `briefing_card.market_analysis[]`
- `briefing_card.market_actions[].campaign_type`
- `briefing_card.market_actions[].recommendation`
- `briefing_card.market_actions[].reason`
- Every item in `briefing_card.watch_next[]`

### Market detail fields (inside each `markets[]` entry)
- `one_line_reason`
- `key_risk`
- `what_changed`
- `summary`
- Every `title` and every item in `sections[].items[]`
- Every `factor` and `reasoning` in `score_breakdown[]`

### Digest bullets
- All bullets in `market_watch`, `key_moves`, `risk_signals`, `regulation`, `projects_trends`

### Tables
- All `tables[].title` values
- All `tables[].columns[]` header labels (e.g. "市场", "信号", "得分", "趋势", "置信度", "7日区间", "昨日", "今日", "原因")
- Descriptive text in `tables[].rows[]` (e.g. the "Reason" column)

### Other
- All `data_gaps` entries

## Exceptions — keep these in English / original form

- All JSON keys (e.g. `briefing`, `market_watch`, `score`)
- Market codes: HK, US, SG
- Signal labels: Strong, Watch, Hold
- `briefing_card.market_actions[].market`: HK, US, SG
- Trend labels: Improving, Flat, Weakening
- Confidence labels: High, Medium, Low
- Numeric values, percentages, dollar amounts
- Ticker symbols: BTC, ETH, SOL, etc.
- Proper nouns: company names, protocol names, product names (e.g. MicroStrategy, Kelp DAO, MAS, SFC, SEC)
- Source URLs

## Style guidance

- Write concise, headline-style Chinese — avoid overly formal or literary phrasing.
- Digest bullets remain max ~80 characters (Chinese characters count as roughly 2 Latin characters for display width).
- Mix English terms naturally where the Chinese crypto community would (e.g. "ETF 资金流入", "BTC 突破关键阻力位").

### Digest bullet examples

```
market_watch:
- "BTC $76,806 (+2.9%)，ETH $2,290 (+4.4%)，大盘普涨"
- "恐惧贪婪指数 33（恐惧），较昨日 47 明显回落"
- "24h 成交量 $98B，较前日放量 12%"

key_moves:
- "MicroStrategy 再买 3,273 BTC，总持仓 818,334 枚"
- "BlackRock IBIT 单日净流入 $420M，连续第五天流入"

risk_signals:
- "Kelp DAO 遭攻击，$300M 救助基金已募集"
- "美债收益率升至 4.7%，风险资产承压"

regulation:
- "加拿大 Bill C-25 推进，拟禁止加密政治捐款"
```

### Top-level field examples

```
title: "每日市场简报 - 2026-04-28"
briefing: "BTC 隔夜回升至 $76.8K，恐惧贪婪指数仍处恐惧区间但较上周有所改善。机构持续买入，MicroStrategy 和 BlackRock ETF 流入提供底部支撑。短期波动率收窄，适合关注突破方向。整体市场处于可交易状态，但需警惕美债收益率上行风险。"
global_regime: "恐慌但可交易"
activation_read: "市场整体处于可激活状态，HK 和 US 市场条件最优。"
strongest_market: "HK — 监管环境稳定，现货交易活跃度回升"
biggest_blocker: "美债收益率上行及宏观紧缩预期压制风险偏好"
```

### Briefing card examples

```
briefing_card:
  headline: "US 评分最高，HK 可预热，SG 继续观察；整体市场从恐慌修复到可交易区间。"
  market_scoring:
    summary: "US 因监管和机构叙事领跑，HK 受益于现货情绪回暖，SG 受 MAS 营销限制拖累。"
    rows:
    - market: "US"
      signal: "Strong"
      score: 72
      trend: "Improving"
      reason: "监管清晰度和机构采用信号同步增强"
  market_data:
  - "BTC $82K 附近，创近三个月新高"
  - "恐惧贪婪指数 47（中性），较上周明显修复"
  market_news:
  - "Clarity Act 目标 7/4 推进，US 监管叙事改善"
  - "Morgan Stanley 入场加密交易，机构采用信号增强"
  market_analysis:
  - "市场情绪已经从防守转向可交易，但尚未进入全面追涨阶段"
  - "US 更适合教育和机构叙事，HK 更适合存量用户活跃，SG 应保持克制"
  market_actions:
  - market: "US"
    campaign_type: "Education / Institutional"
    recommendation: "围绕监管清晰度、ETF/机构采用做市场教育和专业交易者触达"
    reason: "监管和机构信号最强，且合规叙事更容易落地"
  watch_next:
  - "BTC 是否连续站稳关键价位"
  - "ETF 流入和主要监管新闻是否延续"
```

### Market detail examples

```
one_line_reason: "SFC 持牌框架稳定运行，现货交易量回升，散户参与度提高"
key_risk: "衍生品营销受限，合规成本仍是主要障碍"
what_changed: "较昨日 +3 分：现货交易量增长 15%，无新增监管负面消息"
summary: "香港市场在 SFC 持牌框架下持续稳定发展，现货交易活跃度本周回升。散户和半专业交易者参与度提高，但衍生品和杠杆产品营销仍受限制。"

sections:
- title: "趋势解读"
  items:
  - "BTC 现货交易量较上周增长 15%，买盘主导"
  - "本地稳定币交易对流动性改善"

- title: "市场催化剂"
  items:
  - "HashKey Exchange 上线新交易对，吸引增量用户"
  - "数码港 Web3 基金第二批项目公布"

- title: "风险环境"
  items:
  - "KOL 推广和交易竞赛仍需法律审查"
  - "港元联系汇率制度面临美联储政策压力"

score_breakdown:
- factor: "波动率机会"
  reasoning: "BTC 日内波幅收窄至 2%，突破前蓄势阶段"
- factor: "成交量/流动性"
  reasoning: "24h 现货成交量 $1.2B，较上周放量 18%"
- factor: "监管环境"
  reasoning: "SFC 持牌框架运行平稳，无新增限制措施"

tables:
- title: "市场激活仪表盘"
  columns: ["市场", "信号", "得分", "趋势", "置信度"]
- title: "周度一致性检查"
  columns: ["市场", "7日区间", "昨日", "今日", "原因"]
```

### Data gaps example

```
data_gaps:
- "Coinglass 衍生品数据无法获取，衍生品相关评分置信度降低"
- "CoinDesk 部分新闻页面加载失败，催化剂信息可能不完整"
```
