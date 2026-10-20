# minigame-v2 最小世界渲染切片

这是 v2 的第一个运行里程碑，不是完整游戏：

- main 的 World / TextureAtlas / ChunkRenderer
- wx adapter + 主线程 Worker seam
- 无 UI、无玩家、无存档

## 构建

```bash
npm run build:minigame:v2
```

产物：`minigame-v2/game.js`（约 2.2MB）。

## 运行

用微信开发者工具/helper 打开 `minigame-v2`。

## 下一步

- SaveGame seam
- PlayerPhysics / 触摸输入
- UI Kit
