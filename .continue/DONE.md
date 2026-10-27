# 完成档案 · DONE

> 本文件是**已完成工作的唯一档案**，只回答"这批做了什么、怎么验的"——时间线，最近的在最上面。
> 按模块看现状与坑 → `OVERVIEW.md`；下次怎么避开 → `TIPS.md`；机制与格式 → `README.md`。
> **一条内容只写一个地方**，别在三份文档里各抄一遍。
>
> 收尾时**整份队列原样搬进来**（含每条任务下方的完成说明与 `[阻塞]`），标题格式
> `## 批次 <号> · 日期 · 会话 <前 8 位>`。

---

## 批次 20261027-1943 · 2026-10-27 · 会话 9f2dcf81

# 队列 · 会话 9f2dcf8178d4474f8c0f3f8f4e52851c

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-1943

> 用户 2026-10-27：「还有游戏场景内的摇杆、跳跃按键、顶部的三个按钮」。
> 这一批先做**摇杆**：它是唯一"连续跟随手指"的控件，不能再走镜像那条路。

- [x] [Y1] `src/ui2d/Touch2D.ts`：摇杆的画法与几何（`knobOffset` / `clampKnobOffset` / `drawStick` / `Touch2D`）→ `npx vitest run tests/ui2d-touch.test.ts`
  - 做了什么：底座（暗底 + 径向高光 + 浅色描边 + 外圈暗边）、芯子（真线性渐变 + 深色描边）、潜行态绿芯与小牌；`Touch2D` 自带覆盖层（zIndex 30），每帧只喂两个矩形 + 两个 class 状态。
  - 为什么：**摇杆不能镜像** —— 芯子一直动，镜像要么每帧读计算样式，要么落后几帧（黏手）。它只有两个圆，自己画更准更便宜。
  - 验证：`tests/ui2d-touch.test.ts` **7 passed**（圆心偏移、芯子尺寸无关、内圈夹取按方向缩、NaN 回中、芯子大于底座时上限 0）；`tsc` 干净。
  - 批次：20261027-1943

- [x] [Y2] `src/main.ts`：`syncTouch2d()` 接线（可见才接管、`html.ui2d-touch` 让位、小牌文字从 DOM 读）→ `npm run check:fast`
  - 做了什么：每帧读 `#touch-stick` 与 `.knob` 两个矩形 + `.active`/`.sneaking` + `.sneak-badge` 的文案；`html.ui2d-touch #touch-stick { opacity: 0 }` 让位（命中仍归 DOM）。
  - 为什么：与快捷栏同一条结论——`opacity: 0` 不杀 pointer 事件，所以拖摇杆的手势一行没改；而小牌文字走 DOM 才能跟着语言切换。
  - 验证：`npx tsc --noEmit` 干净；`npm run check:fast` 绿。
  - 批次：20261027-1943

- [x] [Y3] 预览页 `tools/preview/touch.html`（拖得动、`?state=active|sneak`、`?dx&dy` 定位置）+ 3 张截图 → `node tools/preview/shoot-all.mjs`
  - 做了什么：把 `index.html` 的样式整段搬进预览页（尺寸/渐变/描边全在 CSS 里），DOM 的摇杆按游戏里同一条规则 `opacity: 0`，canvas 那份才看得出是它画的；拖动芯子实时跟手。
  - 为什么：**不藏 DOM 的话截图里两份会叠在一起**，看着"一样"但什么也没证明（第一版就是这样，连潜行小牌都分不清是 DOM 还是 canvas）。
  - 验证：3 张截图（按下态 / 潜行态 / 遮罩），累计 55 张。
  - 批次：20261027-1943

- [x] [Y4] 文档：`notes/canvas-ui.md` §5.27（为什么不镜像 + 三条边界 + 阶段 6 还剩什么）、决策 D39、`TASKS` 的 M33 改 `[~]` → `node .continue/hooks/check.mjs --fast`
  - 做了什么：§5.27 记下"自己画 + 几何量 DOM"的理由，以及"渐变必须用真渐变（两段纯色会留硬缝）"、`opacity: 0` 不影响命中；M33 标成进行中。
  - 为什么：这一段是唯一"绕开镜像"的例外，不写清楚以后会有人想"统一改成镜像"，然后摇杆就黏手了。
  - 验证：`node .continue/hooks/check.mjs --fast` 六项全过。
  - 批次：20261027-1943


## 批次 20261027-1922 · 2026-10-27 · 会话 9f2dcf81

# 队列 · 会话 9f2dcf8178d4474f8c0f3f8f4e52851c

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-1922

> 用户 2026-10-27：「继续啊，把任务都放到任务列表里去，一件一件去做吧」。
> 这一件是 **M35 + M36**：把"能滚"补成"看得出能滚 + 松手继续滑"。

- [x] [W1] `src/ui2d/menuScreen.ts`：`scrollBarRects()` + 自绘滚动条 → `npx vitest run tests/ui2d-scroll.test.ts`
  - 做了什么：`refresh()` 里遍历镜像子树，找出真的能滚的容器，按 `scrollBarRects()` 画 4px 半透明圆角拇指（右缩 2px，最小 18px）；`draw()` 里在文字之后画（压在内容右侧）。
  - 为什么：DOM 的滚动条是 UA 画的，canvas 里没有 —— 不补就是"能滚但看不出能滚"。
  - 验证：`tests/ui2d-scroll.test.ts` **9 passed**（装得下不画、比例、贴顶/贴底、极长内容用最小长度、越界与 NaN 夹住）。
  - 批次：20261027-1922

- [x] [W2] 惯性：采样最近 5 次移动算速度、`decayVelocity()` 衰减、`stepInertia()` 每帧推进 → 合成 touch 事件实测
  - 做了什么：`drag.samples` 只留 5 个；`onDragEnd` 用 `(first.y - last.y)/dt*16.67` 算 px/帧；`stepInertia()` 每帧 `scrollTop += v` 并按 `0.94^frames`（dt 归一）衰减，`|v| < 0.25` 停；重新按下立刻停住惯性。
  - 为什么：松手即停的手感很硬；而"按帧衰减 + dt 归一"能在掉帧时不至于冲很远。
  - 验证：Playwright 合成 touch 向上拖 60px 松手 → `scrollTop` **60 → 73 → 109 → 129 → 144 → 162 → 168**（到底停住）；`decayVelocity` 4 条断言（单帧/多帧归一、阈值、方向、NaN）。
  - 批次：20261027-1922

- [x] [W3] 截图 `28-inventory-scrollbar.png` + `shoot-all` + 文档 §5.26 / 决策 D38 + TASKS 的 M35 改 `[~]`、M36 标完成 → `node .continue/hooks/check.mjs --fast`
  - 做了什么：滚动 48px 的截图里能看到细拇指在轨道上约 1/3 处；§5.26 记下两件事的做法与断言清单，并明确"滚动条还不能拖"。
  - 为什么：M35 只做了一半（不能拖），如果不写清楚，下一批会以为它已完成。
  - 验证：`node .continue/hooks/check.mjs --fast` 六项全过。
  - 批次：20261027-1922


## 批次 20261027-1739 · 2026-10-27 · 会话 9f2dcf81

# 队列 · 会话 9f2dcf8178d4474f8c0f3f8f4e52851c

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-1739

> 用户 2026-10-27：「背包左右两边的按钮（左：分类、仓库；右：人物、成就、配方）也还是 DOM」。
> 根因：镜像根取的是 `.inv-panel`，而立栏挂在 `.inv-shell` 上、在 panel **外面**。

- [x] [V1] `src/main.ts`：背包镜像根 `.inv-panel` → `.inv-shell`（带 `.inv-panel` 兜底）→ `npm run check:fast`
  - 做了什么：`syncInventory2d()` 里先找 `#inventory-screen .inv-shell`、找不到再退回 `.inv-panel`。
  - 为什么：`#inventory-screen > .inv-shell > [ 左立栏 | .inv-panel | 右立栏 ]` —— 只镜像 panel 就会"中间 canvas、两侧还是 DOM"，一屏两种渲染。
  - 验证：`npx tsc --noEmit` 干净；`npm run check:fast` 绿；截图里左右立栏（分类/仓库 · 人物/成就/配方）都由 canvas 画出。
  - 批次：20261027-1739

- [x] [V2] 预览页补左右立栏 + 2 张截图 → `node tools/preview/shoot-all.mjs`
  - 做了什么：`inventory-mirror.html` 外面套 `.inv-shell`，左右各放立栏按钮，镜像根同步改成 `.inv-shell`；`shoot-all` 累计 51 张。
  - 为什么：立栏的选中态与抽屉展开全靠 DOM class 变化，镜像自动跟上——但这一点必须有图证明，不能只写在注释里。
  - 验证：截图 `27-inventory-rails.png` / `27b-…-tinted.png`：面板 + 两侧立栏都在 canvas 上，遮罩版整片黄。
  - 批次：20261027-1739

- [x] [V3] 文档：`notes/canvas-ui.md` §5.25（"接手整页前先看清根是哪个节点"）、`TASKS.md` 的 M32 标完成 → `node .continue/hooks/check.mjs --fast`
  - 做了什么：§5.25 记下 DOM 层级与"差一层就漏一整块"的教训；M32 从待办移到已完成，进度口径与差异台账同步。
  - 为什么：这个错很隐蔽 —— 漏掉的部分**看着正常**（因为它还是 DOM），只有开遮罩才看得出来。
  - 验证：`node .continue/hooks/check.mjs --fast` 六项全过。
  - 批次：20261027-1739


## 批次 20261027-1732 · 2026-10-27 · 会话 9f2dcf81

# 队列 · 会话 9f2dcf8178d4474f8c0f3f8f4e52851c

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-1732

> 用户 2026-10-27：「滑动物品滚动的能力不行，世界列表也滑不动；就应该是手贴着列表上下移动，它跟手」。
> 根因：游戏把 `html, body` 的 `touch-action` 设成 `none`（为了拖动视角），内层滚动容器
> 每家 WebView 处理不一致 → 手指贴着列表滑，列表纹丝不动。
> 同时把用户点名要做的后续都写进 `TASKS.md`（M32~M36）。

- [x] [U1] `src/ui2d/menuScreen.ts`：`bindDragScroll` —— 接管触摸拖拽滚动（找可滚祖先 / 8px 阈值 / 跟手 / 立刻重画）→ 合成指针事件验证
  - 做了什么：`pointerdown`（非鼠标）→ 从命中元素往上找第一个真的能滚的祖先（`scrollHeight > clientHeight + 2` 且 `overflow-y: auto/scroll`）；纵向位移超过 8px 才劫持；之后每次 `pointermove` 设 `scrollTop = startScroll - dy` 并立刻 `refresh(true)`；`pointerup/cancel` 结束；`input/textarea/select` 不劫持。
  - 为什么：`html, body { touch-action: none }` 让内层滚动容器在部分 WebView 上完全不响应滑动；镜像既然已经在画这一屏，就顺手把"跟手"这件事做掉，不依赖 UA 的滚动实现。
  - 验证：Playwright 合成 touch 指针事件，在 `inventory-mirror.html?creative=1` 里向上拖 60px → `grid.scrollTop` 从 **0 → 60**，画面同步重画；`tsc` 干净。
  - 批次：20261027-1732

- [x] [U2] `TASKS.md`：把用户点名的后续拆成 M32~M36（立栏上 canvas / 触控控件 / 暂停弹窗验收 / 自绘滚动条 / 拖拽惯性）→ `node tools/audit-tasks.mjs`
  - 做了什么：新增五条待办，并把进度口径与差异台账重算（HANDOFF 303/6/12、共 324 项）。
  - 为什么：用户明确说过"后面要做的事都加到任务列表里，不用一个个确认"。
  - 验证：`npm run check` exit=0。
  - 批次：20261027-1732

- [x] [U3] 文档：`notes/canvas-ui.md` §5.24（为什么自己做拖拽滚动、三条边界、验证方式）→ `node .continue/hooks/check.mjs --fast`
  - 做了什么：记下根因（`touch-action: none`）、8px 阈值的理由（别把点击/物品拖拽/横向拖动一起劫持）、以及"滚动条（M35）与惯性（M36）还没做"。
  - 为什么：这一层最容易被后来的人当成"我也可以顺手加个平滑滚动"，结果把点击阈值改坏。
  - 验证：`node .continue/hooks/check.mjs --fast` 六项全过。
  - 批次：20261027-1732


## 批次 20261027-1706 · 2026-10-27 · 会话 9f2dcf81

# 队列 · 会话 9f2dcf8178d4474f8c0f3f8f4e52851c

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-1706

> 用户 2026-10-27：「首页三个按钮的**显示位置**是错的，**点击位置**也是错的」。
> 用真 `WorldScreen` 复现：首页在字体/排版稳定后按钮整体上移（y 483 → 309），
> 而镜像只在第一帧量过一次，之后再也不重量 —— 画在旧位置、点在新位置。

- [x] [S1] 复现页 `tools/preview/world-real.html`：真 `WorldScreen` + `fetch('/index.html')` 搬真样式 → 截图
  - 做了什么：页面构造真的 `WorldScreen`（空存档表 + no-op actions），把 `index.html` 里那段 `<style>` 整段注入，再镜像 `.world-panel`；`?plain=1` 出 DOM 基准；报告晚 1.2s 再打（早期的数字是布局稳定前的旧值）。
  - 为什么：手写假 DOM 测不出定位问题（第一版就是：没有游戏 CSS，元素全是裸节点，什么也没复现）。
  - 验证：`node` 里读同一个按钮在不同时刻的 `y`：**150ms 时 483，1650ms 时 309** —— 差 174px，根因坐实。
  - 批次：20261027-1706

- [x] [S2] `MenuScreen2D`：签名带上几何；`main.ts` 给所有镜像开 `pollMs` 并在 `document.fonts.ready` 后重量 → `npm run check:fast`
  - 做了什么：`computeSignature` 加 `getBoundingClientRect()` + `scrollWidth/scrollHeight`；主菜单 `pollMs: 200`、聊天输入行 `pollMs: 250`（原来 0）；主菜单挂载处加 `document.fonts.ready.then(sync)`。
  - 为什么：几何不在签名里 → 第一帧的旧位置会被永久沿用；而"盒子尺寸没变、内部按钮却动了"的情况签名也抓不到，所以要定期重读兜底。
  - 验证：`tsc` 干净；`npm run check:fast` 绿；镜像版截图（`26-world-mirror.png`）与 DOM 基准（`26b-world-dom.png`）位置一致。
  - 批次：20261027-1706

- [x] [S3] `textPanel`：`letter-spacing` 补偿（大标题不再被截成 `Minicra…`）+ 2 条断言 → `npx vitest run tests/ui2d.test.ts`
  - 做了什么：`readTextRuns` 读 `letter-spacing`，负值按 `-spacing × 字数` 记进 `TextRun.widthSlack`（上限 64）；`drawTextRuns` 把补偿加到 `maxWidth`。
  - 为什么：`world-logo` 是 48px + 负字距，盒子比 canvas 量出来的字窄，`maxWidth` 一夹就出省略号。
  - 验证：`tests/ui2d.test.ts` → **73 passed**（新增 2 条：补偿生效、补偿为 0 时行为不变）。
  - 批次：20261027-1706


## 批次 20261027-1654 · 2026-10-27 · 会话 9f2dcf81

# 队列 · 会话 9f2dcf8178d4474f8c0f3f8f4e52851c

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-1654

> 用户 2026-10-27：「点左侧分类按钮时，会把所有内容平铺出来、伸出弹窗；应该收在弹框内、物品滚动显示」。
> 根因是**镜像不知道 `overflow`**：`readTextRuns`/`readTextBlocks`/`readCanvasBlits` 全按
> `getBoundingClientRect()` 画，而 DOM 是靠 `overflow: hidden/auto` 裁的。

- [x] [R1] `src/ui2d/textPanel.ts`：裁剪 —— `makeClipQuery`（祖先 padding-box 求交 + 缓存）、记录带 `clip`、裁空的跳过、绘制 `paintClipped` → `npx vitest run tests/ui2d.test.ts`
  - 做了什么：新增 `intersectRect` / `makeClipQuery` / `outsideClip` / `paintClipped`；三个读取函数给 `TextRun`/`TextBlock`/`CanvasBlit` 带上 `clip` 并跳过完全在框外的；三个绘制函数按 `clip` 做 `save→clip→paint→restore`。
  - 为什么：`overflow` 是 DOM 才有的语义，canvas 不裁就会把滚出去、溢出面板的内容全画出来（用户报的正是这个）。
  - 验证：`tests/ui2d.test.ts` → **71 passed**（新增 3 条：相交取公共部分、包含取小的、只贴边返回 null）。
  - 批次：20261027-1654

- [x] [R2] 预览页复现 + 修复验证：`inventory-mirror.html?creative=1&scroll=80`（96 项 / 150px 高滚动区）→ 截图
  - 做了什么：预览页加"创造物品栏"模式：12 列 96 格塞进 `max-height: 150px; overflow-y: auto` 的网格并滚 80px，网格外面还有一行翻页条；截图 `25-inventory-scroll.png`。
  - 为什么：这个 bug 只在"内容比容器高"的时候出现，普通背包（27 格）复现不了。
  - 验证：截图里只画出滚动区里看得见的 4 行（最后一行在容器边缘被裁开），翻页条留在面板内，没有任何东西伸出面板。
  - 批次：20261027-1654

- [x] [R3] 文档：`notes/canvas-ui.md` §5.22、决策 D34 → `node .continue/hooks/check.mjs --fast`
  - 做了什么：§5.22 写清根因、修法三段（求交 / 跳过 / 裁剪绘制）与"滚动仍归 DOM"的边界；决策 D34 记下"镜像必须复刻 overflow 语义"。
  - 为什么：这是**第二条**"DOM 有、canvas 没有"的语义（第一条是位图），不记下来还会再踩。
  - 验证：`node .continue/hooks/check.mjs --fast` 绿。
  - 批次：20261027-1654


## 批次 20261027-1650 · 2026-10-27 · 会话 9f2dcf81

# 队列 · 会话 9f2dcf8178d4474f8c0f3f8f4e52851c

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-1650

> 用户 2026-10-27：「继续实现，不要停」—— 把**阶段 3 的最后一块**（多人面板）收掉。
> 它不在 `#world-screen` 那棵树里，所以单开一个镜像；面板里全是 `<input>`，
> 正好检验上一批补的"值 + 光标"能不能用。

- [x] [Q1] `src/main.ts`：`mountMultiplayerMirror()`（`#multiplayer-screen .mp-panel`，zIndex 65、`pollMs: 200`）→ `npm run check:fast`
  - 做了什么：在 `mountMenuMirror(menu)` 之后挂 `mountMultiplayerMirror(multiplayerUi)`；200ms 轮询 `screen.isOpen`，开着就 `engage(.mp-panel)`、关了就 `disengage()`。
  - 为什么：`#multiplayer-screen` 的 z-index 是 60，主菜单镜像（45）盖不到；而面板里是输入框，正好验证"镜像能画值与光标、输入仍归 DOM"这条路。
  - 验证：`npx tsc --noEmit` 干净；`npm run check:fast` 绿。⚠️ 游戏内未实测。
  - 批次：20261027-1650

- [x] [Q2] 预览页 `tools/preview/multiplayer-mirror.html` + 2 张截图 → `node tools/preview/shoot-all.mjs`
  - 做了什么：按 `index.html` 的 `.mp-*` 搭一块真面板（标题 + ✕ + 三行输入框带值 + 红色状态行 + 取消/加入），`MenuScreen2D.engage(panel)`；把焦点放进"房间号"并置于末尾，让镜像画出光标；`?tint=1` 加遮罩；`shoot-all` 累计 46 张。
  - 为什么：`<input>` 的值与光标是这一批唯一"新东西"，必须在能看见的页面上验一次（而不是只在代码里相信它）。
  - 验证：`node tools/preview/shoot-all.mjs` 46 张全出；截图里三个输入框的值、红色状态行、两颗按钮都由 canvas 画出；遮罩版整块面板变黄。
  - 批次：20261027-1650

- [x] [Q3] 文档：`notes/canvas-ui.md` §5.21（镜像根的另一棵树 + 阶段 3 的账）、决策 D33 → `node .continue/hooks/check.mjs --fast`
  - 做了什么：§5.21 记下"独立一棵树要单开镜像、z-index 按它给"，并列出阶段 3 六块界面的完成账；决策 D33 记下"镜像没有"统一一个大根"，而是每个 z-index 层一个实例"。
  - 为什么：镜像的 z-index 判据已经踩过一次（主菜单用默认 1 → 游戏里整块消失），这次要写清"按被镜像那一层的 z-index 往上给"。
  - 验证：`node .continue/hooks/check.mjs --fast` 绿。
  - 批次：20261027-1650


## 批次 20261027-1618 · 2026-10-27 · 会话 9f2dcf81

# 队列 · 会话 9f2dcf8178d4474f8c0f3f8f4e52851c

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-1618

> 用户 2026-10-27：「继续实现，不要停」—— 按任务表推进 M26：**把背包整页接进游戏**。
> 这一批先落"整页镜像"（19 种工作站一次全覆盖、零回归），自绘版继续在预览页演进。

- [x] [P1] `src/ui2d/textPanel.ts` + `menuScreen.ts`：新增 `readCanvasBlits` / `drawCanvasBlits`，镜像绘制顺序定为 底 → 位图 → 文字 → `npx vitest run tests/ui2d.test.ts`
  - 做了什么：`CanvasBlit` + `readCanvasBlits(root, origin, view)`（读范围内所有 `<canvas>` 的矩形与位图）+ `drawCanvasBlits`（关掉平滑按原位贴）；`MenuScreen2D` 多存一份 `blits` 并在 `blocks` 与 `runs` 之间画；同时新增 `pollMs` 选项。
  - 为什么：背包的图标不是文字也不是底色，而是 DOM 里已经画好的位图；不搬只能得到"有边框、没图标"的背包。顺序必须与 DOM 一致（槽位底 → 图标 → 数量）。
  - 验证：`tests/ui2d.test.ts` → **68 passed**（新增 2 条：按原位贴并关平滑、空列表不画）。
  - 批次：20261027-1618

- [x] [P2] `src/main.ts`：背包改成整页镜像（`invMirror`，zIndex 12 + `pollMs: 120`），`#inv-held` 单独藏 → `npm run check:fast`
  - 做了什么：把上一批的 `Inventory2D`（逐槽位读 DOM）换成 `MenuScreen2D` 镜像 `.inv-panel`；`syncInventory2d()` 简化为"开着就 `engage(panel)`、关了就 `disengage()`"；`#inv-held` 用 `html.ui2d-inv #inv-held { opacity: 0 }` 藏掉；`pollMs: 120` 兜住"只换图标不换字"的变化。
  - 为什么：`Inventory2D` 只画槽位、面板底与标题仍是 DOM，遮罩版看得出来"只有格子黄"；整页镜像之后**面板里每一像素都是 canvas**。而 19 种工作站共用同一批 `.inv-slot`，镜像一次全覆盖。
  - 验证：`npx tsc --noEmit` 干净；`npm run check:fast` 绿。⚠️ 游戏内未实测（dev 缺 `core.bin`）。
  - 批次：20261027-1618

- [x] [P3] 预览页 `tools/preview/inventory-mirror.html` + 2 张截图（含遮罩版）→ `node tools/preview/shoot-all.mjs`
  - 做了什么：按 `index.html` 的 `.inv-*` 搭一块 27+9 格的真 DOM（每格含真 `<canvas>` 图标、数量、耐久条、红底格、选择态），`MenuScreen2D.engage(panel)` 镜像它；`?tint=1` 加遮罩；`shoot-all` 累计 43 张。
  - 为什么：镜像的卖点是"面板里每一像素都由 canvas 产出"，遮罩版一张就能证明（整块黄、背景不黄）。
  - 验证：`node tools/preview/shoot-all.mjs` 43 张全出；截图看过：面板底/斜面/图标/64·12·3·32 数量/黄色耐久条/红底格都在，遮罩版整块面板变黄。
  - 批次：20261027-1618

- [x] [P4] 文档：`notes/canvas-ui.md` §5.20（整页镜像 + 位图搬运 + `pollMs` 的坑）、决策 D32 → `node .continue/hooks/check.mjs --fast`
  - 做了什么：§5.20 记下"为什么先镜像"、"位图必须一起搬"、`pollMs` 兜底的原因，以及三条边界（悬停、tooltip、`#inv-held`）；决策 D32 记下"背包分两步：先镜像覆盖全部，再自绘替换"。
  - 为什么：`pollMs` 那条尤其反直觉——"只换图不换字"的镜像会静默显示旧图标，不写清楚下一次会当成渲染 bug 查半天。
  - 验证：`node .continue/hooks/check.mjs --fast` 绿。
  - 批次：20261027-1618


## 批次 20261027-1548 · 2026-10-27 · 会话 9f2dcf81

# 队列 · 会话 9f2dcf8178d4474f8c0f3f8f4e52851c

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-1548

> 用户 2026-10-27：「好的，你的建议处理。后面所有要做的事加到任务列表里，不用一个个找我确认。
> 我们的目标是把背包完全复原」。
> 所以先把**背包完全复原**拆成 M25~M31 写进 `TASKS.md`（M25 本批做完），然后执行 M25：
> 补齐双击收集 / 右键拖拽逐格 / 长按分堆这三条规则。

- [x] [N1] `src/ui2d/inventoryModel.ts`：`rightDragDistribute` / `doubleClickGather` / `splitTake` + 断言 → `npx vitest run tests/ui2d-inventory-model.test.ts`
  - 做了什么：右键拖拽每格放一个（重复经过只放一次）；双击收集（先拿起那一格，再把同类凑到上限；光标本来就有货时把被点那格也并进来）；长按分堆取指定数量（异类拒绝、受上限）。测试从 19 条增到 **31 条**。
  - 为什么：这是"逻辑一模一样"的核心 —— 之前只有左键/右键/Shift/左键拖拽四种，DOM 版还有这三种。
  - 验证：`npx vitest run tests/ui2d-inventory-model.test.ts` → **31 passed**（新增 12 条：右键拖拽 4、双击收集 4、长按分堆 4）；`tsc` 干净。
  - 批次：20261027-1548

- [x] [N2] 对照页接上三种新操作 + **像素探针**验收 → 截图
  - 做了什么：`inventory-compare.html` 双击（400ms 内同格）、右键拖拽（按下时放一个，之后每经过新格放一个）、触摸长按（500ms 取一半）；另外用 Playwright 读 `getImageData` 验证"点 canvas 第 0 格后该格中心从图标色变槽位底色，且 DOM 侧也空了"。
  - 为什么：截图会骗人 —— 第一版两张截图看起来"没变化"，实际是**手上那叠浮在被点的那格上盖住了**；读像素才是硬证据。
  - 验证：像素探针 `before=[139,90,43]` → `after=[139,139,139]`（槽位底色），DOM 侧 `.inv-count` 变空；截图 `22b-inventory-held.png`（手上那叠跟随指针）。
  - 批次：20261027-1548

- [x] [N3] `TASKS.md`：把"背包完全复原"拆成 M25~M31（含验收判据），M25 标记完成；文档 §5.19 + 决策 D31
  - 做了什么：M25 交互规则（本批完成）、M26 接进游戏、M27 视觉对齐、M28 合成、M29 容器工作站、M30 重配方块、M31 触摸 UI 全套；§5.19 记录六种鼠标操作与像素探针手法。
  - 为什么：用户要求"后面要做的事都进任务列表，不用逐个确认" —— 所以把整条路线写死在 TASKS 里，后续批次直接照着做。
  - 验证：`node .continue/hooks/check.mjs --fast` 绿。
  - 批次：20261027-1548


