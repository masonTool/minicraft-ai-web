# 队列 · 会话 9f2dcf8178d4474f8c0f3f8f4e52851c

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-1258

> 用户 2026-10-27：「继续继续」—— 往**设置页**走一步。
> 这一批只做"能不能画对、点得着"：把 `.settings-row` 读成模型、用控件库画出来、
> 交互写回 DOM 控件（`click()` / 写 `value` 再派发事件），并在预览页用**真实 DOM 行**验证。
> ⚠️ **游戏里还没接线**（`?ui2d=1` 时设置页仍是 DOM）：接线要先把暂停菜单那套
> `engaged` 机制泛化成"菜单/设置两态"，混在一起改容易把上一批刚通的 Esc 弄坏。

- [x] [W1] `src/ui2d/form.ts`：`readFormRows()`（DOM → 模型）+ 行/控件几何纯函数 + `drawFormRow` + `writeRangeRatio` → `npx vitest run tests/ui2d-form.test.ts`
  - 做了什么：`form.ts`（约 210 行）—— `readFormRows(host)` 扫 `.settings-row`：有 `.settings-switch` → `switch`（读 `aria-checked`/`.on`）、有 `input[type=range]` → `range`（按 min/max 算 0~1）、有 `.settings-cycle` → `cycle`（`textContent` 当值）；`formRowRects` / `formContentHeight` / `formControlRect` / `formRatioFromX` / `drawFormRow` / `writeRangeRatio`（写 `value` + 派发 `input`/`change`，让原有设置逻辑照常跑）。
  - 为什么：与暂停菜单同一条思路（D18）——**DOM 是唯一真源**，这里不定义"有哪些设置项、什么范围、什么文案"，只负责画与转发；否则设置项一改，两套表必漂。
  - 验证：`tests/ui2d-form.test.ts` **4 passed**（行距、内容高、控件右贴边与小行收窄、滑杆比例的 0/0.5/1 与 NaN）；`tsc` 干净。
  - 批次：20261027-1258

- [x] [W2] `tools/preview/form.html`：用**隐藏的真实 DOM 行**当数据源（开关 / 循环按钮 / 滑杆），画出并支持点/拖/滚/键盘；`shoot-all` 补图 → `node tools/preview/shoot-all.mjs`
  - 做了什么：页面里先建 13 行真的 `.settings-row`（`.settings-switch` / `.settings-cycle` / `input[type=range]`，开关点击会翻转、循环按钮点击会换值），`readFormRows()` 读成模型后画到 canvas；点开关/循环按钮 = `element.click()`、拖滑杆 = `writeRangeRatio()`，每次交互后**重新读模型重画**。加 `?tint=1`；`shoot-all` 累计 29 张。
  - 为什么：读取与写回靠 DOM，光看代码不算验证——这一页把"隐藏 DOM 当数据源"那条路真的跑通了（截图中四行开关/三行循环/三行滑杆的值都来自那些 DOM 元素）。
  - 验证：`node tools/preview/shoot-all.mjs` 29 张全出；截图 `15-settings-form.png` 里页签、开关（绿）、循环按钮（关闭/第一人称）、滑杆（读数 8 / 60 / 50 在轨道左侧）都对；`15b` 是遮罩版。
  - 批次：20261027-1258

- [x] [W3] 游戏里接线：`syncPauseCanvas2d()` 统一管"菜单 / 设置"两态（DOM 让位、遮罩、HUD、`pointer-events`、键盘路由），设置页滚轮与页签点击走 `form.ts` 的模型 → `npm run check && npm run build:fast`
  - 做了什么：把上一批的 `syncPauseMenu2d()` 泛化成 `syncPauseCanvas2d()`——每帧算一个模式（`null` / `'menu'` / `'settings'`），模式变了先 `teardownPauseCanvas2d()` 逐项还原、再按模式建状态。菜单页仍是 `CanvasMenu`（行来自 DOM 按钮）；设置页新增 `buildSettings2d()` / `refreshSettings2d()` / `renderSettings2d()`（标题栏 + 页签 + 行 + 滚动条）与 `handleSettingsPointer()` / `handleSettingsKey()`。键盘分两态路由（设置页自己吃 ↑↓/Enter/空格/Esc，并把焦点行滚进视口）；指针加了 `pointermove` / `pointerup`（滑杆要按下拖动）与 `wheel`（滚列表）。
  - 为什么：两种页面**共用一个覆盖层、一批 DOM 让位/还原**，所以必须由同一个地方决定"现在是谁在接管"——放在别处就会出现"菜单收了、设置页没接上"这种半状态。还原判据继续用 `pauseCanvasMode`（D17），不用 `menu.isOpen`。
  - 验证：`npx tsc --noEmit` 干净；`npm run check` 全量通过；`npm run build:fast` 出包。⚠️ **游戏内仍未实测**（dev 缺 `__host/core.bin` 只能停在落地页）：设置页的"读 DOM → 画 → 写回"链路在 `tools/preview/form.html` 里跑通过（同一份 `form.ts`），但 `main.ts` 这段接线只有类型检查与静态推演。
  - 批次：20261027-1258
