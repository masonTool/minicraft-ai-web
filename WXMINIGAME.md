# WXMINIGAME · 微信小游戏移植任务表

> 本文件是 `wxminigame` 分支的**唯一进度口径**。
> **不要**把这里的状态写进 `TASKS.md` / `HANDOFF.md` / `.codebuddy/auto-continue.md`
> —— 那三份是主线（`main`）的口径，两边混用必然冲突。

---

## 0.0 铁律（2026-10-20 纠偏）

> **小程序版只做“主线 Web 已有功能的小程序化”，不新增任何需求、玩法、实体、物品、配方或限制。**
>
> 1. 任何任务先过“主线是否存在”审计；主线没有就不做、不排期。
> 2. 功能语义、数值、流程以主线为准；允许因触摸/性能重排 UI，但不能改变玩法规则。
> 3. 不额外增加世界数量上限、交互捷径、独占 Boss/物品等“小程序特色”。
> 4. 只允许平台适配：触摸输入、性能/视距、Worker、文件存档、分辨率/安全区。
> 5. 发现偏差先做减法（删除），再补主线功能；不以“新功能”填进度。

---

## 0. 当前状态（新会话 / 换设备先读这一页）

> 最后更新：2026-10-20 · 分支 `wxminigame` · 最新功能提交 `a41f490`
> 只要这一页和 §5 任务表是最新的，换会话/换机器就不会丢上下文。

### 0.1 一眼看进度

| 项 | 值 |
| --- | --- |
| 当前阶段 | M1 平台层收尾 → M2 UI |
| 当前任务 | **WX-038 界面/操作校准**（压扁、点击偏移优先） |
| 刚完成 | 规划纠偏：移除自定义 Boss「虚空守卫」；确立“只做主线功能小程序化”铁律；标记 3 世界上限/3×3 背包入口/容器整叠转移为待对齐 |
| 正式壳 | `minigame/`（压力场景，801 draw call 基线） |
| 真实世界 | `minigame-world/`（WX-020A，当前可看完整地形） |
| 平台基座 | `vendor/minigame-adapter/`（870d66f + 本分支补丁） |
| UI 方案 | 自研 canvas 工具包；**不做 DOM/CSS 全模拟**（§2.6） |

### 0.3 主线对齐审计（P0，先做减法）

| 偏差 | 小程序现状 | 处理 |
| --- | --- | --- |
| 自定义 Boss「虚空守卫」 | 主线不存在 | **已删除**，不保留实体/战斗/掉落 |
| 世界数量上限 3 | 主线无此限制 | **已取消上限**，世界列表分页浏览 |
| 3×3 由背包按钮进入 | 主线对准工作台方块使用 | **已移除捷径**，改为短按工作台打开 3×3 |
| 箱子/熔炉整叠转移 | 主线拖拽/快捷移动 | 对齐主线交互，不新增简化规则 |
| 自研主菜单/HUD/文案 | 主线中文 DOM UI | 保留触摸重排，逐项对齐信息与流程 |
| 视口/触摸基准不统一 | **已改用 window 视口并修正 UI plane 宽高比**；主菜单/HUD/快捷栏自测不再压扁 | 剩余：安全区、各面板与 Web 尺寸对照、点击偏移回归 |

> 审计期间**不排新功能**；先把上述偏差清零，再继续 WX-031/035 等主线已有项。

### 0.4 WX-038 界面/操作校准清单

| 项 | 状态 | 说明 |
| --- | --- | --- |
| 逻辑视口统一 | ✅ | screenWidth/Height → windowWidth/Height |
| UI plane 宽高比 | ✅ | 全屏层补视口比例，修复纵向压扁 |
| 快捷栏尺寸 | ✅ | 按 1024 设计宽等比缩放，槽位保持正方形 |
| HUD 布局 | ✅ | 全屏比例画布，右上/左上面板不再压缩 |
| 安全区 | ⬜ | 刘海/状态栏/底部横条 inset 映射到设计坐标 |
| 设置页尺寸/滚动 | ⬜ | 对照 Web 面板宽高、行高、点击区 |
| 背包/箱子/熔炉 | ⬜ | 对照 Web 槽位尺寸、面板位置、拖拽命中 |
| 方向/摇杆 | ⬜ | 对照 Web 摇杆半径、死区、按钮间距 |
| 点击偏移回归 | ⬜ | 四角/中心/边缘点击验证，坐标与视觉一致 |
| 多分辨率验收 | ⬜ | 844×390、750×1334、刘海屏/安全区 |

### 0.2 最近一次验证数据

| 指标 | 值 |
| --- | --- |
| 环境 | `weixin-minigame-helper`（iPhone 12/13 预览，iOS 17，SDK 3.7.1） |
| 图集 | `TextureAtlas` 209ms，256×1040 |
| 世界 | 37 chunks / 37 drawn / light 0 / queue 0 |
| 玩家 | 第一人称，出生在 `P 9,67,9 G1`（落地） |
| 交互 | 准星命中方块，黑色选中框；`SLOT 1/6` 快捷栏 |
| 存档 | `SAVE ok`；重开预览 `save ready 0 chunks player`，玩家位置成功恢复 |
| 音频 | `AUD ready`；首次触摸解锁，挖放调用材质音效 |
| 几何 | 第一人称视角约 323k triangles / 362 draw calls（视距 3，俯视） |
| 帧率 | 主线程降级：启动约 12s，稳定后 121fps / 8.3ms |
| Worker | helper 里 `wx.createWorker` 不回 pong，自动降级主线程；真机行为待复测 |

### 0.3 新会话 / 换设备接手清单

```bash
cd /Users/mason/DouDou/minicraft-ai-web-wxminigame
git fetch origin && git status -sb
npm ci
npm run typecheck
npm run test:worker
npm run check:fast
```

1. 只读本文件 **§0** 与 **§5 任务表**，不要读主线 `TASKS.md` / `HANDOFF.md` / `auto-continue.md`。
2. 当前分支是 `wxminigame`，主工作区 `/Users/mason/DouDou/minicraft-ai-web` 仍在推进 `main`，不要碰。
3. 构建：
   - `npm run build:minigame:formal` → `minigame/game.js`（压力壳）
   - `npm run build:minigame:world` → `minigame-world/game.js`（真实世界）
4. 预览：`weixin-minigame-helper` 的 `run_game` 指向 `minigame-world/`，再用 `get_logs` / `capture_screenshot`。
5. 只有在**里程碑**才请用户真机截图；日常先用 helper 自测。
6. 提交前缀 `WX-NNN:`；完成一个任务就更新 §5 状态与 §7 进度日志。

### 0.4 当前不要做

- 不要删除 `vendor/minigame-adapter/`（平台基座）。
- 不要删除 `.codebuddy/auto-continue.off`（防止主线自动队列在这个 worktree 乱跑）。
- 不要依赖适配器的假 DOM 写 UI（`getElementById` 返回占位对象）。
- 不要把构建 target 改回 ES2020（真机不支持 `??`/`?.`）。
- 不要为了“省事”把 `minigame/` 和 `minigame-world/` 合并成两个以上新工程；先收口 WX-020B。

---

## 0.5 基本信息

| 项 | 值 |
| --- | --- |
| 本 worktree | `/Users/mason/DouDou/minicraft-ai-web-wxminigame` |
| 本分支 | `wxminigame`（基于 `main`；最近一次合并 `2c4d3fc`） |
| 主线 worktree | `/Users/mason/DouDou/minicraft-ai-web`（`main`，继续推进自己的队列） |
| 任务 ID | `WX-NNN`，与主线“批次 NNN”完全隔离 |
| 提交前缀 | `WX-NNN: ...` |
| 状态记号 | `[ ]` 待办 · `[~]` 进行中 · `[x]` 完成 · `[!]` 阻塞 · `[»]` 已并入后续任务（不再单独验收） |

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
  world-boot.ts          # WX-020A 真实世界启动（图集/World/ChunkRenderer）
  main-thread-worker.ts  # Worker 不可用时的主线程降级
  ui/                    # WX-020B 起的 canvas UI 工具包与各界面
minigame/                # 正式构建壳 + 801 draw call 压力基线
minigame-world/          # WX-020A 真实世界预览工程
tools/minigame/          # 构建与校验
  build.mjs              # 正式主包
  build-world.mjs        # 真实世界主包
  formal-entry.mjs       # 正式壳入口（压力场景）
  worker-entry/          # Worker IIFE 入口 + wx shim
  test-worker-shim.mjs   # Node vm Worker 自测
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

## 2.5 适配器评估：`minigame-adapter`（870d66f）

参考项目：`references/minigame-publisher`（本地，gitignored）；
适配器源码在 `references/minigame-publisher/minigame-adapter`，
上游仓库 `git@github.com:masonTool/minigame-adapter.git`，当前版本 `870d66f`（54 个 JS，328KB）。

> 参考项目里的 `minigame-html-src` 是一个 three.js 3D 游戏（Tower Ball / moto3m），
> 它的 H5 版本**没有 DOM/CSS 界面**，所有画面都在 canvas 里。适配器就是为这种项目写的。

### 2.5.1 结论

**平台层可复用，UI 不能复用。**

| 能力 | 适配器现状 | 对本项目 |
| --- | --- | --- |
| `window` / `document` / Canvas | 有，但是**假 DOM** | 可给 three/库用，不能跑现有 UI |
| `document.getElementById` / `querySelector` | 返回 `faker` / `body` | **禁止**游戏/UI 代码依赖 |
| CSS 布局 / `getComputedStyle` | 没有（`CSSStyleDeclaration` 只处理 margin） | 4,200 行 CSS 不可复用 |
| `classList` / 滚动 / 输入框 | 没有完整实现 | 现有 `src/ui/**` 跑不起来 |
| 2D Canvas / 离屏 Canvas | 有，含 DPR、`getBoundingClientRect`、事件代理 | 可直接用 |
| WebGL2 | 不限制版本，但会包装所有 context 方法 | 可用，需测性能 |
| Image / Audio / AudioContext | 有（基于 `wx.createImage` / `createInnerAudioContext` / `createWebAudioContext`） | 音频可直接用 |
| localStorage | 有（基于 `wx.*StorageSync`） | 可直接用 |
| XHR / Fetch / Blob / FileReader / URL | 有（XHR 支持 arraybuffer、本地文件） | 资源包可复用一部分 |
| Worker | 只有 `wx.createWorker`，单 worker，无 `addEventListener` | 需补 |
| WebSocket | 没有 | 需补（联机可后置） |
| IndexedDB | 没有 | 存档仍需自己写文件适配 |
| FileSystem 封装 | 只在 XHR 内部用过 `getFileSystemManager` | 需自己封装 |
| 触摸事件 | `touchstart/move/end/cancel` | 需再加 pointer 事件 |
| 前后台 | `focus/blur/pause/resume` | 需再加 `visibilitychange` |
| 键盘 / 输入法 | 没有 | 需自己接 `wx.showKeyboard` |
| 抖音 | 没有（全是 `wx.*`） | M6 另写 `tt` 实现 |

### 2.5.2 对工期的实际影响

- 能省：Canvas/Image/Audio/localStorage/XHR/Blob/FileReader/触摸基础/前后台，
  大约 **3~5 人日**（M1 平台层从 ~19 人日降到 ~16）。
- 不能省：**UI 重写（8~12 周）**、存档文件化、Worker 改造、键盘/输入、WebSocket、抖音。
- 净影响：总量约 **106 → 108 人日**（新增适配器 spike 与补丁验证），
  但**降低了 three.js/资源加载的启动风险**，这是它最大的价值。

### 2.5.3 接入策略（推荐 B，spike 用 A）

| 方案 | 做法 | 优点 | 缺点 |
| --- | --- | --- | --- |
| A. 整包引用（只做 spike） | 从 `references/` 本地路径 import，构建一个 `game.js` | 最快验证；不提交适配器源码 | 依赖本地 references，不可复现 |
| **B. 选择性移植（正式，推荐）** | 只把需要的模块放进 `src/platform/wx/vendor/`，加补丁 | 可控；不把假 DOM 暴露给游戏/UI | 多 3~5 人日 |
| C. git submodule | 和原项目一样引 submodule | 上游同步方便 | 构建/CI 复杂，假 DOM 仍在 |

**正式实现只保留这些模块**：Canvas、Image、Audio/AudioContext、localStorage、
XHR/Fetch/Blob/FileReader/URL、TouchEvent/WxEvent、WxInfo/Screen/navigator、
Worker（改写）、xmldom（只有在需要时）。
**不保留**：Document/HTMLElement/CSSStyleDeclaration 里的“假布局”语义
——最多保留 `createElement('canvas')` 这一条，避免误以为 DOM 可用。

### 2.5.4 必做补丁清单

| # | 位置 | 问题 | 补法 |
| --- | --- | --- | --- |
| 1 | `Canvas.js` `getContext` | 对 WebGL 上下文逐个包装方法，可能拖慢 draw call | WebGL 跳过全量包装，只对 `texImage2D`/`texSubImage2D`/`drawImage` 解 `$proxyTarget` |
| 2 | `WxEvent.js` | 只有 touch 事件，没有 pointer | 由 touch 合成 `pointerdown/move/up/cancel`（带 `pointerId`、`pointerType='touch'`、`buttons`） |
| 3 | `WxEvent.js` | 没有 `visibilitychange` | `wx.onShow/onHide` 同时向 `document` 派发 `visibilitychange` |
| 4 | `window.js` | 没有 `matchMedia` | 补 `matchMedia('(pointer: coarse)').matches === true`，否则现有 `isTouchDevice()` 返回 false |
| 5 | `window.js` | 把 `WebGLRenderingContext` 换成空函数 | 真机验证 three r186 的 “WebGL1 not supported” 守卫；必要时删掉/改成 WebGL2 构造器 |
| 6 | `Worker.js` | 无 `addEventListener`、单 worker、路径是 URL 对象 | 补 `addEventListener('message')`；脚本路径改构建期常量；合并两套池子 |
| 7 | 新增 | 没有 IndexedDB / FileStore | 用 `wx.getFileSystemManager()` 写 `src/platform/wx/file-store.ts`，原子写 |
| 8 | 新增 | 没有 WebSocket | `wx.connectSocket` 包一个 `Socket` 接口（MVP 可后置） |
| 9 | 新增 | 没有键盘/输入法 | `wx.showKeyboard` + 自绘输入框（聊天/告示牌/世界名） |
| 10 | 新增 | 没有 `matchMedia`/`history` | 补最小实现，或把调用点改成平台接口 |
| 11 | `HTMLScriptElement.js` | 动态 `require(\`../${...}\`)` 会让 esbuild 扫描整个 references（含 node_modules/.git），WX-006 实测报 4292 个错 | 正式移植时删掉整个 `HTMLScriptElement`；spike 用 esbuild 插件替换成运行时抛错 |

> **落地状态（WX-010）**：#1（删动态 require）、#2（pointer）、#3（visibilitychange）、
> #4（matchMedia）、#6（Worker.addEventListener）已在 `vendor/minigame-adapter/` 内完成；
> 同时删掉了未使用的 `dom/xmldom`（CommonJS，esbuild 会告警，且本项目不用 XML）。
> #7/#8/#9 分别由 WX-016 / WX-019 / WX-01A 负责。

### 2.5.5 UI 的结论

- 适配器**不能**让 `src/ui/**` 与 `index.html` 的 CSS 直接跑起来；
  `Document` 是 fake，`getElementById` 返回一个占位节点，元素没有布局。
- 参考项目里的 `Layout` 插件（`requirePlugin('Layout')`）是一个 flexbox 风格的
  canvas UI 引擎，支持 `<view>/<text>/<image>/<scrollview>`、样式对象、`on('click')`、
  `style.transform`、ticker。它可以作为**菜单/设置/排行榜**的候选方案，
  但**不支持**完整的 CSS、拖拽物品、输入法、像素风九宫格细节；而且只有微信有。
- 因此：**核心 UI 仍按原计划自研 canvas UI 工具包**；
  `Layout` 只做一次小规模可行性验证（WX-021B），不通过就放弃。

### 2.5.6 真机结论（2026-10-20）

同一台设备，两个 spike 使用完全相同的场景：

| 版本 | 场景 | 分辨率/dpr | GL | FPS | MS | TRI | CALLS |
| --- | --- | --- | --- | --- | --- | --- | --- |
| WX-001 SHIM | 压力场景 | 793×360 / 3 | WebGL 2.0 (OpenGL ES 3.2) | 61 | 16.6 | 12720 | 801 |
| WX-006 ADAPTER | 压力场景 | 793×360 / 3 | WebGL 2.0 (OpenGL ES 3.2) | 61 | 16.6 | 12720 | 801 |

> `STRESS 799` 是 32×32 去掉中央 15×15 后的压力方块数；`CALLS 801` =
> 799 个独立 Mesh + 1 个地面 InstancedMesh + 1 个标记方块。
> 两版数字完全一致，说明适配器对 `Canvas.getContext` 的包装在 801 draw call 下
> **没有可测开销**。

**结论：Go。**

1. **采用 `minigame-adapter` 作为平台层基座**（Canvas/Image/Audio/localStorage/
   XHR/Blob/FileReader/触摸/前后台），正式实现选择性 vendored 到仓库内，固定 `870d66f`。
2. **保留** `Canvas.getContext` 的包装（实测无开销，且它负责 Image 的 `$proxyTarget` 解包）。
3. **只补以下缺口**：pointer 事件合成、`matchMedia`、`visibilitychange`、
   `HTMLScriptElement` 动态 require（删）、Worker 的 `addEventListener`/单 worker、
   IndexedDB→文件、键盘输入、WebSocket。
4. **仍然不做 DOM/CSS 模拟**（见 §2.6）；UI 走自研 canvas 工具包。
5. 内存峰值/启动耗时这两项基线还没测，放到 WX-010 正式构建后用开发者工具补；
   它们不影响 Go 结论（性能主项已达标）。

> **补充（用户确认）**：`minigame-adapter` 本身已经在其参考项目中长期验证，
> 不需要再单独做适配器验收。本次真机只验证「three r186 + WebGL2 + 适配器」这条组合。
> 因此 M0 到此关闭；Worker 与图集不再单设门禁，分别并入 WX-018 / WX-020 的开发内验证。
> 下一步直接进入 **WX-010 正式构建体系**。

---

## 2.6 为什么不做“DOM/CSS 全模拟”

> 结论：**这不是在适配器上再加一层，而是自己写一个迷你浏览器。**
> 工作量比“重写 UI”更大，且视觉/交互保真度更差，不采用。

### 2.6.1 仓库里的真实用量

`index.html` 的样式（4,199 行）里：

| 特性 | 行数 |
| --- | --- |
| `display: flex/grid/inline-flex` | 168 |
| `position: absolute/fixed/sticky` | 86 |
| `@keyframes` / `transition` / `animation` | 58 |
| `box-shadow` / `gradient` / `clip-path` / `border-radius` / `image-rendering` | 203 |
| `@media` / `var(--…)` / `calc()` / `env(safe-area…)` | 374 |
| `:hover` / `:active` / `::before` / `::after` / `:not()` / `nth-child` | 77 |
| `overflow` / `scroll` | 100 |
| `text-overflow` / `white-space` / `font-family` / `letter-spacing` | 52 |

`src` 里的 DOM 依赖：

| API | 次数 |
| --- | --- |
| `createElement(...)` | 473（div 284、button 55、span 50、**canvas 31**、i/b 26、input 11、select/option 6…） |
| `classList` | 331 |
| `textContent` | 261 |
| `addEventListener` | 200 |
| `querySelector` | 30 |
| `getBoundingClientRect` | 18 |
| `clientWidth/Height`、`offsetWidth/Height` | 15 |
| `scrollTop` / `scrollLeft` | 9 |
| `innerHTML` | 10 |

### 2.6.2 为什么这比“重写 UI”更贵

1. **CSS 不是“样式表”，是布局约束**：168 处 flex/grid + 86 处绝对定位 +
   19 个媒体查询 + 374 处变量/calc/safe-area，必须有级联、选择器匹配、
   响应式断点和计算值，否则面板会错位。
2. **31 个 `<canvas>` 子元素**：物品图标是“每格一个 canvas 再 drawImage”。
   DOM 模拟层必须知道每个 canvas 的布局位置、裁剪、z 序、重绘时机；
   这不是 appendChild 能解决的。
3. **交互不是 click**：拖拽物品、长按 Tooltip、滚轮/滑动列表、输入法、
   `pointer` 捕获、`elementFromPoint`，都要重新实现命中测试与事件分发。
4. **调试成本**：一旦视觉不对，很难判断是 CSS 解析、布局、绘制还是 canvas 合成；
   这类问题会以“某个界面在某个分辨率下差 2px”的形式长期存在。
5. **适配器只完成了 10%**：它给了 `Element/Node/EventTarget` 树和
   `Canvas/Image/Audio`，但 `CSSStyleDeclaration` 只处理 `margin`，
   `getElementById` 返回 faker，没有 layout/paint/scroll/input。

### 2.6.3 工作量估算（只做“够用子集”）

| 模块 | 人日 |
| --- | --- |
| DOM 树 + API（createElement/appendChild/classList/style/textContent/querySelector/getBoundingClientRect） | 5~8 |
| CSS 解析 + 级联 + 变量 + 媒体查询 | 10~15 |
| 布局（flex / grid / absolute / fixed） | 15~25 |
| 绘制（边框/圆角/渐变/阴影/伪元素/文本换行/图片） | 10~15 |
| 事件/命中测试/滚动/输入法 | 10~15 |
| 31 个子 canvas 合成 + 拖拽层 | 5~8 |
| 把 4,200 行 CSS + 34 个界面调到可用 | 20~30 |
| **合计（子集）** | **75~110 人日（3.5~5 个月）** |

- 完整 DOM/CSS 引擎：**6~12 个月**，而且没法保证和浏览器一致。
- 自研 canvas UI 工具包 + 界面重写：**40~60 人日（8~12 周）**，
  可控、跨平台（微信/抖音），是我们选的路。

### 2.6.4 如果一定要保留“DOM 写法”

可以做一个**API 像 DOM、但不解析 CSS** 的 canvas UI 工具包：
`createElement/appendChild/classList/style/textContent` 都有，样式只接受
一个**明确的样式对象**（不是 CSS 字符串），布局只支持我们真正用到的
flex/absolute/grid 子集。

- 工具包本身约 **3~4 周**；
- 仍然要把 4,200 行 CSS 手工翻译成样式对象/主题表；
- 好处是界面代码的“形状”不用大改，坏处是 CSS 不能直接复用。

这条可以作为 WX-021 的备选实现方式，但**不要**去做 CSS 解析器。

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
| WX-001 | 微信小游戏最小工程 | `minigame/` 能导入开发者工具；three r186 画出单区块 | WX-000 | 2 | [x] |
| WX-002 | 真机基线测量 | 帧率/帧时间/webgl2/压力场景已测；真实游戏的内存/启动并入 WX-041 | WX-001 | 2 | [x] |
| WX-003 | Worker 集成验证 | 不再单设门禁：并入 WX-018（单 worker、复制 vs Transferable、两池合并） | WX-001 | 1.5 | [»] |
| WX-004 | 图集 / 2D canvas 验证 | 不再单设门禁：并入 WX-020（首次真实启动时验证 TextureAtlas 全路径） | WX-001 | 1 | [»] |
| WX-006 | `minigame-adapter` 接入 spike | 从 `references/` 引入适配器 + three r186，构建第二份 `game.js`；与 WX-001 对比帧率/兼容性 | WX-001 | 2 | [x] |
| WX-007 | 适配器取舍与补丁清单 | 决定整包/选择性移植；确认 §2.5.4 的补丁是否都必要，写入 §7 | WX-006 | 1 | [x] |
| WX-005 | Go/No-Go 结论与性能预算 | 结论写进 §7；不达标则给出降级方案 | WX-002~004, WX-006~007 | 0.5 | [x] |

### M1 · 平台层

| ID | 任务 | 验收 / 产出 | 依赖 | 人日 | 状态 |
| --- | --- | --- | --- | --- | --- |
| WX-010 | 小游戏构建体系 | vendored 适配器 + esbuild IIFE + ES2017 + 4MB/语法检查；worker 产物并入 WX-018 | WX-005 | 2 | [x] |
| WX-011 | 平台接口与探测 | `src/platform/types.ts` + `wx/tt/web` 探测；Web 版行为不变 | WX-010 | 1 | [x] |
| WX-012 | canvas / system / lifecycle | 复用适配器 Canvas/WxInfo/WxEvent；补 `visibilitychange`、`matchMedia`、安全区 | WX-011 | 1.5 | [x] |
| WX-013 | 输入适配 | 适配器 touch 之上合成 pointer；左摇杆/右视角/跳跃已用平台 pointer 验证 | WX-012 | 1.5 | [x] |
| WX-014 | storage 适配 | 复用适配器 `localStorage`；`asDomStorage`/JSON 辅助已就绪；设置/世界清单接线在 WX-020/025 | WX-011 | 0.5 | [~] |
| WX-015 | FileSystem 封装 | 原子写（临时文件 + rename）、目录/配额/错误处理 | WX-011 | 2 | [x] |
| WX-016 | 存档适配 | `FileSaveGame` 已在 `minigame-world` 接线：玩家/快捷栏/区块增量落盘，重开恢复；15s 自动保存 + 切后台保存 | WX-015 | 3 | [x] |
| WX-017 | 音频适配 | `AudioEngine` 注入 `createWebAudioContext`；挖放音效已接，HUD `AUD ready`；真机音色待听 | WX-011 | 0.5 | [x] |
| WX-018 | Worker 适配 | `workers/chunk.worker.js` + wx shim；`World`/`MeshWorkerPool` 支持 `createWorker` 注入；同一路径共享 host + 多订阅 | WX-013 | 2 | [x] |
| WX-019 | 网络适配（可后置） | 平台 `wx.connectSocket` 已实现；`NetClient` 接线可后置 | WX-011 | 1 | [~] |
| WX-01A | 键盘/文本输入 | 平台 `wx.showKeyboard` 已实现；聊天/告示牌/世界名接线在 WX-034 | WX-013 | 1 | [~] |
| WX-01B | 资源包降级 | `canReadResourcePacks()` 已加；UI 隐藏/降级在 WX-025 | WX-011 | 1 | [x] |
| WX-01C | 平台层离线测试 | 平台单测 10 个（探测/存储/文件/DOM 适配/文件存档） | WX-014~017 | 1 | [x] |

### M2 · UI 基础（闭环）

| ID | 任务 | 验收 / 产出 | 依赖 | 人日 | 状态 |
| --- | --- | --- | --- | --- | --- |
| WX-020A | 真实世界启动（无 UI） | `minigame-world`：图集/材质/World/ChunkRenderer；helper 预览已出完整地形，worker 超时自动降级主线程 | WX-018 | 3 | [x] |
| WX-020B | 抽 `UiPort` + App 条件启动 | 独立 `src/minigame/main.ts`（未改 Web `main.ts`，避免 14k 行 UI 进包）、`MiniGameUi`、快捷栏、9×3 背包、真实 41 格 Inventory（放置消耗/挖掘拾取/存档） | WX-020A | 3 | [x] |
| WX-021 | UI 工具包 A | 9-slice 面板/按钮三态/文字/快捷栏/背包/暂停面板完成；滚动/输入/拖拽归 WX-022/023 | WX-020B | 3 | [x] |
| WX-021B | `Layout` 插件可行性（可选） | 用 `requirePlugin('Layout')` 做一个设置页 demo；评估文字/滚动/点击/像素风是否够用 | WX-020B | 2 | [ ] |
| WX-022 | UI 工具包 B | 页签/滑块/开关 + CONTROLS 搜索输入 + 拖动滚动列表完成 | WX-021 | 2 | [x] |
| WX-023 | UI 工具包 C | Toast/进度条/41 格/拖拽/合并/交换/长按 Tooltip 完成 | WX-021 | 3 | [x] |
| WX-024 | 主菜单 | 世界列表/切换/新建/删档完成；取消 3 个上限，分页浏览 | WX-022 | 2 | [x] |
| WX-025 | 加载/错误/暂停/设置 | 暂停/设置/生成进度 + 启动失败页 + 运行时 FATAL ERROR 完成 | WX-022 | 3 | [x] |
| WX-026 | HUD | 准星/生命/饥饿/经验 + 破坏进度 + Boss 条 UI 完成；**自定义虚空守卫已删除，等主线 Boss 移植** | WX-023 | 2 | [~] |
| WX-027 | 触摸控件 | MOVE/FLY/SNEAK/PLACE/MINE/JUMP/ATK + 摇杆/视角/长按破坏/飞行/潜行/攻击粒子完成 | WX-013, WX-026 | 3 | [x] |
| WX-028 | 背包 + 2×2 合成 + 创造栏 | 41 格/拖拽/合并/交换 + 快速移动/丢弃（掉落物实体）+ 2×2 合成 + 创造栏完成 | WX-023 | 3 | [x] |
| WX-029 | 工作台 + 配方书 | 2×2 背包合成；短按工作台方块打开 3×3；RECIPES/填格完成 | WX-028 | 3 | [x] |

> UI 方案见 §2.6：**不做 DOM/CSS 全模拟**；WX-021 用自研 canvas 工具包，
> WX-021B 只验证 `Layout` 插件是否值得用于菜单/设置。

### M3 · 内容对齐

| ID | 任务 | 验收 / 产出 | 依赖 | 人日 | 状态 |
| --- | --- | --- | --- | --- | --- |
| WX-030 | 熔炉 / 箱子 | 箱子/熔炉/持久化完成；**整叠转移是简化交互，需对齐主线拖拽/快捷移动** | WX-029 | 3 | [~] |
| WX-031 | 附魔 / 铁砧 / 砂轮 / 锻造 / 酿造 | 五个工作站的槽位与规则对齐原版 | WX-030 | 4 | [ ] |
| WX-032 | 成就树 | 分类/连线/已达成/奖励提示 | WX-022 | 2 | [ ] |
| WX-033 | 地图 / 书 / 信标 | 三块独立界面 + 触摸滚动 | WX-022 | 2 | [ ] |
| WX-034 | 告示牌 / 聊天 | `wx.showKeyboard`、四行文本、发送/关闭 | WX-01A | 2 | [ ] |
| WX-035 | 死亡 / 睡觉 / 伤害闪屏 / 提示 | 遮罩、重生、提前起床、HUD 提示 | WX-026 | 2 | [ ] |
| WX-036 | 全量接线 | App 主循环不再直接触 DOM；`grep document` 仅剩平台层 | WX-024~035 | 3 | [ ] |
| WX-037 | 触屏细节对齐 | 长按、双击、拖拽阈值、摇杆死区、边缘手势 | WX-027 | 2 | [ ] |
| WX-038 | 界面/操作校准 | 已修 window 视口 + UI plane 宽高比 + 背包/设置独占渲染；待安全区、尺寸对照、点击偏移回归 | WX-021, WX-027 | 3 | [~] |

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
| WX-092 | 适配器上游同步 | 若走 vendored 副本：对比 `masonTool/minigame-adapter` 新提交，只 cherry-pick 必要补丁 | 每个里程碑 | [ ] |

**总量**：约 **108 人日**（≈ 5 个月单人；2~3 人并行约 3~4 个月，UI 是瓶颈）。
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
npm run build:minigame:formal   # 正式壳 → minigame/game.js（压力场景）
npm run build:minigame:world    # 真实世界 → minigame-world/game.js（WX-020A）
npm run test:worker             # Node vm 模拟只读 self，验证 ping + 真实 generate
```

> ⚠️ **构建目标必须是 es2017 或更低**：微信真机 JSCore 不支持 ES2020 的
> `??` / `?.`，而开发者工具模拟器支持。症状是真机预览报
> `SyntaxError: Unexpected token ?`（示例：`game.js 25:27` 的
> `canvas.width ?? 0`）。两个 build 脚本已固定 `target: ['es2017']`；
> 以后加正式构建（WX-010）也必须守住这条。

- 微信开发者工具导入哪个目录：
  - **正式压力壳**：`minigame/`（HUD `WX-010 FORMAL`，801 draw call 基线）
  - **真实世界预览**：`minigame-world/`（HUD `WX-020 WORLD`，WX-020A）
  - 项目类型选**小游戏**（不是小程序）；两个工程的 `project.config.json` 已统一 AppID。
- 屏上已有 HUD：版本/分辨率/dpr、`GL_VERSION`、`GL_RENDERER`、`FPS/MS/TRI/CALLS`；
  真实世界还会显示 `CHUNKS/DRAWN/LIGHT/Q/WORKER`。不需要连控制台也能读基线数据。
  黑屏/启动失败会弹 `wx.showModal`，把弹窗文字发回来即可。
- 本 worktree 已放 `.codebuddy/auto-continue.off`：**不要删**。
  主线的自动继续钩子指向主工作区的脚本，不关掉会按主线队列在这个 worktree 里乱跑。

---

## 7. 进度日志

| 日期 | 任务 | 结论 / 改动 | 提交 |
| --- | --- | --- | --- |
| 2026-10-20 | WX-000 | 建立 `wxminigame` worktree/分支；新增本任务表；`AGENTS.md` 加分支提示；关闭本 worktree 的 auto-continue | `5cfc584` |
| 2026-10-20 | WX-001 | 最小工程已构建并**真机验证通过**：`minigame/game.js` 1174KB（gzip 208KB）；three r186 + InstancedMesh + CanvasTexture + 触摸；WebGL2 / 61fps（轻场景） | `f7eaeba` |
| 2026-10-20 | 适配器评估 | 结论：`minigame-adapter` 可复用于平台层，**不能**跑现有 DOM/CSS UI；新增 §2.5 与 WX-006/007 | `3878a65` |
| 2026-10-20 | WX-006 | 适配器版 `game.js` 已构建并**真机验证通过**：1303KB（gzip 235KB）；WebGL2 / 61fps（轻场景），无 `??` 语法错误 | `3878a65` |
| 2026-10-20 | WX-002 预置 | 两份 spike 加屏上 HUD（版本/GL/FPS/TRI/分辨率）；红/绿方块区分 SHIM/ADAPTER | `d8b3337` |
| 2026-10-20 | WX-021 决策 | DOM/CSS 全模拟实测需 75~110 人日（子集），决定不做；UI 走 canvas 工具包，详见 §2.6 | `2e03430` |
| 2026-10-20 | WX-002 修复 | 真机报 `Unexpected token ?`：两个 spike 构建 target `es2020 → es2017`，产物已无 `??`/`?.` | `4015bdf` |
| 2026-10-20 | WX-002 真机 | WX-001 / WX-006 均 WebGL2（OpenGL ES 3.2）、793×360 dpr3、61fps（轻场景）；适配器版无报错 | — |
| 2026-10-20 | WX-002 修正 | HUD 的 `TRI 2/CALLS 1` 是二次 render 重置 info 的统计 bug；改为主场景后抓取，并加压力场景 + `MS` 指标 | `56633a0` |
| 2026-10-20 | WX-002/006 复测 | 两版压力场景均 61fps / 16.6ms / 801 calls / 12,720 tri；`STRESS 799` 是 32×32 去掉中央 15×15；适配器无可测开销 | — |
| 2026-10-20 | WX-005/007 | **Go**；采用适配器作为平台层基座，保留 ctx 包装，只补 pointer/matchMedia/visibilitychange/HTMLScriptElement/Worker/存储/键盘/WebSocket；UI 仍自研 canvas | `5579bd8` |
| 2026-10-20 | M0 关闭 | 用户确认适配器已在参考项目验证，不再单独验收；WX-003/004 并入 WX-018/WX-020；直接进入 WX-010 | `5579bd8` |
| 2026-10-20 | WX-010 | 适配器 vendored 到 `vendor/minigame-adapter/`（870d66f）+ 5 条补丁；正式构建 1232KB / gzip 221KB，`??` 0；入口切到 vendored 适配器 | `969adba` |
| 2026-10-20 | WX-011/012 | 平台接口 + Web/微信实现：system/canvas/storage/files/lifecycle/input/audio/worker/socket/keyboard；6 个单测；入口启动时初始化平台；正式构建 1242KB / gzip 223KB | `f51a4f5` |
| 2026-10-20 | WX-014/015 | 平台 storage + wx FileStore 原子写完成；新增 `asDomStorage`/`readJson`/`writeJson`；单测 106 全过 | `adeb625` |
| 2026-10-20 | WX-016 | 新增 `FileSaveGame`：meta/player/容器/牌子/展示框/成就/区块（紧凑二进制）落文件；与 IndexedDB 版同 API；单测 108 | `948a015` |
| 2026-10-20 | WX-017 | `AudioEngine` 支持注入 AudioContext 工厂（默认行为不变）；微信端可传 createWebAudioContext；音频测试 86 通过 | `948a015` |
| 2026-10-20 | WX-018 | 真实区块 Worker 打成 `workers/chunk.worker.js`（1097KB / gzip 242KB）+ wx 全局 shim；主包合计 2339KB；入口启动时记录 BigInt 能力 | `086953c` |
| 2026-10-20 | WX-01B/01C | `canReadResourcePacks()` 能力检测；平台单测 10 个（探测/存储/文件/文件存档/DOM 适配），单元测试 108 全过 | `96ea23b` |
| 2026-10-20 | WX-018 | `World`/`MeshWorkerPool` 支持 `createWorker` 注入；wx worker 按脚本路径复用 + 多订阅；`World` 过滤非 `generated` 响应 | 本次提交 |
| 2026-10-20 | WX-020A | 新增 `minigame-world`：TextureAtlas + VoxelMaterial + World + ChunkRenderer + 共享 Worker；game.js 1929KB / worker 1097KB / 合计 3026KB；**待真机首块地形** | `92ddbde` |
| 2026-10-20 | WX-020A 修复 | 开发者工具 `self` 只读：原生 self 直接用，微信真机才桥接 `worker`；新增 `npm run test:worker`（Node vm 模拟只读 self），ping + 真实生成回包通过 | `1a63221` |
| 2026-10-20 | WX-020A 自动化 | 开发者工具 automator 可连、`Tool.getInfo` 正常，但 `App.callFunction/captureScreenshot/CDPEnable` 与 `Game.*` 全部超时：官方 automator 只覆盖小程序 App/Page，小游戏无此上下文 | `d102894` |
| 2026-10-20 | WX-020A 预览 | 改用 `weixin-minigame-helper`：真实地形出现；CHUNKS 37 / DRAWN 37 / LIGHT 0 / Q 0 / TRI ~243k / CALLS ~239；稳定后 FPS 121 / MS 8.3（worker 超时后主线程降级） | `1737c9e` |
| 2026-10-20 | 清理/看板 | 删除 WX-001 自写 shim、WX-006 适配器对比工程与旧构建脚本；正式入口/worker 目录改名；新增 §0 状态看板与接手清单 | `dbced2b` |
| 2026-10-20 | WX-020B 第一块 | 真实世界接入第一人称：`PlayerPhysics` + 平台 pointer；左摇杆/右视角/右下跳跃；helper 预览 `P 9,67,9 G1`、37 chunks、89.7k tri、98 calls、121fps | `f868573` |
| 2026-10-20 | WX-020B 第二块 | 准星射线 + 选中框 + 挖/放 + 6 格快捷栏；helper 预览 `T grass_block`、`SLOT 1/6`、229k tri / 254 calls / 119fps | `e097a6b` |
| 2026-10-20 | WX-020B 第三块 | FileSaveGame 接线：玩家/快捷栏/区块增量落盘；`FileStore.mkdir` 修复父目录；15s 自动保存 + 切后台保存；重开 `save ready 0 chunks player`；AudioEngine 挖放音效 | `db58faa` |
| 2026-10-20 | WX-021 开始 | 新增 canvas 快捷栏组件：6 格真实图集图标、白框选中；helper 截图确认底部快捷栏 | `5d06bb6` |
| 2026-10-20 | WX-020B 第四块 | 抽出 `MiniGameUi`（HUD/快捷栏/背包）；右上角背包入口；9×3 面板、点选/点外关闭；helper 临时默认打开截图验证布局 | `21a74a5` |
| 2026-10-20 | WX-020B 第五块 | 新增独立小游戏入口 `src/minigame/main.ts`：先注入适配器再启动 world-boot，不把 14k 行 Web UI 打进小游戏包；build-world 切到该入口，helper 复测 37 chunks/121fps/存档正常 | `9ed3ae1` |
| 2026-10-20 | WX-020B 收口 | 真实 41 格 `Inventory`：读档恢复、空槽补 64 起始方块、放置扣数量、挖掘进背包、存档写回真实槽位；helper `save ready ... player` / `saved` 正常 | `04ede23` |
| 2026-10-20 | WX-021 基础件 | 新增 widgets.ts：9-slice 面板、按钮三态、文字截断/对齐；背包改用面板 + X 按钮；HUD 右上角显示可点击 BAG；helper 截图验证 | `e51ea8d` |
| 2026-10-20 | WX-021/025 | 暂停面板：PAUSED/RESUME/SAVE NOW/SETTINGS(禁用)；MENU/BAG 分开；暂停冻结移动/跳跃；helper 截图验证 | `edfe4ce` |
| 2026-10-20 | WX-022/025 | 设置页：VIDEO/GAME 页签、FOV/视距滑块、声音/反转视角开关、BACK；设置实时改相机/视距/音频；SETTINGS 启用；helper 截图验证 | `8b461d5` |
| 2026-10-20 | WX-023/025 | Toast + 世界生成进度；挖到方块/手动保存/保存失败/空槽提示；存档 `wx list` 路径修复（有区块增量时不再 SAVE off） | `dc91533` |
| 2026-10-20 | WX-023/028 | 41 格背包 UI：9×5、数量、快捷栏 9 格、点快捷栏选中/点物品交换；helper 截图验证 | `ea1e80f` |
| 2026-10-20 | WX-024 开始 | 启动主菜单壳：BEDROCK / PLAY / SETTINGS / NEW WORLD 占位；世界后台生成，菜单独占渲染；PLAY 关闭、SETTINGS 返回菜单 | `5b535e7` |
| 2026-10-20 | WX-026 开始 | HUD 状态层：准星、生命/饥饿图标、HP/FOOD、护甲/氧气、经验条；helper 截图验证 | `c9ca496` |
| 2026-10-20 | WX-022 收口 | CONTROLS 页签：搜索框接 wx.showKeyboard、拖动滚动列表（4 行可见/滚动条）、操作说明；WORLD-INPUT down/move/up 转发；helper 截图验证 | `4a39351` |
| 2026-10-20 | WX-023 拖拽 | 背包按下/拖动/松开：空格移动、同类合并（maxStackOf）、异类交换；拖动时物品图标跟随手指；world-boot 转发 inventory move/up | `dcf0f06` |
| 2026-10-20 | WX-026 破坏 | 右半屏中间按住 0.6s 破坏，准星下方进度条；拖动视角/打开菜单取消；完成进背包并存档 | `ac41486` |
| 2026-10-20 | WX-027 控件 | 可见触摸层：左下 MOVE 摇杆提示、右侧 PLACE/MINE/JUMP 圆形按钮；位置避开生命/饥饿；helper 截图验证 | `3099a1e` |
| 2026-10-20 | WX-027 飞行 | FLY 按钮切换飞行、JUMP 按住上升，飞行状态写入存档；生命/饥饿右移避开摇杆 | `96ad5e7` |
| 2026-10-20 | WX-027/024 | SNEAK 按钮切换潜行；主菜单显示 `MY WORLD · SEED · EDITS`；helper 截图验证 | `03944ae` |
| 2026-10-20 | WX-028 创造栏 | 背包底部 CREATIVE 切换 45 格方块调色板，点方块给 64 个并保存；SNEAK 字号修正；helper 截图验证 | `6d3c567` |
| 2026-10-20 | WX-028 合成 | 背包右侧 2×2 合成：点格取当前快捷栏 1 个/退料，点产物合成，关闭时余料退回；helper 截图验证布局 | `6f866f6` |
| 2026-10-20 | WX-024 删档 | 主菜单 DELETE SAVE：showModal 确认后 clear player/meta/chunks 并停保存；修 clear/deleteWorld 不递归 chunks 的问题；helper 截图验证菜单布局 | `25f9f76` |
| 2026-10-20 | WX-024 新世界 | 主菜单 NEW WORLD：生成新种子写 `wx.worldSeed`、清档、尝试 `exitMiniProgram`；world-boot 启动读该种子；helper 截图验证菜单 | `51a7949` |
| 2026-10-20 | WX-028 收口 | 背包 QUICK 快速移到主背包、DROP 1 生成带重力/落地/近距离拾取的小方块实体；WX-028 交互项完成 | `03f0bc3` |
| 2026-10-20 | WX-024 列表 | `wx.worlds` 注册表 + `wx.worldId` 当前世界：主菜单最多 3 卡片、切换保存后退出、NEW WORLD 新增、DELETE SAVE 清当前；启动按世界 ID/种子打开存档 | `a03157e` |
| 2026-10-20 | WX-023 收口 | 快捷栏长按显示当前物品名；背包长按 500ms 在槽位旁显示方块名，1.2s 消失，拖动/关闭取消 | `0c0b0f0` |
| 2026-10-20 | WX-029 开始 | 背包 2×2/3×3 合成切换：两个 CraftingGrid、动态格子/产物位置、3x3 TABLE/2x2 BAG 按钮；关闭时两个网格余料都退回；helper 截图验证 3×3 布局 | `d16bcde` |
| 2026-10-20 | WX-029 配方书 | RECIPES 页：用当前 41 格统计 canCraft，列出最多 6 条可做配方；点条目经 craftFromInventory 直接扣料出成品；helper 截图验证列表 | `634c3fb` |
| 2026-10-20 | WX-027 收口 | 右侧 ATK 按钮（MINE 左侧）+ 命中粒子：攻击准星目标喷 6 个小方块，破坏完成也喷；WX-027 完成 | `64cca61` |
| 2026-10-20 | WX-025 错误页 | 帧循环加 try/catch：异常时 setError 显示 FATAL ERROR 面板并停止循环；错误状态只渲染错误页，避免被加载遮罩盖住；临时注入异常截图验证 | `6d1b6fc` |
| 2026-10-20 | WX-024 删世界 | DELETE WORLD：清当前世界文件并从 wx.worlds 移除卡片，切到剩余世界（没有则重建默认），写 storage 后退出重进 | `90a9392` |
| 2026-10-20 | WX-026 Boss 条 | stats/UI 增加 setBoss：名称内嵌血条、位于生命图标下方/快捷栏上方；临时显示 WITHER 截图自测后移除默认触发 | `3b2cd00` |
| 2026-10-20 | WX-029 工作台 | 3×3 进入前扫描玩家 4 格内工作台方块；没有则 Toast `STAND NEAR CRAFTING TABLE`，不允许切换 | `6144ca2` |
| 2026-10-20 | WX-029 收口 | RECIPES 点配方：按 `recipeGridSize` 切 2×2/3×3（3×3 检查工作台），`takeItem` 从真实 41 格扣料，`recipePlacement` 填格后回合成面板；材料不足回滚 | `d41c4c7` |
| 2026-10-20 | WX-030 箱子 | 新增 27 格箱子界面：准星中间短按箱子打开，点箱子格取整叠到背包、点快捷栏格放入箱子；箱子独占渲染隐藏重复快捷栏 | `da2da4b` |
| 2026-10-20 | WX-030 熔炉 | 新增 3 格熔炉界面：原料/燃料/产物、火焰/进度、快捷栏放料；Furnace.tick 逐帧推进，打开的炉子持续烧炼；短按熔炉打开 | `ec914a3` |
| 2026-10-20 | WX-030 持久化 | 读档 `restoreContainers(await save.loadContainers())`，存档 `serializeContainers(world.containers)` 写 `containers.json`；helper 日志 `saved ... 0 containers` 正常；WX-030 收口 | `0a1a6fb` |
| 2026-10-20 | WX-025 收口 | 新增 `boot-error.ts`：boot 失败用已创建渲染器画“启动失败”页（简短原因 + 退出重进提示），堆栈只写控制台；渲染器不可用回退 showModal；临时抛错截图验证 | `804765c` |
| 2026-10-20 | WX-026 Boss | 虚空守卫：正前方 12 格悬浮方块、被动不主动攻击；ATK 命中后仇恨、追击、近身 1 伤害；Boss 条同步，死亡掉落萤石；生命改为可变并写存档；helper 截图验证 | `a82e749` |
| 2026-10-20 | 规划纠偏 | 铁律：只做主线功能小程序化，不新增玩法/实体/限制；删除自定义 Boss「虚空守卫」；审计标记 3 世界上限、3×3 背包入口、容器整叠转移待对齐 | `5bc3e1c` |
| 2026-10-20 | P0 主线对齐 | 取消世界 3 个上限，世界列表分页；移除背包 `3x3 TABLE` 捷径，改为短按工作台方块打开 3×3；背包打开时冻结玩家 | `a10ba8f` |
| 2026-10-20 | WX-038 压扁修复 | 逻辑视口从 screen 改 window；全屏 UI plane 补视口宽高比（2*(H/W)*(W/H)）；HUD 改全屏比例画布；快捷栏按 1024 设计宽缩放并保持正方形槽位；helper 截图自测主菜单/HUD/快捷栏 | `a41f490` |
| 2026-10-20 | WX-038 独占渲染 | 背包/设置打开时只渲染自身，隐藏底层 HUD/快捷栏/触屏按钮；helper 截图确认背包比例与层叠关系 | 本次提交 |
| 2026-10-20 | UI 视觉优化 | 面板/按钮渐变+冷色高光；HUD 从全宽黑条改紧凑面板；快捷栏/背包槽位渐变；主菜单加宽、标题下划线、拉开按钮间距；helper 截图自测 | `6f07fbb` |
| 2026-10-20 | 对齐网页版 | 对照 Web 截图：主菜单改 `MINECRAFT` + 绿色徽章 + 中文按钮；HUD 移到右上 4 行中文小字；MENU/BAG 移到左上；准星下加目标名；快捷栏加灰色斜面外框/选中提亮；去掉 HP/FOOD 文本；helper 自测主菜单/游戏内 HUD | `f2cde48` |
| 2026-10-20 | 中文显示名 | 目标名/Toast/背包 Tooltip/配方产物统一改用 `itemLabel()`，如 `矮草`、`橡木木板`；与网页版中文一致 | `e799def` |
| 2026-10-20 | 两段式世界列表 | 标题页只留 `游戏/设置`；`游戏` 打开世界列表（返回/新建世界/世界卡片/进入/删除当前世界）；默认世界名迁移为“我的世界”；helper 截图自测两页 | `202458a` |

> 每次完成任务后在这里追加一行；**只写结论与数据**，不要贴大段日志。

---

## 8. 风险与悬案

| 风险 | 影响 | 应对 | 状态 |
| --- | --- | --- | --- |
| **微信 WebGL2 / 内存** | 低端 Android 可能拿不到 WebGL2 或内存不足 | WebGL2 已真机确认；内存峰值待 WX-010 后补测 | WebGL2 通过，内存待测 |
| **真机 JS 语法** | 模拟器支持 ES2020，真机 JSCore 不支持 `??`/`?.`，报 `Unexpected token ?` | 构建 target 固定 `es2017`；产物用 grep 检查 `??`/`?.` | 已修复（WX-002） |
| **抖音 WebGL2** | 官方小游戏 canvas 只保证 WebGL1；three r186 只支持 WebGL2 | M6 单独 Gate；必要时 three 0.162 + WebGL1 适配 | 未验证 |
| **适配器假 DOM** | `getElementById`/`querySelector` 返回占位对象，UI 代码会“看起来没报错但什么都不显示” | 已写入 `vendor/minigame-adapter/README.md` 与 §2.6：禁止依赖假 DOM，只经 `UiPort`/`src/platform` 访问 | 约束已落地 |
| **适配器 WebGL 包装** | `Canvas.getContext` 对每个方法加包装，draw call 多时可能明显掉帧 | 801 draw call 压力场景下两版均 16.6ms，无可测差异；保留包装 | 已排除 |
| **three WebGL1 守卫** | 适配器把 `WebGLRenderingContext` 换成空函数；若真机判定成 WebGL1 会直接抛错 | WX-006 真机确认；必要时删掉该 fake / 改成 WebGL2 构造器 | 待验证 |
| **适配器动态 require** | `HTMLScriptElement.js` 的动态 require 会让打包器扫描整个 references（WX-006 实测 4292 错） | vendored 副本已删掉动态 require；同时移除未使用的 `dom/xmldom` | 已修复（WX-010） |
| **适配器仅微信** | 全量 `wx.*`；抖音不能复用 | 平台层按 `wx/tt` 分开；抖音 M6 另写 | 已知 |
| **Layout 插件限制** | 只有微信、需插件权限；不支持完整 CSS/拖拽/输入法 | 只做 WX-021B 小规模验证；核心 UI 仍自研 canvas 工具包 | 待验证 |
| **UI 工作量** | 34 个模块、约 500 个 DOM 节点、4,200 行 CSS | 先做工具包 + 闭环；MVP 砍非核心界面 | 进行中 |
| **`main.ts` 冲突** | 主线持续改 14,400 行入口 | 只做最小接口改动；每 3~5 个任务 merge 一次 | 进行中 |
| **Worker 单线程** | 生成/网格化抢一个 worker，卡顿 | WX-018 合并两池 + 分片；必要时主线程时间切片 | Worker 产物已就绪，接线在 WX-020 |
| **BigInt（Worker/Random）** | `Random.ts` 的 SplitMix64 用 BigInt；老引擎无 BigInt 时 Worker 运行时报错 | esbuild 已把 `1n` 降成 `BigInt("...")`；`world-boot` 启动前检查，不支持直接弹窗 | WX-020A 真机确认 |
| **真实世界首启** | 图集生成、共享 worker、光照/网格队列在真机上可能爆内存或卡顿 | helper 预览通过：37 chunks / 243k tri / 稳定 121fps；worker 超时降级主线程时启动约 12s | helper 通过，真机待测 |
| **helper 预览 worker** | `weixin-minigame-helper` 里 `wx.createWorker` 不返回 pong，只能主线程降级 | 运行时 ping 1.5s 超时自动降级；真机 worker 行为留给 WX-020B/040 复测 | 已降级 |
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
