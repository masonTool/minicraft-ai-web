# 队列 · 会话 9f2dcf8178d4474f8c0f3f8f4e52851c

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-1706

> 用户 2026-10-27：「首页三个按钮的**显示位置**是错的，**点击位置**也是错的」。
> 用真 `WorldScreen` 复现：首页在字体/排版稳定后按钮整体上移（y 483 → 309），
> 而镜像只在第一帧量过一次，之后再也不重量 —— 画在旧位置、点在新位置。

- [x] [S1] 复现页 `tools/preview/world-real.html`：真 `WorldScreen` + `fetch('/index.html')` 搬真样式 → 截图
  - 做了什么：页面构造真的 `WorldScreen`（空存档表 + no-op actions），把 `index.html` 里那段 `<style>` 整段注入，再镜像 `.world-panel`；`?plain=1` 出 DOM 基准；报告晚 1.2s 再打（早期的数字是布局稳定前的旧值）。
  - 为什么：手写假 DOM 测不出定位问题（第一版就是：没有游戏 CSS，元素全是裸节点，什么也没复现）。
  - 验证：`node` 里读同一个按钮在不同时刻的 `y`：**150ms 时 483，1650ms 时 309** —— 差 174px，根因坐实。
  - 批次：20261027-1706

- [x] [S2] `MenuScreen2D`：签名带上几何；`main.ts` 给所有镜像开 `pollMs` 并在 `document.fonts.ready` 后重量 → `npm run check:fast`
  - 做了什么：`computeSignature` 加 `getBoundingClientRect()` + `scrollWidth/scrollHeight`；主菜单 `pollMs: 200`、聊天输入行 `pollMs: 250`（原来 0）；主菜单挂载处加 `document.fonts.ready.then(sync)`。
  - 为什么：几何不在签名里 → 第一帧的旧位置会被永久沿用；而"盒子尺寸没变、内部按钮却动了"的情况签名也抓不到，所以要定期重读兜底。
  - 验证：`tsc` 干净；`npm run check:fast` 绿；镜像版截图（`26-world-mirror.png`）与 DOM 基准（`26b-world-dom.png`）位置一致。
  - 批次：20261027-1706

- [x] [S3] `textPanel`：`letter-spacing` 补偿（大标题不再被截成 `Minicra…`）+ 2 条断言 → `npx vitest run tests/ui2d.test.ts`
  - 做了什么：`readTextRuns` 读 `letter-spacing`，负值按 `-spacing × 字数` 记进 `TextRun.widthSlack`（上限 64）；`drawTextRuns` 把补偿加到 `maxWidth`。
  - 为什么：`world-logo` 是 48px + 负字距，盒子比 canvas 量出来的字窄，`maxWidth` 一夹就出省略号。
  - 验证：`tests/ui2d.test.ts` → **73 passed**（新增 2 条：补偿生效、补偿为 0 时行为不变）。
  - 批次：20261027-1706
