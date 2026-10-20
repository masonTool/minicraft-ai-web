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
- [x] 触摸输入
- [x] PlayerPhysics + 基础触摸（左半屏移动 / 右半屏视角）
- [x] 方块交互：轻点放置、长按破坏、快捷栏扣减
- [x] HUD 按 Web 重做：可见摇杆、右下跳跃、快捷栏右侧背包、顶部聊天/暂停/视角矢量图标
- [x] 摇杆拖动/双击潜行自动验收；摇杆头跟随拖动（UI Kit refresh）
- [x] 手指落点白圈（按下/拖动跟随，抬手消失）
- [x] HUD 快捷栏上方显示选中物品名称
- [x] HUD 生命/饥饿条（当前静态 20/20，待生存系统）
- [x] 双击摇杆潜行；方块选中框；合成格拖入不再吞物品
- [x] v2 标题页/开始游戏门控（标题页不生成世界）
- [x] UI Kit：Box/Text/Button/Toggle/Slider、命中、Canvas 叠加、HUD/暂停
- [x] v2 设置页：四页；亮度/视距/灵敏度/FOV/反转Y/自动跳跃/左右手/视角/声音与分组音量
- [x] 声音：WebAudio 垫片 + 放置/破坏音效（无音频上下文时自动降级）
- [x] 外观基础编辑（颜色/发型/胡须/眼睛/披风/眼型/年龄/身架）
- [x] 3D 玩家模型 + 第一/第三人称切换（使用肤色/上衣/裤子）
- [x] 外观：发型/发色/胡须/眼睛颜色/披风 + 3D 模型同步
- [x] 眼型/年龄/身架 + 3D 模型同步
- [x] 声音与全部分组音量（主/方块/UI/生物/玩家/环境/音乐）
- [x] Inventory MVP：物品/创造左侧分类、36/45 格、图标、数量、选中、创造取方块、显式关闭
- [x] Inventory 拖拽交换 + HUD 快捷栏选中
- [x] 2x2/3x3 合成切换、产物、材料拖入/关闭返还（CraftingGrid）
- [x] 配方书：2x2/3x3 过滤、搜索、6 条分页、产物图标/一键填格
- [x] 创造栏搜索/整理；世界卡片累计游玩时间
- [x] 创造栏 Web 五分类（全部/建筑/装备/物品/自然）+ 搜索/整理/分页
- [x] 调试信息开关（FPS/区块/目标/坐标）
- [ ] Inventory 完整态：拖拽细节
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
