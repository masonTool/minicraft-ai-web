# minigame-adapter spike（WX-006）

用参考项目 `references/minigame-publisher/minigame-adapter`（870d66f）替换 WX-001 的自写垫片，
验证 **适配器 + three r186** 在微信小游戏里能不能拿到 WebGL2、帧率是否可接受。

## 跑起来

```bash
# 在 worktree 根目录
npm run build:minigame:adapter
```

前提：`references/minigame-publisher/minigame-adapter` 存在（该目录已 gitignore）。

然后：

1. 微信开发者工具 → 导入 `minigame-adapter-spike/`（项目类型选**小游戏**）。
2. `project.config.json` 的 `appid` 换成自己的小游戏 AppID（真机预览）。
3. 控制台看：
   - `[WX-006] adapter inner ... dpr ...`
   - `[WX-006] navigator ...`
   - `[WX-006] GL_VERSION` / `GL_RENDERER`
   - `[WX-006] fps=... tri=... calls=...`
4. 画面上应该也有一块 16×16 绿色地面 + 柱子；**标记方块是绿色**（WX-001 是红色），
   方便一眼区分当前跑的是哪一版。

## 对比方法（WX-002 / WX-006）

同一台设备、同一个场景，分别跑：

| 版本 | 构建命令 | 工程目录 | 标记方块 |
| --- | --- | --- | --- |
| WX-001 自写 shim | `npm run build:minigame` | `minigame/` | 红色 |
| WX-006 适配器 | `npm run build:minigame:adapter` | `minigame-adapter-spike/` | 绿色 |

记录两边的 `GL_VERSION`、10 秒平均 fps、`tri`/`calls`、首帧耗时、内存峰值。

## 已知风险（重点看）

- 适配器把 `Canvas.getContext` 的所有方法都包了一层；如果 fps 明显低于 WX-001，
  就是这层包装的代价，正式接入时要跳过 WebGL 包装。
- 适配器把 `window.WebGLRenderingContext` 设成空函数；three r186 有一个
  “WebGL1 not supported” 守卫。如果这里直接抛错，把控制台/弹窗内容发回来。
- 适配器的 `document` 是假 DOM：`getElementById`/`querySelector` 不可用，
  这个 spike 只用 `document.canvas` 和 `document.createElement('canvas')`。

## 不属于本 spike 的范围

- UI、存档、Worker、键盘、WebSocket。
- 抖音。
