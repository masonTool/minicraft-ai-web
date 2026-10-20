# minigame（WX-001 spike）

这是微信小游戏移植的**技术验证工程**，不是最终版本。
它只回答一个问题：**three r186（WebGL2-only）在微信小游戏真机上能不能跑、帧率多少。**

## 跑起来

```bash
# 在 worktree 根目录
npm install
npm run build:minigame      # 产出 minigame/game.js
```

然后：

1. 打开微信开发者工具 → 导入项目 → 选择本目录 `minigame/`。
2. 项目类型选**小游戏**；AppID 先填自己的小游戏 AppID（`project.config.json` 里的
   `touristappid` 只能跑模拟器，真机预览要换成真实 AppID）。
3. 编译后看控制台：
   - `[WX-001] GL_VERSION` / `GL_RENDERER`：确认拿到的是 WebGL2。
   - `[WX-001] fps=... tri=... calls=...`：每秒一条。
4. 画面上应该有一块 16×16 的绿色方块地面 + 一根柱子 + 一个旋转的红色方块；
   单指拖动可以转视角。

## 要记录的数字（填回 `WXMINIGAME.md` §7）

| 项 | 怎么取 |
| --- | --- |
| GL_VERSION | 控制台第一条 `[WX-001] GL_VERSION` |
| 平均 fps | 连续看 10 秒的 `fps=` 日志 |
| 三角形 / draw call | 同一条日志里的 `tri=` / `calls=` |
| 首屏到第一帧耗时 | 开发者工具 Performance 或人工计时 |
| 内存峰值 | 开发者工具 Memory / 真机性能面板 |
| 是否黑屏 / 报错 | 黑屏时看 `wx.showModal` 弹窗与控制台 |

## 已知限制

- 只是一个方块场景，不接世界生成、存档、UI。
- `src/minigame/spike/wx-env.ts` 是临时垫片，最终会由 `src/platform/wx/**` 取代（WX-011）。
- 还没有 worker；WX-003 再验证。
- 抖音没有做；M6 单独评估。

## 下一步

- **WX-002**：真机基线测量（把上表填满）。
- **WX-003**：Worker 打包与消息通道验证。
- **WX-004**：图集与 2D canvas 验证。
- 全部通过后 WX-005 给出 Go/No-Go 结论。
