# xihe-rinian-seo — 工具详细文档

> 返回 [README](../README.md)

---

### 1. Lighthouse 集成 — `lighthouse-pull.mjs`

拉取 Google Lighthouse / PageSpeed Insights 数据，建立 SEO 技术基线。免费，无需认证。

```bash
node scripts/lighthouse-pull.mjs --url https://yoursite.com

# 指定策略
node scripts/lighthouse-pull.mjs --url https://yoursite.com --strategy mobile

# 保存基线
node scripts/lighthouse-pull.mjs \
  --url https://yoursite.com \
  --output data/baselines/lighthouse-latest.json
```

输出包含：Performance、Accessibility、Best Practices、SEO 四项得分，以及各审计项通过/失败明细。

默认检查 `seo` 和 `best-practices`，可通过 `--categories` 指定更多类别（如 `performance,accessibility`）。

---

### 2. 页面爬取 — `crawl-page.mjs`

爬取任意 URL，提取 SEO/AEO/GEO 相关的所有页面信号。

```bash
node scripts/crawl-page.mjs https://yoursite.com
node scripts/crawl-page.mjs https://yoursite.com --output data/baselines/yoursite.json
```

提取内容：
- HTTP 状态与关键响应头
- Meta 标签（title、description、canonical、OG、Twitter Card）
- 标题层级（H1–H6）
- JSON-LD Schema 结构化数据
- 链接统计（内链/外链）
- 图片 alt 覆盖率
- hreflang 标签
- `/llms.txt`、`/robots.txt`、`/sitemap.xml` 检测
- 内容统计（字数、阅读时长、页面大小）
- FAQ 检测（Schema / details-summary / 常见问题区域）

---

### 3. AI 引用检测 — `check-ai-citation.mjs`

检查你的域名是否被 AI 搜索引擎引用。支持 5 个引擎，含品牌情感分析和竞品对比。

```bash
# 设置所需引擎的 API Key（至少一个）
export PERPLEXITY_API_KEY=pplx-xxxx
export OPENAI_API_KEY=sk-xxxx
export GEMINI_API_KEY=AIza-xxxx
export MOONSHOT_API_KEY=sk-xxxx   # Kimi / 月之暗面
export YOU_API_KEY=xxxx

# 基础检测
node scripts/check-ai-citation.mjs \
  --domain yoursite.com \
  --keywords "关键词1,关键词2,keyword3"

# 指定引擎
node scripts/check-ai-citation.mjs \
  --domain yoursite.com \
  --keywords "关键词1,关键词2" \
  --engines perplexity,gemini,kimi

# 开启竞品对比
node scripts/check-ai-citation.mjs \
  --domain yoursite.com \
  --keywords "关键词1,关键词2" \
  --competitors competitor1.com,competitor2.com

# 与上次基线对比
node scripts/check-ai-citation.mjs \
  --domain yoursite.com \
  --keywords "关键词1,关键词2" \
  --baseline data/baselines/citation-prev.json \
  --output data/baselines/citation-latest.json

# 查看所有可用引擎
node scripts/check-ai-citation.mjs --list
```

**品牌情感分析**：每次引用自动标记 positive / neutral / negative，汇总品牌在 AI 搜索中的整体形象。

**`--competitors` 标志**：在同一批查询中同时检测竞品域名，直接输出引用份额对比。

支持的引擎及所需 API Key：

| 引擎 | 环境变量 | 获取地址 |
|------|---------|---------|
| Perplexity | `PERPLEXITY_API_KEY` | https://www.perplexity.ai/settings/api |
| ChatGPT web search | `OPENAI_API_KEY` | https://platform.openai.com/api-keys |
| Google Gemini | `GEMINI_API_KEY` | https://aistudio.google.com/app/apikey |
| Kimi / 月之暗面 | `MOONSHOT_API_KEY` | https://platform.moonshot.cn |
| You.com | `YOU_API_KEY` | https://you.com/api |

---

### 4. llms.txt 生成 — `generate-llms-txt.mjs`

为你的网站生成 [llms.txt](https://llmstxt.org/)，告诉 AI 爬虫你的站点是什么。

```bash
node scripts/generate-llms-txt.mjs \
  --url https://yoursite.com \
  --name "Your Site" \
  --description "What your site does" \
  --sitemap https://yoursite.com/sitemap.xml \
  --output public/llms.txt
```

同时生成两个文件：
- `llms.txt` — 简洁版（链接 + 一行描述）
- `llms-full.txt` — 详细版（每页 2–3 句摘要）

---

### 5. GSC 数据拉取 — `gsc-pull.mjs`

拉取 GSC 搜索分析数据，建立传统 SEO 基线。

```bash
# 方式一：服务账号
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
node scripts/gsc-pull.mjs --site https://yoursite.com --days 28

# 方式二：OAuth token
export GSC_ACCESS_TOKEN=ya29.xxxx
node scripts/gsc-pull.mjs --site https://yoursite.com --days 28 --output data/baselines/gsc-latest.json
```

无凭据时会打印详细的设置指南。

---

### 6. GEO 内容优化 — `content-optimize.mjs`

基于 Princeton GEO 论文量化发现，分析页面内容并给出 GEO 优化建议。支持直接传入 URL 或接受 `crawl-page.mjs` 的 JSON 输出。

```bash
# 直接分析 URL
node scripts/content-optimize.mjs --url https://yoursite.com

# 接受 crawl-page.mjs 的 JSON 输出（管道）
node scripts/crawl-page.mjs https://yoursite.com | node scripts/content-optimize.mjs

# 从文件读取
node scripts/content-optimize.mjs --input data/crawl-result.json --output suggestions.json
```

**6 个评估维度（附论文量化增益）：**

| 维度 | 预期可见度提升 |
|------|--------------|
| 专家引用与标注 | +42% |
| 数据与统计 | +33% |
| 来源引用 | +30% |
| 内容结构（H1/H2/FAQ/列表） | 高影响 |
| 答案密度（直接回答比例） | 高影响 |
| 技术术语密度 | +12% |

输出包含：各维度评分、`topActions`（优先级最高的 4 条改进建议）、内容指标（字数、引用数、FAQ 数量）。

---

### 7. 平台存在度检测 — `platform-presence.mjs`

检查品牌在 AI 常引用的 8 大平台上的存在状况，按平台对 AI 引用的贡献权重给出加权总分。

```bash
node scripts/platform-presence.mjs --brand "YourBrand" --domain "yourdomain.com"

# 保存结果
node scripts/platform-presence.mjs --brand "YourBrand" --domain "yourdomain.com" --output presence.json
```

**覆盖平台（按 AI 引用权重排序）：**

| 平台 | AI 引用权重 |
|------|------------|
| Reddit | 40% |
| Wikipedia | 26% |
| YouTube | 23% |
| GitHub | 5% |
| Stack Overflow | 3% |
| Hacker News | 2% |
| Medium | 1% |
| Quora | 0.5% |

每个平台输出：存在状态（found / not_found / unknown）、评分（0–10）、详情指标、专项改进建议。

---

### 8. AI 声量份额 — `share-of-voice.mjs`

计算在指定关键词下，你的品牌在 AI 搜索引用中的占比，并与竞品直接对比。

```bash
# 基础用法
node scripts/share-of-voice.mjs \
  --domain yoursite.com \
  --keywords "product category,main feature,brand name" \
  --competitors "competitor1.com,competitor2.com"

# 指定引擎
node scripts/share-of-voice.mjs \
  --domain yoursite.com \
  --keywords "keyword1,keyword2" \
  --competitors "rival.com" \
  --engines perplexity,gemini \
  --output sov.json
```

输出包含：每个关键词的引用次数（按品牌分）、Share of Voice 百分比、整体 SoV 汇总、`topActions`（标出零引用关键词和被竞品主导的关键词）。无 API Key 时自动生成模板占位结果。

---

### 9. 内容新鲜度检测 — `freshness-check.mjs`

抓取站点 sitemap（或回退到首页导航链接），检查每个页面的最后更新时间，标出过期页面。

```bash
node scripts/freshness-check.mjs --url https://yoursite.com

# 自定义过期阈值（默认 90 天）
node scripts/freshness-check.mjs --url https://yoursite.com --threshold 60 --output freshness.json
```

**日期信号优先级：** Sitemap `<lastmod>` → Open Graph `article:modified_time` → JSON-LD `dateModified` → `<time datetime>` → HTTP `Last-Modified` 响应头。

输出包含：每页新鲜度状态（fresh / stale / unknown / error）、距上次更新天数、整体评分（新鲜页面占比）、`topActions`。

---

### 10. 负面 GEO 监测 — `negative-geo-detect.mjs`

与历史基线对比，检测 AI 搜索中针对你的品牌的负面情感变化和协同攻击模式。

```bash
node scripts/negative-geo-detect.mjs \
  --domain yoursite.com \
  --keywords "brand name,product category" \
  --baseline data/baselines/citation-prev.json \
  --output negative-report.json
```

**检测的告警类型：**

| 类型 | 严重级别 | 描述 |
|------|---------|------|
| `sentiment_shift` | high | 情感从正面/中立转变为负面 |
| `new_negative_source` | medium | 新增未在基线中出现的负面来源 |
| `attack_signal_detected` | medium | 检测到攻击性语言模式 |
| `citation_lost` | low | 曾被引用但当前已消失 |
| `coordinated_attack` | critical | 同一来源域名在 3+ 次引擎/关键词组合中出现 |
| `cross_engine_source` | high | 同一来源跨 2+ 引擎出现在同一关键词下 |

无 API Key 时自动切换为基线扫描模式（仅分析历史数据中的负面信号）。
