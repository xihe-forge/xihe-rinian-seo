---
name: search-forge:seo
description: 技术 SEO 审计 — Lighthouse 集成 + 页面信号分析
---

# /search-forge:seo — SEO 审计

整合 Google Lighthouse 和页面爬取，对目标 URL 进行技术 SEO + 内容 SEO 审计。

## 工具

1. Lighthouse — SEO 技术基线：
```bash
node ${CLAUDE_SKILL_DIR}/../../scripts/lighthouse-pull.mjs --url <URL> --strategy mobile
```

2. 页面爬取 — 信号提取：
```bash
node ${CLAUDE_SKILL_DIR}/../../scripts/crawl-page.mjs <URL>
```

## 审计维度（满分 100）

| 维度 | 分值 | 数据源 |
|------|------|--------|
| Meta 标签 | 15 | crawl → meta |
| 标题层级 | 10 | crawl → headings |
| Schema 结构化数据 | 10 | crawl → schema |
| 图片 alt 覆盖率 | 10 | crawl → images |
| 链接健康度 | 5 | crawl → links |
| Core Web Vitals | 15 | Lighthouse → performance |
| SEO 审计项 | 15 | Lighthouse → seo audits |
| 内容质量 | 10 | crawl → content wordCount, readingTime |
| E-E-A-T 信号 | 10 | crawl → 外链权威度, Schema author |

## 步骤

1. 运行 Lighthouse 和页面爬取（可并行）
2. 按维度逐项评分
3. 标记 PASS / WARN / FAIL
4. 给出修复建议，按优先级排序
