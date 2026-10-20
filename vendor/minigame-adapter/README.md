# minigame-adapter（vendored）

来源：`git@github.com:masonTool/minigame-adapter.git`  
固定版本：`870d66f`  
复制时间：2026-10-20

这是从参考项目 `references/minigame-publisher/minigame-adapter` 复制进来的副本，
用于微信小游戏的平台层基座。上游保持独立，本目录只做**必要补丁**，不要在这里做大改；
上游有新版本时按 `WXMINIGAME.md` 的 WX-092 对比后再 cherry-pick。

## 已删除

- `openability/`：开放数据域/广告/排行榜，本项目暂不使用。
- `tools/`：参考项目的启动/广告/云同步工具，不属于适配层。
- `.git` / 原 `README.md`：子模块元数据与上游说明。

## 本分支补丁

1. `HTMLScriptElement.js`：删掉运行时 `require(...)`。小游戏用打包期静态入口；
   保留动态 require 会让 esbuild 扫描整个目录（WX-006 实测 4292 个错误）。
2. `window.js`：补 `matchMedia`。现有 `isTouchDevice()` 依赖 `(pointer: coarse)`，
   缺失时会误判为桌面端。
3. `WxEvent.js`：由 touch 合成 `pointerdown/move/up/cancel`，并派发
   `visibilitychange` / `visibilityState`。
4. `Worker.js`：补 `addEventListener('message')`（原生只有 `onMessage`）。
   注意：它仍然只保留**一个** worker；两套池子的合并由 `WX-018` 的平台层负责。

## 明确不做

- 不实现 DOM/CSS 布局：`Document` 是假 DOM，`getElementById` 返回占位节点，
  `CSSStyleDeclaration` 只处理 margin。游戏/UI 代码**禁止**依赖它做布局，
  详见 `WXMINIGAME.md` §2.6。
- 不在这里改 `Canvas.getContext` 的包装：真机 801 draw call 实测无可测开销。
