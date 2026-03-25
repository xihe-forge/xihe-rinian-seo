---
name: xihe-rinian-seo:freshness
description: 检测网站内容新鲜度 — 标记超过 90 天未更新的页面
---

# /xihe-rinian-seo:freshness — 内容新鲜度检测

抓取 sitemap，检查每个页面的最后更新时间，标出过期内容。

## 工具

```bash
node ${CLAUDE_SKILL_DIR}/../../scripts/freshness-check.mjs \
  --url <URL> \
  [--threshold 90]
```

## 步骤

1. 运行新鲜度检测
2. 关注 stale 状态的页面
3. 建议更新策略（按流量/重要性优先）
