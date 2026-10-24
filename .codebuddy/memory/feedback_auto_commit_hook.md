---
name: auto-commit 钩子（只当守卫，不替 AI 提交）
description: .continue/hooks/auto-commit.mjs 挂在 Stop，发现未提交改动就拦住交回 AI 自己提交；脚本不做任何 git 写操作
type: feedback
---

`.continue/hooks/auto-commit.mjs`，由 `.codebuddy/settings.json` 注册在 `Stop`（与 `auto-continue.mjs`、`dispatch.mjs` 并列）。

**核心取舍：脚本不执行任何 git 写操作**（不 add / commit / push）。它只做一件事——
发现 `git status` 有内容就阻止停止，把改动清单 + 规矩交回给 AI，由 AI 自己 review 后提交。

**Why:** commit message 的价值取决于"知不知道自己为什么这么改"，从 diff 拼出来的只能是 `update files`。
这套机制的定位是**兜底提示词**：粒度/中文 message 这些规矩本来写在 `AGENTS.md` §4，钩子只是每轮重新注入，
防止长会话里被上下文压缩掉之后忘掉。

**放行条件**：`.continue/auto.off` 刹车、非 git 仓库、merge/rebase/cherry-pick 进行中、detached HEAD、
存在未解决冲突、同一份改动已拦满 `AUTO_COMMIT_MAX_BLOCKS`（默认 2）次。后几种是危险 git 状态，这时拦人反而掩盖问题。

**How to apply:** 被拦住就老实 review + 提交，不要 `--no-verify` 绕；要关守卫 `touch .continue/auto.off`；
日志在 `.continue/.logs/<会话ID>/run.md`。换项目照搬时连脚本 + settings.json 那几条注册一起搬。
