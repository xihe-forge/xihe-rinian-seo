# xihe-rinian-seo

> **命名由来 / Etymology** — 遵循曦和项目三段式命名规范 `xihe-{隐喻}-{功能}`：
>
> - **xihe（曦和）** — 品牌。源自中国神话中的太阳女神曦和 / Brand. Xihe, the sun goddess in Chinese mythology
> - **rinian（日辇）** — 隐喻。日辇是曦和女神每日驾驭载日巡天的太阳车驾。SEO 工具如日辇般驱动网站在搜索引擎中被看见 / Metaphor. Rìniǎn is the solar chariot driven by Xihe across the sky each day. This tool drives your website's visibility in search engines
> - **seo** — 功能。搜索引擎与 AI 引擎一站式优化 / Function. All-in-one optimization for search engines and AI engines

SEO + AEO + GEO 一站式搜索优化工具。
All-in-one SEO + AEO + GEO search optimization tool.

一个命令审计你的网站在传统搜索引擎和 AI 搜索引擎中的可见性，给出可执行的优化建议。
One command to audit your website's visibility across traditional search engines and AI search engines, with actionable optimization recommendations.

由 [Xihe AI](https://github.com/xihe-forge) 锻造，面向所有需要在 AI 时代被看见的人。
Forged by [Xihe AI](https://github.com/xihe-forge), for everyone who needs to be seen in the age of AI.

> v0.3 · 11 工具 / tools · 5 AI 引擎 / engines · 48 tests · by [xihe-forge](https://github.com/xihe-forge)

<p align="center">
  <img src="./demo.svg" alt="xihe-rinian-seo audit demo" width="700">
</p>

---

## 快速开始 / Quick Start

```bash
# npx（无需安装 / no install needed）
npx xihe-rinian-seo --url https://yoursite.com

# 或 clone 后使用 / or clone and run
git clone https://github.com/xihe-forge/xihe-rinian-seo.git
cd xihe-rinian-seo && pnpm install
npm run audit -- --url https://yoursite.com --brand "YourBrand"
```

---

## 审计输出 / Audit Output

一次运行覆盖 7 个维度：
One run covers 7 dimensions:

| 维度 / Dimension | 数据来源 / Source | 免费 / Free |
|------|---------|------|
| SEO 技术基线 / SEO Technical Baseline | Google Lighthouse | ✅ |
| 页面信号 / Page Signals（Meta/Schema/FAQ/Links） | 内置爬虫 / Built-in Crawler | ✅ |
| GEO 内容优化建议 / GEO Content Optimization | Princeton 论文量化模型 / Princeton Paper Model | ✅ |
| 平台存在度 / Platform Presence（Reddit/YouTube/Wikipedia...） | 8 大平台 API / 8 Platform APIs | ✅ |
| 内容新鲜度 / Content Freshness | Sitemap + 页面日期信号 / Page Date Signals | ✅ |
| AI 引用检测 + 品牌情感 / AI Citation + Brand Sentiment | Perplexity / ChatGPT / Gemini / Kimi / You.com | 需 API Key / API Key Required |
| AI 声量占比 vs 竞品 / AI Share of Voice vs Competitors | 同上 / Same | 需 API Key / API Key Required |

---

## 工具一览 / Tools

| # | 工具 / Tool | 命令 / Command | 说明 / Description |
|---|------|------|------|
| 0 | **一键全套 / Full Audit** | `npm run audit` | 运行全部，输出综合报告 / Run all tools, output comprehensive report |
| 1 | Lighthouse | `npm run lighthouse` | Google SEO 技术基线 / Google SEO technical baseline |
| 2 | 页面爬取 / Page Crawl | `npm run crawl` | SEO/AEO/GEO 信号提取 / Signal extraction |
| 3 | AI 引用检测 / AI Citation | `npm run citation` | 5 引擎 + 情感 + 竞品 / 5 engines + sentiment + competitors |
| 4 | llms.txt 生成 / Generate | `npm run llms-txt` | AI 爬虫引导文件 / AI crawler guidance file |
| 5 | GSC 数据 / GSC Data | `npm run gsc` | Google Search Console |
| 6 | 内容优化 / Content Optimize | `npm run content-optimize` | Princeton GEO 论文建议 / Princeton GEO paper recommendations |
| 7 | 平台存在度 / Platform Presence | `npm run platform-presence` | 8 大高引用平台 / 8 high-citation platforms |
| 8 | 声量占比 / Share of Voice | `npm run share-of-voice` | 你 vs 竞品引用率 / Your vs competitor citation rate |
| 9 | 内容新鲜度 / Content Freshness | `npm run freshness` | 标记过期页面 / Flag stale pages |
| 10 | 负面 GEO 防御 / Negative GEO Defense | `npm run negative-geo` | 情感突变 + 协同攻击 / Sentiment spikes + coordinated attacks |

📖 各工具详细用法和参数 / Detailed usage and parameters: [docs/tools.md](docs/tools.md)

---

## Claude Code Skills

```bash
# 安装全部 skills / Install all skills
cp -r skills/*/ ~/.claude/skills/
```

| 命令 / Command | 功能 / Function |
|------|------|
| `/xihe-rinian-seo` | **一键全套审计 / Full Audit** |
| `/xihe-rinian-seo:seo` | SEO 审计 / SEO Audit |
| `/xihe-rinian-seo:aeo` | AEO 审计（8 维度）/ AEO Audit (8 dimensions) |
| `/xihe-rinian-seo:citation` | AI 引用监测 / AI Citation Monitoring |
| `/xihe-rinian-seo:content` | GEO 内容优化 / GEO Content Optimization |
| `/xihe-rinian-seo:presence` | 平台存在度 / Platform Presence |
| `/xihe-rinian-seo:freshness` | 内容新鲜度 / Content Freshness |
| `/xihe-rinian-seo:voice` | 声量占比 / Share of Voice |
| `/xihe-rinian-seo:defense` | 负面 GEO 防御 / Negative GEO Defense |
| `/xihe-rinian-seo:report` | 前后对比报告 / Before/After Report |

---

## 反馈闭环 / Feedback Loop

```
/xihe-rinian-seo (baseline) → optimize → /xihe-rinian-seo (recheck) → /xihe-rinian-seo:report (compare) → ...
```

---

## API Key 配置 / API Key Configuration

AI 引用检测相关功能需要至少一个 API Key：
AI citation features require at least one API Key:

```bash
export PERPLEXITY_API_KEY=pplx-xxxx    # perplexity.ai/settings/api
export OPENAI_API_KEY=sk-xxxx          # platform.openai.com/api-keys
export GEMINI_API_KEY=AIza-xxxx        # aistudio.google.com/app/apikey
export MOONSHOT_API_KEY=sk-xxxx        # platform.moonshot.cn
export YOU_API_KEY=xxxx                # you.com/api
```

无 API Key 时，Lighthouse / 爬虫 / 内容优化 / 平台存在度 / 新鲜度检测仍可正常使用。
Without API Keys, Lighthouse / Crawler / Content Optimize / Platform Presence / Freshness Check still work normally.

---

## 关于曦和 AI / About Xihe AI

曦和（Xihe）得名于中国神话中驾驭太阳的女神。[xihe-forge](https://github.com/xihe-forge) 是曦和 AI 的开源锻造炉——我们在这里把实用的 AI 工具从想法锤炼成可以直接上手的开源项目。xihe-rinian-seo 是锻造炉中的第二个开源作品。更多面向搜索、内容和增长的 AI 工具正在锻造中，欢迎关注或参与贡献。

Xihe is named after the sun goddess who drives the solar chariot in Chinese mythology. [xihe-forge](https://github.com/xihe-forge) is Xihe AI's open-source forge — where we hammer practical AI tools from ideas into ready-to-use open-source projects. xihe-rinian-seo is the second open-source piece out of the forge. More AI tools for search, content, and growth are being forged — follow the org or contribute.

---

## License

MIT — by [xihe-forge](https://github.com/xihe-forge)
