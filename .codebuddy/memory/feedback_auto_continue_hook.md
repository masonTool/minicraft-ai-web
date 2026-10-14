---
name: 自动继续（Stop 钩子）配置与关键坑
description: 用户希望 AI 每轮自动按任务队列继续、不要停下等确认；Stop 钩子必须用 continue:true + stderr + exit 2
type: feedback
---

用户要求：**不要让 AI 停下来等确认**。为此在项目里装了 Stop 钩子自动继续机制（`.codebuddy/settings.json` + `.codebuddy/hooks/auto-continue.mjs` + 队列 `.codebuddy/auto-continue.md`）。换项目时如果用户还想要这个行为，可以照搬这套三件套。

**关键坑（踩过一次，排查了整整一轮）：** Stop 钩子要"阻止停止并让 Agent 继续"时，`stdout` 必须输出 `{"continue": true}`，反馈放 `stderr`，退出码 `exit 2`。

**Why:** 官方文档 Stop 章节的样例写的是 `{"continue": false, "stopReason": "..."}` + exit 2，但附录 `HookOutput` 里 `continue` 的通用定义是「是否继续执行（默认 true）」。照样例写会让实现层把 `continue: false` 当成**硬停止**，Agent 就真的停了 —— 现象是"配了钩子但没自动继续"。官方附录 D 另有一句「退出码 2 时 stdout 被忽略、stderr 传递给 Agent」，两处说法冲突，实测以 `continue: true` 为准。

**How to apply:** 任何项目要装 Stop 钩子做自动继续时，一律 `continue: true` + stderr 承载反馈 + exit 2。另外：脚本要给执行权限并保留 shebang、配置里用绝对路径（官方 FAQ 检查清单），并往日志文件写埋点（记录事件名/决定请/次数），这样"到底有没有触发"能一眼确认，不用靠猜。文档正确地址是 `https://www.codebuddy.ai/docs/zh/ide/Features/Hooks`（`/User-guide/Hooks` 是 404）。
