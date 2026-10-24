# 完成档案 · DONE

> 本文件是**已完成工作的唯一档案**，只回答"这批做了什么、怎么验的"——时间线，最近的在最上面。
> 按模块看现状与坑 → `OVERVIEW.md`；下次怎么避开 → `TIPS.md`；机制与格式 → `README.md`。
> **一条内容只写一个地方**，别在三份文档里各抄一遍。
>
> 收尾时**整份队列原样搬进来**（含每条任务下方的完成说明与 `[阻塞]`），标题格式
> `## 批次 <号> · 日期 · 会话 <前 8 位>`。

---

## 批次 20261024-1455 · 2026-10-24 · 会话 3da8ce2b

- [x] [修1] 配方书回退成"整屏面板 + 手动开关"（修掉自测发现的"配方里出现莫名数字""点物品没反应"两个回归）：`ui/InventoryScreen.ts` 删掉 `recipes` 左栏页与 `.inv-recipe-host`、`index.html` 删掉对应落脚点样式、`main.openRecipeBook` 保持整屏 → `npm run test:ui`（断言：左栏只剩 items/creative/category 三份；标题栏那颗键在仓库里打开时传 `all`；开着时再点只关闭；不再有嵌入态）
  - 做了什么：把上一批的"配方书嵌进左栏"整段撤掉——`PocketLeftPane` 回到三种、删 `recipeHostEl`、`canEmbedRecipeBook()`、`applyInventoryChrome` 里的 `recipes` 分支与 `onRecipeHost(host)` 调用、`index.html` 里 `.inv-recipe-host` 那一格样式；标题栏那颗键改成纯开关：开着 → `onCloseRecipes()`；关着 → `onOpenRecipes(tab)`，其中 `tab` 在仓库（`pane === 'items'`）时**固定为 `all`**（= 搜索/全部那一栏），其余沿用 `lastRecipeTab`。
  - 为什么：左栏那一格只有半屏宽的 7 列，整屏尺寸的配方面板压进去之后列表里的数字与点击都对不上（用户自测报的正是这两条）。回退成整屏面板后渲染与点击都回到已知正常的路径，同时仍然满足"只有用户手动开关、从仓库打开跳到搜索栏、打开后不自动关"。
  - 顺带：`showUnowned`（分类栏"列出未拥有/红底"）不再挂在这颗键上——它现在是纯配方书开关；未拥有筛选留给配方书自己那颗 `notice.recipe.filterOn/Off`。
  - 验证：`npx tsx tools/ui-test.ts` **952 通过 / 0 失败**（改 6 条旧断言 + 重写自审那一段成 6 条：手动开关两个分支、仓库→`all`、`openRecipeBook` 先 show 后 sync、`fillFromBook` 不关书、✕ 仍手动关闭、左栏不再有落脚点）；`npm run typecheck` 通过。
  - 批次：20261024-1455
- [x] [修2] 创造模式背包的自绘滚动条位置/高度错乱：`ui/InventoryScreen.ts` 的 `syncCreativeScrollbar` 改用 rect 相对定位 + `index.html` 给创造栏容器 `position: relative` → `npm run test:ui`（断言：两栏共用同一套 rect 定位，不再用 `offsetTop`）
  - 做了什么：把 `syncCategoryScrollbar` / `syncCreativeScrollbar` 两份几乎相同的实现合成一个 `syncPaneScrollbar(grid, host, track, thumb, pane)`；纵向位置改成 `grid.getBoundingClientRect().top - host.getBoundingClientRect().top`（不再用 `offsetTop`，那个值取决于 offsetParent 落在哪一层），高度取 grid 的实际 rect 高度；滑块最小高度与 CSS 的 `min-height: 24px` 对齐（原来 JS 写 18，比样式还矮）。
  - 为什么：创造栏的滚动条装在 `.inv-creative-section`（搜索框 + 网格）里，而它的 `offsetTop` 基准与分类栏不同——同一套数字在一栏里对、在另一栏里就偏，表现就是"创造模式滚动条显示异常"。合成一份实现之后，"参照生存模式的样式"这件事由代码结构保证，而不是靠两处数字手动对齐。
  - 验证：`npx tsx tools/ui-test.ts` **956 通过 / 0 失败**（新增 4 条：两栏共用同一个函数、位置走 rect 不再有 `offsetTop`、滑块下限 JS=CSS=24、宽度/颜色只有一处定义）；`npm run typecheck` 通过。
  - 批次：20261024-1455
- [x] [修3] 空装备槽点击要有提示：`ui/InventoryScreen.ts#handleSlotClick` 开头加一条（空格 + 空手 + 左键）→ 按部位提示；新增文案键 `inventory.armorEmptyHint` 六语言 → `npm run test:ui` + `npm run test:i18n`（断言：五个部位各有一条提示、键在六张表里）
  - 做了什么：`handleSlotClick` 最前面加一条"空格 + 空手 + 左键"分支，命中装备槽就 `showMessage(tp('inventory.armorEmptyHint', { part }))`；部位名由 `armorSlotPartName()` 给——四个护甲位取 `item.armorType.*`（头盔/胸甲/护腿/靴子，比槽位上那一个字的"头/胸/腿/靴"更适合放进句子），第五格取 `inventory.armor.offhand`。新增文案键 `inventory.armorEmptyHint`，六个语种各一条（表 2864 → 2865）。
  - 为什么：空槽现在只有一枚剪影图标，空手点它原来**什么都不发生**，玩家既不知道这格放什么、也不知道是不是没点中。另外判据必须限定"玩家自己的背包"——箱子/熔炉的槽号从 0 开始，会正好撞进护甲区间 36~40，不挡就会在箱子里弹出"空头盔槽"。
  - 验证：`npx tsx tools/ui-test.ts` **958 通过 / 0 失败**（新增 2 条：提示分支存在 + 只认自己的背包 + 五个部位键齐全；文案含 `{part}` 占位符）；`npx tsx tools/i18n-test.ts` 547 通过、`npm run audit:i18n` 六语言 2865/2865 通过；`npm run typecheck` 通过。
  - 批次：20261024-1455
- [x] [修4] 手持刀剑类物品显示不正常：`render/HandRenderer.ts` 非方块物品改回**扁平双面贴图**（方块仍是立方体），尺寸随 2× 一起放大 → `npm run test:render`（断言：sprite 用 PlaneGeometry + DoubleSide，block 仍用 BoxGeometry；两者尺寸同为 `ITEM_SIZE`）
  - 做了什么：非方块物品的几何体从 `BoxGeometry(0.44, 0.44, 0.08)` 回到 `PlaneGeometry(0.44, 0.44)`，并新增一份 `spriteMaterial`（同一套着色器 + `side: DoubleSide`）给它用；方块仍然走 `BoxGeometry` + 单面材质。删掉 `ITEM_THICKNESS` 常量与它的注释。
  - 为什么：上一批为了"厚度"把图标贴到了盒子的六个面上，剑、镐、钓鱼竿这类斜向/细长图标在侧面被拉伸，看着就是几条彩带（用户自测报的"刀剑显示有问题"）。原版第一人称的物品本来就是 1 像素厚的面片，厚度对这类图标只会帮倒忙——厚度留给方块（方块本来就是立方体）。双面材质保证甩视角时不会忽隐忽现。
  - 验证：`npx tsx tools/render-test.ts` **252 通过 / 0 失败**（把 2 条旧断言改成 4 条新的：4 顶点面片、尺寸同为 0.44、只贴一张图（4 个 UV 角）、面片 DoubleSide 而方块仍 FrontSide）；`npm run typecheck` 通过。
  - 批次：20261024-1455
- [x] [修5] 首页在矮屏上把标题挤出屏幕：`index.html` 首页图标/间距改成随视口高度收缩（clamp + dvh）、`.world-panel[data-view='home']` 允许内部滚动 → `npm run test:ui`（断言：logo 字号含 vh 项、菜单间距含 vh 项、home 视图有 `overflow-y: auto`）
  - 做了什么：首页视图 `.world-view[data-view='home'].active` 的 `justify-content: center` 改成 `safe center` 并补 `overflow-y: auto`（装不下时从顶部排、还能滚回来，不再两头一起裁）；`.world-logo` 字号 `clamp(42px, 8vw, 72px)` → `clamp(28px, min(8vw, 9vh), 72px)`；`.world-menu` 的 `gap/margin-top` 与 `.world-footer` 的 `margin-top` 全部换成带 `vh` 的 clamp；触摸横屏那组覆盖也改成 `clamp(24px, 8vh, 42px)` / `clamp(4px, 1.2vh, 8px)`。
  - 为什么：面板是固定高（`--panel-h`）+ `overflow: hidden`，内容比它高时 `center` 会同时裁掉上下两端——标题在最上面，所以第一个消失。只把字号调小治不了根（不同机型差得太多），必须"安全居中 + 可滚"打底，再把间距做成跟视口高联动。
  - 验证：`npx tsx tools/ui-test.ts` **960 通过 / 0 失败**（改 1 条横屏断言、新增 2 条：home 视图 safe center + 可滚、三处 clamp 都带 vh）。
  - 批次：20261024-1455
- [x] [修6] 背包面板在矮屏上压到快捷栏：`index.html` 用 `--inv-pocket-h` 与 `#inventory-screen` 的 padding 给底部 dock 让位 → `npm run test:ui`（断言：`--inv-pocket-h` 里扣掉了 dock 高度、`#inventory-screen` 有底部安全区 padding）
  - 做了什么：新增 `body.inv-pocket-open #inventory-screen { padding-bottom: calc(62px + env(safe-area-inset-bottom, 0px)); }`——携带版打开时把底部 dock 的高度从"可用高度"里让出来。`--inv-pocket-h` 的原公式（`min(100dvh-72px, max(318px, 42vh))`）没动：减掉 dock 之后剩余空间刚好容得下它，再扣一次会把背包压矮一圈。
  - 为什么：dock 是 `position: fixed`，根本没参与 `#inventory-screen` 的 `grid-template-rows: 1fr auto`（第二行塌成 0），所以面板一直按整屏高居中，底边正好压在快捷栏上。用户说的"被挤到快捷栏上部一点"就是这个。
  - 验证：`npx tsx tools/ui-test.ts` **962 通过 / 0 失败**（新增 2 条：dock 让位的 padding 带安全区、`--inv-pocket-h` 仍受 dvh 约束——防止有人为了"塞下"把它改回固定值）。
  - 批次：20261024-1455
- [x] [修7] 设置里的游戏模式下拉：只列了生存/创造两种、且回调是"切换"而不是"切到选中的那个"：`ui/SettingsScreen.ts` + `main.ts` → `npm run test:ui`（断言：选项来自 `GAME_MODES` 四种、回调签名收 mode、main 里接的是 `setGameMode(mode)`）
  - 做了什么：hook 从 `onToggleGameMode?: () => void` 改成 `onSetGameMode?: (mode: GameMode) => void`；下拉的选项由写死的 `['survival','creative']` 换成 `GAME_MODES`（生存/创造/冒险/旁观四档），回调改成 `(mode) => this.actions.onSetGameMode?.(mode)`；`main.ts` 那边接 `onSetGameMode: (mode) => this.setGameMode(mode)`，顺手删掉不再用的 `nextGameMode` 导入；"这一行要不要显示"的判据同步换成新回调名。
  - 为什么：原来选项只有两项，而写回却是 `nextGameMode(current)`——**无视选中的值**，在创造模式里再选"创造"会退回生存（用户看到的"切到的不是我选的那个"）。四档本来就能用 `/gamemode` 切，界面没理由只给两种。
  - 验证：`npx tsx tools/ui-test.ts` **965 通过 / 0 失败**（新增 3 条：选项来自 GAME_MODES、回调按选中的值且 main 接 `setGameMode(mode)`、那一行的显隐判据跟着改）；`npm run typecheck` 通过。
  - 批次：20261024-1455
- [x] [自审] 审这一批的三层（L1 可测量 / L2 可对抗 / L3 可外部）→ 写 `- L1：` / `- L2：` / `- L3：` 各一句 + 证据
  - L1：7 条修复全部有"坏了就变红"的断言：配方书回退 6 条（手动开关两分支 / 仓库→all / show 先于 sync / fillFromBook 不关书 / ✕ 仍手动 / 左栏无落脚点）、滚动条 4 条、空槽提示 2 条、扁平物品 5 条、首页 2 条、背包避让 2 条、游戏模式 3 条。套件：`ui-test` 952 → **965**、`render-test` 252 → **253**（新增 1 条是自审修的那处漏项）。**薄弱点**：这 7 条全是布局/交互，离线只能断言源码接线与 CSS 取值；"看起来对不对"仍然要真机看一眼。
  - L2：这批做了**三次故意破坏**并复现变红——① `#touch-stick.dynamic` 之外，把 `spriteMaterial` 的亮度那行删掉 → `render-test` 立刻红（这正是自审抓到的真漏项）；② 上一批把 `onRecipeHost` 改成 `null` → 配方书相关 2 条红（已回退）③ 本批把游戏模式回调改回无参 toggle → 3 条里 2 条红（`GAME_MODES` 与 `onSetGameMode` 两条）。三次都已还原（`git status` 只有本次改动）。
  - L3：7 条全部来自用户自测的原话（数字/点不动、滚动条、空槽无提示、刀剑显示、标题被挤出、背包压快捷栏、模式切错），没有一条是我自己找的"顺手优化"；我自己定的只有实现参数——让位高度 62px、滑块下限 24px、字号 `min(8vw,9vh)`、提示句文案。其中"62px"最容易漂（dock 实际高度由 CSS 决定），已写成独立断言而不是散落在计算里。
  - 改进（当场修了 1 条）：`spriteMaterial` 漏了 `setBrightness` —— 拿着剑进洞永远全亮、拿方块却会变暗；补上并加了一条"两份材质同时变暗"的断言。
  - 排除记录（找过但不算问题）：① `showUnowned`（分类栏"列出未拥有/红底"）在修1之后没有入口了——它现在恒为 false，但拆它要动 `renderCategoryGrid`/`craftableIds`/按钮 active 三处，收益小于风险，留待下次专门做；② 首页 4 颗按钮在 320 高以下仍然靠滚动兜底而不是再缩——再缩就点到手指够不稳的 40px 以下；③ 空槽提示只在左键触发（长按是"选数量/右键"语义），触摸端轻点就是左键，不需要为长按再补一条。
  - 批次：20261024-1455

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

