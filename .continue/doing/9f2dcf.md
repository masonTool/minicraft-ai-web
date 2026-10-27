# 队列 · 会话 9f2dcf8178d4474f8c0f3f8f4e52851c

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-2023

> 用户 2026-10-27：「继续完成，多做一点」—— 先修背包的两个真问题（一个是我自己引入的回归），
> 再继续往 M26b 走。

- [x] [X1] 修回归：`html.ui2d-inv #inv-held { opacity: 0 }` 删掉 —— 拖动物品时那一叠会消失
  - 做了什么：去掉那条让位规则（`#inv-held` 在镜像根 `.inv-shell` 外面，藏了没人画），改由 DOM 继续绘制；顺手把注释改成"为什么不能藏"。
  - 为什么：让位 + 没人接手 = 内容消失；而它只在拖动时出现，静态截图完全正常（与 `.inv-shell` 那次同源）。
  - 验证：`tsc` 干净；`npm run check:fast` 绿。
  - 批次：20261027-2023

- [x] [X2] `MenuScreen2D.setHighlight()` + `main.ts` 用 `elementFromPoint` 算悬停格 → 截图
  - 做了什么：镜像新增"悬停高亮"（白框 + 薄白底，画在所有内容之上）；`setHighlight()` 只比重画、不重读 DOM；`main.ts` 全局记指针位置，`inventoryHoverRect()` 用 `elementFromPoint(...).closest('.inv-slot')` 找那一格。
  - 为什么：`.inv-slot:hover` 在 `opacity: 0` 的子树里看不见，玩家会以为"这格点不动"；而 `elementFromPoint` 天然跟着滚动与布局走，比自己算几何稳。
  - 验证：预览页 `?hover=13` 截图里第 13 格有白框+薄白底；`tsc` 干净；`check:fast` 绿。
  - 批次：20261027-2023

- [x] [X3] 文档：`notes/canvas-ui.md` §5.30（两处修复 + "让位前先确认由谁画"的教训）、决策 D42 → `node .continue/hooks/check.mjs --fast`
  - 做了什么：记下"让位 + 没人接手 = 内容消失"这条通用教训（第二次踩），以及 `setHighlight` 只重画不重读的取舍。
  - 为什么：这两条都会在接 M26b 时反复出现，写清楚能少踩。
  - 验证：`node .continue/hooks/check.mjs --fast` 六项全过。
  - 批次：20261027-2023
