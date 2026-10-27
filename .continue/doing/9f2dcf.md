# 队列 · 会话 9f2dcf8178d4474f8c0f3f8f4e52851c

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-1153

> 用户 2026-10-27：「继续」—— 接着做**阶段 2 的第一块**：状态栏四行（生命 / 饥饿 / 护甲 / 氧气）
> 与经验条。它们和快捷栏一样"每帧都在眼前"，而且**全是纯展示**（没有命中测试），
> 是整条底栏里最后两块 DOM。做完之后打开 `?ui2dtint=1`，屏幕底部会整排变黄。

- [x] [V1] 抽出图标真源 + `src/ui2d/Vitals2D.ts`：`vitalsArt.ts`（心/鸡腿/护甲/气泡的 SVG 路径与色值，`ui/VitalsHud.ts` 改成 import 它）；`Vitals2D` 用 Path2D 画四行、离屏快照、低血量脉冲按帧外挂变换 → `npx vitest run tests/ui2d.test.ts`
  - 做了什么：`ui2d/vitalsArt.ts` 收下四条 SVG 路径 / 七个色值 / 两个三态判据（`vitalIconState`、`bubbleIconState`），`ui/VitalsHud.ts` 删掉本地常量改为 import（依赖方向 `ui/ → ui2d/`）。`ui2d/Vitals2D.ts` 用 `Path2D` 填同一份 `d`，半颗在 **9×9 坐标系**里裁 `rect(0,0,4.5,9)`；整块画进离屏快照（签名不含脉冲），低血量脉冲在 blit 时套 `1→1.06` 变换。
  - 为什么：图标两边都要画，路径抄两份必然漂，而"DOM 的心胖一点"没有任何断言抓得到；三态判据分家更糟（会出现一半整颗一半半颗）。脉冲写进签名就等于每帧重画 20 个图标、而它每秒一个来回（见决策 D7、D9）。
  - 验证：`npx vitest run tests/ui2d.test.ts` → **46 passed**（新增 6 条：三态 / 气泡分档 / 行内等距 / 包围盒 / 脉冲曲线 / 签名不含脉冲）。
  - 批次：20261027-1153

- [x] [V2] `src/ui2d/Xp2D.ts`：经验条（轨道 / 渐变填充 / 柔光）+ 等级牌（黑描边绿字，压在条中间），快照按 1% 取整 → 同上
  - 做了什么：轨道 `#14150f` 圆角 3 + 顶部暗线近似内阴影 + 外侧一圈淡黑边；填充 `#c2ff7a→#63c335` 竖向渐变、顶 1px 高光、右端 2px 柔光；等级牌宽 = 文字宽 + 10、高 18、圆角 4、半透明黑底，绿字四向黑描边。签名把进度**取整到 1%**。
  - 为什么：DOM 版自己就是 `Math.round(ratio*100)%`，canvas 按同一粒度重建才既跟得上又不会因浮点每帧重建。柔光只在快照里付一次（`shadowBlur` 在手机上是真开销）。
  - 验证：同上 46 条（其中 4 条打在这里：百分比取整/夹取、填充宽度、等级牌居中、签名 1% 粒度）。
  - 批次：20261027-1153

- [x] [V3] `src/main.ts` 接线 `?ui2d=1`：状态栏与经验条 DOM 让位（纯展示，用 `visibility: hidden`）、几何量 DOM、按 key 变脏才量 → `npm run check:fast && npm run build:fast`
  - 做了什么：`applyVitalsDomFallback()` 把 `#vitals` / `#xp-bar` 设 `visibility: hidden`（保留布局，canvas 才能量到随断点变化的 18/14/22px 图标）；`syncVitals2D(noVitals)` 每帧拼一个 key（生命/饥饿/氧气/护甲/等级/经验百分比/模式/`epoch`），变了才量 40 个 `svg.vital-icon` 与 `#xp-bar` 并喂给 `Hud2D`；resize 时 `vitals2dEpoch += 1` 强制重量。
  - 为什么：DOM 版内部本来就按 key 早退，但"每帧量 40 个 rect"是强制布局，必须挡在 key 后面；`epoch` 解决"数值没变、转屏后矩形变了"这件 key 看不见的事。`visibility` 而非 `opacity`：这两块没有命中测试，`visibility` 还能让浏览器跳过这层绘制（决策 D8）。
  - 验证：`npm run check:fast` 绿（46 条单测 + typecheck）；`npm run build:fast` 出包成功；`npx tsc --noEmit` 干净。⚠️ 真机观感未验（本会话没有浏览器进世界）。
  - 批次：20261027-1153

- [x] [V4] 预览页 `tools/preview/vitals.html` + `shoot-all.mjs` 补图，重拍 `.tmp/canvas-version/` 并更新其 README → `node tools/preview/shoot-all.mjs`
  - 做了什么：新页 `vitals.html` 用**真的** `VitalsHud` / `XpHud` 建 DOM（只为测量，设 `visibility: hidden`），再把矩形喂给 `Hud2D`，所以它走的与游戏里同一条路；参数 `?health&food&air&armor&level&xp&tint&pulse`。`SHOTS` 加 3 张（`09-vitals` / `09b-vitals-low` / `09c-vitals-tinted`），累计 14 张，README 的进度表与"URL → 看到什么"同步更新。
  - 为什么：截图是这一批的唯一"凭证"——用户上一轮的原话就是"截图发我"。顺带踩到一个真实的坑：预览页把 `MAX_AIR` 写成 30，而真值是 300（10 颗气泡、每颗 30 点），结果"氧气是否满""每颗几点"全算错；改成 import 真源后立刻对上了。
  - 验证：`node tools/preview/shoot-all.mjs` 14 张全出；逐张看过：13 点生命 = 6 整 + 1 半 + 3 空、17 饥饿 = 8 整 + 1 半 + 1 空、5 护甲 = 2 整 + 1 半、180/300 氧气 = 6 颗；残血版护甲/气泡两行整行不显示；遮罩版底部整块黄。
  - 批次：20261027-1153

- [x] [V5] 文档：`notes/canvas-ui.md` 加 §5.4（阶段 2 已落地部分与"哪些还没搬"）、决策 D7~D9 → `node .continue/hooks/check.mjs --fast`
  - 做了什么：阶段表把 2 标成 🟡（血条/饥饿/护甲/氧气/经验条 ✅，只剩提示条）；新增 §5.4（Path2D 与 9×9 裁剪、量 DOM 的理由、`visibility` vs `opacity`、脉冲不重建快照、断言清单、预览页与三张截图、以及"阶段 2 还剩什么"表）；决策 D7（图标真源上移）、D8（`visibility: hidden` 的适用边界）、D9（脉冲走变换）。
  - 为什么：这三条决策都不是"随手这么写"——尤其 D8，它和快捷栏的结论**相反**，不写清边界，下一个人会给快捷栏套 `visibility` 然后点不动。
  - 验证：`node .continue/hooks/check.mjs --fast` 六项全过；`npm run check` exit=0。
  - 批次：20261027-1153
