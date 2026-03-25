---
name: rinian-seo:report
description: 对比两次审计快照 — 量化优化效果的反馈闭环
---

# /rinian-seo:report — 反馈闭环对比报告

对比两次审计快照，量化优化效果。

## 工具

使用各工具的 --baseline 和 --output 功能：

```bash
# 1. 首次审计（建立基线）
node ${CLAUDE_SKILL_DIR}/../../scripts/audit.mjs \
  --url <URL> --brand "<品牌>" \
  --output data/baselines/audit-baseline.json

# 2. 优化后再次审计
node ${CLAUDE_SKILL_DIR}/../../scripts/audit.mjs \
  --url <URL> --brand "<品牌>" \
  --output data/baselines/audit-current.json

# 3. AI 引用对比
node ${CLAUDE_SKILL_DIR}/../../scripts/check-ai-citation.mjs \
  --domain <域名> --keywords "<关键词>" \
  --baseline data/baselines/citation-baseline.json \
  --output data/baselines/citation-current.json
```

## 步骤

1. 读取两次审计的 JSON 文件
2. 逐维度对比得分变化
3. 标记已修复项和新发现问题
4. 计算整体改善百分比
5. 给出下一轮优化重点
