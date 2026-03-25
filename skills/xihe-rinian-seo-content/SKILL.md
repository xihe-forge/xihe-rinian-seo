---
name: xihe-rinian-seo:content
description: 基于 Princeton GEO 论文的内容优化建议 — 引用+42%、统计+33%
---

# /xihe-rinian-seo:content — GEO 内容优化

分析页面内容，基于 Princeton GEO 论文量化发现给出优化建议。

## 工具

```bash
# 直接分析 URL
node ${CLAUDE_SKILL_DIR}/../../scripts/content-optimize.mjs --url <URL>

# 或从 crawl 结果分析
node ${CLAUDE_SKILL_DIR}/../../scripts/crawl-page.mjs <URL> --output /tmp/crawl.json
node ${CLAUDE_SKILL_DIR}/../../scripts/content-optimize.mjs --input /tmp/crawl.json
```

## 评估维度

| 维度 | 预期可见度提升 |
|------|--------------|
| 专家引用与标注 | +42% |
| 数据与统计 | +33% |
| 来源引用 | +30% |
| 内容结构 | 高影响 |
| 答案密度 | 高影响 |
| 技术术语密度 | +12% |

## 步骤

1. 运行内容分析
2. 解读各维度得分和 topActions
3. 给出具体修改建议（例如"在第 3 段添加行业统计数据"）
