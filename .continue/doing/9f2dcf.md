# 队列 · 会话 9f2dcf8178d4474f8c0f3f8f4e52851c

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-2307

> 用户 2026-10-27：「继续完成，多做一点」—— 替换前最后一块地基：**光标合流**。

- [x] [H1] `InventoryPanelHost.externalCursor`（拉/推）+ `InventoryScreen.heldStack` 只读 getter → 预览 `?ext=1` 验证
  - 做了什么：入口（`open` / `handlePointer`）先 `pullCursor()`；`render()` 里 `pushCursor()`（没给 `set` 就只读）；游戏侧接 `get: () => inventoryScreen.heldStack`。
  - 为什么：DOM 与自绘各存一份 held，拖动时屏幕上会出现**两叠**；合流之后自绘只做视图。
  - 验证：`?ext=1` 里打开即画出外部 `3×5`，移动后仍是 `3×5`，且外部对象未被写脏（只拉不推）；`tsc` 干净。
  - 批次：20261027-2307

- [x] [H2] 只读是有意为之：`set` 留到"接管输入"那一批再加
  - 做了什么：`externalCursor.set` 设为可选；文档写明为什么现在不推。
  - 为什么：这一阶段自绘面板不吃输入，写了 `set` 只会和 DOM 的逻辑打架；等 DOM 面板不再渲染时再加，就不存在两份状态。
  - 验证：`tsc` 干净；`npm run check` exit=0；截图 `37-inventory-external-held.png` 里那一叠由外部驱动。
  - 批次：20261027-2307

- [x] [H3] 文档：§5.40（两份状态的具体症状 + 只读的理由）、决策 D52 → `node .continue/hooks/check.mjs --fast`
  - 做了什么：把"合流"写成一节，含游戏侧那段接法与只读理由。
  - 为什么：下一个人很容易顺手把 `set` 写上，然后在没接管输入时看到行为诡异。
  - 验证：`node .continue/hooks/check.mjs --fast` 六项全过。
  - 批次：20261027-2307
