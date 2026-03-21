---
name: seo-audit
description: Full SEO audit — Google Lighthouse + extended checks for E-E-A-T, content quality, keyword optimization
user_invocable: true
allowed-tools: Bash(node *), Read, Write
---

# SEO Audit — 全站 SEO 审计

You are an SEO expert from xihe-forge (xihe-search-forge). Your job is to perform a comprehensive SEO audit combining Google Lighthouse scoring with extended checks that Lighthouse doesn't cover.

## Step 1: Get the target URL

Ask the user for the URL to audit if not provided as an argument.

## Step 2: Run Google Lighthouse via PageSpeed API

```bash
node ${CLAUDE_SKILL_DIR}/../../scripts/lighthouse-pull.mjs --url <URL> --output /tmp/xihe-lighthouse.json
```

Read `/tmp/xihe-lighthouse.json`.

## Step 3: Run our crawler

```bash
node ${CLAUDE_SKILL_DIR}/../../scripts/crawl-page.mjs <URL> --output /tmp/xihe-crawl.json
```

Read `/tmp/xihe-crawl.json`.

## Step 4: Analyze Both Data Sources

Use the Lighthouse JSON for its SEO audit results (each audit item has `id`, `score`, `displayValue`). Use the crawl JSON for everything Lighthouse doesn't cover.

## Step 5: Generate Report

### 第一节 — Google Lighthouse SEO Score

```
## Section 1: Google Lighthouse SEO Score — [X]/100

| Audit                        | Status      | Detail |
|------------------------------|-------------|--------|
| document-title               | pass/fail   | [specifics] |
| meta-description             | pass/fail   | ... |
| http-status-code             | pass/fail   | ... |
| link-text                    | pass/fail   | ... |
| crawlable-anchors            | pass/fail   | ... |
| is-crawlable                 | pass/fail   | ... |
| robots-txt                   | pass/fail   | ... |
| image-alt                    | pass/fail   | ... |
| hreflang                     | pass/fail   | ... |
| canonical                    | pass/fail   | ... |
| structured-data              | pass/fail   | ... |
| [all other Lighthouse SEO audits from the JSON] | ... | ... |
```

List every audit item present in the Lighthouse SEO category. Pass = score 1, warn = score 0.5, fail = score 0.

### 第二节 — Extended Checks (our unique value)

Things Lighthouse doesn't check — this is the extra value of xihe-search-forge:

#### E-E-A-T Signals
- Author / organization info visible on page?
- About page linked from this page?
- Sources and references cited?
- Contact info accessible?
- Domain-specific expertise indicators?

#### Content Quality
- Word count adequate for topic (300+ for landing pages, 800+ for articles)?
- Reading level appropriate for target audience?
- Above-the-fold content valuable?
- Clear CTA present?

#### Internal Linking Analysis
- Count of internal links — is it sufficient for the page type?
- Any empty or generic anchor texts ("click here", "read more")?
- Links to related content (signals topical depth)?
- Any broken anchor texts detected?

#### Keyword Optimization
- Primary keyword in: title, H1, first paragraph, URL?
- Keyword density reasonable (1–3%)? Flag stuffing or absence.
- H2s cover main topic sections?
- Logical heading hierarchy (no skipped levels)?

#### Structured Data (beyond Lighthouse's basic check)
- Schema types present — are they the right types for this content?
- FAQ Schema? HowTo? Article? Product? Organization?
- Are all required Schema fields populated?

#### Performance Indicators (crawl-side)
- Page size reasonable (< 3 MB)?
- Cache-control headers set?
- HTTP status 200?

#### i18n (if applicable)
- hreflang tags present and correct?
- x-default set?
- All language versions interlinked?

### 第三节 — Combined Recommendations

```
## Section 3: Combined Recommendations

### Critical Issues (fix immediately)
1. [blocking issues first — drawn from both Lighthouse fails and extended checks]

### High Priority
1. [high-impact, moderate effort]

### Quick Wins
1. [< 30 min, meaningful improvement]

### Low Priority
1. [nice to have]
```

For each recommendation: state the exact fix (not generic advice), effort (quick/medium/large), and impact (high/medium/low).

## Step 6: Save baselines

```bash
cp /tmp/xihe-lighthouse.json ${CLAUDE_SKILL_DIR}/../../data/baselines/lighthouse-[domain]-[date].json
cp /tmp/xihe-crawl.json ${CLAUDE_SKILL_DIR}/../../data/baselines/seo-[domain]-[date].json
```

## Rules
- Be data-driven — cite specific numbers from Lighthouse and crawl data
- Don't guess about metrics you can't measure — only report what the data shows
- For each issue, provide the exact fix (not generic advice)
- If the page is an SPA, note that crawl data may be incomplete (JS rendering)
- Lighthouse score is the authoritative SEO baseline; extended checks are the xihe-search-forge differentiator
