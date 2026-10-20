# WXMINIGAME · 微信小游戏移植任务表

> 本文件是 `wxminigame` 分支的**唯一进度口径**。
> **不要**把这里的状态写进 `TASKS.md` / `HANDOFF.md` / `.codebuddy/auto-continue.md`
> —— 那三份是主线（`main`）的口径，两边混用必然冲突。

---

## 0. 基本信息

| 项 | 值 |
| --- | --- |
| 本 worktree | `/Users/mason/DouDou/minicraft-ai-web-wxminigame` |
| 本分支 | `wxminigame`（从 `main@60a5240` 拉出） |
| 主线 worktree | `/Users/mason/DouDou/minicraft-ai-web`（`main`，继续推进自己的队列） |
| 任务 ID | `WX-NNN`，与主线“批次 NNN”完全隔离 |
| 提交前缀 | `WX-NNN: ...` |
| 状态记号 | `[ ]` 待办 · `[~]` 进行中 · `[x]` 完成 · `[!]` 阻塞 |

**目标**：把现有 Web 游戏移植成**微信小游戏**，保留 `src/core` 的游戏逻辑，
重写 UI 与平台层；微信跑通后再单独评估抖音。

**MVP 范围**：单机、横屏、生存/创造、世界生成、背包/合成/工作站、存档、设置。  
**暂不做**：联机、资源包、手柄、PWA/全屏、诊断导出、抖音（放到 M6）。

---

## 1. 五条硬性约定

1. **只在本 worktree 改代码**。主工作区当前有未提交改动（3 个下界生成文件），不要碰。
2. **不改主线文档**：`TASKS.md`、`HANDOFF.md`、`.codebuddy/auto-continue.md`、
   `.codebuddy/auto-continue-archive.md` 一律不动。
3. **一个任务一个提交**：提交信息以 `WX-NNN:` 开头，正文写清“为什么”，方便逐条回滚。
4. **新代码优先放新目录**，不要改主线正在改的文件（见 §3 冲突策略）。
5. **定期合并 main**：每 3~5 个任务或每周一次；合并后跑 `npm run check:fast`，
   里程碑结束时跑 `npm run check`。

---

## 2. 架构隔离（决定后面好不好合并）

### 2.1 目录约定

```
src/platform/            # 平台接口 + 各平台实现（新增）
  types.ts               # Platform / Canvas / Storage / FileStore / Audio /
                         # WorkerHost / Input / Lifecycle / Socket / Keyboard
  web/                   # 浏览器实现（保持现有行为，供 Web 版继续用）
  wx/                    # 微信小游戏实现
  tt/                    # 抖音（M6 再加）
src/minigame/            # 小游戏入口 + canvas UI（新增）
  main.ts                # 正式入口（WX-010 起）
  spike/                 # WX-001 技术验证（验完可删）
  ui/                    # canvas UI 工具包与各界面
minigame/                # game.json / project.config.json / game.js 产物（新增）
tools/minigame/          # 小游戏构建与校验（build-spike.mjs / build.mjs）
```

原则：**平台差异只允许出现在 `src/platform/**`**；
`src/core/**` 保持平台无关，UI 通过 `UiPort` 注入。

### 2.2 冲突热点文件

| 文件 | 处理方式 |
| --- | --- |
| `src/main.ts`（14,400 行） | 只做“导出 App + 条件启动 + 抽 `UiPort`”的最小改动；小游戏逻辑写到 `src/minigame/**` |
| `src/ui/**` | 视为 Web UI，保持原样；小游戏 UI 全部新写在 `src/minigame/ui/**` |
| `index.html`（4,383 行） | 不改；小游戏不用 HTML |
| `src/core/**` | 尽量零改动；必须改时单独提交并标 `[core]`，登记到 §8 风险表 |
| `package.json` | 只**追加**脚本，不改已有脚本、不整段重排 |
| `TASKS.md` / `HANDOFF.md` / `.codebuddy/auto-continue.md` | **禁止修改** |

### 2.3 合并策略

- 用 `merge`，**不要 rebase**（分支会推送，rebase 会改写历史）。
- 合并命令：

```bash
cd /Users/mason/DouDou/minicraft-ai-web-wxminigame
git fetch origin
git merge origin/main
npm run check:fast
```

- 冲突裁决：
  - 业务逻辑以 `main` 为准；
  - `src/platform/**`、`src/minigame/**` 以本分支为准；
  - `src/main.ts` 逐段看：主线新增逻辑保留，本分支只保留“接口 + 启动分支”。
- 超过 30 分钟仍判断不了时，**停下来记到 §8**，不要猜。

### 2.4 最终回流

本分支对 `src/core`、`src/main.ts` 的通用改进（UiPort、存储接口等）在稳定后
**单独 cherry-pick 回 `main`**；不要整分支合并回 `main`，
`main` 不包含 wx 构建产物与平台代码（除非以后决定双端共存）。

---

## 3. 里程碑

| 里程碑 | 目标 | 出口条件 |
| --- | --- | --- |
| **M0 可行性** | 证明 three r186 + WebGL2 + Worker + 图集在真机能跑 | 中低端 Android ≥30fps、内存不炸、Go |
| **M1 平台层** | 小游戏能启动到主菜单 | `game.js` 起得来；存档/音频/输入可用 |
| **M2 UI 基础** | 菜单 + HUD + 背包闭环 | 能新建世界、进世界、挖放方块、开关背包 |
| **M3 内容对齐** | 工作站/配方书/成就/地图等 | MVP 界面全覆盖 |
| **M4 稳定** | 性能/内存/存档/真机矩阵 | 连续玩 30 分钟不崩、不丢档 |
| **M5 提审** | 包体/合规/材料 | 能提交审核 |
| **M6 抖音** | WebGL1 可行性 + 适配 | 单独 Gate，不阻塞微信 |

---

## 4. 任务表

> 估算单位：**人日**（按 6 小时有效工作计），不含审核/版号等待。

### M0 · 可行性门禁（Go / No-Go）

| ID | 任务 | 验收 / 产出 | 依赖 | 人日 | 状态 |
| --- | --- | --- | --- | --- | --- |
| WX-000 | 建立 worktree/分支/任务表；关闭本 worktree 的 auto-continue | 本文件 + `AGENTS.md` 提示 + `.codebuddy/auto-continue.off` | — | 0.5 | [x] |
| WX-001 | 微信小游戏最小工程 | `minigame/` 能导入开发者工具；three r186 画出单区块 | WX-000 | 2 | [~] |
| WX-002 | 真机基线测量 | 帧率/帧时间/内存峰值/启动耗时/webgl2/包体，写入 §7 | WX-001 | 2 | [ ] |
| WX-003 | Worker 打包与通道验证 | 单 worker 能加载，复制 vs Transferable 的耗时数据 | WX-001 | 1.5 | [ ] |
| WX-004 | 图集与 2D canvas 验证 | `TextureAtlas` 的 createImageData/putImageData/drawImage 可用 | WX-001 | 1 | [ ] |
| WX-005 | Go/No-Go 结论与性能预算 | 结论写进 §7；不达标则给出降级方案 | WX-002~004 | 0.5 | [ ] |

### M1 · 平台层

| ID | 任务 | 验收 / 产出 | 依赖 | 人日 | 状态 |
| --- | --- | --- | --- | --- | --- |
| WX-010 | 小游戏构建体系 | `tools/minigame/build.mjs`（esbuild 多入口）+ worker IIFE 产物 | WX-005 | 2 | [ ] |
| WX-011 | 平台接口与探测 | `src/platform/types.ts` + `wx/tt/web` 探测；Web 版行为不变 | WX-010 | 1 | [ ] |
| WX-012 | canvas / system / lifecycle | 上屏/离屏 canvas、DPR、安全区、横屏、onShow/onHide | WX-011 | 2 | [ ] |
| WX-013 | 输入适配 | `wx.onTouch*` → pointer 事件；多点、摇杆、视角 | WX-012 | 2 | [ ] |
| WX-014 | storage 适配 | `localStorage` → `wx.setStorageSync`；设置/世界清单/诊断 | WX-011 | 1 | [ ] |
| WX-015 | FileSystem 封装 | 原子写（临时文件 + rename）、目录/配额/错误处理 | WX-011 | 2 | [ ] |
| WX-016 | 存档适配 | IndexedDB 7 个仓 → 文件；`SaveGame` API 不变 | WX-015 | 3 | [ ] |
| WX-017 | 音频适配 | `AudioContext` → `wx.createWebAudioContext()` | WX-011 | 1 | [ ] |
| WX-018 | Worker 适配 | 合并“生成池 + 网格池”为单 worker 队列；消息复制 | WX-013 | 2 | [ ] |
| WX-019 | 网络适配（可后置） | `WebSocket` → `wx.connectSocket`；wss + 域名白名单 | WX-011 | 1 | [ ] |
| WX-01A | 键盘/文本输入 | `wx.showKeyboard` 支撑聊天、告示牌、世界名 | WX-013 | 1 | [ ] |
| WX-01B | 资源包降级 | `DecompressionStream` 不可用时关闭 K4，不报错 | WX-011 | 1 | [ ] |
| WX-01C | 平台层离线测试 | 用假实现跑 Node 测试，覆盖存储/输入/生命周期 | WX-014~017 | 1 | [ ] |

### M2 · UI 基础（闭环）

| ID | 任务 | 验收 / 产出 | 依赖 | 人日 | 状态 |
| --- | --- | --- | --- | --- | --- |
| WX-020 | 抽 `UiPort` + App 条件启动 | `main.ts` 只加导出与启动分支；Web 版回归通过 | WX-010 | 3 | [ ] |
| WX-021 | UI 工具包 A | 面板/按钮三态/文字/图标/基础布局（9-slice、像素风） | WX-020 | 3 | [ ] |
| WX-022 | UI 工具包 B | 滚动/页签/滑块/开关/输入框 | WX-021 | 2 | [ ] |
| WX-023 | UI 工具包 C | 槽位/拖拽/长按 Tooltip/Toast/进度条 | WX-021 | 3 | [ ] |
| WX-024 | 主菜单 | 首页/世界列表/新建世界（含删除确认） | WX-022 | 2 | [ ] |
| WX-025 | 加载/错误/暂停/设置 | 加载遮罩、不支持设备、竖屏提示、暂停菜单、设置页 | WX-022 | 3 | [ ] |
| WX-026 | HUD | 生命/饥饿/氧气/护甲/经验/快捷栏/准星/破坏进度/Boss 条 | WX-023 | 2 | [ ] |
| WX-027 | 触摸控件 | 摇杆/跳跃/飞行/潜行/攻击/放置/快捷栏 | WX-013, WX-026 | 3 | [ ] |
| WX-028 | 背包 + 2×2 合成 + 创造栏 | 拿起/放下/合并/交换/快速移动/丢弃 | WX-023 | 3 | [ ] |
| WX-029 | 工作台 + 配方书 | 3×3 合成、可做列表、点配方填格 | WX-028 | 3 | [ ] |

### M3 · 内容对齐

| ID | 任务 | 验收 / 产出 | 依赖 | 人日 | 状态 |
| --- | --- | --- | --- | --- | --- |
| WX-030 | 熔炉 / 箱子 | 火焰与进度、容器内容、快捷移动 | WX-029 | 3 | [ ] |
| WX-031 | 附魔 / 铁砧 / 砂轮 / 锻造 / 酿造 | 五个工作站的槽位与规则对齐原版 | WX-030 | 4 | [ ] |
| WX-032 | 成就树 | 分类/连线/已达成/奖励提示 | WX-022 | 2 | [ ] |
| WX-033 | 地图 / 书 / 信标 | 三块独立界面 + 触摸滚动 | WX-022 | 2 | [ ] |
| WX-034 | 告示牌 / 聊天 | `wx.showKeyboard`、四行文本、发送/关闭 | WX-01A | 2 | [ ] |
| WX-035 | 死亡 / 睡觉 / 伤害闪屏 / 提示 | 遮罩、重生、提前起床、HUD 提示 | WX-026 | 2 | [ ] |
| WX-036 | 全量接线 | App 主循环不再直接触 DOM；`grep document` 仅剩平台层 | WX-024~035 | 3 | [ ] |
| WX-037 | 触屏细节对齐 | 长按、双击、拖拽阈值、摇杆死区、边缘手势 | WX-027 | 2 | [ ] |

### M4 · 稳定与性能

| ID | 任务 | 验收 / 产出 | 依赖 | 人日 | 状态 |
| --- | --- | --- | --- | --- | --- |
| WX-040 | 帧率 / 视距 / 锁帧 | 30/60fps 档位、自适应降视距、帧时间曲线 | WX-036 | 3 | [ ] |
| WX-041 | 内存 / 区块生命周期 | `onMemoryWarning`、远处卸载、纹理释放 | WX-040 | 3 | [ ] |
| WX-042 | 存档健壮性 | 杀进程、写一半、版本迁移、备份恢复 | WX-036 | 2 | [ ] |
| WX-043 | 错误兜底 / 诊断 | 黑屏兜底、错误日志落文件、可导出 | WX-036 | 1 | [ ] |
| WX-044 | 真机矩阵回归 | 低端 Android / 旗舰 Android / 旧 iPhone / 新 iPhone | WX-040~043 | 4 | [ ] |
| WX-045 | Web 版回归 | `npm run check` 全过；`npm run build` 产物不变 | WX-036 | 1 | [ ] |

### M5 · 提审

| ID | 任务 | 验收 / 产出 | 依赖 | 人日 | 状态 |
| --- | --- | --- | --- | --- | --- |
| WX-050 | 包体 / 首包 / 启动优化 | 主包 ≤4MB、启动耗时有数、分包策略 | WX-044 | 2 | [ ] |
| WX-051 | 合规 / IP 清单 | 改名、去 Minecraft 商标、软著、ICP 备案、类目/版号判断 | WX-044 | 2 | [ ] |
| WX-052 | 提审与审核修复 | 提交包、隐私政策、审核意见逐条修复 | WX-050~051 | 3 | [ ] |

### M6 · 抖音（独立 Gate）

| ID | 任务 | 验收 / 产出 | 依赖 | 人日 | 状态 |
| --- | --- | --- | --- | --- | --- |
| WX-060 | 抖音 WebGL2 技术门禁 | `tt.createCanvas().getContext('webgl2')` 实测；three 0.162 降级可行性 | 微信稳定 | 3 | [ ] |
| WX-061 | 抖音平台适配 | `tt.*` 实现 `src/platform/tt/**` | WX-060 | 4 | [ ] |
| WX-062 | 抖音构建 / UI 差异 | game.json、单 worker、包体、屏幕适配 | WX-061 | 3 | [ ] |
| WX-063 | 抖音真机回归 | 帧率/内存/存档/输入 | WX-062 | 2 | [ ] |

### 持续任务

| ID | 任务 | 验收 / 产出 | 节奏 | 状态 |
| --- | --- | --- | --- | --- |
| WX-090 | 合并 `origin/main` + 冲突处理 | 合并后 `check:fast` 通过；冲突结论记 §8 | 每 3~5 个任务 / 每周 | [~] |
| WX-091 | 通用改动回流 `main` 评估 | 列出可 cherry-pick 的提交 | 每个里程碑 | [ ] |

**总量**：约 **106 人日**（≈ 5 个月单人；2~3 人并行约 3~4 个月，UI 是瓶颈）。
不含审核/版号等待。

---

## 5. 单条任务的执行模板

```bash
cd /Users/mason/DouDou/minicraft-ai-web-wxminigame

# 1. 选一个依赖已满足的 [ ]，改成 [~]，写一句“这次要做什么”
# 2. 实现
npm run check:fast      # typecheck + 单测 + 命中的离线套件
npm run build:fast      # 确认 Web 版能出包
npm run build:minigame  # 确认小游戏产物能生成（minigame/game.js）

# 3. review diff（架构 / 回归 / 平台差异）
# 4. 提交
git add <本任务涉及的文件>
git commit -m "WX-NNN: 一句话说明"
git push

# 5. 本文件改回 [x]，在 §7 追加一行
```

**每个任务必须回答的三个问题**（review 时看）：

1. 有没有改到主线正在改的文件？如果改了，为什么不可避免？
2. 新代码是不是只落在 `src/platform/**` / `src/minigame/**` / `minigame/**`？
3. Web 版还能不能正常构建（`npm run build:fast`）？

---

## 6. 环境准备

```bash
cd /Users/mason/DouDou/minicraft-ai-web-wxminigame
npm install            # worktree 没有 node_modules
npm run dev            # 确认 Web 版仍可跑（对照用）
npm run build:minigame # 生成 minigame/game.js（WX-001 spike）
```

- 微信开发者工具：导入 `minigame/`（项目类型选**小游戏**；真机预览要把
  `project.config.json` 的 `appid` 换成自己的 AppID）。
- 本 worktree 已放 `.codebuddy/auto-continue.off`：**不要删**。
  主线的自动继续钩子指向主工作区的脚本，不关掉会按主线队列在这个 worktree 里乱跑。

---

## 7. 进度日志

| 日期 | 任务 | 结论 / 改动 | 提交 |
| --- | --- | --- | --- |
| 2026-10-20 | WX-000 | 建立 `wxminigame` worktree/分支；新增本任务表；`AGENTS.md` 加分支提示；关闭本 worktree 的 auto-continue | `5cfc584` |
| 2026-10-20 | WX-001 | 最小工程已构建：`minigame/game.js` 1170KB（gzip 207KB）；three r186 + InstancedMesh + CanvasTexture + 触摸；**待真机导入验证** | 本次提交 |

> 每次完成任务后在这里追加一行；**只写结论与数据**，不要贴大段日志。

---

## 8. 风险与悬案

| 风险 | 影响 | 应对 | 状态 |
| --- | --- | --- | --- |
| **微信 WebGL2 / 内存** | 低端 Android 可能拿不到 WebGL2 或内存不足 | WX-002 真机基线；不达标先降视距/锁 30fps | 未验证（spike 待导入） |
| **抖音 WebGL2** | 官方小游戏 canvas 只保证 WebGL1；three r186 只支持 WebGL2 | M6 单独 Gate；必要时 three 0.162 + WebGL1 适配 | 未验证 |
| **UI 工作量** | 34 个模块、约 500 个 DOM 节点、4,200 行 CSS | 先做工具包 + 闭环；MVP 砍非核心界面 | 进行中 |
| **`main.ts` 冲突** | 主线持续改 14,400 行入口 | 只做最小接口改动；每 3~5 个任务 merge 一次 | 进行中 |
| **Worker 单线程** | 生成/网格化抢一个 worker，卡顿 | 合并队列 + 分片；必要时主线程时间切片 | 未验证 |
| **存档** | 杀进程/写一半导致丢档 | 原子写 + 备份 + 迁移测试 | 未开始 |
| **IP / 合规** | “Minecraft / 我的世界 / 基岩版” 侵权风险 | 提审前改名/去商标；软著/备案并行 | 未开始 |
| **iOS 内存** | 小游戏内存上限低，易被回收 | 视距降级、纹理释放、内存警告处理 | 未验证 |
| **主线改动冲突** | `src/core` / `src/main.ts` 与主线同时改 | 先在 §8 记录，再小步合并；必要时把通用改动先回流 main | 进行中 |

---

## 9. 和主线的关系（给未来的 AI / 接手人）

- 主线仍在 `/Users/mason/DouDou/minicraft-ai-web` 的 `main` 上推进；
  本 worktree 只做 `WX-*`，**不要**读 `TASKS.md` 的 287 项来决定这里做什么。
- 本文件是这里唯一的“进行中”口径；`HANDOFF.md` 仅用于了解主线历史，不要照着它推进。
- 如果主线改了 `src/core/**` 或 `src/main.ts`，先 `git merge origin/main`，再继续当前任务。
- 如果某个 WX 任务必须改主线正在改的文件，先在 §8 记风险，再动；改完在提交正文里写明。
