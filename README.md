# xihe-seo-aeo

SEO + AEO (Answer Engine Optimization) 工具集，by [xihe-forge](https://github.com/xihe-forge)。

审计、监测、优化你的网站在传统搜索引擎和 AI 搜索引擎中的表现。

## 什么是 AEO？

**AEO (Answer Engine Optimization)** 是针对 AI 搜索引擎（Perplexity、ChatGPT、Gemini、Google AI Overview）的优化。和传统 SEO 不同，AEO 关注的是：你的内容是否会被 AI **引用**。

| | SEO | AEO |
|---|---|---|
| 目标 | Google/Bing 排名 | AI 搜索引擎引用 |
| 关键信号 | 关键词、反链、权威 | 结构化数据、直接回答、llms.txt |
| 衡量方式 | 排名、点击、CTR | 是否被引用、引用频率 |

## 项目结构

```
xihe-seo-aeo/
├── scripts/
│   ├── crawl-page.mjs          # 页面爬取
│   ├── check-ai-citation.mjs   # AI 引用检测
│   ├── generate-llms-txt.mjs   # llms.txt 生成
│   ├── gsc-pull.mjs            # Google Search Console 数据拉取
│   └── engines/                # 各 AI 引擎适配器
│       ├── perplexity.mjs
│       ├── chatgpt.mjs
│       ├── gemini.mjs
│       ├── kimi.mjs
│       └── youcom.mjs
├── skills/
│   ├── aeo-audit/SKILL.md      # /aeo-audit slash command
│   ├── seo-audit/SKILL.md      # /seo-audit slash command
│   ├── aeo-monitor/SKILL.md    # /aeo-monitor slash command
│   └── seo-report/SKILL.md     # /seo-report slash command (NEW)
└── data/baselines/             # 历史数据存储
```

## 安装

```bash
git clone https://github.com/xihe-forge/xihe-seo-aeo.git
cd xihe-seo-aeo
pnpm install   # 或 npm install
```

## 工具

### 1. 页面爬取 — `crawl-page.mjs`

爬取任意 URL，提取 SEO/AEO 相关的所有数据。

```bash
node scripts/crawl-page.mjs https://yoursite.com
node scripts/crawl-page.mjs https://yoursite.com --output data/baselines/yoursite.json
```

提取内容：
- HTTP 状态和关键响应头
- Meta 标签（title、description、canonical、OG、Twitter Card）
- 标题层级（H1-H6）
- JSON-LD Schema 结构化数据
- 链接统计（内链/外链）
- 图片 alt 检查
- hreflang 标签
- `/llms.txt` 检测
- `/robots.txt` 检测
- `/sitemap.xml` 检测
- 内容统计（字数、阅读时长、页面大小）
- FAQ 检测（Schema / details-summary / 常见问题区域）

### 2. AI 引用检测 — `check-ai-citation.mjs`

检查你的域名是否被 AI 搜索引擎引用。支持 5 个引擎。

```bash
# 设置需要的引擎 API Key（至少一个）
export PERPLEXITY_API_KEY=pplx-xxxx
export OPENAI_API_KEY=sk-xxxx
export GEMINI_API_KEY=AIza-xxxx
export MOONSHOT_API_KEY=sk-xxxx   # Kimi/月之暗面
export YOU_API_KEY=xxxx

node scripts/check-ai-citation.mjs \
  --domain yoursite.com \
  --keywords "关键词1,关键词2,keyword3"

# 指定引擎（逗号分隔）
node scripts/check-ai-citation.mjs \
  --domain yoursite.com \
  --keywords "关键词1,关键词2" \
  --engines perplexity,gemini

# 查看可用引擎
node scripts/check-ai-citation.mjs --list

# 与上次基线对比
node scripts/check-ai-citation.mjs \
  --domain yoursite.com \
  --keywords "关键词1,关键词2" \
  --baseline data/baselines/citation-prev.json \
  --output data/baselines/citation-latest.json
```

支持的引擎及所需 API Key：

| 引擎 | 环境变量 | 获取地址 |
|------|---------|---------|
| Perplexity | `PERPLEXITY_API_KEY` | https://www.perplexity.ai/settings/api |
| ChatGPT web search | `OPENAI_API_KEY` | https://platform.openai.com/api-keys |
| Google Gemini | `GEMINI_API_KEY` | https://aistudio.google.com/app/apikey |
| Kimi/月之暗面 | `MOONSHOT_API_KEY` | https://platform.moonshot.cn |
| You.com | `YOU_API_KEY` | https://you.com/api |

### 3. llms.txt 生成 — `generate-llms-txt.mjs`

为你的网站生成 [llms.txt](https://llmstxt.org/) 文件，告诉 AI 爬虫你的站点是什么。

```bash
node scripts/generate-llms-txt.mjs \
  --url https://yoursite.com \
  --name "Your Site" \
  --description "What your site does" \
  --sitemap https://yoursite.com/sitemap.xml \
  --output public/llms.txt
```

生成两个文件：
- `llms.txt` — 简洁版（链接 + 一行描述）
- `llms-full.txt` — 详细版（每页 2-3 句摘要）

### 4. Google Search Console 数据拉取 — `gsc-pull.mjs`

拉取 GSC 搜索分析数据，建立 SEO 基线。

```bash
# 方式一：服务账号
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
node scripts/gsc-pull.mjs --site https://yoursite.com --days 28

# 方式二：OAuth token
export GSC_ACCESS_TOKEN=ya29.xxxx
node scripts/gsc-pull.mjs --site https://yoursite.com --days 28 --output data/baselines/gsc-latest.json
```

无凭据时会打印详细的设置指南。

## Skills

如果你使用 Claude Code，可以将 `skills/` 下的目录安装为 slash command：

```bash
# 个人使用（所有项目可用）
cp -r skills/<name>/ ~/.claude/skills/<name>/

# 项目级安装（仅当前项目可用）
cp -r skills/<name>/ <project>/.claude/skills/<name>/
```

### `/aeo-audit` — AI 可引用性审计

对任意页面进行 8 维度 AEO 评分（满分 80）：
- Schema 结构化数据、内容结构、FAQ、AI 爬虫访问
- Meta 标签、答案密度、权威信号、内容新鲜度

### `/seo-audit` — 全站 SEO 审计

技术 SEO + 内容 SEO 双重审计（满分 100）：
- Meta 标签、标题层级、图片 alt、Schema、索引状态
- 内容质量、关键词优化、E-E-A-T 信号

### `/aeo-monitor` — AI 搜索引用监测

跟踪你的域名在 AI 搜索中的引用状态变化：
- 定期检测 → 存基线 → 对比变化
- 发现新增引用 / 丢失引用
- 针对未被引用的关键词给出优化建议

### `/seo-report` — 反馈闭环对比报告

对比两次审计快照，量化优化效果：
- AEO 分数前后对比（维度级拆解）
- AI 引用率变化趋势（跨引擎汇总）
- GSC 数据对比（排名、点击、CTR）
- 自动标记已修复项 / 新发现问题

## 反馈闭环

这套工具的核心理念是**闭环优化**，不是"分析一次就结束"：

```
审计（baseline） → 优化 → 再次审计 → /seo-report 对比 → 调整 → ...
```

1. 首次运行 `/aeo-audit`，得到基线分数
2. 按建议修复（添加 Schema、生成 llms.txt、优化内容结构）
3. 再次运行 `/aeo-audit`，然后用 `/seo-report` 对比两次快照
4. 运行 `/aeo-monitor`，追踪 AI 搜索引用率随时间的变化

所有历史数据存储在 `data/baselines/` 目录下。

## 免费数据源

| 数据源 | 成本 | 用途 |
|--------|------|------|
| 页面爬取 | 免费 | SEO/AEO 审计 |
| Google Search Console API | 免费 | 排名、点击、CTR |
| Google PageSpeed Insights API | 免费 | Core Web Vitals |
| Perplexity / Gemini / Kimi | 有免费额度 | AI 引用检测 |

不需要 Ahrefs ($129/月) 或 SEMrush ($139/月)。

## License

MIT — by xihe-forge
