---
name: 钩子路径必须自解析项目根
description: 绝对路径换机器或改目录名必坏；相对路径依赖 cwd 也有风险；正解是脚本用 import.meta.url 上退 2 层
type: feedback
---

钩子脚本（`.codebuddy/hooks/*.mjs`）定位项目根，**只能用脚本自身位置反推**：

```js
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(SCRIPT_DIR, '..', '..');
```

**Why（三种写法各自的坑，都实测过）：**

1. **绝对路径** —— 换机器必坏；更隐蔽的是**改目录名也会坏**。本仓库真实踩过：
   settings.json 里写死 `/Users/mason/DouDou/minicraft-ai-web/...`，
   而仓库后来被挪进 `About-minecraft/` 子目录，于是 `Cannot find module`，
   钩子**从未执行过**，但表面上"配置明明在"，排查了很久。
2. **相对路径**（`node .codebuddy/hooks/x.mjs`）—— 依赖钩子进程的 cwd。
   查实现得知 cwd 来自 `getWorkDir()` / session cwd，**在子目录里发起会话就会指错**。
3. **`CODEBUDDY_PROJECT_DIR`** —— 确实会注入钩子进程（约定名，另有 `CLAUDE_PROJECT_DIR`），
   但实现里是**条件注入**：`t.projectDir && (...)`，projectDir 为空时不注入。

**How to apply:** 配置文件里写相对路径（可读、可移植），脚本内部再用 `import.meta.url` 自解析——
两层冗余，任一失效还有另一层。自检脚本 `npm run agent:setup` 会核对配置里的路径；
注意它的 `--fix-hooks` 曾经会把所有钩子命令都改写成同一个脚本名，
多钩子时会被静默覆写（已修为保留 basename）。
