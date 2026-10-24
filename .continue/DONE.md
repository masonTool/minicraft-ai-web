# 完成档案 · DONE

> 本文件是**已完成工作的唯一档案**，只回答"这批做了什么、怎么验的"——时间线，最近的在最上面。
> 按模块看现状与坑 → `OVERVIEW.md`；下次怎么避开 → `TIPS.md`；机制与格式 → `README.md`。
> **一条内容只写一个地方**，别在三份文档里各抄一遍。
>
> 收尾时**整份队列原样搬进来**（含每条任务下方的完成说明与 `[阻塞]`），标题格式
> `## 批次 <号> · 日期 · 会话 <前 8 位>`。

---

## 批次 20261024-1331 · 2026-10-24 · 会话 f834a886

- [x] [跳1] 重写难度与间距参数（间距改绝对格数、方块下限 1.2、最大距离 7.2/蓄力 1.25s）：`src/minigame/games/jump/config.ts` + `logic.ts` → `npm run test:minigame`（改掉「间距与边长同比 1.15~1.9」「间距随分数单调不增」两条旧断言，换成分数越高中心距绝对变大、永远 ≤ 可达上限）
  - 做了什么：`config.ts` 把 `gapRatioMin/Max` 换成绝对格数曲线（`gapStart 4.6~5.4` → `gapEnd 4.8~6.0`，`gapGrowScore 100`），并加 `gapFloorRatio 2.12 + gapFloorMargin 0.1`；`maxCharge 1.25`、`maxDistance 7.2`、`reachMargin 0.35`、`blockSizeMin 1.2`、`shrinkScore 80`。`logic.ts` 新增 `progressToward` / `gapFloorFor` / `gapCurveForScore`，`gapRangeForScore(score, previousSize)` 的下限取「曲线下限 vs 上一块边长算出的硬下限」，`nextBlock` 传 `current.size`。
  - 为什么：上版间距是"边长倍数"，方块缩到 0.9 时间距跟着缩水，"越往后越远"做不到；且两块之间不留倒下小人的空间，倾倒动画没地方演。下限系数 2.12 = 1 个边长 + 1.12 个边长（小人高度）。
  - 验证：`npm run test:minigame` 204 条全绿（新断言：绝对格数 4.6/5.4/4.8/6.0、中心距随分数单调不减且严格变大、下限公式、开局 2.3~2.7 倍边长）；`npm run jump:balance` 可达率 100%、手抖 23.1 跳 / 36.4 分；`npm run check:fast` 全绿。
  - 批次：20261024-1331
- [x] [跳2] 底座形状与尺寸抖动（方形 + 内切圆 r=边长/2、每块 ±6% 抖动、10 分后才有圆形）：`logic.ts` 的 `JumpBlock`/`nextBlock`/`resolveLanding` → `npm run test:minigame`（新增：圆形有效面积是方的 π/4、同 seed 同序列、判定按形状分支）
  - 做了什么：`JumpBlock` 加 `shape: 'square' | 'round'`；`nextBlock` 多吃两个随机数（r4 边长抖动 `jitteredSize`、r5 形状 `shapeFor`），特殊方块强制方形；判定抽出 `blockOverhang(block, x, z)`——方形取 `max(|dx|,|dz|) - 半边长`、圆形取 `hypot - 半边长`，`resolveLanding` 改用它。
  - 为什么：形状必须真的参与判定，否则画圆判方，"圆形更难"就是假的。特殊方块顶面靠图集 UV 分区，圆形会采到格子边，所以只给普通方块圆形（记进 decision D1）。起点块不抖动——它是整局的参照尺寸。
  - 验证：`npm run test:minigame` 221 条全绿，其中新增 17 条：40000 点网格采样得圆形/方形面积比 78.5%±1%（π/4）、方形四角站得住而圆形四角是空的、同一斜向落点方形 hit / 圆形非 hit、抖动端点 0.94×/1.06×、同 seed 尺寸与形状逐块一致、生成器 200 块边长都在 ±6% 内、特殊方块 300 块全方形；`npm run jump:balance` 可达率仍 100%。
  - 批次：20261024-1331
- [x] [跳3] 落点保留不再复位到中心：`logic.ts` 的 `JumpRun.stand` + `jump()` 记录实际落点 + `resolveLanding` 从 stand 起算 → `npm run test:minigame`（落地后 stand 偏移保留、下一跳从偏移点量距离）
  - 做了什么：`JumpRun` 增加 `stand: {x, z}`（小人脚底的实际落点），`createRun` 把它放在起点块中心；`resolveLanding` 的第一个参数从「起点方块」改成「站姿点」，返回 `{ kind, center, point }`；`jump()` 用 `run.stand` 起算并把落点写回新 run，`LandingOutcome` 多带一个 `point` 给渲染层。
  - 为什么：用户明确"落到哪个点就站哪个点"。判定中心仍是方块中心（`centerRatio` 不动），所以站偏只影响**下一跳的距离**，不改命中语义——这样"跳准"依然有意义，但偏一点不会白送一次复位。
  - 验证：`npm run test:minigame` 232 条全绿，新增 11 条：落点偏 0.45 后 stand 偏移保留且不等于中心、outcome.point 与 stand 一致；合成局面（上一跳沿 z 偏 0.6、这一跳转 90°）按 5.0 的方块中心距只到半路（离中心 0.6、非中心），按 5.6 的 stand 距才回正中。
  - 批次：20261024-1331
- [x] [跳4] 三档落点判定（中心命中 / 边缘站稳 / 重心越界 topple）：`logic.ts#resolveLanding` + `jump()` 的 outcome → `npm run test:minigame`（重心在块外 → `topple` 而不是 `miss`；完全悬空两块之间才 `miss`）
  - 做了什么：新增 `LandingKind = 'hit' | 'topple' | 'miss'`，`resolveLanding` 先算 `blockOverhang`：`> 半边长` → miss、`> 0` → topple、否则 hit；`Landing`/`LandingOutcome` 都带 `kind`，`jump()` 里 topple 与 miss 一样写 `status: 'over'`，只把 `kind` 和落点交回场景。
  - 为什么：用户口径是"重心（脚底点）在外时先倾斜再倒，不要立刻掉下去"，而完全悬空（两块之间 / 跳过头太远）没有支点，直接落才合理。分界用悬空量而不是朝向——冲过头和没跳够都往前进方向扑。
  - 验证：`npm run test:minigame` 242 条全绿，新增 10 条：悬空 1.2/1.5 个半边长 → topple（冲过头与没跳够都算）、悬空正好等于半径 → topple、超一点（2.01）× → miss、0 距离与大过头 → miss、圆形角上方形 hit / 圆形 topple、`jump()` 里 topple 结束本局且不加分、落点仍交回。
  - 批次：20261024-1331
- [x] [跳5] 可达性口径改成「从最坏落点仍够到下一块中心」：`logic.ts#maxReachableGap` + `tools/jump-balance.ts` → `npm run jump:balance`（可达率 ≥ 99%，且最远间距 ≤ maxDistance − margin）
  - 做了什么：新增 `maxGapFromEdge(previousSize) = maxReachableGap() − 半边长`，`gapRangeForScore` 的上限改成它；`jump-balance` 的可达率判据改成「间距 + 上一块半边 ≤ maxDistance − margin」，并把模拟器的瞄准距离从「方块中心距」改成「stand → 目标中心」。
  - 为什么：落点保留之后，"站中心起跳"不再是最坏情况——人可能停在上一块的后边缘，那里离下一块多出半个边长。只按中心距判可达，会生成"站偏就永远够不到"的格子。模拟器同理：玩家瞄的是自己站的地方，不是方块中心。
  - 验证：`npm run jump:balance` 可达率 100%（0~300 分逐分）、完美玩家 300 跳不掉、手抖 23.1 跳 / 36.5 分（改瞄准口径前是 11.8 跳，说明模拟器当天确实在按方块中心瞄）；`npm run test:minigame` 245 条全绿，新增 3 条：最远间距 + 半边 ≤ maxDistance − margin、`maxGapFromEdge(2)` 的公式、四个分数点上限都不越界。
  - 批次：20261024-1331
- [x] [跳6] 渲染层接新规则（站姿用 stand、新增 toppling 阶段、一屏只画 3 块、debugState 暴露站姿偏移）：`src/minigame/games/jump/scene.ts` + `BlockScene.ts#nextFrame` → `npm run typecheck` + `npm run test:minigame`（debugState 字段断言同步）
  - 做了什么：`scene.ts` 的站姿/起跳点全部改读 `run.stand`（`placeJumper(run.stand.x, …)`、`release()` 用 stand 算方向与落点、完美命中的波纹画在 `outcome.point`）；新增 `toppling` 阶段（等 `JUMP_TIMING.toppleMs = 380ms` 后接 `falling`，角度留给跳9），倾覆期间不跟镜头；`rebuildBlocks` 从 4 块收成 3 块（上一块 + 当前 + 下一块），`BlockScene.nextFrame` 同步收窄；`debugState` 新增 `standOffset`，`gap` 改成从站姿量、`axis` 仍按方块中心判。
  - 为什么：规则层已经不在中心起跳了，渲染层若还按方块中心画，人和逻辑会越走越偏；`gap` 也必须给 E2E 真实值（它按 gap 反算按压时长）。`axis` 保留方块中心口径是因为"等距两向"是生成器约束，站偏只是让这一跳略斜。
  - 验证：`npm run typecheck` 通过；`npm run test:minigame` 250 条全绿（新增 5 条静态断言：站姿读 run.stand、起跳点读 stand、toppling 阶段存在、一屏 3 块、倾覆不跟镜头；debugState 字段表加 standOffset）；`npm run test:jumpiso` 42 条全绿。
  - 批次：20261024-1331
- [x] [跳7] 清晰度：小游戏独立 renderer 像素比上限 2 → 3，白点圆 24→48 段、阴影贴图 128→256、背景渐变 2×256→2×512 加抖动：`src/main.ts`（`runStandaloneMiniGame`）+ `BlockScene.ts` → `npm run test:jumpiso` + 常量断言（分段数/尺寸写进可导出常量）
  - 做了什么：`main.ts` 新增 `MINIGAME_PIXEL_RATIO_CAP = 3` 并用于小游戏 renderer；`BlockScene.ts` 导出 `DOT_SEGMENTS = 48`、`SHADOW_TEXTURE_SIZE = 256`、`BACKGROUND_TEXTURE_HEIGHT = 512`、`BACKGROUND_NOISE = 1/255`，背景渐变改成 512 行并逐像素叠 ±1 级确定性噪点（`backgroundNoise(idx)` 用 sin 哈希，非 `Math.random`），阴影贴图按常量取尺寸。
  - 为什么：一屏只有 3~4 块纯色方块，填充率几乎全花在边缘抗锯齿上，像素比 3 能明显减少方块边缘毛刺；256 行的渐变在 3x 屏上会被拉出横向色带，512 + dithering 才彻底打散。噪点必须确定性，否则截图对比与"同 seed 同画面"失效。
  - 验证：`npm run test:minigame` 256 条全绿（新增 6 条：像素比上限 3 且被 renderer 使用、白点 48 段、阴影 256、背景 512、噪点常量 + 无随机数）；`npm run test:jumpiso` 42 条、`npm run test:jumptex` 25 条全绿；`npm run typecheck` 通过。
  - 批次：20261024-1331
- [x] [跳8] 方块几何精致化：普通块换圆角倒角盒、圆形底座用 56 段圆柱、阴影按方/圆分两张贴图、特殊方块保持直角盒（图集 UV 原因）：`BlockScene.ts` → `npm run test:jumptex` + `npm run typecheck`
  - 做了什么：`BlockScene` 引入 `RoundedBoxGeometry`（2 段 / 半径 0.055，导出 `BLOCK_CORNER_RADIUS` / `BLOCK_CORNER_SEGMENTS`）作为方形底座；新增 `roundGeometry = CylinderGeometry(0.5,0.5,1,56)`（`ROUND_BLOCK_SEGMENTS`）做圆形底座；`createEntry` 按 `spec.shape` 选几何与阴影材质；`createShadowTexture('square'|'round')` 生成两张贴图、两个材质，`dispose()` 一并释放；音乐盒圆柱段数 40→56；`scene.ts` 把 `block.shape` 传进 `BlockSpec`。
  - 为什么：直角盒在 3x 屏上边缘"一刀切"、圆底座配方阴影会在四角多出灰块。特殊方块不吃圆角——它们顶面靠图集 UV 分区，倒角会把 UV 采样推到格子边缘（这条在交接里已定，测试里钉住）。
  - 验证：`npm run typecheck` 通过；`npm run build:fast` 出包成功（`three/addons/*` 的解析真跑过一遍）；`npm run test:minigame` 263 条全绿（新增 7 条：圆角盒参数、56 段圆柱、特殊方块仍是直角盒、几何按 shape 分支、两张阴影贴图、音乐盒 56 段、卸载释放新资源）；`npm run test:jumptex` 25 条全绿。
  - 批次：20261024-1331
- [x] [跳9] 倾倒动画：`motion.ts` 新增 topple 角度曲线（缓入、约 380ms、90°+）、`JumperModel.ts` 新增 `setTilt()`、`scene.ts` 在 toppling 阶段播放 → `npm run test:jumpmotion`（0→1 单调、端点角度、时长常量）
  - 做了什么：`motion.ts` 加 `TOPPLE_ANGLE = 95°` 与 `toppleAngle(ms)`（`cubicIn`，`JUMP_TIMING.toppleMs` 内 0→95°），`JUMP_TIMING` 增加 `toppleMs = 380`；`JumperModel` 加 `tilt` 字段与 `setTilt(radians)`（正数=朝行进方向，`rotation.x = flip − tilt`），`resetPose` 一并清零；`scene.ts` 的 toppling 分支每帧 `jumper.setTilt(toppleAngle(ms))`，播完清零再进 falling。
  - 为什么：用户要"重心在外时先倾斜再倒"。用缓入（先慢后快）而不是缓出，是因为重心越过支撑面后是被重力拽下去的；正好 90° 会让人物"贴"在方块侧面，多倒 5° 才读得成"已经离开支撑面"。
  - 验证：`npm run test:jumpmotion` 58 条全绿（新增 10 条：端点 95°、90°~100° 区间、单调不减、前半程 <20%（缓入）、最后 1/4 转过 >50%、越界夹住、负数/NaN 归零、380ms 常量）；`npm run test:jumpmodel` 全绿（新增 6 条：90° 倾倒 → rotation.x = −90°、不改朝向、负角夹 0、NaN 安全、resetPose 清倾角）；`npm run test:minigame` 264 条全绿（新增"倾覆阶段播放角度曲线"）；`npm run typecheck` 通过。
  - 批次：20261024-1331
- [x] [跳10] 跳中心的 combo 表现（计分规则不动）：`scene.ts` 飘字改 `×N +P`、`BlockScene.playRipple` 层数随连击增加且外圈偏金、`audio.ts` 完美命中音高随连击升调 → `npm run test:jumpaudio` + `npm run typecheck`
  - 做了什么：`motion.ts` 加 `rippleRingCount(combo) = 3 + min(3, combo−1)` 与 `rippleRingRadius(i, n)`；`BlockScene.playRipple` 接受 combo，波纹 rig 一次建满 6 层、每跳只改可见性/颜色（颜色由 `rippleColorAt` 给，>3 层时最外圈 `RIPPLE_GOLD`）；`audio.ts` 加 `perfectPitchFactor` / `perfectSweep`（每连 +2 半音、封顶两个八度），`playLand(center, combo)` 接上；`scene.ts` 落地时用 `outcome.run.combo` 调音效与波纹，连中两次起飘 `×N  +P`，HUD 分数下方加 `.jump-combo`（`combo >= 2` 才显示，断连击当帧消失），`index.html` 补样式。
  - 为什么：用户要"跳中心有 combo 表现"，但计分规则明确不动。所以三处加强（飘字文案 / 波纹层数与金环 / 音高）全是表现层；`×N` 与金环都从第 2 连起，第 1 连保持原样，否则"连击"这个信号在第 1 次就失效（记进 decision D3）。
  - 验证：`npm run test:jumpaudio` 45 条全绿（新增 12 条：第 1 连原调、每连 +2 半音、严格递增、封顶 ×4、两端同倍率、时长/波形/音量不受影响、常量值）；`npm run test:jumpmotion` 71 条全绿（新增 13 条：层数 3/4/5/6 与封顶、0/NaN 兜底、半径由外向内递减、最外圈恒为 1、3 层时中间圈 0.725）；`npm run test:minigame` 270 条全绿（新增 6 条静态断言）；`npm run typecheck` + `npm run build:fast` 通过。
  - 批次：20261024-1331
- [x] [跳11] 断言与 E2E 口径同步（不跑 E2E，只改脚本）：`tools/jump-e2e.mjs` 的 gapRatio 区间、一屏块数、形状字段 + `tools/jump-iso-test.ts` 的取景断言 → `npm run test:jumpiso`（`npm run check` 全绿为此条完成凭证）
  - 做了什么：`scene.debugState` 补 `onscreen` / `shape` / `nextShape`（E2E 要有得读）；`jump-e2e.mjs` 的按压时长改成按 `MAX_DISTANCE 7.2 / MAX_CHARGE_MS 1250` 反算，gapRatio 区间改成 2.2~5.1 并新增"开局 ≥4.6 格""开局 2 块 / 跳过后 3 块""形状在两类之内""10 分前不出圆形""站姿偏移有限"五条；`jump-iso-test.ts` 新增"新间距下的一屏 3 块"整节（真跑生成器取 3 块，验全部在视口内、当前块占屏宽 10%~45%、纵向撑满 ≥60%、下一块在屏幕更上方）。
  - 为什么：E2E 脚本不在 CI 里跑（要浏览器），它引用的字段/参数一旦改名没人会发现；所以既要改脚本，也要在离线测试里用"读脚本源码 + 比对 config 数值"的方式钉住（`MAX_DISTANCE`、`MAX_CHARGE_MS` 直接与 `JUMP_CONFIG` 比）。
  - 验证：`npm run check` **全绿**（typecheck + 177/177 离线套件 + 三张台账 + 文档门禁 + 浏览器/截图/控制台门禁自检）；`npm run test:jumpiso` 46 条、`npm run test:minigame` 275 条全绿；顺手把 HANDOFF 的"提交总数"从 1702 修到 1716（全量门禁抓出来的）。**没有跑 E2E / 浏览器**（按用户要求）。
  - 批次：20261024-1331
- [x] [自审] 审这一批的三层（L1 可测量 / L2 可对抗 / L3 可外部）→ 写 `- L1：` / `- L2：` / `- L3：` 各一句 + 证据
  - L1：这一批 11 条每条都有一条"坏了就变红"的检查，且都不是纯静态字符串——数值断言占绝大多数（间距绝对格数 4.6/5.4/4.8/6.0、悬空分界 half、stand 偏移 0.45、圆形面积比 78.5%、波纹 3→6 层、音高 ×4 封顶、倾倒前半程 <20%）。证据：`npm run check` 全绿，离线 177/177 套；本批相关断言从 204 条涨到 276（minigame）+ 71（motion）+ 45（audio）+ 46（iso）。
  - L2：刚当场做了两次故意破坏来验"会不会红"：① 把 topple 分界 `overhang > half` 改成 `half * 0.5` → 2 条红（"悬空正好等于半径 → topple"、"倾覆不分朝向"）；② 把 `stand: landing.point` 改回方块中心 → 4 条红（落点偏移 0.45、stand 不等于中心、outcome.point、按中心距只到半路）。两次都还原后全绿。**顺手补了一条**：此前只有 `gapFloorRatio = 2.12` 的公式自证（同一份算术写两遍），现在直接量"两块之间的净空档 ≥ 小人高度"，这才真的验到"倒下有地方"。
  - L3：判断依据里 6 条来自用户原话（画质粗糙 / 间距太小要激进 / 落点别复位 / 重心在外才倒 / 底座太单一 / 跳中心要 combo），直接决定了这 11 条的分工；另外 4 处是我自己定的实现选择（95° 倾倒角、金环与 `×N` 从第 2 连起、背景噪点幅度、净空档的度量方式），全部写进 `f834a8-decision.md` 的 D1~D3，属可回退项，不是从用户那里"问来"的。
  - 批次：20261024-1331

## 批次 20261024-1152 · 2026-10-24 · 会话 3da8ce2b

- [x] [优化1] 出生点不再"永远是平原草地"（用户选 B）：`core/world/SpawnPoint.ts` 放宽群系偏好 + 出生搜索半径（原点 1024 格内随机挑合格点）→ `npm run test:spawn`（新增断言：同一批种子下出生群系不恒定、仍在自然地面、不与水/岩浆重叠）
  - 做了什么：`planSpawnRegion` 从"全网格打分取最优（起伏×1000 + 群系偏好×80 + 距离）"改成两段式：① 半径内**面积均匀随机试投** 48 次，第一块"高于地表下限 + 起伏 ≤4 + 不在水面/虚空群系"的就用；试投点落水时先在 8/16 格环上找最近的岸（`flatSpotNear`），避免落点被推到远处高地；② 试投全落空才退回网格扫描（≤256 格，口径同旧版）。主世界半径 256 → **1024**，随机源用 `new Random(seed).nextDouble()`。
  - 为什么：地形本来就是按种子生成的，但旧评分把任何种子都压到"离原点最近、最平、最像平原"的那块地 → 玩家看到的永远是"草地 + 树 + 侧边海 + 远处山"。随机源必须由种子派生，否则同一种子重进世界会换出生点（与原版口径不符）。
  - 另一处必须改：试投如果只认中心点，能通过的只剩高地（该生成器里高地偏冷），实测 5 个种子全落在雪原/冰刺；先找最近的岸之后变成 stony_peaks / badlands / snowy_plains / ice_spikes / old_growth_pine_taiga。
  - 验证：`npx tsx tools/world-test.ts` 87 通过 / 0 失败（新增 4 条：跨种子群系至少 2 种、≥2/3 相距 128 格以上、同种子两次完全一致、落点都高于海平面；种子 1/7/42/1337/20261024 的落点已打印进输出）；`worldmatrix-test` 29 通过、`terrain-normal-test` 43 通过（出生点仍选得出来、出生区块非空）；`npm run build:fast` 通过。
  - 批次：20261024-1152
- [x] [优化2] 引导未完成时切游戏模式即作废：`main.ts#setGameMode` 里判断"玩家真的换了模式"就 `tutorialDismissed = true` 并落盘；读档恢复模式不触发 → `npm run test:tutorial`（新增断言：setGameMode 后卡片不再出现、dismissed 写进存档；restore 路径不影响）
  - 做了什么：判定抽成纯函数 `tutorial/boot.ts#shouldVoidTutorialOnModeChange`（三个不该触发的场景各一条：读档恢复 / 已作废 / 已走完）；`setGameMode` 在 `next !== this.gameMode` 之后调它，命中就 `tutorialDismissed = true` + `tutorialCard.hide()` + `saveTutorialNow()`，并记一条 `diag.event('ui','tutorial.voidOnModeChange')`。
  - 为什么：引导每一步都长在"创建世界时那个模式"里（生存 4 步 / 创造 4 步的内容完全不同），切过之后接着教必然教错；重开又会把玩家刚做完的事抹掉，所以只作废。读档恢复模式也走同一个 `setGameMode`，必须靠 `waitingForSaveRestore` 排除，否则老存档一进世界引导就被清掉。
  - 验证：`npx tsx tools/tutorial-test.ts` **121 通过 / 0 失败**（新增 8 条：4 条判定 + 4 条接线，接线用正则截出 `setGameMode` 函数体，避免"函数写了没人调用"的假绿）。
  - 批次：20261024-1152
- [x] [优化3] 背包装备槽用部位图标替代文字：`ui/InventoryScreen.ts#buildArmorGrid` + `index.html` 的 `.inv-slot-hint` → 空槽显示头盔/胸甲/护腿/靴子/副手（盾）线框图标，文字只留 title/aria；`npm run test:inventory`
  - 做了什么：`SlotVisuals.ts` 新增 `ArmorSlotKind` + 五条 24×24 填充剪影路径 + `armorSlotHintSvg()`（与 `TouchIcons` 同一套"只画填充、不用描边"的经验）；`buildArmorGrid` 把 `hint.textContent` 换成 `innerHTML = armorSlotHintSvg(...)`，文案改挂到槽位 `aria-label` / `title`（副手仍用更详细的 `inventory.offhandHint`）；CSS 里 `.inv-slot-hint svg { 26×26, opacity .55 }`，颜色收到 `#6d6d6d`。
  - 为什么：原版（Java + 基岩手机）装备槽画的就是部位剪影，文字"头/胸/腿/靴"既不像原版、又会在换语言/窄屏时挤成一团（副手那格当年就是被压到 11px 的）。图标是矢量的，`--touch-scale` 与窄屏都不用再单独调字号。
  - 验证：`npx tsx tools/ui-test.ts` **936 通过 / 0 失败**（新增 2 条：`armorSlotHintSvg(kinds[i])` 且不再有 `hint.textContent = hints[i]` + CSS 有 `.inv-slot-hint svg`；五个图标都是 24×24 视口、含 path、`fill="currentColor"`）；`npm run typecheck` 通过。
  - 批次：20261024-1152
- [x] [优化4] 背包右上角"配方书"点开就是打开配方书（定位"全部/搜索"），再点才是关闭：`ui/InventoryScreen.ts` 配方开关回调 + `main.ts#openRecipeBook/toggleRecipeBook` → `npm run test:inventory`（断言：点击后 `isRecipesOpen() === true`、当前 tab 为 all；第二次点击后为 false）
  - 做了什么：① 左栏新增第四种内容 `recipes` + 落脚点 `recipeHostEl`（`.inv-recipe-host`，与"我的物品 / 物品分类"同一个网格格）；配方书开着时 `applyInventoryChrome` 调 `onRecipeHost(recipeHostEl)` 把 `.recipe-panel` 搬进来（CSS 给它 `.embedded`），关着时 `detachRecipeBook()` 还回整屏层。② 标题栏那颗键改成**开关**：开着 → `onCloseRecipes()`（只关闭）；关着 → `onOpenRecipes(lastRecipeTab)`（首次是"全部/放大镜"）。③ `main.toggleRecipeBook`（R 键）删掉"切分类栏"那条，和这颗键走同一条路。④ 工作站 / 纯容器没有左栏那一格，`canEmbedRecipeBook()` 为 false，仍按旧行为（切分类 / 切"列出全部"）。
  - 为什么：原来点它只是把左栏从仓库切成物品分类，配方书根本没打开（玩家："我点配方书，它却把配方书关掉了"）。关着的配方书是**整屏一层**（z-index 20 盖住背包 10），所以就算调 `onOpenRecipes` 也会把标题栏那颗键一起盖掉，"再点关闭"无法实现 —— 必须先把它嵌回左栏（CSS 里 `.recipe-panel.embedded` 与 `.inv-recipe-host` 的注释本来就是按这个设计的，只是 TS 侧在批次 159 被移除了）。
  - 顺带修：配方书开着时点左轨分类图标 / 左下"物品栏"页签，都会先关书（否则 `leftPane` 判据里 `recipes` 优先，点了看不出变化）。
  - 验证：`npx tsx tools/ui-test.ts` **939 通过 / 0 失败**（新增 3 条：开关两向、落脚点 + CSS 同格、工作站/容器不嵌；另把 3 条旧断言改成新口径）；`recipebook-test` 162 通过；`npm run typecheck` 通过。
  - 批次：20261024-1152
- [x] [优化5] 左栏自绘滚动条：生存与创造位置/宽度统一（都像创造那样离物品留 2px 间隔），修掉创造模式滑条下方跟着走的黑色残块：`index.html` 的 `.inv-category-scrollbar` 系列 + `ui/InventoryScreen.ts` 的滚动条同步 → `npm run test:inventory`（断言两模式滚动条 right/width 取值来自同一组常量）
  - 做了什么：删掉 `.inv-creative-section .inv-category-scrollbar { right: 2px; width: 6px; }` 这条"只改创造栏"的覆盖，宽度统一成 CSS 里唯一的 `.inv-category-scrollbar { width: 7px }`；间隔抽成 `SCROLLBAR_CONTENT_GAP = 8` + `SCROLLBAR_TRACK_WIDTH = 7`（`scrollbarContentLeft` 两个调用方共用）。
  - 为什么两栏位置不同：宽度一个 4px 一个 6px，而 `scrollbarContentLeft` 的右边界钳制是 `host.clientWidth - width - 1`，同一个内容右缘会被钳成不同位置；另外两条右定位规则各写一份 `right`。
  - 黑块根因：滑块原来有 `border: 1px solid #4a4a4a`。在 4~7px 宽的滑条上，1px 深边把实心部分吃到只剩 2~5px，滚动时看上去就是"灰块下面跟着一个小黑块"。现在改成无描边的浅灰实心（`#c2c2c2`，按下/悬停 `#dedede`），圆角继承轨道，`min-height` 18 → 24 更好拖。
  - 验证：`npx tsx tools/ui-test.ts` **941 通过 / 0 失败**（新增 2 条：CSS 里 `.inv-category-scrollbar {` 只有一处且 width 7px、没有只针对创造栏的覆盖、间隔常量被两处引用；滑块规则 `border: 0` 且不再有 1px 深边）。
  - 批次：20261024-1152
- [x] [优化6] 第一人称手持物：拿着东西时隐藏手臂、只显示放大的物品（2 倍 + 厚度增加），空手仍画手臂：`render/HandRenderer.ts` → `npm run test:hand`（断言：持有物品时 arm/cuff/sleeve 不可见、物品尺寸为 2× 且厚度 > 0；空手时手臂可见）
  - 做了什么：`ITEM_SIZE` 0.22 → **0.44**；非方块物品从 `PlaneGeometry`（零厚度）改成 `BoxGeometry(0.44, 0.44, 0.08)` 并六面贴同一张图标 + 逐面明暗；新增 `refreshHandVisibility()`：手臂 / 布袖 / 盔甲袖套**一起**按"手里有没有东西"显隐（`setItem`、`setArmorColor` 都走它），并把胸甲颜色记成字段 `armorColor`；挂点从 `-ARM_LENGTH - ITEM_SIZE*0.36` 收到 `*0.12`（放大后不能再往远处推，否则透视会把视觉尺寸抵消掉）。
  - 为什么：原版第一人称拿着东西时不画那条手臂，方块本身占屏幕很大一块；原来 0.22 的方块 + 常驻手臂，观感是"一只手捏着一粒米"。非方块物品用零厚度平面侧看是一条线，用户要求"厚度也要增加"。
  - 验证：`npx tsx tools/render-test.ts` **250 通过 / 0 失败**（改 1 条旧断言 + 新增 6 条：边长 0.44、薄板厚度 0.05~0.12、六面 UV、拿东西时手臂/布袖隐藏、拿东西时袖套不露、空手时三块回来并再收一次）；`npm run typecheck`、`ui-test` 941 通过。
  - 批次：20261024-1152
- [x] [优化7] 动态摇杆默认显示底圈，跟手触发逻辑不变：`index.html` `#touch-stick.dynamic` 的 opacity 规则（+ 必要时 `TouchControls.ts`）→ `npm run test:touch`（断言 CSS 里 dynamic 不再是全隐、active 才抬高）
  - 做了什么：`#touch-stick.dynamic { opacity: .55 }`（原来 0）、`.active` 回到 1；删掉 `.dynamic.sneaking:not(.active)` 那条"底座透明只留潜行小牌"的规则（底圈常驻之后它会把圈藏掉）；`TouchControls` 新增 `clearDynamicOffset()`，在 `resetStick`（跟手模式松手）与 `setStickMode`（切回固定模式）里清掉 `beginDynamicStick` 写的内联 left/top/right/bottom，让 CSS 的左下默认位置重新生效。
  - 为什么：`beginDynamicStick` 只写内联坐标、从不还原 —— 以前底圈是不可见的，停在哪儿都无所谓；一旦常驻显示，不归位就会"停在最后按过的位置"，看着像摇杆卡住。触发逻辑（左下拇指区内按下才跟手）一个字没改。
  - 验证：`npx tsx tools/ui-test.ts` **943 通过 / 0 失败**（改 2 条旧断言为 `opacity: .55` 口径，新增 2 条：松手/切模式都会清内联坐标、潜行时不再藏底座）。
  - 批次：20261024-1152
- [x] [优化8] 首页四颗按钮高度统一：`index.html` `.world-primary` / `.world-secondary` 的 min-height 与内边距 → `npm run test:theme`（静态断言：两类按钮在同一断点下 min-height 相同）
  - 做了什么：在共用规则 `.world-primary, .world-secondary` 上写 `min-height: 52px; box-sizing: border-box;`；触摸横屏那块 `.world-primary/.world-secondary` 的 44px 改成 52px；后面那条 `body.touch-mode .world-secondary { min-height: 44px; padding: 8px 14px; }` 拆开（44 只留给卡片操作键与世界列表的小键），次按钮单独给 52px。
  - 为什么：主按钮与次按钮各写一套 min-height（52 / 44），并且**后出现的规则覆盖先出现的**——横屏块里 44/44 看着像是统一的，但文件后面那组又把次按钮拉回 44、主按钮拉到 52，于是首页一眼就能看出参差。现在只留一处高度真值，字号仍可不同（主按钮更醒目）。
  - 验证：`npx tsx tools/ui-test.ts` **944 通过 / 0 失败**（改 1 条横屏断言为 52px，新增 1 条：共用规则里必须有 min-height 52、且触摸端不再出现 44px 的主/次按钮覆盖）。
  - 批次：20261024-1152
- [x] [优化9] 首页去掉"非官方 Web 复刻…"那段说明与 `WebGL2!` splash（构建版本信息按用户要求**保留**）：`ui/WorldScreen.ts` + `core/i18n/locales/*/menu.ts` 的 `menu.footer` → `npm run test:theme`（断言首页 DOM 不再有 footer 说明与 splash 节点）
  - 做了什么：`WorldScreen` 删掉 `splash`（"WebGL2!"）节点与 `footerNote`（`t('menu.footer')`），页脚只留 `#world-build`；`index.html` 删掉 `.world-splash` 规则、`@keyframes world-splash`、触摸横屏那条 `.world-splash` 覆盖与 PC 的 `animation: none`；六个语种的 `menu.footer` 键一起删（表 2864 键，六语言 100%）。
  - 为什么：删 DOM 不删 CSS 会留下永远不命中的规则（PC 那条 `.world-splash { animation: none; }` 会让人以为 splash 还在）；`menu.footer` 只被这一处引用，留着就是死键，i18n 表按语言对齐删才不会掉到 99%。
  - 验证：`npx tsx tools/ui-test.ts` **945 通过 / 0 失败**（改 1 条：splash 相关断言改成"整份 CSS 里不再有 `.world-splash`"，新增 1 条：WorldScreen 不再建 splash/footer 节点但保留 `#world-build`）；`i18n-test` 547 通过、`npm run audit:i18n` 六语言 2864/2864 通过；`npm run typecheck` 通过。
  - 批次：20261024-1152
- [x] [优化10] 暂停页去掉成就按钮、"游戏已暂停"标题、副标题、存档/改动/自动保存那行说明（设置页与主菜单设置面板不受影响）：`ui/SettingsScreen.ts` + `main.ts#openSettings` → `npm run test:pause`（断言暂停页 DOM 无这四块、设置页仍有标题与返回）
  - 做了什么：`menuPage` 只 append `actionsRow + help`；删掉 `menuTitle`/`menuHeader`（"游戏已暂停"）、`menuHintEl`（"点「继续游戏」或系统返回键返回"）、`metaEl` 与 `setMeta()`、"成就"按钮（`pause-achievements`）；`setTitle()` 去掉副标题参数；`renderSubtitle()` 只保留设置页那句"改动立即生效"；`main.openSettings` 不再算存档信息，主菜单那处 `setTitle('设置','返回')`。设置页自己的标题/返回键一点没动。
  - 为什么：这四块都是"说明性文字"，用户认为暂停页只需要按钮；成就入口仍在背包左栏（手机上唯一那条路），删掉暂停页那颗不会让成就不可达。存档信息通过暂停页看到之前也没人用，需要时能从世界列表/导出看到。
  - 验证：`npx tsx tools/ui-test.ts` **945 通过 / 0 失败**（改 2 条骨架断言——`makeHeader` 调用从 2 处变 1 处；新增 1 条：暂停页不再出现 `menuTitle`/`settings-meta`/`touchBack`/`pause-achievements` 且只 append `actionsRow, help`）；`i18n-test` 547、`audit:i18n` 2864/2864；`typecheck` 通过；`tools/settings-acceptance.js`（浏览器验收）里那条"存档信息"断言同步改成"四块都不出现"。
  - 批次：20261024-1152
- [x] [优化11] 顶部中间第三颗键（视角）图标换成"眼睛"（保持现有 currentColor 实心风格）：`ui/TouchIcons.ts` 的 `view` 路径 → `npm run test:touch`（断言 svg 含眼球+瞳孔路径、不再是望远镜的镜筒矩形组）
  - 做了什么：`PATHS.view` 从"斜放望远镜（四段矩形 + 底座）"换成一只眼睛：杏仁形眼眶 + `fill-rule="evenodd"` 挖出虹膜 + 实心瞳孔 `<circle r="2.1">`。仍是纯填充、`currentColor`，与其他五个图标同一套画法。
  - 为什么：用户点名"最右边那颗换视角的图标，要一个小眼睛的形状，保持当前这种风格"。望远镜在 22px 下有四段小矩形，缩小后糊成一团；眼睛只有两个形状，小尺寸更清楚。
  - 验证：`npx tsx tools/ui-test.ts` **946 通过 / 0 失败**（新增 1 条：view 的 svg 里有 evenodd 眼眶 + r=2.1 瞳孔，且不再有 `rotate(-33`）。
  - 批次：20261024-1152
- [x] [优化12] PC 端界面元素与手机版保持一致（同一套装备槽图标 / 滚动条位置与样式 / 顶部图标 / 暂停页结构，差异只保留键盘提示文案）：`index.html` 的 `body:not(.touch-mode)` 规则 + 相关 TS → `npm run test:theme` + `npm run test:inventory`
  - 做了什么：删掉 PC 那三组滚动条规则（`display: none !important` 藏掉自绘那根、另开 10px 原生滚动条 + 深色轨道/滑块），PC 与手机现在共用同一根自绘常驻滚动条；装备槽图标、配方书嵌入、暂停页结构本轮本来就是同一套 DOM/CSS（无 `body.touch-mode` 分支）。PC 的格子尺寸档（46/52/54px）与 `.inv-pager` 翻页条**保留**。
  - 为什么：用户是在"滚动条黑块 / 装备槽图标"的上下文里说"PC 上界面内的元素要跟手机版保持一致"——指的是元素长什么样、在哪，不是把桌面的大格子压回手机档。翻页条是批次 620 按"PC 端不能翻页"专门补的入口，删掉等于推翻那条需求。取舍与边界写进 `doing/3da8ce-decision.md` 的 D3。
  - 验证：`npx tsx tools/ui-test.ts` **946 通过 / 0 失败**（把"PC 用看得见的原生滚动条"那条反向改成"PC 与手机共用同一根自绘滚动条"：断言 HTML 里不再出现两条 PC 原生滚动条规则与 `scrollbar-color`）；`npm run check` 全绿（见下一条提交）。
  - 批次：20261024-1152
- [x] [自审] 审这一批的三层（L1 可测量 / L2 可对抗 / L3 可外部）→ 写 `- L1：` / `- L2：` / `- L3：` 各一句 + 证据
  - L1：12 条全部落成了"坏了就变红"的断言，没有一条停在"看着像"：出生点 4 条（`world-test` 打印 5 个种子的实际落点）、引导作废 8 条（4 判定 + 4 接线）、装备槽图标 2 条、滚动条 1 条（正反两面）、手持物放大 6 条（含 `ITEM_SIZE`/厚度）、摇杆常驻 2 条 + 改 2 条、按钮高度 1 条、首页删减 1 条 + 改 1 条、暂停页四块 1 条 + 改 2 条、眼睛图标 1 条。套件数：`ui-test` 936 → **950**、`world-test` 83 → **87**、`tutorial-test` 113 → **121**、`render-test` +6。**薄弱点**：配方书那条交互全在 DOM 回调里，离线跑不到，只能用源码接线断言兜（自审当场补了 4 条）。
  - L2：这批做了**三次故意破坏**并确认变红——① `#touch-stick.dynamic` 改回 `opacity: 0` → `ui-test` 恰好 1 条红；② `HandRenderer.ITEM_SIZE` 0.44 → 0.22 → `render-test` 的"手持方块边长是原来的 2 倍"红；③ 把 `onRecipeHost(this.recipeHostEl)` 改成 `null` → "配方书嵌进左栏" + "左栏切成 recipes 时把落脚点交给配方书" 两条同时红。三次都已还原（`git status` 干净）。
  - L3：判断依据 **12/12 来自用户逐条口述**（11 条问题 + PC 一致性），没有一条是我自创的玩法或限制；我自己定的只有实现参数——试投 48 次 / 8·16 格找岸环 / 主世界半径 1024 / 按钮 52px / 图标路径形状 / 手持物厚度 +0.08 —— 全部写进 `3da8ce-decision.md`（D1/D3）与代码注释，随时可推翻。
  - 改进（当场修了 1 条）：配方书开关的三处接线补成 4 条断言（提交 `[自审]`）。其余找过但**不算问题**的角度：① "暂停页删掉四块后竖屏会不会显得空"——CSS 是居中列布局，空出来的高度由 `actionsRow` 撑，不是固定高度；② "`pause.title` / `settings.touchBack` 变成死键"——`i18n-test` 的必备键清单里仍有它们，且这两句将来在加载页/别处还能用，删了反而要改 6 个语种，收益小于成本；③ "出生点随机让老玩家找不到家"——同一存档的出生点存在存档里，只有新世界才走这条，不影响回档。
  - 批次：20261024-1152

