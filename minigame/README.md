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

旧的自写 shim 版本仍保留用于对比：

```bash
npm run build:minigame          # 会覆盖 minigame/game.js，HUD 显示 WX-001 SHIM
```

适配器对比工程在 `minigame-adapter-spike/`，用 `npm run build:minigame:adapter`。

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

## 已知限制

- 仍是压力场景占位，不接世界生成/存档/UI；`WX-020` 后换成真实 App。
- Worker 还没接（`WX-018`）；`game.json` 暂未声明 `workers`。
- 适配器的假 DOM 只能给库用，**不要拿它做 UI**（见 `WXMINIGAME.md` §2.6）。
- 抖音没有做；M6 单独评估。

## 下一步

- **WX-020**：抽 `UiPort` + App 条件启动，接入真实世界。
- **WX-018**：两套 Worker 池合并 + 单 worker 消息通道。
- **WX-011..017**：平台接口/存储/音频/输入/生命周期。
