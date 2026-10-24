---
name: 别跑 agent:setup --fix-hooks（会拆掉钩子包装）
description: tools/agent-setup.mjs 的 --fix-hooks 会把 node .continue/hooks/run.mjs <脚本> --event=X 改写成 node <绝对路径>/run.mjs，丢掉脚本名与 --event；默认不带参数是安全的
type: feedback
---

`npm run agent:setup`（`tools/agent-setup.mjs`）**不要加 `--fix-hooks`**。

它的正则只匹配命令里第一个 `*.mjs`，于是把
`node .continue/hooks/run.mjs auto-continue.mjs --event=Stop` 改写成 `node <绝对路径>/run.mjs`——
**脚本名和 `--event=` 全丢**，钩子等于没配；而且它写的是本机绝对路径，提交上去换机器就死。
默认形态（不带参数）只检查、只报告，是安全的。

**Why:** 钩子路径本身该由 `lib.mjs` 用 `import.meta.url` 反推项目根（已封装，别自己拼路径）；
`run.mjs` 包装器负责把"钩子自己崩了"翻译成 exit 2 的明确拦截，丢了它会出现"对话一声不吭地停了"。
**How to apply:** 环境自检就跑 `npm run agent:setup`；改完钩子跑 `npm run test:hooks`，
再看 `.continue/.logs/<会话ID>/run.md` 确认真的触发过。
