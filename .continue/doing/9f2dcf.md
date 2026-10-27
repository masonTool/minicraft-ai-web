# 队列 · 会话 9f2dcf8178d4474f8c0f3f8f4e52851c

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-1404

> 用户 2026-10-27：「继续继续」—— 接着把**聊天输入行**交给 canvas（上一批补的输入框
> 取值 + 焦点光标正好能复用），并顺手修一个只在游戏里才会炸的层叠问题。

- [x] [K1] `src/main.ts`：聊天输入行接入 `MenuScreen2D`（`.chat-entry` 让位像素，打开时才接管）→ `npm run check:fast`
  - 做了什么：新增 `chatEntry2d`（`MenuScreen2D`，`zIndex: 12`）与 `syncChatEntry2d()`（每帧看 `.chat-entry` 的 `offsetParent` 是否非空，出现就 `engage`、收起就 `disengage`），在帧循环里排在 `syncTextPanels2d()` 之后；`dispose()` 里一起销毁。
  - 为什么：输入本身一行都不用改（历史、命令补全、回车发送、发送键的 `pointerdown` 都留在 DOM），只需要"谁产像素"换人 —— 这正是镜像路线的价值。
  - 验证：`npx tsc --noEmit` 干净；`npm run check:fast` 绿。
  - 批次：20261027-1404

- [x] [K2] `src/ui2d/menuScreen.ts`：新增 `MenuScreenOptions.zIndex`，并给主菜单镜像补上 45 → 预览页 + 截图
  - 做了什么：`MenuScreen2D` 建覆盖层时按选项设 `zIndex`；主菜单传 45（`#world-screen` 是 40）、聊天传 12（`#chat` 是 8）。预览页 `tools/preview/chat.html`（`?value=`、`?tint=1`），截图 `20-chat-entry.png`。
  - 为什么：`Ui2DOverlay` 默认 `zIndex` 是 1 —— 上一批主菜单镜像**在预览页看着正常、在游戏里会被 `#world-screen` 的背景整个盖住**（表现是"开了 `?ui2d=1` 主菜单直接没了"）。这类层叠问题离线断言查不到、预览页也照不出来。
  - 验证：`node tools/preview/shoot-all.mjs` 38 张全出；截图看过：输入框有值「你好，有人在吗」、绿色发送键有斜面边框、提示行仍在（它是 DOM）。
  - 批次：20261027-1404

- [x] [K3] 文档：`notes/canvas-ui.md` §5.16（含 z-index 判据表）、决策 D28 → `node .continue/hooks/check.mjs --fast`
  - 做了什么：§5.16 记下聊天输入行的做法与"镜像哪棵树、覆盖层就要在它之上"的判据表；决策 D28 记下"覆盖层 z-index 必须按被镜像目标的层叠顺序给"。
  - 为什么：这个坑的形态很隐蔽 —— 预览页正常、游戏里整块消失，很容易被当成"`?ui2d=1` 又坏了"。
  - 验证：`node .continue/hooks/check.mjs --fast` 绿。
  - 批次：20261027-1404
