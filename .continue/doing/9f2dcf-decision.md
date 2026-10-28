# 决策记录 · 会话 9f2dcf8178d4474f8c0f3f8f4e52851c

> 批次 20261028-1000 · 放置规则与换版面

## D61 · 规则放模型层，`null` 的含义必须在签名上写死
- 决定：`MoveRules.canPlace` 作为唯一闸门，五条放置路径统一调用；`canPlaceInSideSlot(slot, item)` 里 `null` 明确定义为"不是装备"（盔甲格拒绝、副手接受）。
- 为什么：① 规则若散在宿主里，五条路径必漏一条，症状是"拖拽能塞进去、点一下不能"；② `null` 的歧义最贵 —— 第一版按"空手所以放行"实现，规则形同不存在，而断言也照着错的写（`canPlaceInSideSlot('helmet', null) === true`），**测试全绿但功能为零**。
- 影响：`InventoryPanelHost.retarget()` 只改版面不改槽位访问器；接进游戏还差 `InventoryScreen` 暴露容器只读访问器 + 一段下标映射。
