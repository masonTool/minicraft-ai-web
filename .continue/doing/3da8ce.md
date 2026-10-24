# 队列 · 会话 3da8ce2b3c274afab7e49dacec06de30

> 状态：执行中
> 创建：2026-10-24
> 批次：20261024-1152

- [x] [优化1] 出生点不再"永远是平原草地"（用户选 B）：`core/world/SpawnPoint.ts` 放宽群系偏好 + 出生搜索半径（原点 1024 格内随机挑合格点）→ `npm run test:spawn`（新增断言：同一批种子下出生群系不恒定、仍在自然地面、不与水/岩浆重叠）
  - 做了什么：`planSpawnRegion` 从"全网格打分取最优（起伏×1000 + 群系偏好×80 + 距离）"改成两段式：① 半径内**面积均匀随机试投** 48 次，第一块"高于地表下限 + 起伏 ≤4 + 不在水面/虚空群系"的就用；试投点落水时先在 8/16 格环上找最近的岸（`flatSpotNear`），避免落点被推到远处高地；② 试投全落空才退回网格扫描（≤256 格，口径同旧版）。主世界半径 256 → **1024**，随机源用 `new Random(seed).nextDouble()`。
  - 为什么：地形本来就是按种子生成的，但旧评分把任何种子都压到"离原点最近、最平、最像平原"的那块地 → 玩家看到的永远是"草地 + 树 + 侧边海 + 远处山"。随机源必须由种子派生，否则同一种子重进世界会换出生点（与原版口径不符）。
  - 另一处必须改：试投如果只认中心点，能通过的只剩高地（该生成器里高地偏冷），实测 5 个种子全落在雪原/冰刺；先找最近的岸之后变成 stony_peaks / badlands / snowy_plains / ice_spikes / old_growth_pine_taiga。
  - 验证：`npx tsx tools/world-test.ts` 87 通过 / 0 失败（新增 4 条：跨种子群系至少 2 种、≥2/3 相距 128 格以上、同种子两次完全一致、落点都高于海平面；种子 1/7/42/1337/20261024 的落点已打印进输出）；`worldmatrix-test` 29 通过、`terrain-normal-test` 43 通过（出生点仍选得出来、出生区块非空）；`npm run build:fast` 通过。
  - 批次：20261024-1152
- [x] [优化2] 引导未完成时切游戏模式即作废：`main.ts#setGameMode` 里判断"玩家真的换了模式"就 `tutorialDismissed = true` 并落盘；读档恢复模式不触发 → `npm run test:tutorial`（新增断言：setGameMode 后卡片不再出现、dismissed 写进存档；restore 路径不影响）
  - 做了什么：判定抽成纯函数 `tutorial/boot.ts#shouldVoidTutorialOnModeChange`（三个不该触发的场景各一条：读档恢复 / 已作废 / 已走完）；`setGameMode` 在 `next !== this.gameMode` 之后调它，命中就 `tutorialDismissed = true` + `tutorialCard.hide()` + `saveTutorialNow()`，并记一条 `diag.event('tutorial','void.onModeChange')`。
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
- [ ] [优化7] 动态摇杆默认显示底圈，跟手触发逻辑不变：`index.html` `#touch-stick.dynamic` 的 opacity 规则（+ 必要时 `TouchControls.ts`）→ `npm run test:touch`（断言 CSS 里 dynamic 不再是全隐、active 才抬高）
- [ ] [优化8] 首页四颗按钮高度统一：`index.html` `.world-primary` / `.world-secondary` 的 min-height 与内边距 → `npm run test:theme`（静态断言：两类按钮在同一断点下 min-height 相同）
- [ ] [优化9] 首页去掉"非官方 Web 复刻…"那段说明与 `WebGL2!` splash（构建版本信息按用户要求**保留**）：`ui/WorldScreen.ts` + `core/i18n/locales/*/menu.ts` 的 `menu.footer` → `npm run test:theme`（断言首页 DOM 不再有 footer 说明与 splash 节点）
- [ ] [优化10] 暂停页去掉成就按钮、"游戏已暂停"标题、副标题、存档/改动/自动保存那行说明（设置页与主菜单设置面板不受影响）：`ui/SettingsScreen.ts` + `main.ts#openSettings` → `npm run test:pause`（断言暂停页 DOM 无这四块、设置页仍有标题与返回）
- [ ] [优化11] 顶部中间第三颗键（视角）图标换成"眼睛"（保持现有 currentColor 实心风格）：`ui/TouchIcons.ts` 的 `view` 路径 → `npm run test:touch`（断言 svg 含眼球+瞳孔路径、不再是望远镜的镜筒矩形组）
- [ ] [优化12] PC 端界面元素与手机版保持一致（同一套装备槽图标 / 滚动条位置与样式 / 顶部图标 / 暂停页结构，差异只保留键盘提示文案）：`index.html` 的 `body:not(.touch-mode)` 规则 + 相关 TS → `npm run test:theme` + `npm run test:inventory`
- [ ] [自审] 审这一批的三层（L1 可测量 / L2 可对抗 / L3 可外部）→ 写 `- L1：` / `- L2：` / `- L3：` 各一句 + 证据
