---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-09-29-team-member-model

English | [中文](2026-09-29-team-member-model.zh.md)

## Summary

Adds the teammate's resolved model to the durable team/member roster record.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

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
## Compatibility

Existing team/member records remain valid: the model field is optional, old logs replay unchanged, and the Agent Teams projection accepts records with or without it. The field is display-grade roster state; the full provider/model/effort route stays in the child's own subagent descriptor, so no other event payload changes.

<a id="verification"></a>
## Verification

npx vitest run packages/experimental/agent-team packages/experimental/tool-agent-team: 82 tests passed, including spawn-with-route, durable roster replay, and cold-resume reconciliation coverage.

<a id="dev-note"></a>
## Dev Note

None.
