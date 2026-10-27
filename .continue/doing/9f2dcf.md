# 队列 · 会话 9f2dcf8178d4474f8c0f3f8f4e52851c

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-1009

> 用户 2026-10-27：「你改的这几个地方都不太明显，看不出来效果如何。要不把快捷栏改一下？」
> 阶段 0 那三样（红闪 / Boss 条 / 破坏与进食进度）本来就是为了"不打扰任何人"才挑的纯展示 HUD，
> 结果也确实没人能看出差别。这一批换成**每帧都在眼前、9 格 + 图标 + 数量 + 耐久 + 选中框**的
> 快捷栏 —— 它才是"一眼就能对比出 DOM 与 canvas"的那块。

- [x] [U1] 新建 `src/ui2d/Hotbar2D.ts`：几何纯函数 + 状态签名 + 离屏快照；`tests/ui2d.test.ts` 加断言 → `npx vitest run tests/ui2d.test.ts`
  - 做了什么：新增 `ui2d/Hotbar2D.ts` —— 面板（`#c6c6c6` + 3px 斜面 + 2px 黑描边）、9 个格子（`#8b8b8b` + 2px 斜面）、图标 blit、数量（12px 四向描边）、序号（10px，选中时不透明）、耐久条（3px 三档）、选中格（白框 + 半透明白底 + 上抬 2px + 放大 1.08 + 柔光）；8 个几何纯函数（内容盒 / 图标居中 / 序号与数量锚点 / 耐久轨道与比例 / 选中矩形 / 快照原点）+ `hotbarSignature()`；`Hotbar2D` 类把整条栏画进一张离屏快照，签名不变时每帧只 `drawImage`。`Hud2D` 收下 `setHotbar()` 并最后画它（红闪在 DOM 里在它下面，不该给它上色）。`index.ts` 补导出。
  - 为什么：几何**不抄 CSS 常量**，输入是 `getBoundingClientRect()` 量出来的矩形 —— `--hotbar-slot` 跟断点走、底部还有 `env(safe-area-inset-bottom)`，抄一份常量就是埋一个"转屏错几像素"的回归面。快照缓存是因为 9 格每帧重画要付二十几次填充 + 十几次文字，而快捷栏的变化率极低（见决策 D1、D3）。图标不自己实现，沿用现成的 `.slot canvas`（`ui/ItemIcon` 是唯一入口，见 D4）。
  - 验证：`npx vitest run tests/ui2d.test.ts` → **34 passed**（新增 12 条）；`npx tsc --noEmit` 干净。
  - 批次：20261027-1009

- [x] [U2] `src/main.ts` 接线 `?ui2d=1`：DOM 快捷栏让位（保留布局与命中），pixels 全由 canvas 画；`?ui2d=0` 完全回退 → `npm run check:fast && npm run build:fast`
  - 做了什么：`refreshHotbar()` 末尾只做两件事——`hotbar2dRevision += 1` 与置脏（**不量 DOM**：它被十几个事件路径调用，量 10 个 `getBoundingClientRect()` 每次都会强制布局）；真正测量与喂状态在每帧的 `updateHotbar2D()` 里，一帧最多一次。`applyHotbar2DDomFallback()` 把 `#hotbar` 的底/斜角/描边设成透明（**边框宽度保留**，否则两侧背包按钮位移 3px），9 个 `.slot` 设 `opacity: 0`。`#hotbar` 被 `visibility: hidden` 藏起来时（打开携带版背包）每 8 帧复查一次。
  - 为什么：**命中继续借 DOM**（见决策 D2）。覆盖层的 `pointer-events` 是元素级、铺满全屏，打开就吃掉 `#touch-look` 的视角手势；而 `visibility: hidden` / `display: none` 会让格子退出命中，连 `bindHotbarTouch` 与长按看物品一起失效 —— 所以只能用 `opacity: 0`。
  - 验证：`npm run check:fast` 绿（655 条单测）；`npm run check` 全量 **exit=0**（181 套离线 + 三张台账 + 文档体量）；`npm run build:fast` 出包成功；`npx tsc --noEmit` 干净。⚠️ **真机观感未验**：本会话没有浏览器，dev 模式下 `__host/core.bin` 缺失会停在落地页 —— A/B 步骤写在 `notes/canvas-ui.md` 的 §5.1。
  - 批次：20261027-1009

- [x] [U4] 加 `tools/preview/hotbar.html` 对照页：不用进世界就能把 DOM 版与 canvas 版摆在一起看；顺手把数量字重对齐 CSS → `node tools/screenshot.mjs --url http://localhost:5173/tools/preview/hotbar.html --out hotbar-preview.png`
  - 做了什么：一页 HTML —— 上半是照抄 `index.html` 那几条 CSS 的 DOM 版，下半是 `Hotbar2D` 画进 canvas 的版本，同一份假数据（空槽 / 数量 / 选中格 / 黄耐久 / 红耐久）。几何照样用 `getBoundingClientRect()` 量 DOM 再喂给 canvas，与 `main.ts` 走同一条路。数量字号原来是 700，改成跟 CSS 一致（`.count` 没写 `font-weight`）——迁移期两边并存，字重不同在 A/B 里就是"像素不一致"。
  - 为什么：用户说的"看不出来效果"有一部分是**验收成本**问题 —— `?ui2d=1` 得先能进世界才看得到，而 dev 缺 `__host/core.bin` 会停在落地页。有了这一页，"画得对不对"不再被"能不能进世界"卡住；阶段 1 的控件库、阶段 2 的血条也能往这里加。
  - 验证：`npx vite --port 5199` + `node tools/screenshot.mjs --url .../tools/preview/hotbar.html --out hotbar-preview.png` → 截图已存 `.tmp/shots/hotbar-preview.png`，逐项对照两排：格子尺寸/斜面、图标位置、数量与序号锚点、耐久条位置与长度、选中格的白色边框与上抬都对得上（唯一剩下的差异是文字抗锯齿）。⚠️ 页面自带 1 条 `console.error`：favicon 404，与页面无关。
  - 批次：20261027-1009

- [x] [U3] 更新 `.continue/notes/canvas-ui.md`：把"阶段 1.5 快捷栏"的判据、命中仍借 DOM 的理由、A/B 步骤写进去 → `node .continue/hooks/check.mjs --fast`
  - 做了什么：阶段表加 `1.5 快捷栏 ✅` 一行；新增 §5.1（做法 + 四条 A/B 步骤 + "这一版不能用来量省了多少 DOM 开销"的警告）与 §5.2（复盘阶段 0 为什么证明不了任何东西：三样都低频、都在屏幕边缘，选样品的判据从"最不打扰"改成"最容易对比"）；§6 判定表补一行"快捷栏的点击/长按：画在 canvas、命中仍走 DOM"。
  - 为什么：这次的教训是**选样品的方式**，不是某个函数写错了。不写下来，下一批还会有人挑"最安全的三样"去证明"改造值不值"。
  - 验证：`npm run check` exit=0（`audit:docs` 与文档体量检查都在里面）；决策写在 `doing/9f2dcf-decision.md` D1~D4。
  - 批次：20261027-1009
