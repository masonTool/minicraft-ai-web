# 队列 · 会话 9f2dcf8178d4474f8c0f3f8f4e52851c

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-2250

> 用户 2026-10-27：「继续完成，多做一点」—— 替换之前必须补的两块：**提示框**与**耐久条**。
> 镜像方案里 tooltip 是 DOM；自绘一旦接管指针，DOM 的 hover 就收不到事件，提示框会直接消失。

- [x] [G1] `ui2d/itemTooltip.ts`：提示框画法 + `itemTooltipRect()` 位置逻辑（翻左/翻上/夹视口）→ 4 条断言
  - 做了什么：紫底 + 紫边 + 稀有度色条 + 标题/说明行/耐久条；位置纯函数化；内容由 `describeOf` 注入（`ui2d` 不依赖 `core`）。
  - 为什么：自绘面板接管指针后 DOM 的 tooltip 会消失，而"丢提示"很容易被当成"还没做"，不补就会在替换那天才发现。
  - 验证：`tests/ui2d-inventory-model.test.ts` **44 passed**（新增 4 条位置断言：右下 / 翻左 / 翻上 / 夹视口）。
  - 批次：20261027-2250

- [x] [G2] 槽位耐久条：`durabilityOf` 注入 + 接到 `drawInvSlot`；预览页给铁镐接上
  - 做了什么：`InventoryPanelHost` 新增 `durabilityOf`，槽位视图里不再固定传 `null`。
  - 为什么：之前自绘面板里工具类物品没有耐久条（镜像版有），属于"看着不像"的细节。
  - 验证：截图 `36-inventory-tooltip.png` 里铁镐图标下方有绿色耐久条，提示框里有 62/250。
  - 批次：20261027-2250

- [x] [G3] 文档：`notes/canvas-ui.md` §5.39、决策 D51、`TASKS` 的 M27 补一句自绘侧 → `node .continue/hooks/check.mjs --fast`
  - 做了什么：写清"为什么必须先补 tooltip 再替换"，并标注附魔/改名未画。
  - 为什么：替换那一步的风险清单要提前列全，否则又会在真机上才发现少了东西。
  - 验证：`node .continue/hooks/check.mjs --fast` 六项全过。
  - 批次：20261027-2250
