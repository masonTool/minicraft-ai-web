# 队列 · 会话 9f2dcf8178d4474f8c0f3f8f4e52851c

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-1307

> 用户 2026-10-27：「继续」—— 接着做**纯文字 HUD**：F3 调试信息与计分板侧边栏。
> 这两块没有控件、没有命中测试，内容就是"一块底 + 几行字"，正好试一条新路子：
> **不重排、按原位重画** —— 把 DOM 里直接带文字的元素连矩形/颜色/字号一起读出来画。

- [x] [P1] `src/ui2d/textPanel.ts`：`readTextRuns` / `readTextBlocks` / `drawTextRuns` / `drawTextBlocks` + 归一化字号与签名 → `npx vitest run tests/ui2d.test.ts`
  - 做了什么：读 DOM 里**直接带文字**的元素（叶子）→ 「矩形 + 文本 + 计算样式的颜色/字号/字重/对齐 + 有无阴影」；另外单独读"有色底"的元素（F3 的 `.35`、计分板的 `.45`）连同圆角。绘制时先画底块再按行画字（多行文本按 `\n` 拆开、行高 1.35 倍字号、竖直居中）。
  - 为什么：F3 那串文案是**拼出来的多行字符串**，计分板是"名字左、分数右"的 flex 行 —— 重排一遍就要把格式与对齐规则各抄一份；颜色字号还会随夜间/低血量/断点变（`ui2d/textPanel.ts` 顶部三条理由）。
  - 验证：`npx vitest run tests/ui2d.test.ts` → **60 passed**（新增 3 条：字重归一、基线、签名稳定性）；`tsc` 干净。
  - 批次：20261027-1307

- [x] [P2] `src/main.ts` 接线：`#debug` 与 `#scoreboard-hud` 让位，`syncTextPanels2d()` 按"文字内容 + 视口"签名决定要不要重读 → `npm run check:fast`
  - 做了什么：`applyTextPanelsDomFallback()` 把两块设 `visibility: hidden`（保留布局：F3 的换行、计分板两列对齐都要靠 DOM 量）；`syncTextPanels2d()` 每帧拼一个"文字内容 + 视口尺寸"的签名，**没变就不碰 `getComputedStyle`**（那是会触发样式重算的调用），变了才 `readTextRuns` + `readTextBlocks` 喂给 `Hud2D.setTextPanels`；`Hud2D` 在最上层画（先底色块再文字），resize 时把签名清空。
  - 为什么：F3 开着时每帧都变（帧率/坐标），那是它本来就该重画；**关着时一次都不读** —— 默认 F3 是关的，所以常态零成本。
  - 验证：`npx tsc --noEmit` 干净；`npm run check:fast` 绿。⚠️ 游戏内未实测。
  - 批次：20261027-1307

- [x] [P3] 预览页 `tools/preview/textpanels.html`（真 DOM 当数据源）+ `shoot-all` 补图 → `node tools/preview/shoot-all.mjs`
  - 做了什么：按 `index.html` 的 `#debug` / `.scoreboard-hud` CSS 建真 DOM（`visibility: hidden`），读 runs + blocks 后原位重画；两张截图（含遮罩版），`shoot-all` 累计 31 张。
  - 为什么：这一路线的卖点是"原位重画"，那就必须能一眼看出**位置/颜色/对齐都与 DOM 一致**——截图里 F3 五行等宽、计分板分数右对齐且是黄色（`#ffd75e` 来自计算样式）。
  - 验证：截图看过：F3 块左上带半透明底、计分板右上带圆角底，名字左/分数右、分数黄色；遮罩版两块都是黄的。
  - 批次：20261027-1307

- [x] [P4] 文档：`notes/canvas-ui.md` §5.11 + 决策 D21 → `node .continue/hooks/check.mjs --fast`
  - 做了什么：§5.11 记下"原位重画"这条路线的三条理由与代价（`getComputedStyle` 的门禁）；决策 D21（纯文字面板按原位重画，不重排版）。
  - 为什么：这是本项目**第一次**"不重排、只重画"的迁移，与前面"画法全部自己实现"的路线不同 —— 不写清楚，下一块（聊天栏 / 状态效果）会重新纠结用哪条路。
  - 验证：`node .continue/hooks/check.mjs --fast` 绿。
  - 批次：20261027-1307
