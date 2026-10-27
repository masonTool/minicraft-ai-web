# 决策记录 · 会话 9f2dcf8178d4474f8c0f3f8f4e52851c

> 批次 20261027-1354 · 新建世界表单接入整页镜像

## D27 · 镜像路线下"输入仍归 DOM，光标/选区归 canvas"；签名必须显式带上输入框的值
- 决定：`<input>` / `<textarea>` 保持 DOM 承接焦点与输入法，`readTextRuns` 单独读 `value`（空值取 `placeholder` 并降不透明度）；焦点框的光标与选区由 `MenuScreen2D.drawFieldCaret()` 用 `selectionStart/End` 计算后画。`computeSignature` 额外拼接所有 `input/textarea` 的 `value`。
- 为什么：镜像的前提是"DOM 让位像素但仍收输入"，而输入框的值恰好**两种都不占**——不在 `textContent` 里（取值要单独取），变化也不进 `textContent`（**所以判断"要不要重画"也必须单独判**）。第一版只补了取值没补签名，结果敲字时 canvas 完全不刷新、输入框一直显示占位提示；这种错在静态截图里看不出来，只有真人敲一遍才会暴露。
- 影响：`MenuScreen2D` 现在对输入框有两处特判（取值 + 光标），比"纯文字镜像"复杂一点。**同一时刻只有焦点框画光标**（多处焦点在 DOM 里本来也不可能）。退得回去：不镜像 `create` 视图即可（白名单去掉一项）。
