# 队列 · 会话 9f2dcf8178d4474f8c0f3f8f4e52851c

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-1235

> 用户 2026-10-27：「继续继续继续继续」—— 把上一批做好的**输入通道接进游戏**：
> `?ui2d=1` 时 Esc 唤出的暂停菜单页由 canvas 画、canvas 收输入。
> 关键取舍：**不给每个按钮重写动作**，而是把 DOM 里那排按钮的 `textContent` 当标签、
> `click()` 当动作 —— 文案（6 种语言）、条件显隐（联机按钮只在房里出现）、
> 删除世界的二次确认全都自动继承，一条都不用抄。

- [x] [Z1] `src/main.ts`：`syncPauseMenu2d()` 跟着 `settingsScreen.isOpen/page` 进出，DOM 面板让位（`visibility: hidden`）、HUD 让位、遮罩与面板都由 canvas 画 → `npm run check:fast`
  - 做了什么：新增 `syncPauseMenu2d()`（每帧一次边沿检测：面板开着且 `page === 'menu'` 就接管）与 `renderPauseMenu2d()`（canvas 自己画 45% 遮罩 + 面板）；让位三处 —— `.settings-panel` 设 `visibility: hidden`（不能用 `display`，会打乱它自己 130ms 的淡出时序）、`#settings-screen` 的遮罩背景改 `transparent`（它排在 canvas 之上，不透明会把面板一起压暗）、`#hud` 设 `visibility: hidden`（body 级定位元素，不藏就压在 canvas 上）。退出时逐项还原。
  - 为什么：三种转换（打开 / 从设置子页退回 / 关掉）都从这一处进出，就不必在 `SettingsScreen` 里埋钩子——埋了会分成两套时序。**还原判据用独立的 `pause2dEngaged` 而不是 `menu.isOpen`**（决策 D17）：激活时要先 `close()` 再点按钮，那时 `isOpen` 已经 false，用它当判据会漏还原（第一版就这么错，症状是"退出暂停后 HUD 永久消失"）。
  - 验证：`npx tsc --noEmit` 干净；`npm run check:fast` 绿。
  - 批次：20261027-1235

- [x] [Z2] 输入路由：Esc / ↑↓ / Home·End / Enter·空格 走 `CanvasMenu`，指针点击走 `handlePointer`，激活 = `button.click()`；关掉时恢复原样 → `npm run check && npm run build:fast`
  - 做了什么：keydown 监听开头加一段"菜单开着时整段键盘归它"（认 ↑↓/Home/End/Enter/空格/Esc，其余键 `preventDefault` 后 return）；覆盖层 canvas 上绑 `pointerdown`（平时 `pointer-events: none`，只有菜单打开时由 `syncPauseMenu2d` 打开），点击走 `handlePointer` → `dispatchPauseMenu`。激活时先 `menu.close()` 再 `button.click()`（按钮可能切页签或直接关面板），随后立刻 `syncPauseMenu2d()` 完成还原。
  - 为什么：菜单开着时按 W 不该让角色在面板后面走——DOM 版靠浏览器焦点挡住了这一层，canvas 版必须自己挡（`preventDefault` + return）。
  - 验证：`npm run check` 全量（含 181 套离线）通过；`npm run build:fast` 出包成功；`tsc` 干净。⚠️ **真机/浏览器没在游戏里跑过**：dev 模式缺 `__host/core.bin` 只能停在落地页，所以"Esc 打开→点设置→退回→再 Esc 关掉"这条链只有静态推演 + 预览页验证。
  - 批次：20261027-1235

- [x] [Z3] 预览页补一张"游戏里那一版"的对照（同一份 DOM 按钮 → canvas 行），`shoot-all` 补图并重拍 → `node tools/preview/shoot-all.mjs`
  - 做了什么：`menu.html` 加 `?from=dom`：真的建出四颗 `<button>`（标签走 `t('pause.resume')` 等真实 i18n 键），再把它们的 `textContent` 喂给 `CanvasMenu`，激活时 `button.click()` —— 与 `main.ts` 完全同一条路。截图 `14-pause-dom-driven.png`；`shoot-all` 累计 27 张。
  - 为什么：接线里最容易错的是"行与按钮的对应关系"，而这条关系在预览页里能一眼看出来（截图里四行就是真实那四颗按钮的文案）。
  - 验证：`node tools/preview/shoot-all.mjs` 27 张全出；截图里四行分别是「继续游戏 / 设置 / 统计 / 保存并退出到主菜单」——正是 `SettingsScreen` 菜单页当前那四颗（成就那颗已在批次 20261024-1152 删除，多人那颗单机时不显示）。
  - 批次：20261027-1235

- [x] [Z4] 文档：`notes/canvas-ui.md` 阶段 3 前进一格（暂停菜单已接线）、决策 D17/D18 → `node .continue/hooks/check.mjs --fast`
  - 做了什么：阶段 3 标 🟡（暂停菜单页 ✅，其余未开始）；新增 §5.9（边沿检测、不重写动作的代码骨架、三处让位的表、"还原判据不能用 isOpen"的警告、键盘整段接管）；决策 D17（独立标志）、D18（行来自 DOM）。
  - 为什么：D18 是这一批的核心取舍，也解释了一个反直觉的结论——"canvas 菜单的能力上限 = DOM 面板现有按钮"，这被当成优点写下来（避免两套 UI 各自长功能）。
  - 验证：`node .continue/hooks/check.mjs --fast` 绿；`npm run check` 通过（TASKS 台账随收尾补齐）。
  - 批次：20261027-1235
