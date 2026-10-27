# 队列 · 会话 9f2dcf8178d4474f8c0f3f8f4e52851c

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-1354

> 用户 2026-10-27：「继续继续继续」—— 把**新建世界表单**也交给 canvas，
> 让"整页镜像"覆盖主菜单的第三个视图。上一批说过：`<input>` 的值不在 `textContent` 里，
> 所以镜像一直绕开这个视图；这一批就把这个缺口补上。

- [x] [J1] `src/ui2d/textPanel.ts`：输入框取值（`textFieldValue` / `inputDisplayText`，占位提示 0.55 不透明度）+ `TextRun.alpha` → `npx vitest run tests/ui2d.test.ts`
  - 做了什么：`readTextRuns` 现在优先认 `<input>` / `<textarea>`（`type` 只认 text/search/number，密码与隐藏框跳过），值为空时用 `placeholder` 并标为占位；`TextRun` 加 `alpha`，占位提示画成 0.55 透明（`::placeholder` 的计算样式读不到）；签名里带上 alpha。
  - 为什么：`<input>` 的**当前值不在 `textContent` 里** —— 这是"整页镜像"最初不敢碰新建世界的原因，也是这一批的唯一硬缺口。
  - 验证：`npx vitest run tests/ui2d.test.ts` → **66 passed**（新增 4 条：有值画值 / 空值画占位并标记 / 没有占位就不画 / 单个空格算有值）；`tsc` 干净。
  - 批次：20261027-1354

- [x] [J2] `src/ui2d/menuScreen.ts`：`drawFieldCaret()` 画焦点框的光标与选区；**签名补上 input 的 value** → 预览页 + 截图
  - 做了什么：`drawFieldCaret()` 在镜像画完文字之后，检查 `document.activeElement` 是否属于被镜像的子树，是就按 `selectionStart/End` + `visibleSlice`/`rangeRect`/`caretRect` 画选区与光标（DOM 那份插入符被 `opacity: 0` 一起藏了）。同时修了签名：原来只比 `scrollTop` + `textContent`，**而敲字时 `textContent` 一点没变** → canvas 永远不重画、输入框一直显示占位提示（第一版截图就是这样）。
  - 为什么：镜像路线下"输入"仍归 DOM，但"看得见"归 canvas —— 光标和选区不画，玩家打字时完全看不到自己在哪。
  - 验证：预览页 `menu-mirror.html?view=create` 里把光标真的放进输入框，截图 `19-create-form.png` 显示出"我的世界"（值而非占位）与输入框边框。
  - 批次：20261027-1354

- [x] [J3] `src/main.ts`：镜像白名单加 `create`（`home` / `worlds` / `create`），更新注释 → `npm run check:fast`
  - 做了什么：`mountMenuMirror()` 的视图白名单从两个扩到三个；注释写清"`create` 为什么现在能进来"（取值 + 光标都补上了）以及"多人面板是另一棵树，不在本批范围"。
  - 验证：`npx tsc --noEmit` 干净；`npm run check:fast` 绿。⚠️ 游戏内未实测（dev 缺 `core.bin`）。
  - 批次：20261027-1354

- [x] [J4] 文档：`notes/canvas-ui.md` §5.15（含"签名要看输入框的值"这个坑）、决策 D27 → `node .continue/hooks/check.mjs --fast`
  - 做了什么：§5.15 记录输入框取值与焦点光标的两处实现、"签名要看 value"的坑，以及"阶段 3 还剩多人面板"的清单；决策 D27 记下"镜像路线里输入仍归 DOM、光标归 canvas"的分工。
  - 为什么：那个签名坑**只在真人敲字时才出现**（截图、静态页面都正常），不写清楚下一个人会当成"输入框不刷新"的玄学。
  - 验证：`node .continue/hooks/check.mjs --fast` 绿。
  - 批次：20261027-1354
