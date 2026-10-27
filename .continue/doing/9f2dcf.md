# 队列 · 会话 9f2dcf8178d4474f8c0f3f8f4e52851c

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-1218

> 用户 2026-10-27：「继续继续继续」—— 把**阶段 2 的最后一块**（提示条族）收掉：
> 目标名、攻击蓄力条、切槽时浮出的物品名。三样都是纯展示、都不吃事件，
> 做完之后「底部 HUD + 准星周围的东西」就全是 canvas 的了。

- [x] [X1] `src/ui2d/overlays.ts`：三样提示条的画法 + 纯函数（`attackChargeRect` / `attackChargePercent` / `itemNameAlpha`），`Hud2D.setTips()` 统一收口 → `npx vitest run tests/ui2d.test.ts`
  - 做了什么：`overlays.ts`（约 200 行）—— `drawTargetLabel` / `drawAttackCharge` / `drawItemNamePop` / `drawTips` + `attackChargeRect`（44×3、准星下 16px）/ `attackChargePercent`（量化到 2%，与 DOM 版同口径）/ `itemNameAlpha`（350ms 淡入 → 保持 2000ms → 350ms 淡出）；`Hud2D.setTips()` 在**所有绘制之后**画（提示条在原 DOM 里就是最上面那层）。
  - 为什么：**不做快照缓存**（决策 D13）—— 三样加起来每帧就两次 `fillText` + 一块 44×3 小矩形，为它维护签名比直画还贵；缓存是按量级决定的，不是按"要不要优化"。
  - 验证：`npx vitest run tests/ui2d.test.ts` → **51 passed**（本批 +5）；`npx tsc --noEmit` 干净。
  - 批次：20261027-1218

- [x] [X2] `src/main.ts` 接线 `?ui2d=1`：三样 DOM 让位（`visibility: hidden`），矩形仍从 DOM 量（文本长度/触摸 pinned 位置都在 CSS 里），alpha 按时间算 → `npm run check:fast && npm run build:fast`
  - 做了什么：`applyTipsDomFallback()` 把 `#target-info` / `#attack-cooldown` / `#selected-item-name` 设 `visibility: hidden`（保留布局，canvas 才能量到"随文本变宽、触摸时被 JS 挪位"的矩形）；`syncTips2D()` 每帧喂状态——目标名与物品名**只在文本/锚点/视口变时量 DOM**，蓄力条的几何直接由 `attackChargeRect(overlay.width, overlay.height)` 算；`showSelectedItemName()` 里记 `itemNameShownAt`，淡化交给 `itemNameAlpha`；resize 时 `tips2dEpoch += 1`。
  - 为什么：物品名的淡出 canvas 里没有 transition，要么按时间算要么每帧 `getComputedStyle`（更贵且不可断言）；按时间算还顺带解决了"暂停时不淡"（决策 D14）。
  - 验证：`npm run check:fast` 绿；`npm run check` exit=0；`npm run build:fast` 出包；`tsc` 干净。⚠️ 真机观感未验。
  - 批次：20261027-1218

- [x] [X3] 预览页 `tools/preview/tips.html` + `shoot-all` 补图，重拍 `.tmp/canvas-version/` 并更新 README → `node tools/preview/shoot-all.mjs`
  - 做了什么：`tips.html` 按 `index.html` 那几条 CSS 建真 DOM（`visibility: hidden`）只为测量，再把矩形喂给 `Hud2D.setTips()`；参数 `?target=&item=&charge=&age=&tint=1`。`SHOTS` 加 3 张（`11-tips` / `11b-tips-fade` / `11c-tips-tinted`），累计 22 张；`.tmp/canvas-version/README.md` 的进度表与 URL 表同步。
  - 为什么：提示条是"一闪而过"的东西（物品名 2 秒、蓄力条不到 1 秒），截图必须能把状态定住；`age=2175` 那张专门展示"淡出到一半"。
  - 验证：`node tools/preview/shoot-all.mjs` 22 张全出；逐张看过：目标名贴在准星下方、蓄力条 44px 在它上面不远、物品名胶囊在快捷栏上方；`charge=100` 那版条确实消失；`age=2175` 那版半透明。
  - 批次：20261027-1218

- [x] [X4] 文档：`notes/canvas-ui.md` §5.6（阶段 2 收尾 + 还剩表盘）、决策 D13/D14 → `node .continue/hooks/check.mjs --fast`
  - 做了什么：阶段 2 行改成"只剩指南针·时钟表盘"；新增 §5.6（三处与前面不同的做法 + "阶段 2 还剩什么"表）；决策 D13（不做快照缓存）、D14（淡出按时间算）。
  - 为什么：D13 容易被误解成"偷懒"——所以写清了判据是**量级**；D14 的代价（低帧率跳格）也写在正面，免得以后有人当成 bug 去修。
  - 验证：`node .continue/hooks/check.mjs --fast` 六项全过；`npm run check` exit=0。
  - 批次：20261027-1218
