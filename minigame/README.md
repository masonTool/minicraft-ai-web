# minigame（微信小游戏正式开发工程，WX-010 起）

这是微信小游戏的**正式构建目标**。当前入口还是压力场景占位（`WX-020` 抽出
`UiPort` 后替换成真实 App），但构建链路已经按正式约定跑：

- vendored `minigame-adapter`（`vendor/minigame-adapter/`，870d66f + 本分支补丁）
- esbuild 单文件 IIFE，`target: es2017`（真机不支持 `??` / `?.`）
- 主包 4MB 上限检查 + 语法残留提示

## 跑起来

```bash
# 在 worktree 根目录
npm install
npm run build:minigame:formal   # 正式版 → minigame/game.js
```

真实世界预览在独立工程 `minigame-world/`（WX-020A）：

```bash
npm run build:minigame:world    # → minigame-world/game.js
```

`minigame/` 暂时保留为**正式构建壳 + 801 draw call 压力基线**，
WX-020B 抽完 `UiPort` 后会替换成真实 App；一次性对比工程（自写 shim / 适配器版）
已经删除，历史留在 git 里。

然后：

1. 微信开发者工具 → 导入项目 → 选择本目录 `minigame/`。
2. 项目类型选**小游戏**（不是小程序）。
3. `project.config.json` 已填真机 AppID；换账号时改这里。
4. 编译后看顶部 HUD：

```
WX-010 FORMAL  793x360 dpr 3  STRESS 799
GL WebGL 2.0 (OpenGL ES 3.2)
GL ...
FPS 61  MS 16.6  TRI 12720  CALLS 801
```

- `STRESS 799` = 32×32 去掉中央 15×15 后的压力方块数；
- `CALLS 801` = 799 个独立 Mesh + 地面 InstancedMesh + 标记方块；
- 单指拖动转视角；绿色标记方块。

## 构建产物

```
minigame/game.js                    主包（vendored 适配器 + three + 入口）
minigame/workers/chunk.worker.js    真实区块生成/网格化 Worker（WX-018）
```

`game.json` 已声明 `"workers": "workers"`。Worker 里的 `Random.ts` 用 BigInt；
esbuild 会把 `1n` 降成 `BigInt("...")`，但老引擎没有 BigInt 时仍会在运行时报错。
入口会打印 `[WX-...] BigInt true/false`，WX-020 接线时据此决定是否降级到主线程。

## 已知限制

- 仍是压力场景占位，不接世界生成/存档/UI；`WX-020B` 后换成真实 App。
- Worker 产物已就绪；`minigame-world` 在 helper 预览里 worker 不回 pong，会自动降级主线程，真机行为待复测。
- 适配器的假 DOM 只能给库用，**不要拿它做 UI**（见 `WXMINIGAME.md` §2.6）。
- 抖音没有做；M6 单独评估。

## 下一步

- **WX-020B**：抽 `UiPort` + 玩家/输入，接入真实 App。
- **WX-021**：canvas UI 工具包。
- 平台层 WX-011~018 已完成；真机 worker 与真实内存放到 WX-040/041 复测。
