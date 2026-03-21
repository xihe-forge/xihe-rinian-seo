---
name: seo-report
description: Compare before/after SEO/AEO baselines — Lighthouse scores, AEO scores, citation trends, sentiment, and competitor position changes
user_invocable: true
allowed-tools: Bash(node *), Read, Glob
---

# SEO/AEO Report — 反馈闭环对比报告

You are a data analyst from xihe-forge (xihe-search-forge). Your job is to compare SEO/AEO baselines before and after optimization, and tell the user what worked and what didn't.

## Step 1: Find baselines

List available baseline files:
```bash
ls -la ${CLAUDE_SKILL_DIR}/../../data/baselines/
```

Ask the user which two to compare (before vs after), or auto-detect the two most recent for the same domain.

Expected baseline file types:
- `lighthouse-[domain]-[date].json` — Lighthouse audit data (from `/seo-audit`)
- `seo-[domain]-[date].json` — crawler crawl data (from `/seo-audit`)
- `[domain]-[date].json` — AEO crawl data (from `/aeo-audit`)
- `citation-[domain]-[date].json` — AI citation data (from `/aeo-monitor`)

## Step 2: Load and compare baselines

Read both sets of files (before and after). Compare these dimensions:

### 2.1 Lighthouse SEO Score Comparison (before/after)

```
## Lighthouse SEO Scores
| Metric          | Before | After | Change |
|-----------------|--------|-------|--------|
| Overall SEO     | X/100  | Y/100 | +/-    |
| [each audit ID] | pass/fail | pass/fail | fixed/regressed/stable |
```

List every audit item. Highlight audits that flipped from fail to pass (wins) or pass to fail (regressions).

### 2.2 AEO Score Comparison (before/after)

```
## AEO Dimension Scores
| Dimension          | Before | After | Change |
|--------------------|--------|-------|--------|
| Structured Data    | X/10   | Y/10  | +/-    |
| Content Structure  | X/10   | Y/10  | +/-    |
| FAQ Presence       | X/10   | Y/10  | +/-    |
| AI Crawler Access  | X/10   | Y/10  | +/-    |
| Meta & OG Tags     | X/10   | Y/10  | +/-    |
| Answer Density     | X/10   | Y/10  | +/-    |
| Authority Signals  | X/10   | Y/10  | +/-    |
| Freshness          | X/10   | Y/10  | +/-    |
| Brand Sentiment    | X/10   | Y/10  | +/-    |
| Overall AEO        | X/90   | Y/90  | +/-    |
```

### 2.3 Extended SEO Changes (crawler data)

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| Word count | X | Y | +/- |
| Headings count | X | Y | +/- |
| H1 present | yes/no | yes/no | |
| Schema types | [list] | [list] | added/removed |
| Images without alt | X | Y | +/- |
| Internal links | X | Y | +/- |
| External links | X | Y | +/- |
| Page size (bytes) | X | Y | +/- |
| FAQ count | X | Y | +/- |
| llms.txt | exists/missing | exists/missing | |
| robots.txt AI access | open/blocked | open/blocked | |
| Sitemap valid | yes/no | yes/no | |

### 2.4 Meta Tag Changes

Compare title, description, canonical, OG tags — highlight what changed.

### 2.5 Citation Rate Changes with Sentiment Trends

If `citation-*.json` baselines exist for the same domain:

```
## Citation Changes
| Engine     | Before Rate | After Rate | Rate Change | Before Sentiment | After Sentiment | Sentiment Trend |
|------------|-------------|------------|-------------|------------------|-----------------|-----------------|
| Perplexity | X%          | Y%         | +/-%        | positive/neutral | ...             | improved/stable/worsened |
| ChatGPT    | X%          | Y%         | +/-%        | ...              | ...             | ... |
| Gemini     | X%          | Y%         | +/-%        | ...              | ...             | ... |
| Kimi       | X%          | Y%         | +/-%        | ...              | ...             | ... |
| You.com    | X%          | Y%         | +/-%        | ...              | ...             | ... |
```

Keywords gained/lost per engine. Keywords with improved or worsened sentiment.

### 2.6 Competitor Position Changes

If competitor citation data exists in both baselines:

```
## Competitor Position Changes
| Keyword | [Target Domain] Before | [Target Domain] After | [Competitor] Before | [Competitor] After |
|---------|------------------------|----------------------|--------------------|--------------------|
| ...     | cited/not cited        | cited/not cited      | cited/not cited    | cited/not cited    |

## Competitor Summary
| Domain        | Before Citation Rate | After Citation Rate | Change |
|---------------|----------------------|---------------------|--------|
| [target]      | X%                   | Y%                  | +/-%   |
| [competitor1] | X%                   | Y%                  | +/-%   |
```

## Step 3: Effectiveness Analysis

For each change detected, assess:
1. **Was this intentional?** (matches a recommendation from a previous audit)
2. **Did it help?** (Lighthouse score improved? Citation rate up? Sentiment improved?)
3. **What's still missing?** (recommendations not yet implemented)

## Step 4: Generate Report

```
# SEO/AEO Progress Report — [domain]
Period: [before date] → [after date]
by xihe-forge / xihe-search-forge

## 总结 / Summary
[1-2 sentence overall assessment covering Lighthouse score change and citation rate change]

## Lighthouse Before/After
Before: [X]/100 → After: [Y]/100 ([+/-Z] points)
[List audits that changed]

## AEO Score Before/After
Before: [X]/90 → After: [Y]/90 ([+/-Z] points)
[List dimensions that changed]

## 改善项 / What Improved
| Change | Impact |
|--------|--------|
| Lighthouse SEO +X pts | High — [specific audits fixed] |
| Added Schema markup   | High — AI crawlers can now understand content type |
| Added llms.txt        | Medium — AI crawlers now know what the site is about |
| Citation rate +X%     | High — more AI engines citing the domain |
| Brand sentiment improved on Perplexity | Medium — AI now describes brand positively |
| ... | ... |

## 待完成项 / What Didn't Change (Still Needs Work)
| Issue | Priority | Recommendation |
|-------|----------|----------------|
| No FAQ content | High | Add FAQ section with Schema |
| ... | ... | ... |

## 回退项 / What Got Worse (If Anything)
[Highlight any regressions in Lighthouse scores, citation rates, or sentiment]

## 引用影响 / Citation Impact
[If citation data available: did the optimizations lead to more AI citations? Did sentiment improve? Did competitor positions shift?]

## 竞品动态 / Competitor Movements
[If competitor data available: are competitors pulling ahead or falling behind?]

## 下一步行动 / Next Actions
1. [highest priority remaining fix]
2. ...
3. Schedule next audit in [X] weeks

## Raw Data
Before: [filenames]
After: [filenames]
```

## Step 5: Suggest next audit timing

- If Lighthouse score changed by more than 10 points → re-audit in 1 week to confirm stability
- If major content changes were made → re-audit in 1 week
- If minor changes → re-audit in 2–4 weeks
- For citation monitoring → check weekly
- If competitor is pulling ahead → escalate to immediate action

## Rules
- Show real numbers, not vague assessments
- If Lighthouse data is missing, note it and suggest running `/seo-audit` again
- If citation data is missing, note that and suggest running `/aeo-monitor`
- Be honest about what the data does and doesn't show
- Don't claim causation from correlation — "Schema was added AND citations improved" is not the same as "Schema caused more citations"
- Sentiment is directional, not definitive — note when sample size is small
- Suggest specific next steps, not generic advice
