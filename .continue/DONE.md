# 完成档案 · DONE

> 本文件是**已完成工作的唯一档案**，只回答"这批做了什么、怎么验的"——时间线，最近的在最上面。
> 按模块看现状与坑 → `OVERVIEW.md`；下次怎么避开 → `TIPS.md`；机制与格式 → `README.md`。
> **一条内容只写一个地方**，别在三份文档里各抄一遍。
>
> 收尾时**整份队列原样搬进来**（含每条任务下方的完成说明与 `[阻塞]`），标题格式
> `## 批次 <号> · 日期 · 会话 <前 8 位>`。

---

## 批次 20261027-1143 · 2026-10-27 · 会话 9f2dcf81

# 队列 · 会话 9f2dcf8178d4474f8c0f3f8f4e52851c

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-1143

> 用户 2026-10-27：「现在看的还是不太清楚。要不然这样，如果是 canvas 画的，统一先加一层黄色遮罩，
> 这样就容易区分了。」—— 对，这是"改造进度"最省事的一种可视化：不靠肉眼比对像素，
> 而是让 canvas 产出的每一块像素自己"亮明身份"。

- [x] [U5] 加调试遮罩：`src/ui2d/debug.ts` 的 `applyDebugTint()`（`source-atop` 整层刷）+ `Hud2D.setDebugTint()` + `main.ts` 解析 `?ui2dtint=1` + 两个预览页支持 `?tint=1` → `npx vitest run tests/ui2d.test.ts`
  - 做了什么：新增 `ui2d/debug.ts`（`applyDebugTint(ctx,w,h)`：`save` → `globalCompositeOperation='source-atop'` → 整块刷 `rgba(255,214,0,.52)` → `restore`）；`Hud2D` 加 `setDebugTint()`，在**所有绘制之后**刷遮罩；`main.ts` 把 `readUi2DFlag()` 拆成通用 `readFlag(name)`，新增 `UI2D_TINT_ENABLED = UI2D_ENABLED && readFlag('ui2dtint')`；两个预览页加 `?tint=1`。
  - 为什么：`source-atop` 让**合成器**替我们判断"哪些地方有像素" —— 不用维护"这一帧画了哪些矩形"的账，将来新增控件自动被覆盖。遮罩单独一个参数、不跟 `ui2d=1` 绑定：多一次全屏填充会让帧率 A/B 失真，颜色不对也容易被当成 bug（见决策 D5/D6）。
  - 验证：`tests/ui2d.test.ts` **36 passed**（新增 2 条：假 ctx 断言调用序列 = `save → op source-atop → fill → fillRect 0,0,w,h → restore`；尺寸非法时一笔不画）；`tsc` 干净；`npm run check` exit=0。
  - 批次：20261027-1143

- [x] [U6] `tools/preview/shoot-all.mjs` 补遮罩版截图并重拍全部；更新 `.tmp/canvas-version/README.md` 的进度表 → `node tools/preview/shoot-all.mjs`
  - 做了什么：`SHOTS` 加 4 张遮罩版（`06-hotbar-tinted`、`06b-hotbar-tinted-dom-vs-canvas`、`07-boss-tinted`、`08-all-tinted`），重拍共 11 张；README 的表格补上四行，并加一张"URL → 看到什么"的表（不带参数 / `?ui2d=1` / `?ui2d=1&ui2dtint=1` / 关掉）。
  - 为什么：用户要的是"一眼能判断实现到哪"，那截图里就必须有**同一份数据的染色/不染色对照** —— `06b` 那张（上排 DOM 不染色、下排 canvas 全黄）比任何文字说明都直接。
  - 验证：`node tools/preview/shoot-all.mjs --base http://localhost:5199` 11 张全出，逐张看过：快捷栏整条染黄、DOM 那排原色；Boss 条只有那条被染、周围画面原色；红闪那版整屏偏黄（符合预期，红闪本身就是全屏填充）。
  - 批次：20261027-1143

- [x] [U7] 文档：`notes/canvas-ui.md` 记下这个调试开关与用法；决策写进 `doing/9f2dcf-decision.md` D5/D6 → `node .continue/hooks/check.mjs --fast`
  - 做了什么：`notes/canvas-ui.md` 新增 §5.3（实现一句话、为什么需要它、三条边界、以及"红闪打开时整屏都黄"这个反直觉现象）；决策 D5（`source-atop` 整层刷而非逐块算矩形）、D6（开关独立成 `ui2dtint=1`）。
  - 为什么：这个开关的价值不在代码而在**验收方式**——以后每迁一块界面，只要拍一张带遮罩的图就能说明"这块换了"，不必再靠肉眼比像素。不写下来，下一批会重新发明一遍。
  - 验证：`node .continue/hooks/check.mjs --fast` 六项全过；`npm run check` exit=0。
  - 批次：20261027-1143

## 批次 20261027-1009 · 2026-10-27 · 会话 9f2dcf81

# 队列 · 会话 9f2dcf8178d4474f8c0f3f8f4e52851c

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-1009

> 用户 2026-10-27：「你改的这几个地方都不太明显，看不出来效果如何。要不把快捷栏改一下？」
> 阶段 0 那三样（红闪 / Boss 条 / 破坏与进食进度）本来就是为了"不打扰任何人"才挑的纯展示 HUD，
> 结果也确实没人能看出差别。这一批换成**每帧都在眼前、9 格 + 图标 + 数量 + 耐久 + 选中框**的
> 快捷栏 —— 它才是"一眼就能对比出 DOM 与 canvas"的那块。

- [x] [U1] 新建 `src/ui2d/Hotbar2D.ts`：几何纯函数 + 状态签名 + 离屏快照；`tests/ui2d.test.ts` 加断言 → `npx vitest run tests/ui2d.test.ts`
  - 做了什么：新增 `ui2d/Hotbar2D.ts` —— 面板（`#c6c6c6` + 3px 斜面 + 2px 黑描边）、9 个格子（`#8b8b8b` + 2px 斜面）、图标 blit、数量（12px 四向描边）、序号（10px，选中时不透明）、耐久条（3px 三档）、选中格（白框 + 半透明白底 + 上抬 2px + 放大 1.08 + 柔光）；8 个几何纯函数（内容盒 / 图标居中 / 序号与数量锚点 / 耐久轨道与比例 / 选中矩形 / 快照原点）+ `hotbarSignature()`；`Hotbar2D` 类把整条栏画进一张离屏快照，签名不变时每帧只 `drawImage`。`Hud2D` 收下 `setHotbar()` 并最后画它（红闪在 DOM 里在它下面，不该给它上色）。`index.ts` 补导出。
  - 为什么：几何**不抄 CSS 常量**，输入是 `getBoundingClientRect()` 量出来的矩形 —— `--hotbar-slot` 跟断点走、底部还有 `env(safe-area-inset-bottom)`，抄一份常量就是埋一个"转屏错几像素"的回归面。快照缓存是因为 9 格每帧重画要付二十几次填充 + 十几次文字，而快捷栏的变化率极低（见决策 D1、D3）。图标不自己实现，沿用现成的 `.slot canvas`（`ui/ItemIcon` 是唯一入口，见 D4）。
  - 验证：`npx vitest run tests/ui2d.test.ts` → **34 passed**（新增 12 条）；`npx tsc --noEmit` 干净。
  - 批次：20261027-1009

- [x] [U2] `src/main.ts` 接线 `?ui2d=1`：DOM 快捷栏让位（保留布局与命中），pixels 全由 canvas 画；`?ui2d=0` 完全回退 → `npm run check:fast && npm run build:fast`
  - 做了什么：`refreshHotbar()` 末尾只做两件事——`hotbar2dRevision += 1` 与置脏（**不量 DOM**：它被十几个事件路径调用，量 10 个 `getBoundingClientRect()` 每次都会强制布局）；真正测量与喂状态在每帧的 `updateHotbar2D()` 里，一帧最多一次。`applyHotbar2DDomFallback()` 把 `#hotbar` 的底/斜角/描边设成透明（**边框宽度保留**，否则两侧背包按钮位移 3px），9 个 `.slot` 设 `opacity: 0`。`#hotbar` 被 `visibility: hidden` 藏起来时（打开携带版背包）每 8 帧复查一次。
  - 为什么：**命中继续借 DOM**（见决策 D2）。覆盖层的 `pointer-events` 是元素级、铺满全屏，打开就吃掉 `#touch-look` 的视角手势；而 `visibility: hidden` / `display: none` 会让格子退出命中，连 `bindHotbarTouch` 与长按看物品一起失效 —— 所以只能用 `opacity: 0`。
  - 验证：`npm run check:fast` 绿（655 条单测）；`npm run check` 全量 **exit=0**（181 套离线 + 三张台账 + 文档体量）；`npm run build:fast` 出包成功；`npx tsc --noEmit` 干净。⚠️ **真机观感未验**：本会话没有浏览器，dev 模式下 `__host/core.bin` 缺失会停在落地页 —— A/B 步骤写在 `notes/canvas-ui.md` 的 §5.1。
  - 批次：20261027-1009

- [x] [U4] 加 `tools/preview/hotbar.html` 对照页：不用进世界就能把 DOM 版与 canvas 版摆在一起看；顺手把数量字重对齐 CSS → `node tools/screenshot.mjs --url http://localhost:5173/tools/preview/hotbar.html --out hotbar-preview.png`
  - 做了什么：一页 HTML —— 上半是照抄 `index.html` 那几条 CSS 的 DOM 版，下半是 `Hotbar2D` 画进 canvas 的版本，同一份假数据（空槽 / 数量 / 选中格 / 黄耐久 / 红耐久）。几何照样用 `getBoundingClientRect()` 量 DOM 再喂给 canvas，与 `main.ts` 走同一条路。数量字号原来是 700，改成跟 CSS 一致（`.count` 没写 `font-weight`）——迁移期两边并存，字重不同在 A/B 里就是"像素不一致"。
  - 为什么：用户说的"看不出来效果"有一部分是**验收成本**问题 —— `?ui2d=1` 得先能进世界才看得到，而 dev 缺 `__host/core.bin` 会停在落地页。有了这一页，"画得对不对"不再被"能不能进世界"卡住；阶段 1 的控件库、阶段 2 的血条也能往这里加。
  - 验证：`npx vite --port 5199` + `node tools/screenshot.mjs --url .../tools/preview/hotbar.html --out hotbar-preview.png` → 截图已存 `.tmp/shots/hotbar-preview.png`，逐项对照两排：格子尺寸/斜面、图标位置、数量与序号锚点、耐久条位置与长度、选中格的白色边框与上抬都对得上（唯一剩下的差异是文字抗锯齿）。⚠️ 页面自带 1 条 `console.error`：favicon 404，与页面无关。
  - 批次：20261027-1009

- [x] [U3] 更新 `.continue/notes/canvas-ui.md`：把"阶段 1.5 快捷栏"的判据、命中仍借 DOM 的理由、A/B 步骤写进去 → `node .continue/hooks/check.mjs --fast`
  - 做了什么：阶段表加 `1.5 快捷栏 ✅` 一行；新增 §5.1（做法 + 四条 A/B 步骤 + "这一版不能用来量省了多少 DOM 开销"的警告）与 §5.2（复盘阶段 0 为什么证明不了任何东西：三样都低频、都在屏幕边缘，选样品的判据从"最不打扰"改成"最容易对比"）；§6 判定表补一行"快捷栏的点击/长按：画在 canvas、命中仍走 DOM"。
  - 为什么：这次的教训是**选样品的方式**，不是某个函数写错了。不写下来，下一批还会有人挑"最安全的三样"去证明"改造值不值"。
  - 验证：`npm run check` exit=0（`audit:docs` 与文档体量检查都在里面）；决策写在 `doing/9f2dcf-decision.md` D1~D4。
  - 批次：20261027-1009

## 批次 20261027-0848 · 2026-10-27 · 会话 49866712

> 界面迁 canvas 的第一步：先立地基（文字 / 命中 / 覆盖层 / 控件）＋试点三样纯展示 HUD，
> `?ui2d=1` 做 A/B；并把"哪些不搬、为什么"写成表（`notes/canvas-ui.md`）。

# 队列 · 会话 498667122b7f4c508a73dac8f5e7e792

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-0848

> 本队列在并行工作树 `.continue/doing/.worktree/worktree_canvasui_20261027` 里执行
> （分支 `worktree_canvasui_20261027`，基于 `88175334`）。父树没有队列 —— 这一批从头到尾只在这棵树里。

- [x] [C1] 修 net-client-look 红灯：NetClient.tick 的 look 改成「变化 / 2 秒兜底」才发 → npx vitest run tests/net-client-look.test.ts
  - 做了什么：**没有改代码**。上游 `88175334` 已把这条口径定成「每条 `move` 都带全量外观」，测试也同步改成 `expect(moves()[1].look).toEqual(LOOK_A)`。我先按旧断言写了去重补丁（`LOOK_RESEND_MS` + `lastLookKey/lastLookAt`），跑到一半发现与 HEAD 的测试冲突，于是三处编辑**完整回退**，`git status src/` 干净。
  - 为什么：同一件事只能有一个口径。服务端 `readAppearance` 已改成**合并**语义，客户端"每条都带"不会再引发闪烁；去重是更省字节，但会与"每条都带"的断言直接冲突 —— 既然上游已经拍板并落了测试，就不该在迁移分支里偷偷改回去。
  - 验证：`npx vitest run tests/net-client-look.test.ts` → **8 passed**；`git status --short src/` 无输出（确认回退干净）。
  - 批次：20261027-0848

- [x] [C2] 建 src/ui2d/ 骨架：overlay（DPR/尺寸）、text（测量/裁切/换行）、input（命中测试/焦点/层栈）、widgets（按钮）→ npm run check:fast
  - 做了什么：新增 5 个模块 + 1 个汇总入口：`text.ts`（字体栈、测量缓存 512 条、`tokenize`/`truncateToWidth`/`wrapToWidth`、`drawText`）、`input.ts`（`hitRegionAt` 纯函数 + `Ui2DInput` 指针路由，空命中表时强制 `pointer-events: none`）、`overlay.ts`（2D 覆盖层、DPR 夹到 3、ResizeObserver、绘制单位统一 CSS px）、`widgets.ts`（圆角矩形/HUD 底板/进度条/原版按钮，色值抄 `index.html` 的 `--mc-*` 与 `--hud-*`）、`index.ts`（分层入口与"不许反向依赖 main"的约定）。
  - 为什么：**文字走 `fillText` 而不是 SDF 字形图集** —— 6 种语言含中日韩，图集等于把字体搬进构建期；覆盖层做成**独立 2D canvas** 而不是塞进 WebGL，也是同一条理由。命中表默认为空且强制关掉 `pointer-events`，避免铺满全屏的层吃掉触摸端的视角手势（`TIPS.md` 里"按钮看得见、点了没反应"那条坑的 canvas 版）。
  - 验证：`npx vitest run tests/ui2d.test.ts` → **22 passed**（**抓到 1 个真实 bug**：`hitRegionAt` 原本反向遍历又用 `>=`，导致下层覆盖上层，已改正向遍历）；`npx tsc --noEmit` 干净；`npm run check:fast` 绿（643 条单测）。
  - 批次：20261027-0848

- [x] [C3] 试点：把准星 / 伤害闪 / Boss 条迁到 ui2d 覆盖层，DOM 版本保留为可回退开关 → check:fast + build:fast
  - 做了什么：`src/ui2d/Hud2D.ts` 画三样 —— 受伤红闪（预渲染 320×180 三层 radial 精灵 + `globalAlpha`，只在上一帧真画过时才清屏）、Boss 血条（龙/凋灵/护盾三套渐变，几何照抄 `#boss-bar`）、破坏与进食进度条。`main.ts` 只加 3 处分支 + 1 处绘制调用：`updateBossBar` 改成"先算数值再分路画"、两个进度条函数开头提前 return、`damageFlash.update()` 之后调 `hud2d.render()`；`DamageFlash` 在开关打开时传 `null`（数值照算、不写 DOM opacity）。开关是 `?ui2d=1`，DOM 版本一行没删。
  - 为什么：**准星没有搬**（与条目原文不同，见决策 D3）。它靠 `mix-blend-mode: difference` 与下层画面做差值混合，那是 DOM 合成器的能力；2D canvas 里 `difference` 只在本图层内生效，叠到 WebGL 上就是一块白十字，雪地/沙漠上反而看不见。换成"破坏/进食进度条"：同样是纯展示、每帧变、且没有混合模式依赖。
  - 验证：`npm run check:fast` 绿；`npm run build:fast` 出包成功（`main-C75H5CHE.js` 2,126.25 kB / gzip 594.93 kB）；`npx tsc --noEmit` 干净。⚠️ **真机/浏览器观感与帧率未验**：本会话没有浏览器，且 dev 模式下 `__host/core.bin` 缺失会停在"去应用里玩"落地页 —— 需要用户用 `?ui2d=1` 进一次世界对比。
  - 批次：20261027-0848

- [x] [C4] 写迁移方案与阶段门禁到 .continue/notes/canvas-ui.md（含验收命令）
  - 做了什么：`notes/canvas-ui.md` 九节 —— 现状三层与代码量、A/B 路线对比（选 2D 覆盖层的决定性理由是文字）、目录与依赖方向、阶段 0~6 的判据与验收命令（含"停在哪一格"的判据）、阶段 0 已落地清单与真机 A/B 步骤、**判定不搬/搬法特殊** 六条（准星混合模式、IME 必须留 DOM、拖拽、原生控件、无障碍退化、全屏剪贴板不变）、七个迁移 checklist（色值同步 / 文案走 t() / CSS px / pointer-events 默认关 / 横屏优先 / 可回退）、测试改写策略（先加后删）、四条风险。
  - 为什么：这次迁移真正的成本不是"画出来"，而是**回归面**与**判定边界**。把"哪些不能搬、为什么"写成表，比写"要搬什么"更值钱 —— 准星那条如果不写，下一批一定会有人顺手搬过去，然后在雪地上发现白十字。
  - 验证：`node .continue/hooks/check.mjs --fast` 通过（文档体量 / 编号 / 配置 / hooks 自检）；`npm run audit:docs` 通过（`npm run check` 里已跑过一遍）。
  - 批次：20261027-0848

---

## 批次 20261027-0900 · 2026-10-27 · 会话 12c62cf0

> 继续 R1：把 Rust 版缺的协议能力按组补齐，每组都跑一遍黑盒断言。

# 队列 · 会话 12c62cf015444720a2a57c257f80c045

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-0900

- [x] [R1] 快照 v2 + 关房清缓存 + bye + 外观 + 掉落物：`server/rust/src/{store,state,handlers,protocol,ratelimit}.rs` → `run-net-test.sh`
  - 做了什么：① 快照 1→2（可读 v1），落盘只留 `savedAt/timeOfDay/day/weather`，`apply_snapshot` 不再读四张房间表；② `State::clear_room`（按房名前缀清 edits/containers/signs/frames/items/worlds/hosts/clocks）+ `OrderedMap::retain`（连带清顺序队列，否则 `remember` 会以为淘汰了却没释放容量）；③ `bye`：房主当场关房踢人、其他人当场广播 `leave`；④ 外观改成"白名单 + 合并写 + 能表达 false + 补 dead/hp/food"；⑤ 掉落物固定窗口 → 令牌桶 30/s + 突发 400。
  - 为什么：这些都是 10-26 之后主线上已经定稿的行为，Rust 版缺一项队友就会看到不同的世界。
  - 验证：黑盒 233 → **261 / 297**；`cargo test` 28 通过。
  - 批次：20261027-0900

---

## 批次 20261027-0930 · 2026-10-27 · 会话 12c62cf0

# 队列 · 会话 12c62cf015444720a2a57c257f80c045

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-0930

- [x] [R1] 每房一套时钟 + 天数 + `room-config` 模式 + `sleep` 过一天：`server/rust/src/{state,handlers,lib}.rs` → `run-net-test.sh`
  - 做了什么：`RoomClock { start_ms, start_time_of_day, start_day, weather }` + `State.clocks` / `default_clock`；`welcome`/`time` 广播/`sleep`/`room-config`/天气推进全部按房；`join` 采纳房主上报的 `day`·`timeOfDay`·`weather`（宽限重连不覆盖，顺序是"先定天数与时刻、最后重置起点"）；`sleep` 先结算今天再 +1；`room-config` 累积 `applied` 并广播 `{t:room-config, by}`，`welcome.gameMode` 取当前模式。
  - 为什么：以前是全服一套时钟——房主 B 在乙房开房会把甲房的太阳一起拨过去；而房主本地继续玩之后，重开房还会被拽回"服务端此刻"。
  - 验证：黑盒 261 → **283 / 297**；`cargo test` 28 通过。
  - 批次：20261027-0930

---

## 批次 20261027-1120 · 2026-10-27 · 会话 12c62cf0

> 用户 2026-10-27："请继续" —— 把两份原生壳的上机验收清单写下来，顺手跑通了 iOS 的模拟器级验收。

# 队列 · 会话 12c62cf015444720a2a57c257f80c045

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-1120

- [x] [R1] 修 `build-ios.sh` 的变量边界 bug：`server/rust/build-ios.sh` → `bash server/ios/check.sh`
  - 做了什么：`echo "编真机（$DEVICE）"` 里全角右括号紧贴变量名，bash 把多字节首字节并进变量名（`DEVICE\xef: unbound variable`），整个 iOS 构建断在第一行。改成 `${DEVICE}`；同类的 `${SIM_ARM} / ${SIM_X86}` 一起改。
  - 为什么：这不是"环境问题"，是脚本自己的错——`$VAR` 后面接中文/全角符号必须加花括号。
  - 验证：`bash server/ios/check.sh` 全部通过（两架构 xcframework + 两 SDK typecheck + 三个 C 入口）；`check-sim.sh` 在模拟器里真跑 → **端口 8887**、`/healthz`、`/rooms`、停止后归零。
  - 批次：20261027-1120
- [x] [R1] 两份上机验收清单：`server/android/README.md`、`server/ios/README.md`
  - 做了什么：安卓 11 步（服务起没起来 / 同机 webview / 另一台设备发现含 AP 隔离与 MulticastLock 排查 / 进房后世界对不对 / 后台省电 / 离线回归）；iOS 5 步（本地网络权限"拒绝后不再弹"、`dns-sd` 验 Bonjour、iOS↔iOS 互发现、前台限制、ATS）。
  - 为什么：这几条 CI 跑不了，但每条都能写成"看什么 / 不对先查哪里"，真机时不至于重新推。
  - 验证：`npm run check` exit=0。
  - 批次：20261027-1120
- [x] [R2] 记下 iOS 只发布不浏览的缺口：`server/ios/README.md`、`.continue/TASKS.md`
  - 做了什么：README 的"还没做"补一条（`BonjourAdvertiser` 只有 `NetService`，没有 `NetServiceBrowser`）；TASKS 新增 `R2`。
  - 为什么：现在 iOS 能看到邻居是因为对方也发了 UDP 组播，"靠 Bonjour 互相发现"这条其实不成立——不写清楚，下一个人会以为已经支持。
  - 验证：`npm run check` exit=0（HANDOFF 待办 0→1）。
  - 批次：20261027-1120

---

## 批次 20261027-1040 · 2026-10-27 · 会话 12c62cf0

> 用户 2026-10-27："继续" —— R1 全绿之后，把原生壳（安卓/iOS）与 Rust 的接线做了一遍静态核对，并跑掉两个冒烟套件。

# 队列 · 会话 12c62cf015444720a2a57c257f80c045

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-1040

- [x] [R1] 手机壳 port=0 的语义修正：`server/rust/src/instance.rs`、`capi.rs`、`server/ios/include/minicraft_server.h` → `cargo check` + `run-smoke.sh`
  - 做了什么：`start_instance` 只在 `want_port > 0` 时覆盖 `config.port`；0 走 `Config::from_env()` 的默认（8887 或 `PORT`）。注释与 iOS 头文件同步改口径。
  - 为什么：安卓 Intent 不传 port（`wantPort=0`）、iOS `start(port: 0)` 都是默认路径，以前 `bind(0)` 会让系统随机分配——客户端与发现广播都用 8887，别人照着界面里的地址永远连不上。
  - 验证：`cargo check` 零警告；`bash server/rust/run-smoke.sh` **20 / 0**；`run-beacon-smoke.sh` **13 / 0**。
  - 批次：20261027-1040
- [x] [R1] 原生壳接线核对（静态）：`Cargo.toml` / `app/build.gradle` / `NativeServer.java` / `jni.rs` / `capi.rs` / `minicraft_server.h`
  - 做了什么：逐项确认真实名字与签名一致——`lib name = minicraft_server` ↔ gradle 拷 `libminicraft_server.so`；`Java_com_minicraft_server_NativeServer_{startServer,stopServer,serverPort}` 三对；`minicraft_{start,stop}_server` / `minicraft_server_port` 的 4/0/0 参数与 `.h` 一致；安卓的 `MulticastLock` 在位（不拿它会丢组播帧）。
  - 为什么：真机之前能静态查的接线先查掉，剩下的（前台服务类型、真机权限、Bonjour 发布）只能上机验。
  - 验证：无代码改动，只核对。
  - 批次：20261027-1040

---

## 批次 20261027-1000 · 2026-10-27 · 会话 12c62cf0

# 队列 · 会话 12c62cf015444720a2a57c257f80c045

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-1000

- [x] [R1] `session-sync` / `mob-attack` / `edits-request`·`edits-reply`：`server/rust/src/{state,handlers}.rs` → `run-net-test.sh`
  - 做了什么：① `session-sync` 房主整份上行容器/牌子/展示框（每批 200、每连接 256 条上限、不走令牌桶、不做距离闸），存表并按房广播；② `mob-attack` 只转给被打的那一个人（跨房/打自己一律丢，伤害夹 0~50，带 `fromId`）；③ 懒上行：`confirmed_chunks`/`requested_chunks`/`sent_edit_chunks`，未确认区块向房主要（8 条在飞上限、5 秒忘记以便重试），`edits-reply` 按区块校验后存缓存 + 标已确认 + 广播成普通 `blocks`，已确认或无房主时直接推缓存（每批 2048）。
  - 为什么：这三块是"房主权威"的最后一块拼图——手机当房主时队友看不到箱子、野怪打不动人、远处的方块补不上。
  - 验证：`bash server/rust/run-net-test.sh` → **297 通过 / 0 失败**（与 Node 同一份断言）；`cargo test` 28、`cargo check` 零警告。
  - 批次：20261027-1000

---

## 批次 20261027-0800 · 2026-10-27 · 会话 12c62cf0

> 用户 2026-10-27："继续" —— 发现本机其实有 cargo（只是没进 PATH），于是把之前"盲写未验证"的 Rust 改动全部编译 + 跑黑盒断言。

# 队列 · 会话 12c62cf015444720a2a57c257f80c045

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-0800

- [x] [R1] Rust 编译验证 + 修 E0382：`server/rust/src/beacon.rs` → `cargo check` / `cargo test`
  - 做了什么：`cargo check` 立刻抓到 `borrow of moved value: room`（`has_host` 在 `room` move 之后又借用），改成先算 `has_host` 再构造；`cargo test` **28 通过**。
  - 为什么：之前几批 Rust 改动是在"没有工具链"的前提下写的，只能算推测；有了编译器才第一次被真正检验。
  - 验证：`cargo check` 干净；`cargo test` 28 / 0。
  - 批次：20261027-0800
- [x] [R1] 补 Rust 的 `ALLOW_HOSTLESS_ROOMS` + `/ping` + `beaconPort` + `isHost`：`server/rust/src/{lib,handlers}.rs`、`run-net-test.sh` → `bash server/rust/run-net-test.sh`
  - 做了什么：① `ALLOW_HOSTLESS_ROOMS=1`（Config/Hub/join 判断 + 验收脚本），否则单人用例全被 `no-host` 拒（第一次跑只有 **227/297**）；② `/ping` 路由（客户端扫网段只认能回它的机器，缺了它手机端永远扫不到）；③ `/healthz` 补 `beaconPort`；④ `player` 广播（join 与每条 `move`）补 `isHost`。
  - 为什么：前两条是**产品级缺陷**（不是测试口径问题）：改名后别人扫不到手机上跑的服务端、队友的名字牌不标房主。
  - 验证：黑盒断言 **227 → 233 / 297**；`cargo test` 28 / 0。
  - 批次：20261027-0800
- [x] [R1] 把剩余 64 条按 10 组写清（TASKS R1 + 两处 README）：`server/README.md`、`server/rust/README.md`
  - 做了什么：README 的「195 条 0 失败」改成「当前基线 233/297、`cargo test` 28 绿」；缺口表扩成 10 组并标出每组的失败断言数（`day` 6 / 采纳时钟天气 6 / 快照 v2 6 / 关房清缓存 3 / `session-sync` 6 / `edits-*` 3 / `bye` 2 / 外观 1 / 掉落物 1 / 每房时钟）。
  - 为什么：这 64 条就是可执行的验收清单——每一条都对应一句断言，不需要再猜"还缺什么"。
  - 验证：`npm run check` exit=0。
  - 批次：20261027-0800

---

## 批次 20261027-0740 · 2026-10-27 · 会话 12c62cf0

> 用户 2026-10-27："请继续，不要停" —— Rust 侧继续推进时发现剩下的都是结构性改动，先把会误导人的文档修掉、把缺口记成待办。

# 队列 · 会话 12c62cf015444720a2a57c257f80c045

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-0740

- [x] [R1] 修正「Rust 已逐条对齐」的过时声明 + 记下缺口：`server/README.md`、`server/rust/README.md`、`.continue/TASKS.md` → `npm run check`
  - 做了什么：两处 README 原来都写「与 JS 版逐条对齐 / 195 条 0 失败」，改成「**对齐到 2026-10-25 那一版**」，并列出 Rust 还缺的四项（`session-sync`、`edits-request`/`edits-reply`、每房一套时钟、`join` 采纳房主时钟），已补的三项标「未编译验证」；TASKS 增 `R1`（含验收口径），HANDOFF 待办 0→1。
  - 为什么：这句话正是本次合并把我误导的地方——文档说"逐条对齐"，实际 Rust 缺 5 项、且我补的 3 项没编译过。文档比代码更该保守。
  - 验证：`npm run check` exit=0（HANDOFF 口径 / TASKS 差异台账已由脚本重写）。
  - 批次：20261027-0740

---

## 批次 20261027-0720 · 2026-10-27 · 会话 12c62cf0

> 用户 2026-10-27："继续" —— 把合并后列出的 P0（Rust 与 Node 的协议差异）能安全补齐的部分先做掉。

# 队列 · 会话 12c62cf015444720a2a57c257f80c045

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-0720

- [x] [L13] Rust `join` 补 `no-host` / `host-offline`：`server/rust/src/{handlers,protocol}.rs` → 语法自查
  - 做了什么：`protocol.rs` 补 `CLOSE_HOST_OFFLINE = 4009` / `CLOSE_NO_HOST = 4010`；`handlers.rs` 在 `wants_host` 判定之后加一段——`hosts` 里没登记房名就拒 `no-host`，登记着但人不在 `players`（宽限期断线）就拒 `host-offline`；用 `st.hosts.get(&room).copied()` 先取出 id 再判，避免 `drop(st)` 与借用打架。
  - 为什么：与 Node 版同一口径。没有房主的房间是一个**不推进的世界**（方块能放、怪不动、红石不亮），界面却一切正常。
  - 验证：**只做了语法与类型自查**——本机没有 `cargo`，`bash server/rust/run-net-test.sh` 未跑。
  - 批次：20261027-0720
- [x] [L13] Rust `/rooms` 补 `maxPlayers`、beacon 的 `has_host` 按房间判断：`server/rust/src/{lib,beacon}.rs` → 语法自查
  - 做了什么：`Config` 加 `max_players`（`MAX_PLAYERS`，默认 10，脏值/0 退回默认）→ `Hub` → `/rooms` 输出 `maxPlayers`；`beacon::announce_of` 的 `has_host` 从 `!state.hosts.is_empty()`（任意房间有房主）改成 `state.hosts.contains_key(&room)`（这一间）。
  - 为什么：前者让浮窗在手机内建服务端上也显示 `在线/容量`；后者在多房间时会对着一个没人跑模拟的房说「可以进」，客户端照它进房就踩到同一个坑。
  - 验证：同上，未经编译验证。
  - 批次：20261027-0720

---

