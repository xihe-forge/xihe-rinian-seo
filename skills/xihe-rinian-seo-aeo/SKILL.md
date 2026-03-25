---
name: xihe-rinian-seo:aeo
description: AI 可引用性审计 — Schema、llms.txt、FAQ、答案密度等 8 维度评分
---

# /xihe-rinian-seo:aeo — AEO 审计

评估页面对 AI 搜索引擎的可引用性，8 个维度满分 80 分。

## 工具

```bash
node ${CLAUDE_SKILL_DIR}/../../scripts/crawl-page.mjs <URL>
```

## 审计维度（满分 80）

| 维度 | 分值 | 检查内容 |
|------|------|---------|
| Schema 结构化数据 | 10 | JSON-LD 数量和类型覆盖 |
| 内容结构 | 10 | H1–H6 层级、段落长度 |
| FAQ 内容 | 10 | FAQ 数量、Schema + HTML |
| AI 爬虫访问 | 10 | robots.txt 是否允许 AI bot |
| Meta & OG 标签 | 10 | title、description、OG 完整度 |
| 答案密度 | 10 | 直接回答句比例 |
| 权威信号 | 10 | 外链引用、作者信息 |
| 内容新鲜度 | 10 | lastmod、dateModified |

## 步骤

1. 爬取目标页面
2. 逐维度评分并记录发现
3. 汇总得分，标记 PASS（≥7）/ WARN（4-6）/ FAIL（<4）
4. 输出修复建议，按预期影响排序
