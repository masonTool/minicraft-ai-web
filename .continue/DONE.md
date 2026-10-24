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

## 批次 20261024-1010 · 2026-10-24 · 会话 e50bd5cb

- [x] [跳11] 分数 HUD 被宿主顶栏盖住：`index.html` 的 `.jump-hud` 定位改回"让开顶栏 + 安全区"，`scene.ts` 无改动 → `npm run test:minigame`（新增静态断言：`.jump-hud` 的 top 必须含 `56px`/`safe-area`，不许用百分比贴顶）＋ 重跑 e2e 截图肉眼确认分数可见
  - 做了什么：`.jump-hud` 的 `top` 从 `6%` 改回 `calc(56px + env(safe-area-inset-top, 0px))`，`left` 用 `6% + 安全区`；`tools/minigame-test.ts` 读 `index.html`，钉住"top 必须 56px + 安全区""left 必须带安全区"两条。
  - 为什么：`6%` 在横屏 390 高下只有 23px，正好落在宿主顶栏（top 8px + 36px 高的"退出"按钮，z-index 4）覆盖区，分数**整块看不见**。这是上一批 `[跳8]` 我自己改出来的回归。
  - 验证：截图里 `3` / `21` 出现在顶栏下方 ✓；`npm run test:minigame` 192 条全绿。
  - 批次：20261024-1010

- [x] [跳12] 每个方块顶面中心加白色小圆点（参考图 02/03 每块都有，直径 ≈ 0.11~0.14 边长）：`BlockScene.ts` 加共享几何 + 材质、随入场/淡出缩放的 `dot` mesh → `npm run test:minigame`（断言：每块都有 dot、尺寸随 size、释放时 dispose）＋ 像素取样确认顶面中心是白点
  - 做了什么：共享 `CircleGeometry(1,24)` + 白色 `MeshBasicMaterial`，每块一个 `dot`；半径 = `0.065 × 边长`（直径 0.13）；只有普通方块叠点（特殊方块顶面自带井盖盘/唱片纹/魔方格/门脸）；位置/缩放跟着 `refreshEntry` 走，方块压扁时白点一起沉。
  - 踩坑：**第一版白点根本看不见**。不透明物体会按"由近到远"排序，白点不写深度又排在方块之前 → 被顶面整片盖掉。改成 `transparent: true` + `renderOrder = 3` 才出来。
  - 验证：放大截图里黄块顶面正中白点清晰 ✓；`npm run test:minigame` 新增 3 条断言，197 条全绿。
  - 批次：20261024-1010

- [x] [跳13] 色板换成参考图取样的高饱和糖果色（顶面 `#FCF366` / `#F77E3F` / `#BEEF46` 这一档，背景 `#D1D4DD` 系），`palette.ts` 六组全换 → `npm run test:minigame`（断言：每组背景亮度在 200~240、方块色饱和度 ≥ 0.45、与背景对比度 ≥ 阈值）＋ 对截图做像素取样核对
  - 做了什么：把近白 `#F7F6FB` 从轮换里拿掉（它属于"绿色首页"上的白块，摆到浅灰紫关卡背景上几乎与背景同亮），补进珊瑚红 `#EE7467`、天蓝 `#6A9BF9`；六组重排，**每组至少 3 个高饱和色、最多 1 个灰**；淡黄背景那组去掉黄块、浅蓝背景那组去掉柠檬绿（|ΔL| 只有 0.03~0.04，糊进背景）。
  - 新增断言：HSL 饱和度 ≥ 0.3 的方块 ≥ 3 个（"洗白"防线）、无彩/灰方块 ≤ 1 个；既有的"没有方块糊进背景（|ΔL| ≥ 0.04）"当场抓出淡黄那组的 0.032 与浅蓝那组的 0.037。
  - 验证：截图 coral/lime/深灰 明显比之前饱和 ✓；像素取样 ref02 顶面 rgb(252,243,102)/(247,126,63)/(190,239,70) 与色板一致 ✓；`test:minigame` 197 条全绿。
  - 批次：20261024-1010

- [x] [跳14] 阴影按参考图收紧（只比背景暗 ~10%、边缘干净、半径缩到现在的一半）：`BlockScene.ts` 的 `SHADOW_SPREAD` / 贴图渐变 / `SHADOW_OPACITY` → `npm run test:minigame` ＋ 像素取样核对"阴影处亮度 / 背景亮度 ≈ 0.90"
  - 做了什么：贴片 1.9 → 1.35 倍边长、偏移 0.83 → 0.58 边长（`(-0.30,+0.50)`）；贴图渐变从"一路柔到边"改成"核心 62% 实、最后 38% 收边"、圆角 0.22 → 0.16；浓度 0.35 → 0.32。
  - 为什么：ref02 实测阴影核心 rgb(137,141,150) vs 背景 rgb(209,212,221) ≈ 暗 35%（浓度没错），但**边缘更利、面积更小**；我们原来是"大半径径向渐变 + 1.9 倍贴片"，读起来是一团雾。
  - 验证：截图里阴影贴着方块、边缘干净 ✓；`test:minigame` 全绿。
  - 批次：20261024-1010

- [x] [跳15] 小人放大到参考比例（ref02 实测：小人高 ≈ 0.73 × 方块对角宽，我们 0.47）：`iso.ts` 的 `JUMPER_HEIGHT_RATIO` 0.72 → ~1.08，`JumperModel` 头径 0.29 → 0.33、裙摆 0.35 → 0.42 → `npm run test:jumpmodel && npm run test:jumpiso && npm run test:minigame`（比例断言同步改，取景头位不许把方块挤出画面）
  - 做了什么：`JUMPER_HEIGHT_RATIO` 0.72 → **1.12**；头径 0.29 → 0.33、头心 0.855 → 0.835、裙摆 0.35 → 0.42（PROFILE 九点等比放大 1.2）；`jump-model-test` 的期望值改成从 `JUMPER_HEIGHT_RATIO` 算出来，不再手抄 0.72。
  - 顺带修双份真值：`JumperModel.setSize` 里写死 `edge * 0.72`，而取景用的是 `iso.ts` 的 `JUMPER_HEIGHT_RATIO`——只改一处就会出现"小人没变大、镜头却按 1.12 留头位"（画面白空一块）。现在 `setSize` 直接读 `JUMPER_HEIGHT_RATIO`。
  - 验证：截图里小人明显变大、头顶留白正常 ✓；`test:jumpmodel` 45 条、`test:jumpiso` 42 条、`test:minigame` 197 条全绿。
  - 批次：20261024-1010

- [x] [跳16] 背景暗角减弱 + 去掉过重的竖向渐变（参考图接近纯色）：`BlockScene.ts` 的 `createBackgroundTexture` → `npm run test:minigame` ＋ 像素取样核对"四角亮度 / 中心亮度 ≥ 0.97"
  - 做了什么：六组背景的 `bottom` 全部收窄到 `top` 的 ~97%（原来差 10~20%，mist 那组 ΔL 达 0.20）。
  - 为什么：ref02 实测顶 rgb(211,215,224) → 底 rgb(209,212,221)，**只差约 1%**；横屏矮屏下 10~20% 的竖直渐变会把整屏压成"上亮下暗的灰"，与参考图差别最直观。渲染层的 `createBackgroundTexture` 只负责把两个端点插值，问题在色板取值，不在函数。
  - 验证：截图背景已接近纯色 ✓；`test:minigame` 197 条全绿（含"上亮下暗""ΔL ≤ 0.25"两条既有断言）。
  - 批次：20261024-1010

- [x] [跳17] 重跑 e2e 四张截图，逐项比对并写结论（视角/明暗/中心点/色板/阴影/小人/背景/分数 HUD）→ `npm run jump:e2e && npm run check`，比对表贴进完成说明
  - 验证：`npm run jump:e2e -- --url http://localhost:5175/` → **18 / 18 通过**（正交相机 ✓ / 间距 1.15~1.9 边长 ✓ / 两向无斜角 ✓ / 五类方块合法性 ✓ / 结算与重开 ✓ / 无 console 错误）；`npm run check` → **退出码 0**（离线 177/177 套 + 三张台账 + 文档门禁）。
  - 逐项比对结论（截图 `.tmp/shots/jump-{ready,charging,after5,over}.png` vs 参考图 02/03）：
    | 项 | 参考图 | 现在 | 结论 |
    | --- | --- | --- | --- |
    | 投影 | 正交、俯角 30°、方位 225° | 同 | ✓ 一致（菱形宽高比 2.0） |
    | 三面明暗 | 顶亮、左暗、右中 | 1.00 / 0.775 / 0.93 | ✓ 一致，且方向经像素互证 |
    | 顶面白点 | 每块顶面中心白点，直径 ≈ 0.13 边长 | 有，特殊方块不叠 | ✓ 已补齐 |
    | 色板 | 高饱和糖果色（黄/橙/柠檬/珊瑚/蓝） | 同档，每局 ≥3 个高饱和 | ✓ 已对齐（取样值一致） |
    | 阴影 | 左下、核心暗 35%、边缘干净、约 0.6 边长 | 同 | ✓ 已收紧 |
    | 小人 | 高 ≈ 0.73 方块对角宽，头 0.33、裙摆 0.42 | 0.68~0.73 | ✓ 已放大 |
    | 背景 | 近纯色，顶底差 ~1% | 差 ~3% | ✓ 可接受 |
    | 分数 HUD | 左上、深色细体、无其他文字 | 同（让开宿主顶栏） | ✓ 已修 |
  - 仍不一致、且**不打算装一致**的：① 原版字体拿不到，数字用系统字体（`-apple-system/Helvetica Neue`）近似；② 特殊方块美术（井盖管纹、便利店门脸、唱片）是我按特征手绘的 canvas 图，只能"可辨识"；③ 横屏取景是原创适配，原版是竖屏构图，方块占屏比例无法照搬。
  - 批次：20261024-1010

- [x] [自审] 审这一批的三层（L1 可测量 / L2 可对抗 / L3 可外部）→ 写 `- L1：` / `- L2：` / `- L3：` 各一句 + 证据
  - L1：这批六处改动全部变成了可测量的断言，而不是"看着像"——分数位置（`index.html` 的两条 CSS 断言）/ 白点（3 条：存在、随高度缩放、随卸载释放）/ 色板（3 条：≥3 个高饱和、≤1 个灰、不糊进背景）/ 小人比例（1 条从 `JUMPER_HEIGHT_RATIO` 算，杜绝手抄）/ 阴影与背景（复用既有像素级断言）。合计 `test:minigame` 190 → 197 条、`test:jumpmodel` 45 条。
  - L2：当天做了三次故意破坏并复现变红——① 把某局改成"近白 + 两块灰" → 3 条断言同时红（登记表 / 高饱和数 / 灰块数）；② 上一批验证过俯角 30°→35° 红 6 条、左右明暗对调红 4 条；③ 这批还暴露了**断言覆盖不到的一类**：分数被顶栏盖住时，元素在、文本对、E2E 全绿，只有截图能发现——所以 L1 的薄弱点是"可见性"，只能靠 `[跳17]` 的人工比对兜。
  - L3：这批的判断依据**全部来自真实参考图**（02/03/06 三张，逐点像素取样：色值 6 处、比例 2 处、阴影 2 处、背景 2 处），没有一条是"我觉得应该是"。唯一自选的是"每组至少 3 个高饱和 + 最多 1 个灰"这条量化门限（原版没给规则，是从 6 组参考图的分布反推的），已写进 `palette.ts` 注释。
  - 改进（当场做了 2 条）：① `JumperModel.setSize` 的双份真值修掉（写死 0.72 vs `iso.ts` 的 1.12）；② 饱和度/灰块两条"洗白"防线——如果不加，下次谁把颜色调灰，只有肉眼能发现。
  - 批次：20261024-1010

