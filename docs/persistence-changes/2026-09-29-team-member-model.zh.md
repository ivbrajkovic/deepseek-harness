---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-09-29-team-member-model

[English](2026-09-29-team-member-model.md) | 中文

## 概述

在持久的 team/member roster 记录中加入 teammate 解析后的 model。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-09-29-team-member-model
baseline: false
changes:
  - root: "event:team/member"
    previous: "2026-09-11-initial"
    after: "0bff5e9256cf33b10e27a092105d23885a2f68bbe449ed1a68df551d449d619b"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

已有 team/member 记录仍然有效：model 字段为可选，旧日志按原样重放，Agent Teams 投影接受带或不带该字段的记录。该字段仅用于 roster 展示；完整的 provider/model/effort 路由仍保存在 child 自己的 subagent descriptor 中，其他事件载荷不变。

<a id="verification"></a>
## 验证

npx vitest run packages/experimental/agent-team packages/experimental/tool-agent-team：82 个测试通过，包括按路由创建、持久 roster 重放与冷恢复对账覆盖。

<a id="dev-note"></a>
## 开发备注

无。
