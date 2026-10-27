# 决策记录 · 会话 9f2dcf8178d4474f8c0f3f8f4e52851c

> 批次 20261027-1153 · 状态栏四行 + 经验条迁 canvas（阶段 2 第一块）

## D7 · 图标形状与色值抽到 `ui2d/vitalsArt.ts`，DOM 版反过来 import 它
- 决定：心 / 鸡腿 / 护甲 / 气泡的 SVG 路径、色值、三态判据从 `ui/VitalsHud.ts` 搬到 `ui2d/vitalsArt.ts`；`ui/VitalsHud.ts` 改为 import。依赖方向因此变成 `ui/ → ui2d/`（与既有约定一致：ui2d 只许依赖 `ui/Device.ts`）。
- 为什么：这两边画的是**同一组图标**，路径抄两份必然漂，而"DOM 的心胖了一点"这种差异没有任何断言会抓到。三态判据（2 点整颗 / 1 点半颗）尤其关键：分家就会出现"DOM 半颗、canvas 整颗"——两边都"看着对"，只有摆在一起才看得出来。
- 影响：改图标只改一处，两侧同时生效；`ui/VitalsHud.ts` 少了一屏常量。退得回去：把这些常量搬回 `ui/` 即可，但那样 canvas 侧就要重启一份副本。

## D8 · 状态栏用 `visibility: hidden` 让位（与快捷栏的 `opacity: 0` 相反）
- 决定：`?ui2d=1` 时 `#vitals` 与 `#xp-bar` 直接 `visibility: hidden`；快捷栏那边仍然只能用 `opacity: 0`。
- 为什么：`visibility: hidden` 会让元素**退出命中测试**——对快捷栏是致命的（点格子切槽、长按看物品都靠它），但状态栏和经验条**本来就是纯展示**，没有任何点击。反过来 `visibility` 还能让浏览器跳过这一层的绘制，比 `opacity: 0`（仍参与合成）更省。
- 影响：两者都保留布局，所以 canvas 仍能从 DOM 量到矩形（图标尺寸随断点 18 / 14 / 22px 变，不能抄常量）。**边界**：将来若给状态栏加点击（比如点血量开详情），必须换回 `opacity: 0`，否则点了没反应。

## D9 · 低血量脉冲不重建快照，只在 blit 时套变换
- 决定：脉冲（`#vitals.low-health` 的 1s `scale(1.06)`）由 `vitalsPulseScale(seconds)` 算倍率，在 `drawImage` 外层 `translate → scale → translate` 完成；快照签名里**不含脉冲**。
- 为什么：脉冲每秒一个来回、一直跳，若写进签名就等于每帧重画 20 个图标（Path2D 填充 + 半颗裁剪）。做成变换之后稳态仍是每帧一次 blit。
- 影响：脉冲的 `drop-shadow` 红晕没做——一次全屏级 `shadowBlur` 不值这个价，"跳"在、红晕不在；曲线用 `1 - cos` 近似 CSS 的 ease-in-out（两端斜率同为 0，肉眼分辨不出，但**可断言**）。退得回去：删掉 `draw()` 里那段变换即可。
