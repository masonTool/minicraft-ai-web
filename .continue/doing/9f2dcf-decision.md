# 决策记录 · 会话 9f2dcf8178d4474f8c0f3f8f4e52851c

> 批次 20261027-2001 · 触控按钮簇 + 图标真源上移

## D40 · 图标几何上移到 `ui2d/`，DOM 与 canvas 各取一半能力
- 决定：六个触控图标的形状（`path` / `rect` / `circle`）放进 `ui2d/touchArt.ts`；`ui/TouchIcons.ts` 从它拼 `<svg>`，canvas 用同一份数据拼 `Path2D`（按 `d` 缓存）。
- 为什么：图标原来是内联 SVG 字符串，canvas 只能"照着抄一份路径"——那是这类迁移里最容易悄悄画歪的地方（歪了不报错，只是看着不像，且没有断言能抓）。上移之后两边共用一份数据，改图标只改一处，`tests/ui2d-touch.test.ts` 还能钉"六个都有形状、互不相同"。
- 影响：① 依赖方向变成 `ui/TouchIcons.ts → ui2d/touchArt.ts`（与 `vitalsArt.ts` 一致）；② 画图标用的是 `Path2D(d)`，SVG 的 `evenodd` 用 `ctx.fill(path, 'evenodd')` 保留（眼睛的虹膜靠它）；③ 阴影用"同形状下移 1px 再画一遍"，不用 `shadowBlur`——后者每帧对 6 个图标会明显掉帧。
