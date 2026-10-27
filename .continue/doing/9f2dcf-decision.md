# 决策记录 · 会话 9f2dcf8178d4474f8c0f3f8f4e52851c

> 批次 20261027-1943 · 触控摇杆上 canvas

## D39 · 摇杆**不走镜像**：自己画、几何量 DOM
- 决定：`ui2d/Touch2D.ts` 每帧只读两个矩形（`#touch-stick` 底座、`.knob` 芯子）+ 两个 class 状态，用 `createRadialGradient` / `createLinearGradient` 自己画底座与芯子；DOM 那一份靠 `opacity: 0` 让位，命中与手势完全不动。
- 为什么：摇杆是**唯一连续跟随手指**的控件。镜像那套"读一次 DOM、按原位重画 + 定期重读"在这里有两个毛病：读 `getComputedStyle` 才能拿到渐变与阴影（贵），而按 `pollMs` 重读会落后几帧 —— 表现是"摇杆黏手"。它本身只有两个圆，自己画反而更准、更便宜（2 次 `getBoundingClientRect`，0 次样式计算）。
- 影响：① 观感是手写的一份，色值集中在 `STICK_COLORS`，改 CSS 后要同步这一份（已在 §5.27 写明）；② 渐变必须用真的 canvas 渐变——第一版用两段纯色近似，正中间留了一条硬缝；③ `opacity: 0` 保住了命中（与快捷栏同一条结论），所以拖动、双击切潜行、回中全部照旧。
