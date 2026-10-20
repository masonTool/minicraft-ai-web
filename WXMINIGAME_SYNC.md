# main → 小游戏同步流程

> 目的：让 Web `main` 与小游戏分支的每次同步都有固定入口、固定分类、固定验收，避免再出现“手写 Canvas 版和 Web DOM 版各改一套”的漂移。

## 1. 分支职责

| 分支 / worktree | 职责 | 规则 |
|---|---|---|
| `main` | Web 唯一源码源 | 不直接放小游戏平台代码 |
| `wxminigame` | 当前可运行的小程序版本 | 保留作回退，不再作为长期主线 |
| `wxminigame-v2` | 新架构迁移线 | 从 main 起步；core/render 尽量零改动；UI 用 UI Kit |

推荐 worktree：

```bash
git worktree add ../minicraft-ai-web-v2 -b wxminigame-v2 main
```

> 不要在 `wxminigame-v2` 上直接 rebase main。
> 使用 `merge --no-ff`，让脚本能准确识别“这次 main 带进来的变更”。

## 2. 每次同步的固定步骤

### 0. 准备

```bash
git status                 # 必须干净
git fetch origin
```

### 1. 合并 main（必须产生 merge commit）

```bash
git merge --no-ff origin/main
```

冲突时的处理原则：

| 路径 | 冲突处理 |
|---|---|
| `src/platform/**`、`src/minigame/**`、`vendor/**`、`minigame-world/**`、`tools/minigame/**` | 保留 v2 自己的版本 |
| `src/core/**`、`src/render/**`、`src/world/**`、`src/data/**` | 尽量接受 main，再补 adapter 垫片 |
| `src/ui/**`、`index.html`、CSS | 不要直接接受；按 UI 迁移清单人工处理 |
| `package.json` / 构建脚本 | 两边合并后人工确认脚本仍存在 |

不要用 `git checkout --theirs .` 全局覆盖。

### 2. 跑同步审计

```bash
npm run sync:audit
```

merge commit 会自动按：

```text
HEAD^1  = merge 前的 v2
HEAD^2  = 被 merge 进来的 main
```

审计 `HEAD^1..HEAD^2`，也就是“这次 main 实际带进来的文件”。

非 merge 状态则审计 `main...HEAD`，用于查看整体分叉。

### 3. 按分类处理

输出分为五类：

| 分类 | 含义 | 处理 |
|---|---|---|
| `CORE` | core/render/world/data | 优先保持 main 原样；补 adapter |
| `UI` | `src/ui/**`、`index.html`、CSS | 不会自动同步；迁移到 UI Kit / 共享 Spec |
| `PLATFORM` | platform/minigame/vendor/微信工程 | v2 专属，保留 v2 |
| `BUILD` | package/tsconfig/vite/CI | 人工合并并验证 |
| `OTHER` | 其他 | 逐个判断 |

### 4. 处理 adapter 风险

审计会扫描新增代码里的浏览器 API：

```text
DOM / localStorage / IndexedDB / navigator
Canvas / ImageData / OffscreenCanvas
Worker / requestAnimationFrame
AudioContext / PointerLock / Fullscreen
```

处理顺序：

1. 先在 `src/platform/**` 或 `vendor/**` 补垫片；
2. 只有在垫片无法解决时，才改 `core/render`；
3. 改 core 的提交必须单独标记，并同时跑 Web 回归。

### 5. UI 迁移

`UI` 分类里的每个文件都必须做一次判断：

- 只是文案/数值变化 → 同步到 UI Kit 对应页面；
- 布局/结构变化 → 按 Web 结构在 UI Kit 重做；
- 高频变化页面（设置、背包、聊天）→ 优先抽成共享 Spec，减少下次迁移。

**不能把 main 的 DOM/CSS 文件直接当作小游戏 UI 实现。**

### 6. 跑验收

```bash
npm run sync:audit -- --run
```

这条会执行：

- `typecheck`
- `test:v2-core`（存在时）
- `build:minigame:world`（存在时）
- `check:fast`

另外必须人工/CI 跑：

```bash
# Web 回归
npm run check
npm run build:fast

# 小游戏
npm run test:minigame:flow
```

### 7. 记录

在 `WXMINIGAME.md` 记录：

- 同步的 main commit
- CORE 改动
- UI 迁移页面
- adapter 新增垫片
- 验收结果

## 3. 审计命令

```bash
# 只审计
npm run sync:audit

# 指定基线
npm run sync:audit -- --base origin/main

# 审计 + 本地门禁
npm run sync:audit -- --run

# CI：有 adapter 风险或门禁失败则非 0
npm run sync:audit -- --strict

# 机器可读
npm run sync:audit -- --json
```

## 4. 可直接合并与必须人工的边界

| 变更类型 | 能否直接 merge |
|---|---|
| core/render/world 内部逻辑 | 多数可以，需 adapter 检查 |
| 新方块/配方/世界生成 | 多数可以 |
| 新 UI 页面 / CSS / DOM 结构 | **不能自动生效，必须迁 UI Kit** |
| 新浏览器 API | 必须先补 platform 垫片 |
| 平台/微信构建代码 | 永远保留 v2 |
| package/CI | 人工合并 |

## 5. 禁止事项

- 禁止把 `wxminigame-v2` 整体 merge 回 `main`。
- 禁止为了“先跑起来”在 `core/render` 里写 `wx.*`。
- 禁止用 main 的 `src/ui/**` 覆盖小游戏 UI。
- 禁止跳过 adapter 风险扫描直接合并。
- 禁止把 Web 的 CSS 原样塞进 Canvas UI。

## 6. Definition of Done

一次同步完成必须同时满足：

- [ ] `sync:audit` 无未解释的 `CORE` 风险
- [ ] `UI` 分类每一项都有迁移结论
- [ ] `PLATFORM` 未被 main 覆盖
- [ ] `typecheck`、`build:minigame:world`、`check:fast` 通过
- [ ] Web `check` / `build:fast` 通过
- [ ] `test:minigame:flow` PASS
- [ ] `WXMINIGAME.md` 已记录
- [ ] 小游戏包仍 <4MB
