# xihe-search-forge

SEO + AEO + GEO 一站式搜索优化工具，by [xihe-forge](https://github.com/xihe-forge)。

> Google Lighthouse 负责 SEO 基础项。我们负责 Lighthouse 覆盖不到的一切——AI 可引用性、llms.txt、跨 5 个 AI 引擎的引用监测、品牌情感分析、竞品追踪。

---

## 什么是 SEO / AEO / GEO？

| | SEO | AEO | GEO |
|---|---|---|---|
| 全称 | Search Engine Optimization | Answer Engine Optimization | Generative Engine Optimization |
| 目标 | Google/Bing 排名 | AI 搜索引擎引用 | 在 AI 生成内容中被提及 |
| 关键信号 | 关键词、反链、Core Web Vitals | 结构化数据、直接回答、llms.txt | 品牌权威、内容格式、AI 友好度 |
| 衡量方式 | 排名、点击、CTR | 是否被引用、引用频率 | 引用情感、竞品对比、提及份额 |

三者共同构成现代搜索可见性的完整图景。

---

## 项目结构

```
xihe-search-forge/
├── scripts/
│   ├── lighthouse-pull.mjs         # Google Lighthouse 集成（免认证）
│   ├── crawl-page.mjs              # 页面爬取与 AEO/SEO 信号提取
│   ├── check-ai-citation.mjs       # AI 引用检测（5 引擎 + 情感 + 竞品）
│   ├── generate-llms-txt.mjs       # llms.txt 生成
│   ├── gsc-pull.mjs                # Google Search Console 数据拉取
│   └── engines/                    # 各 AI 引擎适配器
│       ├── perplexity.mjs
│       ├── chatgpt.mjs
│       ├── gemini.mjs
│       ├── kimi.mjs
│       └── youcom.mjs
├── skills/
│   ├── aeo-audit/SKILL.md          # /aeo-audit slash command
│   ├── seo-audit/SKILL.md          # /seo-audit slash command
│   ├── aeo-monitor/SKILL.md        # /aeo-monitor slash command
│   └── seo-report/SKILL.md         # /seo-report slash command
└── data/baselines/                 # 历史数据存储
```

---

## 安装

```bash
git clone https://github.com/xihe-forge/xihe-search-forge.git
cd xihe-search-forge
pnpm install   # 或 npm install
```

---

## 工具

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

输出包含：Performance、Accessibility、Best Practices、SEO 四项得分，以及 Core Web Vitals（LCP、CLS、FID）。

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

### 5. Google Search Console 数据拉取 — `gsc-pull.mjs`

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

## Skills

如果你使用 Claude Code，可以将 `skills/` 下的目录安装为 slash command：

```bash
# 个人使用（所有项目可用）
cp -r skills/<name>/ ~/.claude/skills/<name>/

# 项目级安装（仅当前项目可用）
cp -r skills/<name>/ <project>/.claude/skills/<name>/
```

### `/aeo-audit` — AI 可引用性审计

对任意页面进行 8 维度 AEO 评分（满分 80）：Schema 结构化数据、内容结构、FAQ、AI 爬虫访问、Meta 标签、答案密度、权威信号、内容新鲜度。

### `/seo-audit` — 全站 SEO 审计

技术 SEO + 内容 SEO 双重审计（满分 100），整合 Lighthouse 数据：Meta 标签、标题层级、图片 alt、Schema、Core Web Vitals、内容质量、E-E-A-T 信号。

### `/aeo-monitor` — AI 搜索引用监测

跟踪域名在 AI 搜索中的引用变化：定期检测 → 存基线 → 对比变化。发现新增 / 丢失引用，并针对未被引用的关键词给出优化建议。

### `/seo-report` — 反馈闭环对比报告

对比两次审计快照，量化优化效果：AEO 分数维度级拆解、AI 引用率变化趋势（跨引擎汇总）、GSC 数据对比（排名、点击、CTR）、Lighthouse 得分前后对比、自动标记已修复项 / 新发现问题。

---

## 反馈闭环

```
审计（baseline） → 优化 → 再次审计 → /seo-report 对比 → 调整 → ...
```

1. 首次运行 `/seo-audit` + `/aeo-audit`，得到完整基线（含 Lighthouse 得分）
2. 按建议修复（添加 Schema、生成 llms.txt、优化内容结构、修复 Core Web Vitals）
3. 再次审计，用 `/seo-report` 对比两次快照
4. 运行 `/aeo-monitor`，持续追踪 AI 搜索引用率和品牌情感变化

所有历史数据存储在 `data/baselines/` 目录下。

---

## 免费数据源

| 数据源 | 成本 | 用途 |
|--------|------|------|
| 页面爬取 | 免费 | SEO/AEO/GEO 信号提取 |
| Google Lighthouse / PageSpeed Insights API | 免费，无需认证 | Core Web Vitals、SEO 技术项 |
| Google Search Console API | 免费 | 排名、点击、CTR |
| Perplexity / Gemini / Kimi | 有免费额度 | AI 引用检测（含中文市场） |
| ChatGPT web search / You.com | 有免费额度 | AI 引用检测（英文市场） |

不需要 Ahrefs ($129/月) 或 SEMrush ($139/月)。

---

## License

MIT — by [xihe-forge](https://github.com/xihe-forge)
