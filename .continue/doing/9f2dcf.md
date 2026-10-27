# 队列 · 会话 9f2dcf8178d4474f8c0f3f8f4e52851c

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-1345

> 用户 2026-10-27：「去完成」—— 做上一轮说的**输入法定型**。
> 这是新建世界、多人面板、聊天三条线共同的前置件：canvas 自己收不到输入法组合态，
> 唯一正路是"屏幕外放一个看不见但可聚焦的 `<input>` 收字，canvas 只画"。

- [x] [H1] `src/ui2d/textInput.ts`：`CanvasTextInput`（隐藏 input 收字 + 画光标/选区/组合态下划线）+ 一组纯几何/编辑函数 → `npx vitest run tests/ui2d-textinput.test.ts`
  - 做了什么：`textInput.ts`（约 420 行）—— 隐藏 `<input>`（`opacity: 0` + 1×1 + 固定视口内 + `pointer-events: none`）承接输入；`metricsFor` / `caretXOf` / `clampCaret` / `applyInsert` / `backspaceAt`（按码点）/ `visibleSlice`（超宽滚动窗口）/ `rangeRect` / `caretRect` / `caretBlinkOn`；`CanvasTextInput` 负责 `open/close/focus/render/dispose`，Enter 提交、Esc 取消（两者都先看 `isComposing`）。
  - 为什么：canvas 没有输入框，也收不到组合态。三条约束见 §5.14 —— 尤其"不能用 `display: none`"（拿不到焦点、移动端不弹键盘）和"组合态靠事件不靠 value"（拼音阶段 `value` 里已经有字母了）。
  - 验证：`npx vitest run tests/ui2d-textinput.test.ts` → **18 passed**；`tsc` 干净。
  - 批次：20261027-1345

- [x] [H2] 预览页 `tools/preview/textinput.html`：能**真的打字**（含中文输入法）、可预填内容与选区；两张截图 → `node tools/preview/shoot-all.mjs`
  - 做了什么：一页"新建世界"面板，两块 `CanvasTextInput`（世界名称 / 种子），点一下就能打字；`?value=我的世界&sel=1,3` 预填并选中一段（截图用），`?tint=1` 加遮罩。`shoot-all` 加 2 张（累计 36 张）。
  - 为什么：这一层的正确性一半只能靠"真的敲一遍"——组合态下划线、光标闪烁、选区宽度都只有在动起来时才看得出问题；截图至少能把"中文 + 选区"这一幕定住。
  - 验证：`node tools/preview/shoot-all.mjs` 36 张全出；截图看过：`18b` 里"我的世界"四个字、第 2~3 个字上有蓝色选区、种子框是未聚焦空框 + 占位提示。
  - 批次：20261027-1345

- [x] [H3] 文档：`notes/canvas-ui.md` §5.14（三条约束 + 未接线的边界）、决策 D26 → `node .continue/hooks/check.mjs --fast`
  - 做了什么：§5.14 把三条约束做成表格（每条都写"为什么"），并明确写了**还没接进游戏**；决策 D26 记下"为什么用隐藏 input 而不是自己实现键盘"。
  - 为什么：这一层最容易被后来的人"简化"——把 `opacity: 0` 改成 `display: none`、或者干脆用 `value` 判组合态。两种改法在桌面 Chrome 上**都能跑**，只在移动端输入法下坏掉，不写清楚就会被改回去。
  - 验证：`node .continue/hooks/check.mjs --fast` 绿。
  - 批次：20261027-1345
