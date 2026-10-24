# 完成档案 · DONE

> 本文件是**已完成工作的唯一档案**，只回答"这批做了什么、怎么验的"——时间线，最近的在最上面。
> 按模块看现状与坑 → `OVERVIEW.md`；下次怎么避开 → `TIPS.md`；机制与格式 → `README.md`。
> **一条内容只写一个地方**，别在三份文档里各抄一遍。
>
> 收尾时**整份队列原样搬进来**（含每条任务下方的完成说明与 `[阻塞]`），标题格式
> `## 批次 <号> · 日期 · 会话 <前 8 位>`。

---

## 批次 20261024-1726 · 2026-10-24 · 会话 167f6a14

- [x] [修23] 重做第一人称手持物品/手臂的骨架（用户："手持物品的显示还是有很大的问题，参照正版效果调整"）：`src/render/HandRenderer.ts` + `src/render/TextureAtlas.ts` → 用临时截图脚本量各类物品的屏幕包围盒，对照原版构图收进合理区间
  - 做了什么：① 整只手改成**屏幕比例口径**（`syncRig()` 每帧按 `fov`/`aspect` 把"握点屏幕比例 + 屏幕高单位"换算成相机空间），常量集中在文件头（`GRIP_SCREEN_*` / `BLOCK_SIZE` / `SPRITE_SIZE` / `ARM_*`）；② 空手手臂改成"从屏幕右下角伸进来、末端一块略粗的拳头"，根部退到画面外（实测最近处 0.10 格 → 0.57 格）；③ 扁平物品的厚度面改成只取图标**最外一列/行**（六面同贴整张 = 彩带，填纯色 = 空气里一条孤线，两种都实测复现过）；④ 对齐口径改成"图标里不透明那块的底边中点落在握点"（新增 `TextureAtlas.contentBounds()`，面包/苹果不再浮在手心上方）；⑤ 只有完整立方体才画立方体，火把/花草/台阶等改画图标（之前火把被渲染成一根细长条）；⑥ 挥动改成绕肩部支点的小角度旋转 + 手腕前压（原来 0.9 弧度会把物品整个甩出画面）。
  - 为什么：用户报"还是有很大的问题"。先量化取证：空手手臂包围盒 x 72%~346%、y 75%~514%（一块贴着屏幕的褐色墙），手持方块 y 47%~118%（顶到画面中间），钻石剑 x 61%~109%、y 31%~90% 且翻出两条彩带。三条根因分别是"手臂根部贴到近裁面被透视放大""厚度面拉伸图标""尺寸是世界格数、和握点深度不匹配"。
  - 验证：`npm run check` 全绿（含 `test:render` **260 通过 / 0 失败**，新增"换宽高比握点跟着投影走""视野变宽整只手跟着缩放""挥到一半物品仍在画面内""厚度面只取图标最外一列""按内容底边对齐握点"等断言）；另外用 `playwright-core` 起真实浏览器进创造模式逐件截图核对：1280×720 与手机横屏 844×390、FOV 60/90 下空手 / 石头 / 原木 / 玻璃 / 钻石剑 / 铁镐 / 铁斧 / 面包 / 苹果 / 火把，以及挥动中间帧（物品不再被甩出画面、无游离线条）。实测包围盒：空手手臂 x 69%~114%、y 74%~146%（最近处 0.57 格）；石头 x 64%~96%、y 62%~128%；钻石剑 x 61%~90%、y 42%~86%。
  - 批次：20261024-1726
- [x] [修24] 台账：把这一批记进 `DONE.md` / `notes/batches.md` / `OVERVIEW.md` / `TASKS.md` → `npm run check`
  - 做了什么：新增 1726 一节与批次索引一行；OVERVIEW「渲染」那条把手持物的口径换成"屏幕比例 + 厚度面取边缘列 + 只有完整立方体才画方块"；TASKS 的「队列落地 · 当场任务」补一行。
  - 为什么：这批把"手持物的尺寸口径"整个换掉了，不写进 OVERVIEW 的话下一轮还会有人往 `HandRenderer` 里塞世界格数常量。
  - 验证：`npm run check` 全绿（含 `audit:docs` 体量门禁与 `audit:tasks` 的台账核对）。
  - 批次：20261024-1726

## 批次 20261024-1723 · 2026-10-24 · 会话 723564b3

- [x] [修21] 创造物品栏把面板填满（列表下面的空白去掉）：`index.html` 五处 `.inv-creative` 高度上限改成 `flex: 1 1 auto; min-height: 0; max-height: none` → `npm run test:ui`
  - 做了什么：把创造网格的固定上限全部换成"吃掉剩余高度"——`.inv-panel.creative-ui.pocket-ui .inv-creative`（原 `min-height: min(38vh,200px)` / `max-height: min(42vh,220px)`）、`body.touch-mode` 同名那条、横屏矮屏那条（原 34/38vh）、`.inv-panel.creative-ui .inv-creative`（原 `min(58vh,420px)`）、双栏 `.inv-panel.pocket-ui.pocket-dual .inv-creative`（原 174px）、`body.touch-mode ...pocket-dual` 那条（原 174px）、`body:not(.touch-mode) ...pocket-dual`（原 `min(58vh,430px)`）。
  - 为什么：面板高度是固定的 `--inv-pocket-h`（矮横屏就是 318px），网格用 `vh` 封顶就只占一半，下面自然空一大片。面板/内容区/创建区三层都是 `flex: 1 1 auto; min-height: 0`，网格只要也 `flex: 1 1 auto` 就会把剩下的高度全部吃掉（多出来的高度就是能多看见的行）。
  - 验证：`npx tsx tools/ui-test.ts` **976 通过 / 0 失败**（新增 1 条：两条主规则都是 `flex: 1 1 auto` 且不再出现 `max-height: 174px;` / `max-height: min(42vh…;` 这些声明——注意断言认"带分号的声明"，规则块里的注释会提到旧值）。
  - 批次：20261024-1723
- [x] [修22] 台账：`DONE.md` / `notes/batches.md` / `OVERVIEW.md` / `TASKS.md` 记这一批 → `npm run check`
  - 做了什么：新增 1723 一节、批次索引一行、TASKS 队列落地一行、OVERVIEW「界面与音频」补"创造网格填满剩余高度，别再按 vh 封顶"。
  - 为什么：面板是固定高度这一点不写在台账里，下一轮又会有人给网格加 `max-height: 42vh` 之类的"保险"。
  - 验证：`npm run check` 全绿（含 `audit:tasks` 的提交总数核对）。
  - 批次：20261024-1723

## 批次 20261024-1706 · 2026-10-24 · 会话 723564b3

- [x] [修18] 创造物品栏：点非"搜索"分类时搜索行整条收掉（列表上移，不被搜索框占位）：`src/ui/InventoryScreen.ts` `syncCreativeSearch()` + `index.html` 一条 CSS → `npm run test:ui`
  - 做了什么：`syncCreativeSearch()` 里除了藏输入框，再按"分类按钮还在不在这一行里"给 `.inv-creative-controls` 加/去 `search-hidden`；CSS 用 `.inv-panel .inv-creative-controls.search-hidden { display: none !important; }` 收掉整行（`!important` 是因为 `.inv-panel.creative-ui.pocket-ui .inv-creative-controls` 的 `display: flex` 有 4 个类，压不过）。
  - 为什么：双栏那条 `.inv-panel.pocket-ui.pocket-dual .inv-creative-controls { min-height: 32px }` 会在输入框藏掉之后继续占 32px + 6px 行距，物品列表被顶下去一截——用户："物品的列表应该向上平移，不要被搜索框占位"。分类按钮在左轨时整行本来就没用，可以整条收；按钮仍在这一行里的布局（非 pocket）只藏输入框，否则分类按钮会一起消失。
  - 验证：`npx tsx tools/ui-test.ts` **975 通过 / 0 失败**（新增 1 条：`tabsInRow` 判据 + 类名切换 + CSS 收行）。
  - 批次：20261024-1706
- [x] [修19] 创造物品栏只剩一根滚动条（原生那条 = "滑块下面的小滚动条 / 底下小黑块"），并且只许纵向滚：`index.html` → `npm run test:ui`
  - 做了什么：① 把 `.inv-panel.creative-ui.pocket-ui .inv-creative` 从旧的"原生滚动条要看得见"那段（`scrollbar-width: thin` + 8px `::-webkit-scrollbar` + `#b9b9b9` 槽 + `#6f6f6f` 块）里删掉，那段只留给嵌入版配方网格；新增 `.inv-panel .inv-grid.inv-creative { scrollbar-width: none; }` + `::-webkit-scrollbar { display:none; width:0; height:0 }`（带 `.inv-panel` 才压得过那 4 个类的旧规则）。② 创造网格（基础 + 双栏）补 `overflow-x: hidden`。
  - 为什么：创造栏早就换成自绘那根（`.inv-creative-section .inv-category-scrollbar`），旧的原生那条一直没真被关掉——`.inv-grid.inv-creative { scrollbar-width: none }` 只有 2 个类，输给 `.inv-panel.creative-ui.pocket-ui .inv-creative` 的 `scrollbar-width: thin`。于是两根并排：原生 8px 槽 + 深色块压在 6px 自绘滑块下面，滚起来就是"滑块下面的小滚动条"和小黑块。另外 `overflow-y: auto` 单独写会让 `overflow-x` 变成 auto，多 1px 就在底部画一条横向滚动条。
  - 验证：`npx tsx tools/ui-test.ts` 975 通过（新增 2 条：创造栏不再出现原生滚动条声明（thin 与 `::-webkit-scrollbar` 两处都查）、基础与双栏两条网格都是 `overflow-x: hidden; overflow-y: auto`）。
  - 批次：20261024-1706
- [x] [修20] 台账：`DONE.md` / `notes/batches.md` / `OVERVIEW.md` / `TASKS.md` 记这一批 → `npm run check`
  - 做了什么：新增 1706 一节与批次索引一行；OVERVIEW「界面与音频」补"创造栏只有自绘一根滚动条（`scrollbar-width: none` 必须写成 `.inv-panel .inv-grid.inv-creative`，否则被 4 个类的旧 `thin` 规则压住）+ 非搜索分类要收整条搜索行"；TASKS 队列落地补一行。
  - 为什么：`scrollbar-width: none` 写了却无效这件事，只看片段看不出来，下次还会踩；所以坑写进 OVERVIEW 那一行摘要里（`TIPS.md` 已到 500 行上限，按"宁可少写"不新增条目）。
  - 验证：`npm run check` 全绿（含 `audit:docs` 体量门禁）。
  - 批次：20261024-1706

## 批次 20261024-1652 · 2026-10-24 · 会话 723564b3

- [x] [修16] 那颗键改成"可合成物品状态"的纯开关（亮灭 = 状态本身），只保留一条特殊逻辑：仓库里 + 关着 → 打开状态并跳到搜索分类：`src/ui/InventoryScreen.ts` → `npm run test:ui`
  - 做了什么：① click 只有两件事——仓库（`pane === 'items'`）且 `!showUnowned` → `showUnowned = true` + `openPocketCategory('all')`；其余一律 `showUnowned = !showUnowned` + 重排（左栏不跳页）。② 两处 `active` 判据（背包 / 工作站）都改成 `this.showUnowned`，不再掺"左栏在哪一页"。
  - 为什么：上一批把 `active` 写成 `leftPane === 'category'`，结果"分类页里亮着关不掉（点一下状态灭了、按钮还亮）"和"仓库里永远灰着（状态开着也不亮）"两个都错。用户口径是：按钮亮灭 = 状态本身、由用户完全控制、所有分类同一逻辑；只有"仓库里 + 关着"这一条会顺手跳到搜索页。所以亮灭判据必须与点击所翻的那个位是同一个人（`showUnowned`），特殊逻辑只额外做"跳页"。
  - 验证：`npx tsx tools/ui-test.ts` **972 通过 / 0 失败**（4 条断言重写：不碰配方书、正常逻辑取反且不跳页、特殊逻辑 `pane==='items' && !showUnowned` → 置真 + `openPocketCategory('all')`、两处 `active` 都是 `this.showUnowned` 且不再出现 `leftPane === 'category'` / `showCategory` 版本）。
  - 批次：20261024-1652
- [x] [修17] 台账跟口径：`DONE.md` / `notes/batches.md` / `OVERVIEW.md` / `TASKS.md` / `TIPS.md` 里"亮着 = 左栏在可合成视图里"的说法改成"亮着 = 状态本身"；`HANDOFF.md` 提交总数同步 → `npm run check`
  - 做了什么：1636 那节补更正行、新开 1652 一节；OVERVIEW 里那颗键的一句话口径重写；TASKS 里 1636 那条标注被 1652 推翻、并补 1652 一行；TIPS 那条改成"亮灭判据必须就是点击所翻的那个位"。
  - 为什么：这条口径已经连错两轮（"开书" → "跟视图走"），文档里留着错的说法下一轮还会照做。
  - 验证：`npm run check` 全绿（含 `audit:tasks` 的提交总数核对）。
  - 批次：20261024-1652

## 批次 20261024-1636 · 2026-10-24 · 会话 723564b3

> **更正（批次 20261024-1652）**：本批把 `active` 改成"左栏在可合成视图里"仍然是错的——那样在分类页里
> 亮着关不掉、在仓库里永远灰着。正确口径见 1652：亮灭 = 状态本身（`showUnowned`），特殊逻辑只有
> "仓库里 + 关着 → 打开并跳到搜索分类"。


- [x] [修14] 澄清后改回："可合成物品"键只是左栏视图的开关——不打开配方书，且**按钮不会自己灭**：`src/ui/InventoryScreen.ts`（click 分支回退 + `active` 判据改成 `leftPane === 'category'`，工作站那条同口径）→ `npm run test:ui`（断言：click 里没有 `onOpenRecipes`/`onCloseRecipes`；`active` 只看视图、两处都不再带 `showUnowned`）
  - 做了什么：① 撤掉上一批给那颗键加的 `onOpenRecipes('all')` / `isRecipesOpen` 分支，回到"仓库→`openPocketCategory(lastRecipeTab)`、已在分类页→切 `showUnowned`"。② `active` 从 `leftPane === 'category' && this.showUnowned` 改成 `leftPane === 'category'`；工作站分支 `showCategory && this.showUnowned` 同样改成 `showCategory`（`showCategory` 本身就是"左栏在分类页"）。③ title 回到 209 那套（描述再点一下切哪种筛选）。
  - 为什么：用户澄清"没有所谓的配方书页面，配方相关的东西全走可合成物品这颗键"——上一批把"会自动关闭"读成了"配方书被关"，实现方向错了。"按钮自己灭"的真实原因是 `active` 绑在**红底筛选**上：从仓库点进来的第一次 `showUnowned` 还是 false，于是视图开了、按钮是灭的，看起来像自动关掉、得再点一下（那一下才把 `showUnowned` 打开）。
  - 验证：`npx tsx tools/ui-test.ts` **971 通过 / 0 失败**（把上一批那 3 条"那颗键开书"的断言换回"只切视图、不碰配方书"，`active` 那条改成只看视图且覆盖工作站分支）。
  - 批次：20261024-1636
- [x] [修15] 台账改口径：`DONE.md` / `notes/batches.md` / `OVERVIEW.md` / `TASKS.md` 里"那颗键打开配方书"的说法全部改成"可合成物品视图开关 + 亮着跟着视图" → `npm run check`
  - 做了什么：1609 那批的 DONE 条目补一行"更正"，本批次另开一节；OVERVIEW「物品栏与合成」、TASKS 队列落地、批次索引都改成正确口径（滚动条那部分不动）。
  - 为什么：文档里留一句错的因果，下一轮还会把同一个误解再实现一遍。
  - 验证：`npm run check` 全绿（编号 / 覆盖度 / 差异 / 文档体量四条台账 + 全部离线套件）。
  - 批次：20261024-1636

## 批次 20261024-1609 · 2026-10-24 · 会话 723564b3

> **更正（批次 20261024-1636）**：本批 `[修11]` 的"那颗键打开配方书"是**误解**——用户澄清没有"配方书页面"，
> 那颗键是可合成物品视图的开关；已在 1636 改回。`applyInventoryChrome` 里不关配方书那条仍然保留
> （它修的是"R 键在容器/工作站界面里开的书被重排关掉"，与本条无关）。滚动条那两条（修12/修13）不受影响。


- [x] [修11] 标题栏"配方书"键真的能打开配方书，且**不再自动关闭**：`src/ui/InventoryScreen.ts`（按钮 click 分支 + 把 `applyInventoryChrome` 里两处 `onCloseRecipes()` 挪到 `openWith` 的换面板处）→ `npm run test:ui`（断言：仓库里点它＝左栏切"全部/搜索"并调 `onOpenRecipes('all')`；重排函数里不再有 `onCloseRecipes`；换成别的面板时才关书）
  - 做了什么：① 那颗键改三分支——书开着→关；左栏已在分类页→切"列出未拥有（红底）"（保留 1531 口径）；左栏在仓库→`openPocketCategory('all')` + `onOpenRecipes('all')`（容器/工作站两类不弹书，没有可摆的合成格）。② `applyInventoryChrome()` 里容器分支与工作站分支那两行 `onCloseRecipes()` 删除，"换面板就收书"并进 `openWith()` 的 `mode/容器变了` 块与 `openTrade()`；`openWith` 末尾那条只在 inventory/crafting 生效的窄条件一并去掉。③ 那颗键"亮着"的判据加上 `bookOpen`，title 改成"点下去会发生什么"。
  - 为什么：根因是 `openRecipeBook()` 先 `show()` 再 `syncRecipePane()`，而 sync 走的就是 `applyInventoryChrome`，容器/工作站两条分支无条件 `onCloseRecipes()` → 书刚打开就被自己关掉（用户报的"配方书会自动关闭"）。关书是玩家意图（✕/R/换界面），不该是布局副作用。另外 1531 的 B 口径让手机彻底没有配方书入口（当时记成已知缺口），本轮反馈说明要的是书本身。
  - 验证：`npx tsx tools/ui-test.ts` **971 通过 / 0 失败**（本批新增 8 条、改 3 条旧断言：开书 2 条、重排不关书 / 收书位置 2 条、滚动条槽位与黑色滑块 4 条；旧断言里"只切分类、不碰 `onOpenRecipes`"两条与"`active` 只看 `showUnowned`"一条按新口径重写）。
  - 批次：20261024-1609
- [x] [修12] 左栏滚动条与物品留出间距、滑块改成黑色：`index.html`（分类/创造网格 `padding-right` 预留槽位、列宽可缩、滑块 `#1c1c1c`）+ `src/ui/InventoryScreen.ts`（`scrollbarContentLeft` 的 clamp 不再把轨道推到物品上）→ `npm run test:ui`
  - 做了什么：分类网格 `repeat(7, 40px)` → `repeat(7, minmax(0, 40px))`、`padding-right: 5px` → `15px`（= 8px 间距 + 7px 轨道），`.inv-category .inv-slot` 改 `width:100% / aspect-ratio:1 / max 40px`；双栏创造栏同样处理（`padding-right: 14px` = 8 + 6）；滑块 `#c2c2c2 → #1c1c1c`（按下 `#3a3a3a`）；`scrollbarContentLeft()` 的夹紧上限从 `容器宽 - 轨道 - 1` 收到 `容器宽 - 轨道`。PC 那套 48px 规则同步（`minmax(0,48px)` + `padding-right: 15px`）。
  - 为什么：5px 的预留装不下"8px 间距 + 7px 轨道"，JS 的 `Math.min(…)` 就把轨道按回容器右缘、直接压在最后一列上——用户说的"应该与物品有一定间距"；浅灰滑块和浅灰面板同色，所以要求黑色。窄屏左栏只有 ~257px 而 7×40 要 286px，列宽不给收缩余地时最后一列本来就会被裁掉，滚动条更没地方站。
  - 验证：`npx tsx tools/ui-test.ts` 971 通过（新增 4 条：分类预留 15px = 8+7、双栏创造预留 14px = 8+6、夹紧上限不再 `- 1`、滑块为 `#1c1c1c` 且不再出现 `#c2c2c2`）。
  - 批次：20261024-1609
- [x] [修13] 断言与台账：`tools/ui-test.ts` 改掉旧断言 → `npm run check`
  - 做了什么：删/改 3 条旧断言（"那颗键只切物品分类（不碰 onOpenRecipes）"、"标题栏那颗键只切物品分类"、"`toggle('active', leftPane === 'category' && this.showUnowned)`"），补 8 条新断言；决策写进 `doing/723564-decision.md`（D1 恢复开书、D2 重排不关书、D3 间距靠 CSS 预留槽位）。
  - 为什么：这几条断言钉的正是本轮推翻的口径，留着会红（也会把回归锁死成旧行为）。
  - 验证：`npm run check` 全绿（typecheck + 全部离线套件 + 三张台账 + 文档体量），`ui-test` 971 通过 / 0 失败。
  - 批次：20261024-1609

## 批次 20261024-1531 · 2026-10-24 · 会话 3da8ce2b

- [x] [修8] 手持刀剑显示：锚点移到**柄**（贴图底边中心当握把），并给扁平物品**厚度**（薄盒子 + 侧面压暗，避免图标被拉成彩带）：`render/HandRenderer.ts` → `npm run test:render`（断言：sprite 用薄盒子且 depth ∈ [0.03,0.08]；几何包围盒底边在锚点（min.y≈0），方块仍居中；侧面亮度低于正反面）
  - 做了什么：扁平物品改回薄盒子 `BoxGeometry(0.44, 0.44, SPRITE_THICKNESS=0.05)`，六面同图标；新增 `SPRITE_SHADE = [.62,.62,.86,.62,1,1]`（正反满亮度、厚度边压暗）取代方块那套 `FACE_SHADE`；几何体 `translate(0, ITEM_SIZE/2, 0)` 让**底边落在挂点上**（手握柄）；新增 `SPRITE_HOLD_ROTATION = [0.1,-0.55,-0.32]` 与 `BLOCK_HOLD_ROTATION` 分开，方块仍握中间。顺手把 1455 那份只为"双面面片"存在的 `spriteMaterial` 删了（薄盒子正反面都是真实几何，两份材质只会漏改亮度）。
  - 为什么：用户要三件事——柄在手里（底边贴锚点）、有厚度（0.05）、别把图标拉成彩带（侧面压暗到 0.62，让它读作"边的暗面"而不是再来一遍图标）。
  - 验证：`npx tsx tools/render-test.ts` **254 通过 / 0 失败**（把 1455 的 5 条改成 6 条：薄盒子厚度区间、尺寸 0.44、`min.y≈0 且 max.y≈0.44`、方块仍居中、侧面 0.62 / 正面 1、两套握持姿态各自成立）；`npm run typecheck` 通过。
  - 批次：20261024-1531
- [x] [修9] 空装备槽只保留部位图标，**去掉点击后的介绍文案**：`ui/InventoryScreen.ts` 删 `armorSlotPartName` 与提示分支、六个语种删 `inventory.armorEmptyHint` → `npm run test:ui` + `npm run test:i18n`（断言：不再有 `armorEmptyHint` 键与提示分支，槽位仍画图标）
  - 做了什么：删掉 `handleSlotClick` 里那条"点空装备槽给提示"的分支、`armorSlotPartName()` 方法与 `ARMOR_PART_KEYS` 常量；六个语种同步删 `inventory.armorEmptyHint`（表回到 2864 键）。空槽里那五枚部位剪影图标**保持不变**。
  - 为什么：用户："装备空槽有了，只需要显示放置什么就可以了，不用介绍。" 图标本身已经说明这一格放什么，再弹一句等于把说明写两遍。
  - 验证：`npx tsx tools/ui-test.ts` **964 通过 / 0 失败**（把 1455 那 2 条"要有提示"改成 1 条"不弹介绍、图标仍在"）；`i18n-test` 547 通过、`audit:i18n` 六语言 2864/2864；`typecheck` 通过。
  - 批次：20261024-1531
- [x] [修10] 配方书与左栏滚动条按用户确认的口径恢复（**口径待确认**：见回复里的 A/B 选项）→ `npm run test:ui`（按选定口径写断言）
  - 做了什么：① 配方书按用户选的 **B** 恢复：标题栏那颗键回到"只切物品分类"——在仓库里 → `openPocketCategory(lastRecipeTab)`（首次是"全部/放大镜"），已在分类栏 → 切"列出未拥有（红底）/ 只看能做的"；那颗键**完全不碰配方书**（书仍只能由 R 键或自己的 ✕ 手动开关，且是整屏那一层）。② 滚动条按用户选的 **A** 拆回两栏各自一套：`syncCategoryScrollbar` 贴内容右缘（`SCROLLBAR_CONTENT_GAP = 8`、7px 宽），`syncCreativeScrollbar` **不写 left**、交给 CSS 新增的 `.inv-creative-section .inv-category-scrollbar { right: 2px; width: 6px; }`；两者都保留 1455 那次修正的"rect 相减定位"与 24px 滑块下限（`offsetTop` 取决于 offsetParent，正是创造栏错位的根因）。
  - 为什么：用户确认"那颗键只切分类、不弹书"（B）与"回到两栏各自一套"（A）。保留 rect 定位是因为"各自一套"指的是**位置/宽度口径**分开，不是把已知会错位的算法抄回来。
  - 验证：`npx tsx tools/ui-test.ts` **964 通过 / 0 失败**（改 5 条：那颗键只切分类且不碰 `onOpenRecipes`、分类栏里切 `showUnowned`、R 键仍独自开关书、两栏各自一套 + 创造栏交给 CSS `right: 2px`、创造栏不写 left、两处 rect 定位）；`typecheck` 通过。
  - 副作用（按用户口径接受）：手机上配方书没有入口了（只剩 PC 的 R 键），与改动之前一致。
  - 批次：20261024-1531
- [x] [自审] 审这一批的三层（L1 可测量 / L2 可对抗 / L3 可外部）→ 写 `- L1：` / `- L2：` / `- L3：` 各一句 + 证据
  - L1：3 条各自都有会红的断言——手持刀剑 6 条（薄盒子厚度区间、尺寸、**底边贴锚点**（包围盒 min.y≈0）、方块仍居中、侧面压暗/正面满亮、两套握持旋转各自成立）、空槽去介绍 1 条（不再有 `armorEmptyHint` 与提示分支，图标仍在）、配方书+滚动条 6 条（那颗键只切分类且不碰 `onOpenRecipes`、分类栏切 `showUnowned`、R 键独自开关书、两栏各自一套、创造栏交给 CSS `right: 2px`、创造栏不写 left）+ 滚动条 2 条（两处 rect 定位、JS/CSS 滑块下限同为 24）。`render-test` 253 → **254**、`ui-test` 964。
  - L2：本批做了**两次故意破坏**并确认变红——① 删掉 `geometry.translate(0, ITEM_SIZE/2, 0)`（让物品回到"捏在图标正中"）→ "扁平物品的底边贴在挂点上" 立刻红（实测 `y ∈ [-0.220, 0.220]`）；② 上一批已验过的"删 `spriteMaterial` 亮度那行"在本批重构里被合并成一份材质，旧的"两份材质同时变暗"断言已随材质合并一起删除（不再有可破坏点，属于**减少**而不是漏测）。两次都已还原（`git status` 只有文档）。
  - L3：3 条全部来自用户实测原话（"恢复配方书和滚动条"→ 已用弹窗确认到 B/A；"手应该拿到柄的位置""刀剑也应该有厚度"；"空槽只要显示放置什么，不用介绍"）。我自己定的只有实现参数——厚度 0.05、侧面亮度 0.62、握持旋转 `[0.1,-0.55,-0.32]`、创造栏 2px/6px。其中**握持旋转**是唯一没法离线验证的（要看实际视角弧度），已在注释里标明来源，如果手感不对只需改这一个常量。
  - 排除记录（找过但不算问题）：① 手机上配方书没有入口——这是 B 口径的必然结果，写进 decision D2 并告知用户；② 方块仍握在中间而不是"底边贴手"——用户只说刀剑要握柄，方块握中间才符合原版观感；③ 创造栏滚动条不写 `left` 会不会在 PC 上错位——PC 那条 `body:not(.touch-mode)` 规则已在 1455 删除，现在两栏共用同一套 `right` 兜底。
  - 批次：20261024-1531

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

