# 决策记录 · 会话 9f2dcf8178d4474f8c0f3f8f4e52851c

> 批次 20261028-1022 · 创造栏搜索与真机清单

## D66 · 搜索要跟 DOM 用同一套别名；验收清单要能打勾
- 决定：`matchesQuery` 接受 `string | readonly string[]`，适配层传 `[itemName, itemLabel, String(id)]`；真机验收写成 `.continue/notes/device-checklist.md`（44 条，动作→期望→打勾）。
- 为什么：① DOM 的搜索是三样都比，canvas 少一个别名，症状是"原版能搜 stone、canvas 搜不到"——这类"少一条匹配规则"的差异，用户会觉得是"canvas 版坏了"；② 剩下的未完成项全都只在有 `core.bin` 的环境成立，散在 TASKS 里没人会逐条走，列成可打勾的清单才会真的被走一遍。
- 影响：清单里六条专防本轮改动（产物格只出不进、`containerDirty`、`shulker_box`、`canPlace`、`creativePick`、暂停后 HUD 恢复），上机时优先走。
