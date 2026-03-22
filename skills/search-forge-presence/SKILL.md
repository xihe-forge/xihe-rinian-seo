---
name: search-forge:presence
description: 检查品牌在 Reddit/YouTube/Wikipedia 等 8 大高引用平台的存在状况
---

# /search-forge:presence — 平台存在度检测

检查品牌在 AI 搜索引擎高频引用的 8 个平台上的存在度。

## 工具

```bash
node ${CLAUDE_SKILL_DIR}/../../scripts/platform-presence.mjs \
  --brand "<品牌名>" \
  --domain "<域名>"
```

## 覆盖平台（按 AI 引用权重）

Reddit 40% | Wikipedia 26% | YouTube 23% | GitHub 5% | Stack Overflow 3% | Hacker News 2% | Medium 1% | Quora 0.5%

## 步骤

1. 确认品牌名和域名
2. 运行检测
3. 重点关注高权重但低得分的平台
4. 给出具体的平台运营建议
