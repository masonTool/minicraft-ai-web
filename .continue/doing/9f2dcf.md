# 队列 · 会话 9f2dcf8178d4474f8c0f3f8f4e52851c

> 状态：执行中
> 创建：2026-10-28
> 批次：20261028-0946

> 用户 2026-10-28：「请继续执行未完成的任务」——待办已清零，继续推进进行中的背包线。

- [x] [X1] `ui2d/stationLayouts.ts`：20 条工作站预设 + `stationExtra`（含 flame）
  - 做了什么：表 + 三个查询函数；测试 11 条（槽位数、火焰/进度标记、存储类无结果格、未知种类退化）。
  - 为什么：宿主写 `if (kind === ...)` 永远没法一眼看完支持范围。
  - 验证：`test:ui2d-station` 11/11；预览 `?station=furnace` 截图。
  - 批次：20261028-0946

- [x] [X2] `ui2d/armorRules.ts`：装备列放置规则 + 下标换算
  - 做了什么：`canPlaceInSideSlot` / `sideSlotFor` / `sideSlotAt(index, sideStart)`。
  - 为什么：装备列当成普通格子，玩家能把面包塞进头盔格。
  - 验证：`test:ui2d-armor` 7/7（含"装备列不从 0 开始"的换算）。
  - 批次：20261028-0946

- [x] [X3] 预览接预设 + 修 `flame` 漏传
  - 做了什么：`?station=furnace&progress=0.45`；`stationExtra` 带上 `flame` 并加断言。
  - 为什么：表里写了没人读 = 字段变注释，火焰块不排版。
  - 验证：截图 `45-inventory-furnace.png`（原料/燃料 + 箭头 45% + 火焰）。
  - 批次：20261028-0946
