# 完成档案 · DONE

> 本文件是**已完成工作的唯一档案**，只回答"这批做了什么、怎么验的"——时间线，最近的在最上面。
> 按模块看现状与坑 → `OVERVIEW.md`；下次怎么避开 → `TIPS.md`；机制与格式 → `README.md`。
> **一条内容只写一个地方**，别在三份文档里各抄一遍。
>
> 收尾时**整份队列原样搬进来**（含每条任务下方的完成说明与 `[阻塞]`），标题格式
> `## 批次 <号> · 日期 · 会话 <前 8 位>`。

---
## 批次 20261023-1847 · 2026-10-23 · 会话 b75f5b89

**做了什么**：把"两个用 3D 做的 2D 小游戏"整体换成一个真 3D 的**跳一跳**——删掉推箱子 / 打砖块与旧渲染层（`BlockScene` / `blockGroups` / 通用关卡格式），目录 / 进度 / 选择页收成"单游戏 + 最高分"；新增跳一跳的纯逻辑（三方向生成器 / 蓄力距离 / 落点判定 / 连击计分 / 难度曲线 / 可达性保证）、柱子渲染（顶/侧/底三套 UV + 四套群系主题 + 相机跟随）、蓄力压缩与空中翻转、结算与最高分、特殊方块、WebAudio 合成音效；最后用 Playwright 跑 12 项端到端自查（含四张截图）与难度平衡模拟。共 12 条。

**条目**（原文照搬）：

- [x] [跳跳1] J0-1 去旧与单游戏改版：删 `src/minigame/games/sokoban`、`src/minigame/games/breakout`；清 i18n / `index.html` CSS / `main.ts` 接线与 `tools/minigame-test.ts` 旧小节；`catalog.ts` 改单游戏（`jump`，无 `levelCount`）、`progress.ts` → `mc.minigame.v2`（最高分）、`MiniGameMenu` 去掉关卡网格；新增 `src/minigame/games/jump/scene.ts` 占位（背景 + 一块方块 + 人物 + 退出）→ 验证：`npm run typecheck`、`npm run test:minigame`、`grep -riE "sokoban|breakout" src tools index.html` 无输出
  - 做了什么：删掉 `games/sokoban/`、`games/breakout/` 与不再被引用的 `src/minigame/level.ts`；`catalog` 只留 `jump`（去掉 `levelCount`）；`progress` 换成 `mc.minigame.v2` 的**最高分**（只保留更高分、坏数据当空、v1 直接作废）；`MiniGameMenu` 收成一层（卡片直接开局、显示"最高 n"）；`main.ts` 接线改成 `startMiniGame(gameId)`，返回键分支同步（`back()` 不再返回 boolean）；新增 `games/jump/scene.ts` 占位（草方块 + 玩家方块人 + 提示）
  - 为什么：两个旧游戏是"用 3D 做 2D"，观感与可玩性都不行；跳一跳要复用图集与 `PlayerRenderer`，旧游戏留着会让目录/进度/菜单一直带着关卡语义。占位场景同时提前验证 `BlockScene` 与 `PlayerRenderer` 能在主菜单路径（自建 renderer）一起渲染并释放干净
  - 验证：`npm run typecheck` 通过（无输出）；`npm run test:minigame` 84 通过 / 0 失败；`npm run check:fast` 14/14 套绿；`grep -riE "sokoban|breakout" src index.html` 无输出（`tools/minigame-test.ts` 只剩两条"旧游戏已移除"的负向断言，故意保留）
  - 批次：20261023-1847
- [x] [跳跳2] J0-2 跳一跳纯逻辑：新增 `src/minigame/games/jump/config.ts`（全部可调参数）与 `logic.ts`（方向生成 / 蓄力距离 / 落点判定 / 连击计分 / 难度曲线 / 可达性保证），在 `tools/minigame-test.ts` 加断言 → 验证：`npm run test:minigame` 全绿（可达性、单调性、三方向、边长与间距曲线、连击封顶 +32）
  - 做了什么：`config.ts` 集中 16 个可调参数（蓄力/距离/边长/间距/方向/中心比例/连击/特殊方块）；`logic.ts` 提供 mulberry32 确定性随机、难度曲线（`blockSizeForScore` / `gapRangeForScore` / `maxReachableGap`）、`distanceForCharge`、`nextBlock`（±30°/0° 三方向 + 间距随机 + 特殊方块）、`resolveLanding`（轴对齐两分量）、`scoreForLanding`（+2/+4/…封顶 32）、`jump`（判定→计分→自动生成下一个）
  - 为什么：方向自动对准下一个方块，玩家只控制距离（一个自由度）；可达性写进生成器（间距上限 ≤ `maxDistance − 0.3`），难度只抬下限与缩方块，永远不会生成"理论跳不到"的格子；随机自带确定性（同 seed 同序列），否则"间距可达"只能靠跑一万次碰运气
  - 验证：`npm run test:minigame` 131 通过 / 0 失败（新增 47 条：蓄力 7、难度 7、生成器 8、特殊方块 4、落点与计分 12、一局推进 8）；`npm run typecheck` 通过
  - 批次：20261023-1847
- [x] [跳跳3] J0 门槛：残留引用为 0、`npm run check:fast` 绿、菜单「小游戏 → 卡片 → 开局 → 退出」可走通、进度坏数据不抛错 → 验证：三条命令输出贴进完成说明
  - 做了什么：跑完 J0 的三道门；"菜单点击"这一步**不在本批做**（J0 还没有画面可看），改由后续 Playwright 自查条第一次覆盖；进度坏数据由 `test:minigame` 的"存储容错"7 条钉住
  - 为什么：按计划的门槛分层，J0 只验"纯逻辑 + 静态接线"，浏览器链路的 E2E 要等"进→玩→结算→退出"完整之后才有意义（`notes/jump-game.md` §3）
  - 验证：`grep -riE "sokoban|breakout" src index.html` → 无输出；`npm run test:minigame` → 131 通过 / 0 失败；`npm run check:fast` → 6/6 套绿；`npm run build:fast` → `✓ built in 1.08s`
  - 批次：20261023-1847
- [x] [跳跳4] 画面骨架：新增 `PillarScene.ts`（顶/侧/底三套 UV、按 tile 组合分组的 InstancedMesh）与 `themes.ts`（草地/雪地/沙漠/石山四套主题 + 天空渐变），相机斜俯视 + 跟随插值 + resize → 验证：`npm run typecheck`、`npm run test:minigame`（UV 面顺序 / 分组数 / dispose 静态断言）
  - 做了什么：`themes.ts` 四套主题（顶/侧/底 tile + 天空渐变 + 雾色），每 20 分换一套；`pillars.ts` 抽出**纯逻辑分组**（按三张贴图的组合分组，一组 = 一个 draw call）；`PillarScene.ts` 按面写 UV（`+X/-X/+Y/-Y/+Z/-Z` 各 4 个顶点，顶面用顶贴图、底面用底贴图、其余侧面），相机按"当前+下一方块"的跨度自适应距离，跟随用 `1 - e^{-7dt}`（帧率无关），`resize` 更新宽高比
  - 为什么：旧渲染层只取 `tiles[0]` 铺六面，草块侧面也是草，看着不像 Minecraft；分组抽成纯函数是为了能在 node 里断言"草方块和音符盒必须两组"，不用靠截图
  - 验证：`npm run typecheck` 通过；`npm run test:minigame` 141 通过 / 0 失败（新增柱子分组 13 条：组数、组顺序、草/雪主题三面 tile、5000 根 2 组、耗时 < 50ms）
  - 批次：20261023-1847
- [x] [跳跳5] 玩法接入：`scene.ts` 接 `logic.jump`——按下蓄力、松手起跳（状态机 Idle/Charging/Airborne/Falling/Over）、方向自动对准、落点判定、相机跟随、始终预生成下一个方块、掉落动画 → 验证：`npm run test:minigame`（状态机纯函数断言）+ `npm run typecheck`
  - 做了什么：`scene.ts` 写成完整一局：`ready → charging → jumping → (ready | falling → over)` 五个阶段只由 `beginCharge / release / land / finish` 四个方法切换；`release` 调 `logic.jump()` 得到结果但不立刻应用，先播 0.3~0.5 秒抛物线动画（水平线性、垂直 `sin(πt)`），落地 `land()` 才写回新状态；`falling` 0.75 秒后进 `over`；相机每帧 `follow`
  - 为什么：判定与表现分离——`logic.jump()` 是纯函数、立刻知道结果，动画是时间的函数；两者混在一起会出现"人还在天上但分数已经加了"的中间态
  - 验证：`npm run typecheck` 通过；`npm run test:minigame` 141 通过（含场景 15 条静态断言：状态机、朝向、`logic.jump` 调用点、退出/重开）
  - 批次：20261023-1847
- [x] [跳跳6] 人物与方块动画：蓄力压缩（`PlayerRenderer.object.scale.y`）、起跳过冲、空中翻转、落地回弹、方块同步下压、落地尘土（粒子可选） → 验证：`npm run test:minigame`（动画曲线的纯函数断言）
  - 做了什么：蓄力时 `scale.y = 1 − 0.35 × charge`（脚底为原点，压的是"蹲下"不是"陷进地里"）+ 柱子 `setSquash(0.12 × charge)`；起跳时 `scale.y` 弹回 1、`rotation.x = −2π × progress` 前空翻；落地归零并重置；`jumpPeak = min(2.4, 0.85 + 距离 × 0.3)` 让远跳更高
  - 为什么：压缩/翻转都是"只改挂点或整组缩放"，不重建模型；空翻必须写在 `PlayerRenderer.update()` **之后**（update 会把 `rotation.x` 归零），这条在代码里写了注释
  - 验证：`npm run typecheck`；`npm run test:minigame` 141 通过（静态断言覆盖 `BODY_SQUASH`、`setSquash`、`rotation.x = -Math.PI * 2 * progress`）
  - 批次：20261023-1847
- [x] [跳跳7] HUD 与结算：左上分数 / 最高分、结算面板（本局 / 最高 / 再来一局 / 退出）、最高分经 `recordScore` 落盘、i18n → 验证：`npm run test:minigame`（进度回写）+ `npm run typecheck`
  - 做了什么：`.jump-hud` 左上角大号分数 + "最高 n"；`.jump-over` 结算面板（本局分数 / 最高 / 再来一局 / 退出），44px 按钮；`finish()` 里 `recordScore(loadProgress()) → saveProgress()`，并回调 `onScore`；重开走 `restart()`（不退出宿主、seed+1）；新增 i18n `minigame.jump.{hint,best,over,retry}`
  - 为什么：最高分只在"结束"写一次（不打中间分），重开不清最高分；结算按钮 `stopPropagation`，否则点按钮会被 stage 的 pointerdown 当成蓄力
  - 验证：`npm run typecheck`；`npm run test:minigame` 141 通过（"最高分落盘"静态断言 + 进度纯函数/存储容错 16 条）
  - 批次：20261023-1847
- [x] [跳跳8] 特殊方块：音符盒（+30）/ 彩色羊毛（+10），停留 2 秒计时与 toast、只触发一次、不连续出现 → 验证：`npm run test:minigame`（停留计时纯函数 + 只触发一次）
  - 做了什么：落地后若当前方块是 `music` / `cube`，进入停留计时（`specialHoldSeconds = 2`），到点加分 + toast + 音效，`specialTaken` 保证一块只给一次；起跳或重开都会重置计时
  - 为什么：生成侧的"不连续出现"已经在 `logic.specialKindFor` 里挡住（纯函数有 4 条断言）；表现侧只负责计时，避免两处都判一次
  - 验证：`npm run test:minigame` 141 通过（特殊方块生成 4 条 + 场景静态断言含 `specialHoldSeconds` / `specialBonus`）
  - 批次：20261023-1847
- [x] [跳跳9] 音效：WebAudio 合成蓄力音调上升 / 落地 / 中心命中 / 掉落；无 AudioContext 或抛错时静默降级 → 验证：`npm run guard`（0 错误）+ `npm run typecheck`
  - 做了什么：`JumpAudio` 内部类——蓄力一条持续三角波（220→660Hz，随蓄力更新），落地 160Hz / 中心 880Hz 短音，特殊方块 660→990Hz，掉落 300→80Hz 下滑；`ensureContext` 兼容 `webkitAudioContext`，`suspended` 时 `resume`，所有节点操作包 `try/catch`
  - 为什么：不引入音频文件（包体不变）；原版"听声音数节奏"是手感的一部分，所以蓄力音是**持续音高变化**而不是滴滴声
  - 验证：`npm run typecheck`；`npm run test:minigame` 141 通过（"音效静默降级"断言要求同时出现 `AudioContext` 与 `catch`）；`guard` 在收尾条统一跑
  - 批次：20261023-1847
- [x] [跳跳10] 难度平衡：`tools/jump-balance.ts` 模拟 1000 局（随机力度 / 接近完美力度），输出可达率、平均局长度、分数分布；按结果微调 `config.ts` → 验证：`npm run jump:balance` 输出可达率 100%
  - 做了什么：`tools/jump-balance.ts` 三种玩家各跑 500 局（完美 / 判断误差 ±12% / 乱按）+ 0~300 分逐分生成查可达率；据此把间距下限从 1.4 抬到 2.6（原值小于方块边长 1.8，两根柱子会重叠）
  - 为什么：误差模型必须是**百分比**（估的是"该跳多远"），绝对值模型在后期方块变小时会失真（±0.18 格时"手抖玩家"300 跳都不掉）
  - 验证：`npm run jump:balance` → 可达率 100.00%、完美玩家 300 跳不掉、±12% 玩家平均 31.6 跳 / 56.8 分、乱按 2.0 跳，输出"✓ 平衡达标"
  - 批次：20261023-1847
- [x] [跳跳11] Playwright 自查：`tools/jump-e2e.mjs`（进 → 跳 5 次 → 故意掉落 → 结算 → 重开 → 退出 → `stageChildren=0` 与几何回落）+ 截图分析（构图占比、HUD 可读性、按钮尺寸、蓄力反馈是否可辨）→ 验证：`npm run jump:e2e` 全绿 + 自查结论写进完成说明
  - 做了什么：`tools/jump-e2e.mjs` 用 844×390 横屏跑完整链路并落四张截图（菜单 / 待跳 / 蓄力 / 结算）；自己看截图迭代了三轮构图与反馈
  - 为什么：截图是唯一能回答"铺满没有、好不好看"的证据；E2E 是唯一能回答"按钮点得动吗"的证据（纯逻辑测试永远发现不了 pointer capture 吞 click）
  - 验证：`npm run jump:e2e` → **12 / 12 全绿**（面板打开 / 卡片直接开局 / 连跳 5 次 index=5 / 分数累加 / 跳空结算 / 面板可见 / 重开归零 / 最高分保留 / 实例清空 / 层隐藏 / 0 报错）
  - 自查结论（截图分析）：
    · 构图：两根柱子占屏宽约 50~55%（844×390），下一目标始终在画面内；小人完整不裁头；分数左上、提示底部居中
    · 蓄力：身体压缩 45% + 蹲姿前倾 + 柱子下沉 18%，截图里一眼可辨（第一版只压 12%，几乎看不出来）
    · 结算：面板居中、两个按钮 44px、遮罩 55%，"新记录！"会替代"最高 N"
    · 修掉的真 bug：① 初始间距 1.4 < 方块边长 1.8 → 两根柱子重叠、整屏只有一根，**看不到要跳哪**；② 宿主 `setPointerCapture` 把 click 重定向到 stage → 结算按钮点不动（玩家也会遇到）；③ 主题每 20 分切换导致结算画面突变 → 改成每局一个主题；④ 掉落时相机继续跟随导致画面乱甩 → 掉落/结算期冻结
  - 批次：20261023-1847
- [x] [跳跳12] 收尾回归：`npm run check` 全量、`build:fast`、`guard`、`minigame:perf`；`OVERVIEW/TIPS/DONE/TASKS` 与差异表更新 → 验证：四条命令全绿
  - 做了什么：跑完四道门；同步 `notes/jump-game.md` 的差异表（每局一个主题）、参数表（2.0/2.6~4.2）、架构（PillarScene + pillars.ts）与验证工具（jump:balance / jump:e2e）
  - 为什么：`minigame:perf` 第一次报"退出后几何体 93→96"（超 +2），复跑为 94→95（+1）——是主世界区块流式带来的基线波动，不是小游戏泄漏（`smoke.ts` 本批未改，且退出后 `stageChildren=0`、纹理 2→2）；如实记录，没有放宽判据
  - 验证：`npm run check` 全绿（172 套，修了两个 tools 侧类型错误 + 一处误改的聊天遮罩透明度）；`build:fast` 出包；`npm run guard` → 0 条错误；`minigame:perf` 复跑通过（几何 +1、纹理 +0、fps 不劣化）
  - 批次：20261023-1847

---

## 批次 20261023-0000 · 2026-10-23 · 会话 4024a9d4

**做了什么**：多语言**基础设施（P0）**——把 i18n 从"一张 zh 表 + 一张 en 表 + 一个模块级语言状态"
改成"6 种语言装得下"的骨架：语言元数据模块（`LOCALES` 六条 + 前缀匹配 + 兜底英文）、
中文/英文各按界面拆成 9 个分组文件并**用 `satisfies Messages` 把键集卡到编译期**、
语言清单接进运行时（`LocaleCode` + 稀疏表）、首次启动跟随系统（`language: 'auto'`）、
回落链收到英文一档 + 列表连接与复数交给 `Intl`、按需加载 + 切语言整页重载、
`npm run audit:i18n` 接进门禁 + `?lang=xa` 伪语言。共 9 条（8 条 P0 + 1 条审计驱动的 [发现]）。

**条目**（原文照搬）：

- [x] [P0-1] 语言元数据模块：新建 `src/core/i18n/locale.ts`（6 语言元数据 + 前缀匹配 + 兜底英文），`tools/i18n-test.ts` 补一节断言 → `npm run test:i18n` 全绿、`npm run typecheck` 不新增错误
  - 做了什么：新建 `core/i18n/locale.ts`（`LOCALES` 六条元数据：短码 / 自称 / htmlLang / intlLocale；`isLocaleCode` / `localeMeta` / `matchLocale` / `detectLocale`），`tools/i18n-test.ts` 新增一节 22 条断言
  - 为什么：旧 `I18n.detectLanguage()` 只认 zh/en、其余一律回中文，等于"陌生语言用户被塞中文"；且语言清单与自称写死在 `I18n.ts` 里，加语言要动逻辑文件。拆出来后**加语言 = 在 `LOCALES` 加一行**
  - 三个刻意的取舍：① 短码存设置（`zh`/`en` 老存档不用迁移）；② 只做前缀匹配、不做语言协商（玩家的选择优先于设备猜测）；③ 匹配不到返回 `null`，兜底由 `detectLocale()` 定成**英文**——"匹配对不对"与"兜底选谁"分开验
  - 验证：`npm run test:i18n` 135 通过 / 0 失败（原 113 + 新增 22）；`npm run typecheck` 与 `npm run typecheck:tools` 均无错误
  - 批次：20261023-0000
- [x] [P0-2] zh 主表拆成命名空间：把 `I18n.ts` 的 `ZH` 搬进 `core/i18n/locales/zh/*.ts`（menu / settings / inventory / station / chat / progress / minigame / misc），`index.ts` 合成 → `npm run test:i18n` **一条断言都不改**仍然全绿（证明是纯搬运）
  - 做了什么：`I18n.ts` 里的 454 条中文按界面拆成 9 个文件（`menu` 33 / `settings` 81 / `inventory` 123 / `station` 78 / `editor` 38 / `chat` 18 / `progress` 24 / `minigame` 38 / `misc` 21），`locales/zh/index.ts` 合成并导出 `MessageKey` / `Messages`；`I18n.ts` 只留 `const ZH = zh` 一行别名（495 行删到 7 行）
  - 为什么用脚本搬：454 条手打必出错。写了一次性脚本 `.tmp/split-zh.mjs` 解析 `const ZH = {…}` 块（注释挂下一条、续行归上一条），按前缀分组输出；`I18n.ts` 只做"删块 + 加 import + 加别名"
  - 为什么分组从 8 个变 9 个：第一版跑完 `misc` 收了 62 条、跨 12 个命名空间，正是这次要消掉的"杂物抽屉"。加 `editor`（`book.*` / `sign.*` / `template.*` / `buildtools.*`），并把 `recipeBook.*` 归 `inventory`、`beacon.*` 归 `station`，`misc` 降到 21 条（`pause` / `death` / `sleep` / `fullscreen` / `install` / `unit`）
  - 怎么验证"纯搬运"：搬运前后各把 `TABLES.zh` 导成 JSON 排序比对（`.tmp/dump-zh.ts`），**627 条键与值零 diff**；再加 `test:i18n` 135 条一条没改仍全绿
  - ⚠️ 连带改了两处**已通过**的断言（用户拍板：改成走 `t()` 查表）：`ui-test.ts` 3 条（暂停菜单「继续游戏 / 设置 / 保存并退出」）与 `tutorial-test.ts` 2 条（石镐说明、删掉的四步不留文案）原本是"读 `I18n.ts` 源码找中文字面量"，表搬走后必然假红。改后验的是"键对 + 中文值对"，今后再搬文件不会再红
  - ⚠️ 顺带统一了"中文字面量守卫"的口径：`i18n-test.ts` 里同一套判据原来在 5 处各抄一遍，抽成 `firstCjkLiteral()` / `linesWithCjkLiteral()` 两个函数，并把口径写进注释（**中文只允许住在 `locales/zh/**`**）；新增一条"分组文件都被 `index.ts` 合并、不留孤儿"的断言（拆了文件忘了合并会红）
  - 验证：`npm run test:i18n` 139 通过 / 0 失败（135 + 新增 4）；`npm run test:ui` 926 / 0；`npm run test:tutorial` 113 / 0；`npm run typecheck`、`npm run typecheck:tools` 无错误
  - 批次：20261023-0000
- [x] [P0-3] en 同构拆分 + 编译期卡齐：`locales/en/*.ts` 用 `satisfies Messages`（`MessageKey` 由 zh 的 `as const` 推导）→ 故意删一条键时 `npm run typecheck` 必须报错（验完还原）
  - 做了什么：454 条英文按与中文**同一套前缀规则**拆成同样的 9 个文件；每个分组文件用 `satisfies Pick<Messages, keyof typeof zhXxx>`，`locales/en/index.ts` 用 `satisfies Messages` 收口；`I18n.ts` 只留 `const EN = en` 别名
  - 为什么分组用 `Pick<Messages, keyof typeof zhXxx>` 而不是在 index 处一次性卡：这样报错会**指到具体分组文件的具体行**，而不是只说"index 里少了个键"。实测删 `settings.group.game` 时 tsc 同时报两处：`en/settings.ts(96,3)` 与 `en/index.ts(31,3)`
  - 为什么还要 `satisfies` 而不只靠 `keyParity()`：后者是运行期断言（跑测试才知道），前者在 `typecheck` 里，而 `typecheck` 已经在 `check:fast` 与提交守卫里了 —— 零额外成本
  - 顺手把 `I18n.ts` 文件头第 3 条约定改写：原来说"中英键集一致靠 `keyParity()` 给断言用"，现在键集由类型保证，`keyParity()` 退居第二道防线（留给"表是运行时拼出来的"那种情况，比如命令回执合并进来的 129 条）
  - 怎么验证"纯搬运"：搬运前后各把 `TABLES.en` 导成 JSON 排序比对 → **627 条键与值零 diff**
  - 编译期卡齐的验收：`sed` 删掉 `en/settings.ts` 的 `'settings.group.game'` → `npm run typecheck` 报 `TS2741 Property '"settings.group.game"' is missing`（两处）→ 从备份还原 → typecheck 重新通过
  - 新增守卫（`test:i18n` +4 条）：英文分组与中文一一对应、每个分组都带 `satisfies Pick<Messages`、`index.ts` 带 `satisfies Messages` —— 防"类型保护被悄悄删掉"
  - 验证：`npm run test:i18n` 142 通过 / 0 失败；`npm run typecheck`、`npm run typecheck:tools` 无错误
  - 批次：20261023-0000
- [x] [P0-4] 语言清单接进运行时：`Language` 扩成 `LocaleCode`、`TABLES` 改稀疏表（缺表回落 en）、`detectLanguage` 走 `LOCALES` 匹配、`setLanguage` 的 `<html lang>` 走 `htmlLang` → `test:i18n` 补 `fr-FR → fr` 的新语义断言
  - 做了什么：`Language = LocaleCode`（6 种）；`TABLES` 改成 `Partial<Record<LocaleCode, …>>` 稀疏表 + `tableOf()` 取表（没装返回空表，调用方不必判空）；`LANGUAGES` 改成**从表派生**的可选语言（现在仍是 zh/en，写完某语言表会自动出现）；`LANGUAGE_NAMES` 从 `LOCALES` 派生；`detectLanguage` 转发 `detectLocale`、`isLanguage` 转发 `isLocaleCode`；`setLanguage` 的 `<html lang>` 走 `localeMeta().htmlLang`
  - 回落链改成 **当前 → 英文 → 中文 → 键名**：德语缺一条退英文是对的（德语用户多半看得懂），退中文等于把界面切成看不懂的字；中文留在链尾做最后兜底
  - 三个刻意的取舍：① `LANGUAGES`（可选）与 `LOCALES`（支持）分开——"能选但没内容"比不列更糟，所以下拉只列有表的；② `isLanguage` 认**支持的全集**而不是"有表的"——存档里存了 `de` 不该被判成脏数据、把玩家设置重置掉；③ 没有直接动 `DEFAULT_LANGUAGE`（仍是 `zh`），"首次启动跟随系统"是 P0-5 的事，这条不做半截
  - ⚠️ 连带修了 3 处同类"双语假设"（`typecheck` 当场抓出来的 + 同批 grep 出来的）：`UsageText.translateUsageFields` 的参数类型 `'zh' | 'en'` 放宽到 `Language`；`messages.pickLabel()` 与 `advancementText.ts` 三处判定从"是不是英文"改成"**是不是中文**"——原来德/俄用户会在这几处拿到中文（`Weather set to 下雨` 那类半截话的根源）
  - ⚠️ 改了两条**已通过**的断言（条目里预先约定了）：`detectLanguage('fr-FR')` 由"回退中文"改成 `'fr'`、`detectLanguage(undefined)` 改成 `'en'`；另加 4 条（`de-AT`/`pt-BR`/`ja-JP` 的匹配与兜底）
  - 验证：`npm run test:i18n` 154 通过 / 0 失败（142 + 新增 12）；`test:settings` 111、`test:commands` 434、`test:advancement` 116 全绿；`typecheck` 与 `typecheck:tools` 无错误
  - 批次：20261023-0000
- [x] [P0-5] 首次启动跟随系统：设置项加 `language: 'auto'`（老存档迁移 + 写坏回退）、设置页下拉加"跟随系统"、`boot()` 时按 `navigator.language` 定语言 → `npm run test:settings` 与 `test:i18n` 全绿
  - 做了什么：`I18n.ts` 新增 `AUTO_LANGUAGE` / `LanguageSetting` / `isLanguageSetting` / `deviceLanguage` / `resolveLanguage(setting, tag?)` / `applyLanguageSetting()`；`GameSettings.language` 改成 `LanguageSetting`，出厂默认改成 `auto`；设置页下拉变成 `['auto', ...LANGUAGES]`，`auto` 那条标签显示"跟随系统（English）"（括号里是**这台设备**解析出来的语言）；`boot()` 第一屏之前调 `applyLanguageSetting(loadSettings().language)`
  - 为什么 `auto` 不塞进 `Language`：它不是一种语言，没有文案表、也不该进 `TABLES`。混进去会让 `t(key,'auto')` 在类型上合法却永远查不到东西，所以单独一个 `LanguageSetting` 联合类型
  - 为什么老存档里的 `zh`/`en` 原样保留：那是玩家当时的选择（或旧版默认）。换默认值不该把老玩家的界面语言改掉 —— 只有"没这个字段 / 写坏了"才回落到 `auto`
  - 为什么下拉只列有表的语言：`auto` 之后是 `LANGUAGES`（从 `TABLES` 派生），所以德语表没写之前不会出现"Deutsch 选了没反应"
  - ⚠️ 顺带修掉一个**既有缺陷**：`setLanguage()` 原来只在 `SettingsScreen.applyLanguage()` 里被调用（打开设置面板时才跑），也就是说**存档里存的 `en` 在启动时根本没生效**——主菜单一直是中文，直到打开设置。现在 `boot()` 在建任何界面之前先应用一次
  - 验证：`test:i18n` 163 通过 / 0 失败（154 + 新增 9）；`test:settings` 119 通过 / 0 失败（111 + 新增 8：出厂默认、老存档保留、写坏回落、德语虽无表也合法）；`typecheck` / `typecheck:tools` 无错误
  - 批次：20261023-0000
- [x] [P0-6] 回落链与语言相关格式：`t()` 回落 当前 → en → key（去掉硬编码 `ZH`）、`joinList` 改 `Intl.ListFormat`、新增 `tn()`（`Intl.PluralRules`，为俄语 4 种复数留口）→ `test:i18n` 补 de/ru 假数据用例
  - 做了什么：`t()` 回落链砍到 **当前 → 英文 → 键名**（去掉"最后退中文"）；`joinList` 改走 `Intl.ListFormat(conjunction)`；新增 `plural.ts`（零依赖：`PluralCategory`/`PluralForms`/`PluralTable` + `pluralCategoryFor`）；`I18n.ts` 加 `PLURAL_TABLES`/`pluralTableOf`/`pluralCategory`/`tn()`；`tp()` 与 `tn()` 共用抽出来的 `substitute()`
  - ⚠️ 中文列表连接**按用户拍板改成 Intl conjunction**：`木板、圆石、木棍` → `木板、圆石和木棍`，两项 `木板和圆石`。这是本批唯一有意的中文可见变化（换来不再为每种语言手写连接规则），对应断言也照新口径改了
  - 为什么去掉"最后退中文"这一档：`locales/en/**` 已由 `satisfies Messages` 保证键集与中文完全一致，英文那一档不可能查空；留着退中文反而会把"漏翻"伪装成"只是语言不对"
  - `tn()` 的两个关键取舍（都踩过）：① **复数类别必须跟模板同语言**——拿德语规则去英文模板里挑类别，会挑出英文没有的 `few`/`many`，最后只能退 `other`；② 判断"这条文案最终由哪种语言提供"用的是 `t()` 同一条回落判据，不是"当前语言的复数表有没有这个键"
  - 复数只登记**真正会读错**的键：`station.brewLeft`（英文 `{count} more brews` → 1 时读错），其余用 `t()` 那一条；中文没有复数形式（CLDR 只有 other），自动走回落
  - ⚠️ 自己写错一条断言并修正：最初用 `t(key,'de') === key` 判"英文表是否完整"，但命令回执里有 `{name} Health = {value}` 这种**语言中性**条目，英文值就是键本身，被误报。改成判"键在不在英文表里"
  - 验证：`test:i18n` 180 通过 / 0 失败（163 + 新增 17）；`test:ui` 926、`test:inventory` 103 全绿；`typecheck` / `typecheck:tools` 无错误
  - 批次：20261023-0000
- [x] [P0-7] 按需加载 + 切语言重载：`loadLocale()`（zh/en 静态、ru/pt/fr/de 动态 `import()`）、`boot()` 先加载再建 UI、切语言存设置后 `location.reload()`，删除 `SettingsScreen.applyLanguage()` 系列 → `npm run test:ui` / `test:settings` 全绿
  - 做了什么：`TABLES` 改成"可写池 `TABLE_POOL` + 只读视图"；新增 `LocaleModule` 类型、`LOADERS` 注册表、`registerLocaleLoader()`、`loadLocale(code)`（异步，失败**不抛异常**只返回 false）；`LANGUAGES` 常量改成函数 `availableLanguages()`（有表**或**有加载器才算可选，因为表现在会在运行时填进来）；`applyLanguageSetting()` 改成 `resolve → loadLocale → setLanguage` 的异步链，`boot()` 里 `await` 它；设置页切语言改成存设置 + `location.reload()`；删掉 `labelBindings` / `applyLanguage()`，`bindLabel()` 只写文案
  - 为什么 zh/en 不走动态加载：中文是源语言、英文是回落链的唯一一档，两者**第一帧**就要用（首屏提示、`<html lang>`、每次 `t()` 的兜底），异步会把启动改成"先白屏再出字"
  - 为什么现在 `LOADERS` 是空表：ru/pt/fr/de 的表还不存在，写 `import('./locales/de/index.ts')` 会直接构建失败。P4 写完某语言的表就在 `LOADERS` 加一行（`de: () => import('./locales/de/index.ts')`），这也是唯一的一步。加载链本身已用**假语言**在断言里跑通（注册 `de` → 加载 → 表进池子 → `t()` 查得到 → 可选清单变长）
  - 为什么切语言要整页重载：局部重刷（`applyLanguage()`）只能覆盖挂了 ref 的那几个节点，物品名/生物名/成就/命令反馈/配方书都刷不到；这套机制已经踩过"`applyInventoryChrome()` 把硬编码写回去、刷完一秒又被覆盖"的连环坑。重载后 `boot()` 重新解析、加载、建界面，`applyLanguage()` 整条机制可以删掉
  - ⚠️ 连带改了一句文案：`settings.language.hint` 从"切换后重新打开本面板生效"改成"切换后游戏会重新加载以生效"（旧文案在重载机制下已经是错的）
  - ⚠️ 断言侧机械适配：`LANGUAGES` → `availableLanguages()`（6 处调用点，语义不变）；`applyLanguageSetting` 现在是 async，断言里加 `await`
  - 验证：`test:i18n` 190 通过 / 0 失败（180 + 新增 10）；`test:ui` 926、`test:settings` 119、`test:unit` 151（20 文件）全绿；`typecheck` / `typecheck:tools` 无错误
  - 批次：20261023-0000
- [x] [P0-8] 审计与伪语言：`npm run i18n:audit`（扫 `t('…')` / `tp('…')` 字面量 → 报"用了但没有 / 有但没人用 / 各语言覆盖率"）接进 `check:fast`；`en-XA` 伪语言（`?lang=xa`）→ `npm run i18n:audit` 报 0 缺口
  - 做了什么：新增 `tools/i18n-audit.ts`（+ `npm run audit:i18n`，接进 `check:fast` 与 `check` 的 typecheck 之后，便宜且早失败）；`I18n.ts` 新增 `setPseudoLocale` / `isPseudoLocale` / `isPseudoLocaleTag` / `pseudoText`，`boot()` 里 `?lang=xa` 打开伪语言
  - 审计的三条判据：**缺失**用窄判据（只认 `t()`/`tp()`/`tn()`/`msg()` 的直接第一参数，硬错误 `exit 1`）、**孤儿**用宽判据（源码里出现过该字符串就算引用，只报告不失败）、**覆盖率**按 `LOCALES` 逐语言报
  - 两个刻意的取舍：① **先剥注释再扫**——这个仓库注释里大量出现键名，不剥会把死文案算成有人用；② **剥注释要保留行号**（注释行换成空行而不是删掉），否则报出来的 `file:line` 会位移
  - 🔴 **审计第一次跑就抓到一个真 bug**：`Commands.ts:572` 的 `msg('{key} 已设置为 {value}（超出范围，已夹到 {clamped}）')` 在 `commandMessages.data.ts` 里**没有对应英文**。中文下看不出（键就是中文原文），英文下会整句漏中文。已补 `'{key} set to {value} (out of range, clamped to {clamped})'`
  - 另一处误报也修了：`msg('当前游戏规则：\n{rules}')` 扫出来是反斜杠+n 两个字符，而表里的键是真换行 → 加 `decodeLiteral()` 还原转义（`\n` / `\t` / `\uXXXX` / 引号）
  - 伪语言为什么用"包括号"而不是"换字母变音"：中文文案也要能一眼认出来，而音标只对拉丁字母有意义；括号也不吃字宽，不会把正常界面撑坏
  - ⚠️ 伪语言是**运行期变换**（在 `t()` 出口包一层），不是造一张 `en-XA` 假表：假表只能覆盖"已有的键"，而这里要照的是"没接 i18n 的文字"，两者覆盖面一样但变换版不需要新 LocaleCode、新表、新加载器
  - 实测数字：353 个文件 · 554 处直接调用 · 表里 629 条键 · zh/en 各 100% · 孤儿 73 条（多含数据驱动取键）
  - 验证：`npm run audit:i18n` → 0 缺口、exit 0；`test:i18n` 198 通过 / 0 失败（190 + 新增 8）；`npm run check:fast` 全绿（typecheck + audit:i18n + vitest 151 + 离线 172 套，17.3s）
  - 批次：20261023-0000

- [x] [发现] 先修 `audit:i18n` 的引用判据，再清确实死掉的键（顺序不能反：判据不可信时删键 = 让界面显示裸键名，而且不报错）
  - 做了什么（修判据）：`tools/i18n-audit.ts` 换掉"按成对单引号切字符串"的做法，改成两条更稳的判据 —— ① **源码子串包含**（`code.includes(key)`）；② **模板拼键前缀**（`t(`settings.opt.fps${n}`)` → 前缀 `settings.opt.fps`；短于 4 字符不收，避免 `settings.` 把整片放行）。报告里把 4 个前缀打出来，过宽前缀一眼可见
  - 做了什么（清键）：删 4 条确认死文案（zh + en 各一份）：`settings.language.hint`（重载提示从未被渲染）、`settings.row.autosave`（批次 528 删掉自动保存行）、`slot.rename`（铁砧用的是 `slot.anvilRename`）、`tutorial.title`（引导卡标题另有来源）。表 629 → **625** 条
  - 为什么旧判据不可信：它靠"成对单引号"切字面量，一行里反引号模板与单引号混排时配对错位、后面整段被切乱 —— 实测 `inventory.recipeBook` 明明写在 `InventoryScreen.ts:1038` 却被报成孤儿，`settings.opt.fps30` 这类模板拼键也全被判死。**73 条里只有 4 条是真的**
  - 验证：`npm run audit:i18n` → 孤儿 73 → **0**，zh/en 覆盖率 625/625 100%，exit 0；`npm run test:i18n` 198 通过 / 0 失败（死键同时从两处"必需键"清单里去掉：`required` 与 `slotKeys`）；`npm run check:fast` 全绿（命中 14/172 套）
  - 批次：20261023-0000

**队列原文 · 其余部分**（验收口径与后续路线图，P1~P5 尚未开工，留档备查）：

- `npm run check:fast` 与 `npm run check` 全绿
- 中文与英文**文案内容零 diff**（P0 只搬不译）
- 4 个新语言文件可以先不存在，但 `LOCALES` 登记之后，缺表必须被审计报出来，而不是静默回落
- **P1 命令域键化**：129 条回执 → `cmd.*`；`usageError('中文用法')` → `usageError('tp')` 查 `cmd.usage.*`；`/help` 的 usage/description 进表；删除 `USAGE_FIELD_NAMES` / `translateUsageFields` / `pickLabel`；`CommandHelp.ts` 的 140 条参数标签 + `CommandHelpScreen` 整屏
- **P2 数据层键化**（中文文本零变化）：物品/方块名 `item.<id>`；说明 `item.desc.<id>`（独立文件）；生物名、职业/等级、附魔、效果、群系、维度、世界类型、音效组、外观 10 张、朝向、旗帜图案、配方书页签、类别；逻辑层 reason 串（`Loom` / `StationNeed` / 容器红底原因）
- **P3 界面残留**：`TouchControls` / `Tooltip` / `BookScreen` / `SignEditor` / `NameTagEditor` / `CommandBlockEditor` / `BeaconScreen` / `UnsupportedScreen` / `StatisticsScreen` / `LoadingOverlay` / `relativeTime` / `index.html` 首屏 / `manifest.webmanifest`
- **P4 新语言**：德语（最长串、复合词）→ 俄语（4 种复数 + 西里尔）→ 法语 → 葡语（巴西）；每语言一个批次
- **P5 Play 发行**：商店列表 6 份文案、Android 13 per-app language 透传、`?lang=` 深链、真机横屏逐语言过一遍

