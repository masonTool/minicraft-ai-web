---
name: 自动继续（Stop 钩子）配置与关键坑
description: 用户要求 AI 每轮按队列自动继续、不停下等确认；Stop 钩子要自动继续必须 continue:true + 反馈走 stderr + exit 2
type: feedback
---

用户要求：**不要让 AI 停下来等确认**。`.continue/hooks/auto-continue.mjs` 挂在 `Stop` + `UserPromptSubmit`，
发现队列还有 `[ ]` / `[~]` 就阻止停止、把下一条任务注入回来；刹车是 `touch .continue/auto.off`。

**关键坑（踩过一次，排查了整整一轮）：** Stop 钩子要"阻止停止并让 Agent 继续"时，
`stdout` 必须输出 `{"continue": true}`，反馈文字放 `stderr`，退出码 `exit 2`。

**Why:** 官方文档 Stop 章节的样例写的是 `{"continue": false, "stopReason": "..."}` + exit 2，
但附录 `HookOutput` 里 `continue` 的定义是「是否继续执行（默认 true）」；照样例写会让实现层当成**硬停止**，
现象是"配了钩子但没自动继续"。附录 D 又说「exit 2 时 stdout 被忽略、stderr 传给 Agent」，两处冲突，实测以 `continue: true` 为准。

**How to apply:** 任何要装"自动继续"的项目，一律 `continue: true` + stderr 承载反馈 + exit 2；
脚本要自解析项目根（见"钩子路径必须自解析"）、保留 shebang 与执行权限；
宿主侧的 `loop_limit`（`.codebuddy/settings.json`，本仓库写 100）决定一条用户消息能续跑几次——
上限为 1 时不报错，症状只是"对话停了"，日志里的「续跑第 N 次」是唯一区别。钩子文档地址是
`https://www.codebuddy.ai/docs/zh/ide/Features/Hooks`（`/User-guide/Hooks` 是 404）。
