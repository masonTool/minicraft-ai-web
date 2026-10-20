# minigame-v2 最小世界渲染切片

这是 v2 的第一个运行里程碑，不是完整游戏：

- main 的 World / TextureAtlas / ChunkRenderer
- wx adapter + 主线程 Worker seam
- 静态标题页（开始游戏后才生成世界）
- 基础 HUD/暂停/设置/背包 UI（UI Kit MVP）
- PlayerPhysics / 基础触摸 / 文件存档

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
