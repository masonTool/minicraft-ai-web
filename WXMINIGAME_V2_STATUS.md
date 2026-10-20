# wxminigame-v2 迁移状态

分支：`wxminigame-v2`  
起点：`main`（当前 `c1edde2`）  
原则：main 是源码源；core/render/world 尽量零改动；平台差异在 adapter；UI 用 UI Kit。

## 已完成

- [x] 独立 worktree / 分支，不污染 `main`
- [x] `WXMINIGAME_SYNC.md` 同步流程
- [x] `tools/minigame/sync-audit.mjs` 审计脚本
- [x] `vendor/minigame-adapter` 从现有小程序版本迁入
- [x] `src/platform` 平台层迁入
- [x] `src/core/worker/WorkerLike.ts`（additive 平台 seam）
- [x] `npm run typecheck` 通过
- [x] 主线程 Worker 垫片（复用 main `chunk.worker` 的生成/网格化）
- [x] v2 core 冒烟：main World 生成 9 个区块（`npm run test:v2-core`）

## 尚未完成

- [x] SaveGame / IndexedDB seam（FileSaveGame 内存冒烟通过）
- [x] v2 最小世界渲染启动（main World + TextureAtlas + ChunkRenderer，截图已验证）
- [x] v2 出包：`minigame-v2/game.js` 约 2.2MB
- [ ] 触摸输入
- [x] PlayerPhysics + 基础触摸（左半屏移动 / 右半屏视角）
- [x] 方块交互：轻点放置、长按破坏、快捷栏扣减
- [x] v2 标题页/开始游戏门控（标题页不生成世界）
- [x] UI Kit：Box/Text/Button/Toggle/Slider、命中、Canvas 叠加、HUD/暂停
- [x] v2 设置页：游戏/控制/外观/声音四页；亮度/视距/灵敏度/声音偏好
- [ ] 外观/皮肤编辑器（当前占位）
- [ ] 完整声音/分组音量
- [x] Inventory MVP：物品/创造左侧分类、36/45 格、图标、数量、选中、创造取方块、显式关闭
- [x] Inventory 拖拽交换 + HUD 快捷栏选中
- [x] 2x2/3x3 合成切换、产物、材料拖入/关闭返还（CraftingGrid）
- [ ] Inventory 完整态：配方书/搜索/分页
- [ ] Settings / Inventory 按 Web 结构重做
- [x] 小游戏构建脚本与包体（`build:minigame:v2`，2.2MB）

## 下一步顺序

1. 用平台 SaveGame 承接 IndexedDB。
3. 写 v2 最小启动：World + TextureAtlas + ChunkRenderer 画出一个区块。
4. 正式触摸控件（摇杆/跳跃/挖掘）。
5. 扩展 UI Kit（Toggle/Slider/Scroll/Tabs/Grid），重做 Settings/Inventory。

## 验收

```bash
npm run sync:audit -- --run
npm run typecheck
```

当前 `sync:audit` 在 v2 起点无差异；typecheck 通过。
