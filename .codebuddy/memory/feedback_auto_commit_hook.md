---
name: auto-commit 钩子（只当守卫，不替 AI 提交）
description: Stop 钩子发现工作区有未提交改动就阻止停止，把清单与规矩交回 AI 自己 review/commit/push；脚本不做任何 git 写操作
type: feedback
---

`.codebuddy/hooks/auto-commit.mjs`，挂在 `Stop` + `UserPromptSubmit`，与 `auto-continue.mjs` 并列。

**核心取舍：脚本不执行任何 git 写操作**（不 add / commit / push）。它只做一件事——
发现 `git status` 有内容就阻止停止，把改动清单 + 规矩交回给 AI，由 AI 自己 review 和提交。

**Why:** commit message 的质量取决于"知不知道自己为什么这么改"。脚本从 diff 拼出来的只能是
`update files`，等于把版本历史的价值丢掉。这套机制的定位是**兜底提示词**——
规则（粒度/中文 message）本来就在 AGENTS.md §4 和 HANDOFF §2 里，钩子只是每轮重新注入一次，
防止长会话里前面的规则被上下文压缩掉之后 AI 就忘了。

**六道放行**（后四种是危险 git 状态，这时拦人反而会掩盖问题）：
`.off` 刹车、非 git 仓库、merge/rebase/cherry-pick 进行中、detached HEAD、
存在未解决冲突、本会话已拦满 `AUTO_COMMIT_MAX`（默认 5）次。

**How to apply:** 换项目要用的话，连 `.codebuddy/hooks/auto-commit.mjs` + settings.json 里
那两条注册一起搬。刹车是 `touch .codebuddy/auto-commit.off`；日志看
`.codebuddy/auto-commit.log`（`decision=block` 说明生效且拦住了）。
若发现 AI 不理会拦截、直接停了，设 `AUTO_COMMIT_STYLE=exit2` 切换输出风格
（`continue:false` + reason 与 `exit 2` + stderr 两种写法在官方文档与实测之间不一致，两个都留着）。
