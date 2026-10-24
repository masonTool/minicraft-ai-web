# 队列 · 会话 3da8ce2b3c274afab7e49dacec06de30

> 状态：执行中
> 创建：2026-10-24
> 批次：20261024-1455

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
- [ ] [修5] 首页在矮屏上把标题挤出屏幕：`index.html` 首页图标/间距改成随视口高度收缩（clamp + dvh）、`.world-panel[data-view='home']` 允许内部滚动 → `npm run test:ui`（断言：logo 字号含 vh 项、菜单间距含 vh 项、home 视图有 `overflow-y: auto`）
- [ ] [修6] 背包面板在矮屏上压到快捷栏：`index.html` 用 `--inv-pocket-h` 与 `#inventory-screen` 的 padding 给底部 dock 让位 → `npm run test:ui`（断言：`--inv-pocket-h` 里扣掉了 dock 高度、`#inventory-screen` 有底部安全区 padding）
- [ ] [修7] 设置里的游戏模式下拉：只列了生存/创造两种、且回调是"切换"而不是"切到选中的那个"：`ui/SettingsScreen.ts` + `main.ts` → `npm run test:ui`（断言：选项来自 `GAME_MODES` 四种、回调签名收 mode、main 里接的是 `setGameMode(mode)`）
- [ ] [自审] 审这一批的三层（L1 可测量 / L2 可对抗 / L3 可外部）→ 写 `- L1：` / `- L2：` / `- L3：` 各一句 + 证据
