# minigame-world（WX-020 真实世界启动）

第一次在微信小游戏里跑**真实地形**：

- `TextureAtlas` 全路径（程序化图集）
- `VoxelMaterial` 自研体素着色器
- `World` + `chunk.worker.js`（生成与网格化共用同一个 worker）
- `ChunkRenderer` 流式加载/网格化/视距裁剪
- 无 UI、无玩家操作，固定相机 + 单指拖拽旋转

## 构建

```bash
cd /Users/mason/DouDou/minicraft-ai-web-wxminigame
npm run build:minigame:world
```

产物：

```
minigame-world/game.js
minigame-world/workers/chunk.worker.js
```

## 导入

微信开发者工具 → 导入项目 → 选择 `minigame-world/` → 项目类型**小游戏**。
AppID 已填，换账号时改 `project.config.json`。

## 屏上 HUD

```
WX-020 WORLD 793x360 dpr 3
ATLAS 850ms 256x1008
CHUNKS 49  DRAWN 49  LIGHT 0  Q 0
FPS 60  MS 16.6  TRI ...  CALLS ...
```

重点看：

| 指标 | 说明 |
|---|---|
| `ATLAS` | 图集生成耗时、尺寸；真机如果 >2s 需要考虑分帧/预生成 |
| `CHUNKS` / `DRAWN` | 已加载/已绘制区块；视距 6 应有约 49 块 |
| `LIGHT` | 光照队列剩余；应逐步收敛到 0 |
| `FPS` / `MS` | 真实地形下的帧率/帧时间 |
| `TRI` / `CALLS` | 几何量与 draw call |

启动失败会弹 `WX-020 启动失败`，把弹窗文字发回来即可。

## 已知风险

- `Random.ts` 依赖 BigInt；入口会先检查，不支持则直接弹窗。
- 生成与网格化共用一个 worker，可能出现排队；先看 `Q` 和 `LIGHT`。
- 还没有玩家物理/存档/UI，这是 WX-020 的下一阶段。
