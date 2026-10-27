# 队列 · 会话 9f2dcf8178d4474f8c0f3f8f4e52851c

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-1517

> 用户 2026-10-27：「请直接处理背包」—— 进阶段 4。
> 背包是整个迁移里最大的一块（7564 行），但它有个有利结构：**每格槽位就是 42×42 盒子 +
> 一张 36×36 图标 canvas + 一个数量文本**，与快捷栏几乎同构。所以先做「槽位像素」，
> 交互（拖拽/分堆/连发）**一行都不动**。

- [x] [L1] `src/ui2d/Inventory2D.ts`：槽位几何与绘制（底/斜面/图标/数量/耐久/红底/白框）+ 签名 + 读 DOM → `npx vitest run tests/ui2d-inventory.test.ts`
  - 做了什么：`Inventory2D.ts`（约 330 行）—— `invContentRect` / `invIconRect`（等比居中）/ `invCountAnchor` / `invDurabilityRect` / `invSignature` / `drawInvSlot`；`readInvSlots()` 从 DOM 读每格的矩形、图标 canvas、数量、耐久条比例与档位、`:hover`/`:active`、`.locked`/`.held`；`readSlotSkin()` 从 CSS 变量读底面与四边斜面颜色（不抄常量）；`Inventory2D` 自带一层覆盖层（zIndex 12）+ 签名缓存，`update()` 每帧读 DOM、变了才重画。
  - 为什么：槽位与快捷栏同构，直接复用那套结论（量 DOM、像素换手不换输入）；`#inv-held`（拿在手上的那一叠）也一起画，否则拖动时图标会消失。
  - 验证：`npx vitest run tests/ui2d-inventory.test.ts` → **9 passed**（内容盒、图标居中与收窄、数量/耐久锚点、自定义边框宽度、签名稳定性与各字段变化）；`tsc` 干净。
  - 批次：20261027-1517

- [x] [K2→L2] `src/main.ts`：打开背包时接管（让位用挂在 `<html>` 上的类，扛得住槽位重建）→ `npm run check:fast`
  - 做了什么：新增 `inventory2d`（`Inventory2D`，zIndex 12）与 `syncInventory2d()`：`inventoryScreen.isOpen` 变化时开关，开着时每帧 `update()`；让位靠 `<style>` 里一条 `html.ui2d-inv #inventory-screen .inv-slot, html.ui2d-inv #inv-held { opacity: 0 }` + 切换 `<html>` 上的类（**不用逐元素内联样式**：背包切模式/换容器会重建槽位 DOM）。
  - 为什么：`opacity: 0` 保住了命中测试，于是拖拽分配、长按分堆、连发、悬停提示全都不用改；而"逐元素设 opacity"在重建后失效 —— 槽位会闪回 DOM 原样。
  - 验证：`npx tsc --noEmit` 干净；`npm run check:fast` 绿。⚠️ 游戏内未实测（dev 缺 `core.bin`）。
  - 批次：20261027-1517

- [x] [L3] 预览页 `tools/preview/inventory.html`（27 格 + 快捷栏行 + 红底格 + 选择白框）+ 2 张截图 → `node tools/preview/shoot-all.mjs`
  - 做了什么：造了 27 格 + 9 格假槽位（图标用纯色块代替真实图集裁切、数量 64/12/3/32、两格带耐久条、一格红底、一格选择态），`Inventory2D` 接管绘制；`?tint=1` 加遮罩；`shoot-all` 加 2 张（累计 40 张）。
  - 为什么：背包的槽位在各种工作台上数量不同（27/36/45），但**绘制代码只有一份**；预览页用 27 格就能看清底、斜面、图标、数量、耐久、红底、白框是否都对。
  - 验证：`node tools/preview/shoot-all.mjs` 40 张全出；截图看过：格子斜面方向（上/左暗、下/右亮）、64/12/3/32 数字贴右下、黄/红耐久条、红底格、白框选择态都对。
  - 批次：20261027-1517

- [x] [L4] 文档：`notes/canvas-ui.md` §5.17（两条沿用 + 两个专坑 + "还没做的"表）、决策 D29 → `node .continue/hooks/check.mjs --fast`
  - 做了什么：§5.17 记下"槽位与快捷栏同构"的判断、`<html>` 类让位的原因、z-index 12 的理由，并明确列出"布局与交互仍是 DOM"的边界；决策 D29 记下"背包只换像素不换交互"。
  - 为什么：背包最容易被误解成"整个界面都要重画"。写清楚"槽位是像素、交互是 DOM"这条线，才不会被后来的人越改越多。
  - 验证：`node .continue/hooks/check.mjs --fast` 绿。
  - 批次：20261027-1517
