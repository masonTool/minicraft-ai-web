# wxminigame-v2 架构说明

## 目标

- main 继续作为 Web 唯一源码源
- core/render/world 尽量零改动
- 微信差异收敛在 adapter/platform
- v2 不复制 Web DOM UI，使用 Canvas UI Kit
- 包体保持 4MB 以内，移动端优先 60 FPS

## 分层

```
main
  src/core       World / 生成 / 物理 / 合成 / 容器 / 生存 / 存档
  src/render     ChunkRenderer / TextureAtlas / Sky / Weather / VoxelMaterial
        │
        ├── 只做 additive seam（WorkerLike、存档/平台接口）
        ▼
v2
  src/platform   平台抽象与微信 adapter
  src/platform/wx
                 bootstrap / 输入 / storage / files / worker / AudioContext
  src/minigame-v2
                 index.ts          组合根：启动、世界生命周期、帧循环、UI 状态
                 ui-kit/           Canvas UI（Box/Text/Button/Slider/Slot/Icon/Ring/Vital）
                 mobs.ts           猪/羊/僵尸：模型/游走/追击/攻击
                 containers.ts     箱子/熔炉状态、面板、存取、熔炉 tick
                 block-icon.ts     背包/HUD 物品图标与图集 UV
                 inventory-catalog.ts
                                   创造五分类与页签映射
                 recipe-book.ts    配方匹配/取料/填格纯逻辑
                 inventory-tabs.ts 物品/创造/配方页与合成面板 UI
                 quality.ts        画质分级/FPS 自适应
                 wx-mesh-pool.ts   微信真实 Worker 网格化
                 chunk-worker-entry.ts
                                   微信 worker.onMessage 入口
  minigame-v2
                 game.js           主包
                 workers/chunk.worker.js
                                   网格化 Worker（构建生成，git ignore）
```

## 运行时链路

```
标题
→ 世界列表（WorldRegistry / platform.storage）
→ 新建/编辑/删除
→ mountWorld
   ├─ 保存旧世界（玩家/区块/容器）
   ├─ 新建 World + ChunkRenderer
   ├─ FileSaveGame 读回区块/玩家/背包/容器/时间/天气
   └─ 进入 HUD
→ frame
   ├─ 60 FPS 帧率上限
   ├─ 输入/物理
   ├─ 生物/环境/生存
   ├─ 区块请求与网格化（Worker，失败回退主线程）
   ├─ 天空/天气/渲染
   └─ UI Canvas 叠加
```

## 状态归属

| 状态 | 位置 | 持久化 |
|---|---|---|
| 世界清单/时间/难度/模式 | WorldRegistry | platform.storage |
| 玩家位置/背包/health/food/xp/flying/time/weather | FileSaveGame PlayerSave | 平台文件 |
| 方块编辑 | world.edits / FileSaveGame | 平台文件 |
| 容器 | world.containers / ContainerSave | 平台文件 |
| 设置 | `wx.v2.settings` | platform.storage |
| 生物/掉落物 | 运行时数组 | 不持久化（重进世界清空） |

## 平台边界

- `src/platform` 不依赖 Three 或游戏 UI
- core 不感知 DOM、微信 API
- UI Kit 只依赖 Canvas 2D 与设计坐标 1024×uiHeight
- Worker 只通过消息协议通信，不共享对象
- Worker 不可用时，2.5 秒无绘制自动重建主线程 ChunkRenderer

## 性能策略

- 60 FPS 上限
- 画质档：1.5 / 1.25 / 1.0 DPR
- 自动档：连续 3 秒 <55 FPS 降档，稳定 >58 FPS 10 秒回升
- 开局 8 秒内不评估，避免加载期误降
- UI 重绘 33ms 节流
- world.update 仅在跨区块/视距变化时调用
- 可见区块入队 150ms
- 网格化主线程预算 3ms
- 生物 AI 20Hz、天气 30Hz

## 本次架构清理

- 删除 `showHud` 中错误的 `menuScreen = 'title'`
- `PigMob` 更名为 `MobState`（猪/僵尸共用）
- 测试入口 `wx.__v2Test` 只在桌面运行时安装，真机不暴露
- 抽取 `createChunkRenderer`，去掉初始/mount/Worker 回退三处重复构造
- 状态/调试 HUD 暴露 `qualityTier` 与 `meshBackend`
- 抽取 `MobSystem`：猪/羊/僵尸模型、游走、追击、攻击、击杀统一，组合根减少约 350 行
- 抽取 `ContainerSystem`：箱子/熔炉打开、存取、面板、熔炉 tick 移出组合根
- 抽取 `drawBlockIcon` 与创造分类纯逻辑，组合根不再依赖图集布局
- 抽取 `recipe-book.ts`：配方尺寸匹配、背包取 1 份材料、填合成格
- 抽取 `inventory-tabs.ts`：物品/创造/配方三页 + 合成面板 UI 构建，组合根只注入状态与回调
- 抽取 `quality.ts`：DPR 分级、低帧降级、稳定回升、天气可见性

## 已知架构债务

1. `src/minigame-v2/index.ts` 仍是 2800+ 行组合根，包含：
   - 菜单/世界生命周期
   - HUD/容器/设置/背包 UI
   - 生物/掉落/生存
   - 存档/自动保存
2. 猪/羊/僵尸的通用建模/AI 已抽到 `mobs.ts`；后续可继续补更多生物种类与正式 AI
3. 背包/合成/配方书 UI 与游戏逻辑仍耦合在组合根
4. `WorkerHost.post` 忽略 transfer，Worker 消息仍可能发生结构化克隆拷贝
5. Settings/Inventory 尚未按 Web DOM 结构拆分组件

## 建议拆分顺序

1. ~~`mobs/`：MobState、spawn、tick、攻击、掉落~~（已完成）
2. ~~`containers/`：箱子/熔炉面板与存取~~（已完成）
3. `inventory/`：背包/合成/配方书
4. `save/`：snapshot/persist/load/mountWorld
5. `frame/`：主循环、性能管理
6. 仅保留组合根/启动入口

## 剩余任务

### P0 必须完成

- 真机验证：
  - Worker 是否生效（`meshBackend=worker`）
  - 60 FPS / 画质档是否稳定
  - 跨进程存档恢复
  - 声音、容器、生物、床、天气
- 真机低端机 30 分钟稳定性

### P1 功能

- 完整生物/怪物 AI（不只猪/僵尸）
- 门/按钮/拉杆等方块交互
- Settings / Inventory 按 Web 结构继续拆分
- 死亡掉落纹理

### P2 架构

- 按上面 6 步拆分 2800 行组合根
- Worker 池支持多 worker / transfer
- 统一测试 API 与生产构建开关
