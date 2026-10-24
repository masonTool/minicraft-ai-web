---
name: 钩子路径必须自解析（配置写相对路径）
description: 钩子脚本用 import.meta.url 反推项目根（.continue/hooks/lib.mjs 已封装）；settings.json 写相对路径 + run.mjs 包装；别跑 agent:setup --fix-hooks
type: feedback
---

钩子定位项目根**只能靠脚本自身位置反推**——`lib.mjs` 已经封装好，直接复用，不要自己写路径：

```js
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = resolve(SCRIPT_DIR, '..', '..');
```

`.codebuddy/settings.json` 里的命令写**相对路径**，并且必须保留 `run.mjs` 包装与 `--event=`：

```
node .continue/hooks/run.mjs auto-continue.mjs --event=Stop
```

**Why（三种写法都实测踩过）：**
1. **绝对路径** —— 换机器必坏；更隐蔽的是改目录名也坏。本仓库真踩过：settings.json 里写死
   `/Users/mason/DouDou/minicraft-ai-web/...`，仓库后来被挪进子目录，于是 `Cannot find module`，
   钩子**从未执行过**，但表面上"配置明明在"。
2. **相对路径裸跑** —— 依赖钩子进程的 cwd，从子目录发起会话就指错；所以配置用相对路径、脚本内部再自解析，两层冗余。
3. **`CODEBUDDY_PROJECT_DIR`** —— 会注入，但是**条件注入**（`projectDir` 为空时不注入），不能当唯一依据。

**别跑 `npm run agent:setup -- --fix-hooks`**：它把命令改写成 `node <绝对路径>/<脚本>`，
会**丢掉 `run.mjs` 包装和 `--event=`**——包装器负责把"框架自己崩了"翻译成 exit 2 的明确拦截，
丢了它就会出现"对话一声不吭地停了"（宿主把非 0/2 退出码当未阻止处理）。默认的 `agent:setup`（不带该参数）是安全的。

**How to apply:** 新钩子照 `lib.mjs` 的写法拿 `PROJECT_ROOT`；改钩子后至少手跑一次
`node .continue/hooks/selftest.mjs`，再看 `.continue/.logs/<会话ID>/run.md` 确认真的触发了。
