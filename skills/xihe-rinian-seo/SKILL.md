---
name: xihe-rinian-seo
description: 一键全套 SEO + AEO + GEO 审计 — 输入 URL，输出综合报告
---

# /xihe-rinian-seo — 综合搜索优化审计

对目标网站执行全套审计：Lighthouse SEO 基线、页面信号爬取、GEO 内容优化分析、平台存在度检测、内容新鲜度监控，以及 AI 搜索引用检测（需 API Key）。

## 用法

用户提供 URL 即可，其余参数可选：

```bash
node ${CLAUDE_SKILL_DIR}/../../scripts/audit.mjs \
  --url <用户提供的URL> \
  --brand "<品牌名，可选>" \
  --keywords "<关键词，逗号分隔，可选>" \
  --competitors "<竞品域名，逗号分隔，可选>" \
  --output <输出路径>
```

## 输出

JSON 报告包含：
- `scores` — 各维度评分 + 综合分
- `sections` — 各工具完整结果
- `topActions` — 按优先级排序的 Top 10 改进建议

## 步骤

1. 确认用户提供了目标 URL
2. 如果用户没指定品牌名，从域名推导
3. 运行审计命令
4. 解读结果，重点关注 `topActions` 和低分维度
5. 给出具体可操作的修复建议
