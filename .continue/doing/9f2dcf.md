# 队列 · 会话 9f2dcf8178d4474f8c0f3f8f4e52851c

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-1319

> 用户 2026-10-27：「继续继续」—— 把上一批那条「原位重画」的路子用到**剩下的纯展示 HUD**上：
> 状态效果胶囊（`#effects-hud`）与聊天消息列表（`.chat-log`）。
> 这两块本来就要重排一遍才好看，但它们的版式（胶囊/分行）已经在 CSS 里写好了，
> 直接原位重画既省事又不会漂。

- [x] [E1] `src/main.ts`：`#effects-hud` 与 `.chat-log` 纳入纯文字面板（让位 + 每帧签名同步）→ `npm run check:fast`
  - 做了什么：`applyTextPanelsDomFallback()` 加上 `#effects-hud`，并**只藏 `.chat-log`**（输入行/提示/发送键仍是 DOM —— 那是阶段 3 输入法那一摊）；`syncTextPanels2d()` 把这两块一起纳入"文字内容 + 视口"签名与读取，根节点列表化（`roots[]` 逐个 `readTextRuns` + `readTextBlocks`）。
  - 为什么：聊天**不能整块藏**——`#chat` 里还挂着输入行，一藏就把打字界面也藏了（与快捷栏"容器不能整体透明"同一个道理）。
  - 验证：`npx tsc --noEmit` 干净；`npm run check:fast` 绿。
  - 批次：20261027-1319

- [x] [E2] `src/ui2d/textPanel.ts`：渐变底的近似（状态效果胶囊的 `--hud-bg` 是 `linear-gradient`，`backgroundColor` 是透明的）→ 预览页 + 截图
  - 做了什么：`hasBackground()` 在 `backgroundColor` 透明但 `backgroundImage !== 'none'` 时，退化成一块半透明深色 `HUD_GRADIENT_FALLBACK = rgba(16,17,21,.66)`；预览页 `textpanels.html` 加状态效果胶囊（3 个，好/坏两种边框）与聊天 4 行（系统黄 / 普通白 / 提示蓝 / 报错红），两张截图重拍。
  - 为什么：不退化的话这三个胶囊会**完全没有底**，白字直接压在世界画面上（截图里一眼就看出来）。复刻整条 CSS 渐变要解析 `linear-gradient(...)` 字符串，只为"上下差 2% 亮度"，不值得（决策 D22）。
  - 验证：`node tools/preview/shoot-all.mjs` 31 张全出；截图看过：三个胶囊有底、边框分好坏、文字不溢出；聊天四行颜色分别对（黄/白/蓝/红）。
  - 批次：20261027-1319

- [x] [E3] 文档：`notes/canvas-ui.md` §5.12 + 决策 D22 → `node .continue/hooks/check.mjs --fast`
  - 做了什么：§5.12 记下"纯展示 HUD 到此清零"、渐变底的近似，以及聊天只藏消息列表的理由；决策 D22（渐变底退化成半透明深色）。
  - 为什么：这是"纯展示 HUD 全部搬完"的收口，得写清**还剩什么**（聊天输入行、效果色点这类 pseudo 元素），否则下一批会以为还有活。
  - 验证：`node .continue/hooks/check.mjs --fast` 绿。
  - 批次：20261027-1319
