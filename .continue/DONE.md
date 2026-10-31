# 完成档案 · DONE

> 本文件是**已完成工作的唯一档案**，只回答"这批做了什么、怎么验的"——时间线，最近的在最上面。
> 按模块看现状与坑 → `OVERVIEW.md`；下次怎么避开 → `TIPS.md`；机制与格式 → `README.md`。
> **一条内容只写一个地方**，别在三份文档里各抄一遍。
>
> 收尾时**整份队列原样搬进来**（含每条任务下方的完成说明与 `[阻塞]`），标题格式
> `## 批次 <号> · 日期 · 会话 <前 8 位>`。

---

## 批次 20261031-1025 · 2026-10-31 · 会话 d02a01-decision

> 末影之眼可见性：降速 + 紫色尾迹 + 本体自发光

# 决策 · 会话 d02a01d3bf2a427eb75b76e23ae21dd1（批次 20261031-1025）

## D1 · 速度 11 → 8 格/秒，寿命 4 → 4.5 秒（射程 44 → 36 格）

- 决定：两个常量一起改，射程只缩 8 格。
- 为什么：原版是"每 tick 朝目标加一点速度 + 阻尼"，稳态约 9 格/秒、飞 80 tick（4 秒），射程三十几格。本项目 11 格/秒比玩家跑动（约 4.3）快太多，没有参照物时"嗖"一下就不见了。降到 8 并把寿命补到 4.5 秒，射程 36 格——比原版略长一点，既慢下来又不至于让玩家多扔十几次。
- 影响：单次从 44 格降到 36 格（839 格的要塞约 23 次）；改回两个常量即可撤回。

## D2 · 尾迹每 0.05 秒一颗（20 颗/秒），复用现有 portal 粒子

- 决定：`Throwable.tick` 里按时间累积，每满 0.05 秒调一次 `ctx.spawnPortalParticles(x, y, z, 1, 0.06)`。
- 为什么：原版是每 tick（20/秒）在眼睛后方撒一颗 `PORTAL` 粒子，所以远处能看见一条紫尾迹。本项目贴图虽在，但**飞行中一颗粒子都没有**（只有碎掉时才有），速度一快就彻底失去参照。按 60fps 每帧撒会变成 270 颗，既挤 1024 的粒子池又过密，所以按 20/秒对齐原版的 tick 频率。
- 影响：尾迹在场约 30 颗（`portal` 粒子寿命 0.9~1.6 秒）；只在 `ender_eye` 上生效，其它投掷物不受影响。

## D3 · 眼睛本体自发光（`materialForLevel(15)`）

- 决定：`EntityRenderer.syncThrowable` 把 `ender_eye` 与火球归进同一档"自发光"。
- 为什么：本项目实体渲染会按所在格的天光/方块光变暗，夜里或洞里扔出去的眼睛几乎看不见；原版的可见性主要靠粒子尾迹，但"远处还能看到它"最直接的做法是让本体不吃环境光。这一条**比原版更亮**，所以记进 TASKS 的差异台账。
- 影响：夜里/洞里的眼睛像一颗小灯（只有 0.3 格的 sprite，不会照亮周围）；要撤回只需把它从自发光那一档去掉。

---

## 批次 20261031-0943 · 2026-10-31 · 会话 d02a01-decision

> 末影之眼找不到末地：要塞地表入口 + 眼睛射程 + 传送门房箱子

# 决策 · 会话 d02a01d3bf2a427eb75b76e23ae21dd1

## D1 · 要塞入口做成"把现有梯子井向上延长到地表"，而不是新建螺旋楼梯

- 决定：井位沿用原点房间正中那 2×1（`s.x`/`s.x+1`, `s.z`，与下层梯子井同一条），从 `s.y+3` 一直挖到 `world.surfaceY(s.x, s.z)`，两侧梯子、井壁包石砖。
- 为什么：不新建横向通道、不改 origin 房间布局，跨区块重放最简单；原版那条螺旋楼梯要十几段逐级抬升，在纯函数生成里最容易出现"邻居区块各画一半"的接缝问题。井位在房间正中，玩家从地表爬下来直接落在上层入口房间。
- 影响：新探索的区块里每座要塞都会多一条竖井（老存档已生成的区块不变）；只改生成，不动存档格式。撤回只需删掉 `buildSurfaceShaft` 的调用。

## D2 · 地表在水下时，井口砌到海平面以上一格（不做"跳过"）

- 决定：井的顶部取 `max(world.surfaceY, SEA_LEVEL + 1)`；井壁从井底一直包到井口，井内是空气。
- 为什么：默认种子里最近那座要塞（`685, -18, -484`）的地表只有 y=36，**就在海面下**——最初写的"水下不开井口"会让这条修复对用户实际遇到的那座要塞完全失效。井壁是完整 4×3 外框、没有对角缺口，所以水灌不进井；海里那一截就是一根石砖烟囱，玩家游到塔顶再下去。
- 影响：水下要塞多一段水面上的石砖塔（视觉上比原版更显眼，但"找不到"的代价更大）。撤回只需把 `Math.max` 换回 `surfaceY` 并在水面下 return。

## D3 · 眼睛只调"上升初速 + 存活时长"，不改目标点、不改 15 格信号

- 决定：`ENDER_EYE_RISE` 5.5 → 9，`ENDER_EYE_LIFETIME` 3.5 → 4（原版 80 tick）。
- 为什么：实测 60 个地表采样点里 12% 飞不到 5 格、中位数只有 29 格——根因是最高只到约 8 格，一撞树/坡就落地。抬高到约 14 格、射程 44 格就能越过大部分树冠；而"目标指要塞原点"已够用（竖井就在原点正上方），改成指传送门房要重算 `planStronghold` 的随机序列，脆弱且容易和真实生成错开。
- 影响：眼睛单次飞得更远（839 格理论 19 次而非 24 次）；`test:throwable` 的射程断言仍落在 25~60 区间。数值回到 5.5/3.5 即可撤回。

## D4 · 传送门房箱子加末影之眼（1~3 个，权重 4）

- 决定：`stronghold_portal` 表新增 `Item.ENDER_EYE` 一条，量按原版量级。
- 为什么：原版这张表本来就有末影之眼；本项目只给珍珠，玩家没带够眼睛时进了要塞也点不亮，而烈焰粉要靠下界——等于把"找到要塞"又推回"先去下界"。
- 影响：`stronghold_portal` 的珍珠期望会从 2.5 略降（总权重变大），`test:endportal` 只断珍珠的 2~3 颗、不断期望值，不会红。

---

## 批次 20261031-1300 · 2026-10-31 · 会话 mine2-20261031

> 挖方块仍未及时：只重烘改动段 + 编辑固定 Worker

# 队列 · 会话 mine2-20261031

> 状态：执行中
> 创建：2026-10-31
> 批次：20261031-1300

- [x] 复测并拆解"方块仍不及时消失"：真机按住挖，量 往返 / Worker 解析 / 烘网格 / 拷贝 四段
  做了：`/tmp/mine9.mjs`、`/tmp/mine10.mjs`（在页面里包 `meshPool.request`，读 Worker 回包的 `perf`）。结论：**烘网格是大头**——整列 9~10 段 96~160ms，3 段约 40ms；解析 3ms、拷贝 1~2ms。上一版每次都在整列重烘，因为"攒下的改动段"越攒越多。
  验证：Pixel 2 XL 实跑，数据见上。
- [x] 只重烘被改动的那几段：Worker 缓存上一次的顶点数据 + 段连通图，编辑固定落在同一 Worker；攒超过 3 段只追最新那段，其余后台"追平"→ `test:render`
  做了：`MeshRequest.sections/keep`、`sectionCache`（最近 2 个区块）、`MeshWorkerPool.workerFor` 固定分配、`ChunkRenderer.edits`（段集合 + 最新段）+ `pendingSet`（追平）。
  验证：`test:render` 新增 5 条（加载是整列、改一格只带 7/8/9、在途不重复派发、攒多了只追最新三段、被挤掉的段由追平补）；真机：改动→上屏 中位 82 → 51ms，最大 319ms，6 秒挖 40 格全部各挂一次。提交 `f3eea369`。

---

## 批次 20261031-1031 · 2026-10-31 · 会话 55858f3f

# 队列 · 会话 55858f3f628e4b31821c7b04ebc713c3

> 状态：执行中
> 创建：2026-10-31
> 批次：20261031-1031

> 目标（用户 2026-10-31）：手机（安卓壳 / 触屏）上弓弩射不出去——按住没有反应，
> 松手只会挖方块。要修根因（手势归属），不是绕开症状。

- [x] 触屏上弓/弩/望远镜不再被"射线必须指空"挡住：`web/src/main.ts`（`usingItem` + 新增 `holdsChargeable`）→ `npm run test:ui` + `npm run check:fast`
  - 做了什么：`usingItem` 按手持物品分流——新增 `holdsChargeable`（弓 / 弩 / 望远镜），这三件跳过 `hit !== null` 判据，维持条件读 `touch.aimPoint !== null`（手指还按着）；其余物品保持原判据。
  - 为什么：触屏的 `hit` 就是手指落点，而 `REACH` 已是 10 格（批次 336），"射线前方 10 格没有方块"几乎不成立，于是弓一次都充不了能；`touch.holding` 还要求"未拖动"，等于禁止边拉弓边瞄准。
  - 验证：`npm run check:fast` 全绿；`npm run test:ui` 1232 通过 / 0 失败。
  - 批次：20261031-1031
- [x] 拉弓/装填期间不再顺手挖方块、打怪、乱挥手：`web/src/main.ts`（`chargingShot` + `updateBreaking` / `updateAttacking` / `updateArmSwing`）→ `npm run check:fast`
  - 做了什么：新增 `chargingShot`（`bowDrawing || crossbowDrawing`），`updateBreaking` 的早退条件、`updateAttacking` 的攻击分支、`updateArmSwing` 的节拍器三处读它；拉弓期间顺手作废排队的轻点攻击请求。
  - 为什么：放宽 `usingItem` 之后，触屏长按 400ms 会同时把这一下判成"挖方块/打怪"（`onBreakStart → leftDown`），一边拉弓一边把瞄着的地挖穿。
  - 验证：`npm run check:fast` 全绿；`read_lints` 零诊断。
  - 批次：20261031-1031
- [x] 弩对功能方块让位 + 开界面时显式取消蓄力（关背包不再补射）：`web/src/main.ts`（`updatePlacing` / `updateInteraction` 早退）→ `npm run check:fast`
  - 做了什么：`updatePlacing` 里"手上是弓就 return"那条扩成 `BOW || CROSSBOW`；`updateInteraction` 在 `uiOpen || sleeping` 的早退分支里显式清 `bowDrawing/bowCharge/crossbowDrawing/crossbowCharge`。
  - 为什么：弩原来没有这一条，对着箱子/工作台按住会先开界面、装填白做；而那段早退会把 `updateBow`/`updateCrossbow` 整段跳过，只清 `hit` 的话 `bowDrawing` 悬在 true、蓄力值不清零，关掉背包那一帧会补射一箭。
  - 验证：`npm run check:fast` 全绿；`read_lints` 零诊断。
  - 批次：20261031-1031
- [x] 把这次的语义钉成离线断言：`tools/ui-test.ts` → `npm run test:ui`
  - 做了什么：`tools/ui-test.ts` 新增 6 条断言——`holdsChargeable` 白名单内容与顺序（必须在 `hit !== null` 之前）、弓弩维持条件读 `aimPoint`、食物/盾仍保留原判据、`chargingShot` 被挖/打/挥三处读取、弩与弓一样对功能方块让位、开界面早退里清两套蓄力状态。
  - 为什么：`usingItem` 这条判据之前零断言（只钉了一句源码字符串），改坏了没人红——这次就是这么静默坏掉的。
  - 验证：`npm run test:ui` 1232 → **1238 通过 / 0 失败**（新增 6 条全过）。
  - 批次：20261031-1031
- [x] 全量门禁 + 台账收尾：`npm run check` → 全绿
  - 做了什么：跑全量 `npm run check` 发现两道**预存**的红（与本次改动无关）：① `tools/structure-test.ts` 的 `shaftCache` 写死 `Map<string, Uint8Array>`，而方块 id 已是 16 位（`BlockArray = Uint16Array`）→ `typecheck:tools` 直接报 3 条；② `audit:diffs` 的差异台账过期（237 → 238 条，由批次 20261031-1025 往 L39 里补注记后没重新生成）。①随本条修掉（只改缓存类型声明），②按台账规矩重新生成（派生内容不手改）。
  - 为什么：`git commit` 的守卫只跑 `check:fast`（不含 `typecheck:tools` 与三张台账），所以这两处能在 main 上一直红着不被发现；不修掉的话这批的"全量门禁"是空话。
  - 验证：`npm run check` 退出码 0；`test:offline` 181 套全绿；台账 `--print` 三项通过。
  - 批次：20261031-1031

---

## 批次 20261031-1100 · 2026-10-31 · 会话 mine20261031

> 挖方块时方块要等停手才消失：在途网格被后续改动作废

# 队列 · 会话 mine20261031

> 状态：执行中
> 创建：2026-10-31
> 批次：20261031-1100

- [x] 复现与定位：真机按住挖 + 边走边挖，逐次记录"改方块 / 网格派发 / 结果回传 / 挂进场景"的时间线
  做了：`/tmp/mine8.mjs` 6 秒挖掉 54 格只挂上 13 次网格，中间 2 秒画面完全不动；停手后最后一份才挂上。根因在 `ChunkRenderer.enqueue`：遇到在途请求就把序号往前推让在途结果作废，连续挖时在途结果永远比下一次改动旧，全部被丢弃。这条逻辑 2026-10-17 起就有，不是本批引入的，但移动时的帧内预算让它更容易被看见。
  验证：同脚本在旧包（`app-step7`）上同样复现（190 格 / 19 次挂载），确认非回归而是老毛病。
- [x] 在途请求不再被后续改动作废：`ChunkRenderer.dirtyRebuild` + 挂上后立刻按最新状态重烘 → `test:render`
  做了：同一区块同时只允许一个在途请求，期间的改动只记一笔脏；结果挂进场景后立刻用 `MESH_PRIORITY_EDIT` 重排一次。单块最多落后一次往返。
  验证：`test:render` 新增 5 条（在途期间不重复派发、在途结果照样挂、挂上后立刻重排、重排确实派发）；真机同场景挂载 13 → 70 次 / 6 秒，改动→派发 1ms、派发→回传 76ms、回传→挂载 5ms，无整块丢弃。提交 `266fbd83`。

---

## 批次 20261031-0930 · 2026-10-31 · 会话 judder20261031

> 低端机移动时满帧却顿：帧时钟与 Worker 回传重活的帧内预算

# 队列 · 会话 judder20261031

> 状态：执行中
> 创建：2026-10-31
> 批次：20261031-0930

- [x] 摸底：真机 CDP 逐帧记录 rAF 时间戳 / 帧体分段 / GL 上传 + CPU profile，飞行前进时找"满帧却卡"的来源
  做了：三个来源。① dt 用回调开头的 `performance.now()`，回调起点被推迟 0~5ms（p90 4.6ms），dt 在 13~19ms 之间跳，位移忽大忽小；② Worker 生成结果在消息回调里当场并入，`onChunkLoaded` 里刷怪笼 / 村庄床两趟全高度三重循环 + 光照播种，一次 20~54ms，正好落在两帧之间；③ 网格结果也在回调里合并 + 逐顶点 `computeBoundingSphere`，一块 3~8ms，几块前后脚到就叠起来。
  验证：`/tmp/judder.mjs`、`/tmp/prof.mjs` 在 Pixel 2 XL 实跑，旧包飞行 12 秒掉帧 26~33、显示间隔 p99 50~67ms。
- [x] 帧时钟改用 rAF 时间戳：`core/world/PerfPolicy.ts#frameClock` + `main.ts` 主循环 → `test:perfpolicy`
  做了：dt / 限帧判据 / 暂停与后台的 lastTime 一律用 vsync 时间戳；缺失、非法或比 now 晚时退回 now。
  验证：`test:perfpolicy` 新增 5 条（回调抖动不进 dt、对照组 now 会抖 4ms 以上、三种退回）。
- [x] 区块并入挪进帧内按预算：`World.enqueueGenerated` / `integrateArrived` + `CHUNK_INTEGRATE_BUDGET_MS = 1`（实际每帧一块）→ `test:render`
  做了：消息只排队，主循环每帧并入；遮罩期不限；200ms 没人取由定时器兜底；`setDimension` / `reset` / `dispose` 清队列；排队中的仍算 `pendingCount`。
  验证：`test:render` 新增 8 条（到达不并、至少一块、不限一次并完、计数）。
- [x] 加载扫描先查表跳过：`core/world/ChunkContents.ts` + `main.ts#onChunkLoaded` → `test:loot`
  做了：一趟查表（空 section 跳过、全找到提前返回）判断有无箱子 / 避雷针 / 刷怪笼 / 信标 / 床，没有的那几趟整趟跳过，有的照旧跑原扫描。
  验证：`test:loot` 新增 8 条，含与逐格扫描对拍 40 个随机区块。
- [x] 网格挂载挪进帧内按预算 + 包围球按 section 范围直接给：`ChunkRenderer.applyReady` + `MESH_APPLY_BUDGET_MS = 4` → `test:render`
  做了：Worker 网格结果排队，帧内挂载；排队期间区块卸载就丢弃；包围球用 `fitSphere`（与 `applySections` 同一个盒子），不再逐顶点算。
  验证：`test:render` 新增 4 条；真机同场景 A/B（飞行前进 12 秒 × 3 次）：掉帧 26~33 → 2~3，显示间隔 p99 50~67ms → 16.9ms，平均 55 → 59.4 fps。提交 `b52b0054`。

---

## 批次 20261031-0055 · 2026-10-31 · 会话 c747f7

> 降温第二批：数据驱动砍 draw call / 三角形，加空闲降帧

# 队列 · 会话 c747f798fe5f443089f73456db302086

> 状态：执行中
> 创建：2026-10-31
> 批次：20261031-0055

- [x] 摸底：真机 WebView 远程调试（release 包 `-e debugweb true`）逐帧统计 draw call 来源、DOM 变化、IO 来源 → 数据驱动后续各项
  做了：低头满屏地形每帧 157 次 draw call 里 152 次是区块网格、三角形 167 万；DOM 每帧只有 `#death` / `#target-vitals` 各写一次 class；5 秒内 localStorage 1 次、worker 消息 6 条，IO 不是问题。
  验证：CDP 取样脚本在 Pixel 2 XL 上实跑，数据见上。
- [x] 遮挡搜索加视锥约束 + 包围球收紧到要画的 section + 两处 class 不再每帧写：`render/SectionOcclusion.ts` + `render/ChunkRenderer.ts#applySections` + `main.ts` → `npm run check:fast` + 真机 draw call / 三角形
  做了：BFS 只往视锥内 section 扩展（视图矩阵变化才重算，真机转视角时每帧 ≤1.1ms）；包围球按实际要画的 section 高度重设；`classList.toggle(…, force)` 状态不变不写。提交 `c0bb0cf9`。
  验证：`test:mesh` 新增 8 条断言（视锥前/后、包围球覆盖与收紧、全画回整列）；真机低头 draw call 298 → 163、三角形 164 万 → 57 万，平视 148 / 23 万；平视截图远景、水、树林无漏画。
- [x] 顶点 / 索引无损瘦身：合并网格顶点 < 65536 用 16 位索引 → `npm run check:fast` + 真机画面
  做了：`mergeSectionLayer` 按顶点数选 `Uint16Array` / `Uint32Array`，数值不变。顶点属性改 16 位整数（植物交叉面等非 1/16 坐标会变）不满足"逐像素一致"，判定不做。提交 `ecede2bc`。
  验证：`test:mesh` 新增 2 条断言（类型与数值）；真机画面正常。
- [x] 动态帧率（用户 2026-10-31 提出）：没操作、画面不动时降帧，任何输入立即恢复 → 离线断言 + 真机帧率时间线
  做了：`core/world/IdleFrameRate.ts`，2.5 秒无输入 + 相机位姿不变 + 世界不在成批加载时上限 30 帧；手指按住、坠落 / 载具、成批加载都不降（随机刻零星重刷不算加载）；空闲帧不喂自适应降档。安卓壳改由原生 `InputManager` 判断手柄（`JsHostBridge.hasGamepad` + 设备监听派发事件），网页不再注册 `gamepadconnected`（Chromium 有这个监听就常驻手柄轮询线程）。提交 `6ea853d6`。
  验证：`test:perfpolicy` 新增 9 条断言；真机静止 100% 时间 30 帧、拖动视角当帧恢复 60；线程表里 Gamepad polling 消失。
- [x] 真机冷机（电池 ≤33°C）复测：持续拖动视角 59.0 fps、帧时间中位 5ms / 90 分位 10ms、卡顿 3.5%、CPU 合计 73%；稳态静止 30.8 fps、卡顿 0.3%、CPU 合计 44%（上一批末静止为 61 fps / 74%）
  做了：测量脚本加入"持续拖动"与"只采样"两种模式，APK 路径显式传入、安装失败即报错。
  验证：两轮 20 秒 `dumpsys gfxinfo` + `/proc` 线程采样，开测/结束电池温度均在 32.4~34.2°C。

---

## 批次 20261030-2316 · 2026-10-31 · 会话 c747f7

> 手机发烫，在不降画质前提下做四步渲染与空转优化

# 队列 · 会话 c747f798fe5f443089f73456db302086

> 状态：执行中
> 创建：2026-10-30
> 批次：20261030-2316

- [x] 实心层拆成「不透明 / 镂空」两份材质，不透明层不再 discard：`core/mesh/ChunkMesher.ts` + `render/ChunkRenderer.ts` + `render/VoxelMaterial.ts` → `npm run check:fast` + 真机出帧数
  做了：图集逐张判定 16×16 全不透明贴图（资源包覆盖后重判），下发给网格 worker；整格方块且贴图全不透明的面进 `opaque` 层，`VOXEL_OPAQUE` 宏编译掉 alpha 测试，先于镂空层绘制吃 early-Z。提交 `50b71b0e`。
  验证：`npm run check:fast` 全绿；Pixel 2 XL 冷机（电池≈33°C）同种子满屏地形 20 秒：60 fps 封顶、帧时间中位 5ms / 90 分位 18ms、GPU 中位 6ms / 90 分位 12ms；截图镂空方块（树叶）与实心方块显示正常。
- [x] 区块网格按「地表在前、地下在后」合并：`render/ChunkRenderer.ts#mergeSectionLayer` → `npm run check:fast` + 真机出帧数
  做了：不透明/镂空层按 section 从高到低合并，半透明层保持原顺序（不改混合次序）。提交 `a98ea200`。
  验证：`npm run check:fast` 全绿；同口径真机：60 fps、帧时间 5 / 17ms、GPU 6 / 13ms，与上一步持平（满屏地表视角下地下面片本就少）。
- [x] 区段遮挡剔除（section 连通性 + 方向受限 BFS，按区块收 drawRange）：mesher 产出连通掩码 + 渲染侧裁剪 → `npm run check:fast` + 真机出帧数
  做了：新增 `core/mesh/SectionVisibility.ts`（每 section 六面连通图，与面剔除同一个 `opaque` 判定）与 `render/SectionOcclusion.ts`（从相机 section 做方向受限 BFS，只在换 section / 网格增删时重算）；合并网格记录 section 索引区间，用 drawRange 截掉不可见段。提交 `c25885c8`。
  验证：`test:mesh` 新增 9 条断言（空/实心/竖井连通图、剔除深层、出世界高度全画、区间记录）全过；同口径真机：60 fps、帧时间 5 / 5ms、卡顿 0.16%、GPU 6 / 11ms；抬头/平视截图远景、水面、洞口无漏画。
- [x] 去掉空转开销：没接手柄不轮询、无声时挂起音频（先确认是否空转）→ `npm run check:fast` + 真机出帧数 + 线程占比
  做了：收到 `gamepadconnected` 才调 `getGamepads()`（模块级门控，拔掉停止）；`AudioEngine.idleTick` 全静音 3 秒挂起 AudioContext，确定要发声时自动 resume，切后台的硬挂起不受影响。提交 `569d33c5`。
  验证：`npm run check:fast` 全绿；同口径真机：61 fps、帧时间 5 / 7ms、卡顿 4.7%、CPU 合计 74%；线程表里 Gamepad polling 消失，AAudio 由约 5% 降到 2.1%。

---

## 批次 20261030-1925 · 2026-10-30 · 会话 c747f798

> 真机发热归因：不是内存也不是游戏逻辑，而是每像素的填充与提交开销；关掉 preserveDrawingBuffer + 削掉两处整屏像素成本

# 队列 · 会话 c747f798fe5f443089f73456db302086

> 状态：执行中
> 创建：2026-10-30
> 批次：20261030-1925

- [x] 关掉 `preserveDrawingBuffer`，缩略图改成抓之前在同一任务里重画一帧：`web/src/main.ts`
  - 做了什么：`WebGLRenderer` 的 `preserveDrawingBuffer` 由 `true` 改成 `false`；新增 `App.renderForThumbnail()`，`captureThumbnail` 在 `drawImage` 之前先调它画一帧
  - 为什么：这一位原本只为"存档缩略图"（一局抓几次）而开，却和 `antialias: true` 叠成**每帧**一次 MSAA resolve + 一块不可复用的背板。隔离基准（同机 Adreno 540、1644×822、MSAA 开、同样绘制量、只改这一位）：**42.9 fps → 57.8 fps**
  - 验证：`npm run check` 全绿；缩略图路径改为"先画再读"，仍是同一任务内读背板（真机世界卡片缩略图此前一直正常，逻辑未变，只是抓之前多画一帧）
  - 批次：20261030-1925

- [x] 天空穹顶着色器去掉三处整屏逐像素开销：`web/src/render/Sky.ts`
  - 做了什么：去掉对 `uSunDir` 的逐像素 `normalize`（`Sky.update` 写进去的就是 `(cos t, sin t, 0)`，本来单位长）；`pow(x, 8.0)` 展开成三次乘法；霞光整段包进 `if (uSunGlow > 0.0)`（它只在日出日落前后非零）
  - 为什么：抬头看天时 `Chrome_InProcGp` 顶到一核的 37.4%（JS 反而降到 6.1%），说明瓶颈是穹顶这个**整屏**着色器的每像素开销，不是 draw call 数量。三处改动输出逐位等价
  - 验证：`npm run render-test` 通过，并新增三条结构守卫（不许回去用 `pow`、不许再 `normalize(uSunDir)`、霞光必须有 `uSunGlow > 0.0` 判据）；两套 GLSL 用无头 Chrome 实际编译通过（`PASS Sky dome fragment` / `PASS Voxel fragment`）
  - 批次：20261030-1925

- [x] 地形着色器把 `bayer4(gl_FragCoord)` 从算两遍改成算一次复用：`web/src/render/dither.ts` + `VoxelMaterial.ts`
  - 做了什么：`GLSL_DITHER` 拆出 `ditherWithBayer(color, bayer)`；地形着色器在 `discard` 之前算一次 `bayer4`，阈值抖动与最终输出抖色共用
  - 为什么：两处本来就该用同一个屏幕空间图案（批次 524 + 520），各算一遍等于整屏多十几条 ALU，而地形是占屏面积最大的着色器
  - 验证：`npm run check` 全绿；`render-test` 换成新判据并补了"整屏只算一次 bayer4"的断言（材质里 `bayer4(gl_FragCoord.xy)` 出现次数必须为 1）
  - 批次：20261030-1925

- [x] 真机复测与结论归档
  - 做了什么：提交后把真机数据、隔离基准与"未能验证的部分"写清楚
  - 为什么：**新包没法装到这台机器上**——`assembleRelease` 需要 `MINICRAFT_KEYSTORE*` 口令（只有用户知道），而 debug 包签名不同、覆盖安装要先卸载并丢掉存档，属于不可回退动作，没有擅自做
  - 验证：基准数据来自设备 Chrome 的隔离页面（同 GPU、同分辨率、同 MSAA）；着色器那两处只做了"编译通过 + 结构守卫"，未量化
  - 批次：20261030-1925

---

## 批次 20261029-1600 · 2026-10-29 · 会话 ea9ea51

> 一仓多产物目录重排 + 安卓只认自家签名的核心数据封存

# 队列 · 会话 ea9ea51

> 状态：执行中
> 创建：2026-10-29
> 批次：20261029-1600

- [x] [A22] 多产品目录重排：`src/ index.html public/ vite.config.ts` 迁入 `web/`，`server/android` 迁到 `android/`
  - 做了什么：`git mv` 四个路径进 `web/`、`server/android` 提到根；`tools`/`tests` 的 `../src`、`../public`、`index.html` 引用批量改向；`tsconfig` 两份 include、`vite.config.ts`（`root: WEB_ROOT` + `REPO_ROOT` 锚定 `.tmp`）、`release-check` 的 `DIST`/`index.html`、`capacitor.config.json`、Gradle 的 `repoRoot` 与 `capacitor.settings.gradle` 一起改
  - 为什么：一仓多产物，Web 的入口/资源/配置自成一目录；Android 壳不该埋在 `server/` 里（它消费 `web/dist`，不是服务端）
  - 验证：`npm run check` 全绿（离线 **181** 套、单测 153 套 1579 条）、`build:fast` 产物落 `web/dist`
  - 批次：20261029-1600
- [x] [A23] 安卓签名闸门与核心数据封存
  - 做了什么：新增 `tools/seal-core.ts`（AES-256-GCM 封存 + 与长度互质的形态变换，产物 `android/app/src/main/assets/sealed/{core.sealed,salt.bin,signers.txt}`）、`CoreVault.java`（验签名 → HKDF 派生 KEK → 解 CEK → 解载荷 → 逆变换，失败一律 null）、`CoreVaultPlugin.java`（`CoreVault.read()`，失败 reject）；`hostCore.ts` 先问原生保险柜、拿不到再走静态 URL；Gradle 去掉明文 `copyHostCore`、改为 `checkSealedCore`（缺封存体或残留明文都直接报错）；`release-check` 增加"无明文 / 非 MCTB / 白名单非占位 / 有 salt"四条断言
  - 为什么：明文 41 KB 方块表放 `assets/public` 等于白送；"改签包能不能跑"必须绑在**数据能不能解开**上，而不是一个可被 patch 的布尔判断
  - 验证：`npm run test:sealed` **15/0**（含换签名 / 换盐 / 改字节 / 截断 / 空白名单 5 条负面）；`gen:sealed` 产出 41.2 KB 封存体；`build:app` 在占位白名单上**按预期红**（证明门禁有效）；`npm run check` 全绿（离线 182 套）
  - 批次：20261029-1600
- [x] [A23] iOS 侧对等 + 三端说明文档
  - 做了什么：`ios/App/CoreVault.swift`（CryptoKit 版解封 + Team ID 校验）、`ios/App/CoreVaultPlugin.swift`；`ios/ windows/ mac/` 各一份 README；`docs/CODE-PROTECTION-STATUS.md` 记已落地 / 未做 / 两处偏离
  - 为什么：iOS 与 Android 共用同一份封存格式与同一套"验签名再解封"的顺序，但 Xcode 工程需要 `@capacitor/ios`，本机没装，先把源码与契约落下来
  - 验证：`typecheck` + `typecheck:tools` 清洁；Swift 侧待 Xcode 工程补齐后实测（状态文档已标注）
  - 批次：20261029-1600

---

