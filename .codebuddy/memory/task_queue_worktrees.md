---
name: 任务记账与并行开发只走 .continue（continue-do）
description: 队列/进度/踩坑的唯一载体是 .continue/，命令与流程照 README.md；并行开发用 worktree.mjs，不要另造记账流程
type: feedback
---

本项目的任务、进度、踩坑**只有一处**：`.continue/`（continue-do 框架）。队列文件是
`doing/<会话 ID 前 6 位>.md`，机制说明书是 `.continue/README.md`（文件分工、四态标记、收尾五步都在那里）。

**Why:** 历史上并存过多套记账入口（`.codebuddy/auto-continue.md`、`npm run q` 系列、`queues/`、
`EXPERIENCE.md`），状态互相打架，最后只留 `.continue/` + 钩子。这些旧入口**都已删除，不要再引用或恢复**。

**How to apply:** 开新批次 `node .continue/hooks/queue-init.mjs --new-batch`；并行开发
`node .continue/hooks/worktree.mjs <单词>`（**要在新路径另开会话**，本树里跑等于没隔离）；
收尾归档 `node .continue/hooks/archive-queue.mjs <会话ID>`；急停 `touch .continue/auto.off`。
细节一律回去读 `.continue/README.md`，别凭记忆复述规则。
