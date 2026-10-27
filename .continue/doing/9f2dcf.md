# 队列 · 会话 9f2dcf8178d4474f8c0f3f8f4e52851c

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-1209

> 用户 2026-10-27：「继续继续」—— 接着做**阶段 1：控件库**。
> 这是"整页搬走"的前提：设置页 / 主菜单 / 背包里的每一个交互，拆开都是这几个控件
> （开关、滑块、下拉、页签、滚动列表、提示框、弹窗）。控件库一天，整页才有资格谈。

- [x] [W1] `src/ui2d/controls.ts`：七个控件的**画法 + 纯状态机**（开关 / 滑块 / 下拉 / 页签 / 滚动列表 / 提示框 / 弹窗），几何与命中全部做成可断言的纯函数 → `npx vitest run tests/ui2d-controls.test.ts`
  - 做了什么：`controls.ts`（约 470 行）—— 七个 `draw*` + 一组纯函数：`toggleNext`、`sliderTrackRange`/`sliderRatioFromX`/`sliderRatioStep`、`dropdownMenuRect`/`dropdownIndexAt`、`tabRects`/`tabIndexAt`、`listMaxScroll`/`clampListScroll`/`listScrollByWheel`/`listVisibleRange`、`tooltipRect`、`modalRect`；另有 `controlRegion`（矩形登记命中）与 `insetRect`。色值延续 `PALETTE`，新增 `CONTROL_COLORS` / `MODAL_COLORS`。
  - 为什么：**状态留在调用方、控件只给画法与状态机**（决策 D10）。canvas 没有"元素自己记得自己开着没有"，混在一起就会长出第二份真相（DOM 那套 `class` 正是如此）；而纯函数能离线断言，绘制不能。
  - 验证：`npx tsc --noEmit` 干净；`npx vitest run tests/ui2d-controls.test.ts` → **21 passed**。
  - 批次：20261027-1209

- [x] [W2] `tests/ui2d-controls.test.ts`：每个控件"命中 → 状态 → 回调"的离线断言（滑块的 0/0.5/1、下拉的翻转与越界、列表的滚动夹取、提示框防溢出）→ `npm run test:unit`
  - 做了什么：21 条断言，分七组：控件命中区域（矩形 + 开区间边界）、开关翻转、滑块（可拖范围两端各留半钮 / 0-0.5-1 / 越界与 NaN / 键盘步进同一夹取）、下拉（默认向下 / 下方放不下翻上 / 上下都放不下选空间大的那侧 / 菜单项越界 -1）、页签（等分 / 左闭右开 / 最右边界算最后一个）、列表（内容高 / 最大滚动 / 夹取 / 滚轮按整行含"恰好半行向上取整" / 可见范围首尾）、提示框（下方 / 翻上 / 左右夹进视口）、弹窗（居中 / 小屏夹进视口）。
  - 为什么：这些错每一条都只表现为"手感不对"或"偶尔点不到"，真机上间歇出现、手指复现不出来 —— 只有纯函数断言能钉住。
  - 验证：`npm run test:unit` 绿（新增文件被 `vitest run tests` 自动收进去，不需要注册）。
  - 批次：20261027-1209

- [x] [W3] `tools/preview/controls.html`：把七个控件摆一排并能真的点/拖/滚（canvas 直接接指针事件），加 `?tint=1`；`shoot-all.mjs` 补图并重拍 `.tmp/canvas-version/` → `node tools/preview/shoot-all.mjs`
  - 做了什么：一页 900×560 的可交互画廊 —— 开关两枚、滑块（按住拖）、下拉（点开选中）、三页签、20 行滚动列表（滚轮 + 点行选中 + 右侧滚动条）、"?" 悬停提示框、"打开弹窗"（不透明深色面板 + 标题栏 + ✕ + Esc）。命中一律走 `hitRegionAt(regions(), x, y)`，就是将来设置页要用的那条路。`?state=dropdown|tooltip|modal` 把浮层固定打开（截图用），`?tint=1` 加遮罩。`shoot-all` 加 5 张，累计 19 张。
  - 为什么：阶段 1 的判据就是"能在调试面板里摆一排"；而且**交互只能靠手**验，截图不行 —— 所以这一页刻意打开 `pointer-events`（游戏里铺满全屏的覆盖层必须关着，否则吃掉视角手势）。
  - 验证：`node tools/preview/shoot-all.mjs` 19 张全出；逐张看过：下拉展开贴字段下方、已选项高亮；列表滚到 03~14 且滚动条在中段；提示框贴 "?" 下方两行；弹窗不透出底下列表；遮罩版整页黄。
  - 批次：20261027-1209

- [x] [W4] 文档：`notes/canvas-ui.md` 阶段表把 1 标成 ✅、新增 §5.5（七个控件的接口与"为什么状态留在调用方"）、决策 D10~D12 → `node .continue/hooks/check.mjs --fast`
  - 做了什么：阶段表补回 `1 控件库 ✅` 一行（上一批那次表格编辑把它整行替换掉了，这次顺手补回来）；新增 §5.5（七行接口表 + 三条经验：状态留调用方 / 翻转与避让必须自己算 / 弹窗要不透明）；决策 D10（画法与状态机分离）、D11（下拉与提示框自己避让）、D12（弹窗不复用 HUD 底板）。
  - 为什么：D12 是这一批唯一"踩到才改"的一条 —— 第一版弹窗用半透明 HUD 底板，截图里底下列表的字全透上来，像字叠字。不写下来，下一个人做设置页还会再踩一次。
  - 验证：`node .continue/hooks/check.mjs --fast` 六项全过；`npm run check` exit=0。
  - 批次：20261027-1209
