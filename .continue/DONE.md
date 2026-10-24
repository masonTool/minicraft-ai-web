# 完成档案 · DONE

> 本文件是**已完成工作的唯一档案**，只回答"这批做了什么、怎么验的"——时间线，最近的在最上面。
> 按模块看现状与坑 → `OVERVIEW.md`；下次怎么避开 → `TIPS.md`；机制与格式 → `README.md`。
> **一条内容只写一个地方**，别在三份文档里各抄一遍。
>
> 收尾时**整份队列原样搬进来**（含每条任务下方的完成说明与 `[阻塞]`），标题格式
> `## 批次 <号> · 日期 · 会话 <前 8 位>`。

---

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

