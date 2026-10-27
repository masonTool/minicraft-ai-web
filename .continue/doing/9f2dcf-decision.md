# 决策记录 · 会话 9f2dcf8178d4474f8c0f3f8f4e52851c

> 批次 20261027-1319 · 状态效果 + 聊天消息（纯展示 HUD 收口）

## D22 · 渐变底退化成半透明深色，不解析 CSS 渐变
- 决定：`readTextBlocks` 在 `backgroundColor` 透明但 `backgroundImage !== 'none'` 时，用 `HUD_GRADIENT_FALLBACK = rgba(16,17,21,.66)` 画一块底。
- 为什么：状态效果胶囊的 `background` 是 `var(--hud-bg)`（`linear-gradient(rgba(16,17,21,.62), rgba(8,9,12,.74))`），在 DOM 里 `backgroundColor` 是透明的。要么退化，要么解析整串 `linear-gradient(...)`（还有 `radial-gradient`、多个色标、角度）。**退化后上下差的那 2% 亮度，肉眼分辨不出**，而解析器要写一大堆还容易错。
- 影响：所有"渐变底的 HUD 块"在 canvas 上看起来是一块平色（目前的用法里只有状态效果胶囊踩到）。退得回去：将来若要精确，可以读 CSS 变量 `--hud-bg` 的两个停靠点自己拼 `createLinearGradient`。

## D23 · 聊天只藏消息列表，不藏 `#chat`
- 决定：`applyTextPanelsDomFallback()` 对聊天只把 `.chat-log` 设 `visibility: hidden`，输入行/提示/发送键保持 DOM。
- 为什么：`#chat` 里挂着输入行。整块藏会把"打字界面"一起藏掉——而输入法那一摊（隐藏 `input` 收字 + canvas 显示 composing）是阶段 3 的独立课题，本批不该顺手把它拖进来。这与"快捷栏容器不能整体透明（否则两侧按钮一起消失）"是同一条经验。
- 影响：打字时 canvas 与 DOM 会同时出现（消息列表在 canvas、输入行在 DOM），两者位置由同一套 CSS 决定，看起来是连续的一列。退得回去：删掉那一行 `visibility` 即可。
