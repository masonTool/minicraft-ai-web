# minigame-world（WX-020A/B 真实世界）

第一次在微信小游戏里跑**真实地形 + 第一人称玩家**：

- `TextureAtlas` 全路径（程序化图集）
- `VoxelMaterial` 自研体素着色器
- `World` + `chunk.worker.js`（生成与网格化共用同一个 worker；worker 不回 pong 时自动降级主线程）
- `ChunkRenderer` 流式加载/网格化/视距裁剪
- `PlayerPhysics` + 平台 pointer 输入：左半屏移动、右半屏视角、右下角跳跃
- 还没有 UI/背包/存档；下一步 WX-020B 抽 `UiPort`

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
WX-020 WORLD 844x390 dpr 3  P 9,67,9 G1
ATLAS 224ms 256x1040  W main  T grass_block  SLOT 1/6
CHUNKS 37  DRAWN 37  LIGHT 0  Q 0
FPS 119  MS 8.4  TRI 229322  CALLS 254
L tap cycle/drag move · R drag look/tap top place mid break bottom jump
```

- `P x,y,z G0/1`：玩家坐标、是否落地；
- `T ...`：准星命中的方块（黑色选中框会套住它）；
- `SLOT 1/6`：快捷栏当前槽位；底部 6 格是真实图集图标，白框为当前槽位；
- 左半屏拖动 = 摇杆，轻点 = 切快捷栏；
- 右半屏拖动 = 视角，轻点分区：上 = 放方块、中 = 挖方块、下 = 跳跃；
- `WORKER wx` 表示真机 worker 可用；`main` 表示自动降级主线程；
- `SAVE ready/ok/error`：文件存档状态；`AUD ready/on`：音频状态；
- 玩家位置、快捷栏、方块改动会存到 `wxfile://usr/save/wx-default/`，15 秒自动保存、挖放后 1.2 秒去抖保存、切后台立即保存；重开预览会恢复玩家。

重点看：

| 指标 | 说明 |
|---|---|
| `ATLAS` | 图集生成耗时、尺寸；真机如果 >2s 需要考虑分帧/预生成 |
| `CHUNKS` / `DRAWN` | 视距 3 约 37 块；全部 DRAWN 说明网格化完成 |
| `LIGHT` | 光照队列剩余；应逐步收敛到 0 |
| `Q` | 网格化队列；应降到 0 |
| `FPS` / `MS` | 真实地形下的帧率/帧时间 |
| `TRI` / `CALLS` | 几何量与 draw call |

启动失败会弹 `WX-020 启动失败`，把弹窗文字发回来即可。

## 已知限制

- `Random.ts` 依赖 BigInt；入口会先检查，不支持则直接弹窗。
- helper 预览里 `wx.createWorker` 不回 pong，会自动降级主线程（启动约 12s、5fps，完成后 120fps）。
- 方块交互是基础射线版：固定 6 格快捷栏、无破坏进度/音效/掉落物；这些与背包/存档一起在 WX-020B 后续和 WX-021 补。
