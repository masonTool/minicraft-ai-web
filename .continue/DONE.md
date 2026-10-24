# 完成档案 · DONE

> 本文件是**已完成工作的唯一档案**，只回答"这批做了什么、怎么验的"——时间线，最近的在最上面。
> 按模块看现状与坑 → `OVERVIEW.md`；下次怎么避开 → `TIPS.md`；机制与格式 → `README.md`。
> **一条内容只写一个地方**，别在三份文档里各抄一遍。
>
> 收尾时**整份队列原样搬进来**（含每条任务下方的完成说明与 `[阻塞]`），标题格式
> `## 批次 <号> · 日期 · 会话 <前 8 位>`。

---

## 批次 20261025-0316 · 2026-10-25 · 会话 7e09a4a8

> 上架 Google Play 的版权 / 商标处置（7 条）。
> ⚠️ 本批的 **7 个代码提交**信息里写的是 `20261025-0117`（开工时钩子注入的号，与另一个会话同分钟开工撞号），
> 归档时用 `queue-init --new-batch` 换成本号以满足「批次号唯一」；
> 按批次 grep 提交请用 `20261025-0117`。

> 状态：执行中
> 创建：2026-10-25
> 批次：20261025-0316

- [x] [合规1] 清掉对外文案里的「Minecraft / 我的世界 / 基岩版」字样：`public/manifest.webmanifest` 的 description 换成与商店短描述一致的说法、`package.json` 的 description 同步 → `npm run check:manifests` 通过，且 `grep -rn "我的世界\|基岩版" public/ package.json` 零命中
  - 做了什么：manifest description 改成「浏览器里的方块世界：无限地形、生存与创造、多世界存档，无需安装」（与 `docs/store/zh.md` 的短描述同一句）；`package.json` description 改成「方块沙盒（Web / WebGL2）：无限地形、生存、合成与联机」；顺手把六语言 `itemDesc.ts` 里 `item.desc.chain` 的「基岩版里 / In Bedrock / В Bedrock…」改成不指名版本的说法
  - 为什么：真正会出现在用户设备上的只有 manifest description（安装提示/启动器），先把这一处清掉；`item.desc.chain` 是**会显示在物品说明里**的句子，直接写竞品版本名等于自己递证据。`docs/store/` 六份文案复查后确认**本来就没有**商标字样（唯一出现 Mojang / Microsoft 的地方是那句免责声明，保留），所以没动文件
  - 验证：`npm run check:manifests` 通过（5 份语言文件与基准一致）；`npm run audit:i18n` 通过（六语言 100%）；`npm run test:i18n` 550/0；`grep -rn "基岩版\|Bedrock" src/core/i18n/locales/*/itemDesc.ts` 零命中（`item.bedrock` 是方块名「基岩」，属于术语表，按 D3 不动）
  - 批次：20261025-0316
- [x] [合规2] 重写 33 条照抄原版的成就标题（6 语言共 198 条），保留 id 与触发逻辑：`src/core/progress/advancementText.data.ts` + `src/core/i18n/locales/{zh,en,de,fr,pt,ru}/advancement.ts` → `npm run test:i18n && npm run test:advancement && npm run audit:i18n`
  - 做了什么：33 条里 **30 条**换掉（`石器时代`→`第一块圆石`、`来硬的`→`第一炉铁`、`西装革履`→`穿上胸甲`、`冰桶挑战`→`水浇岩浆`、`我们需要更深入些`→`走进下界`、`资深怪物猎人`→`狩猎清单`、`村庄英雄`→`村庄救星`、`腥味十足`→`钓上来一条`、`涂蜡`→`涂上蜂蜡`…），六语言各 30 条 + `advancementText.data.ts` 的英文副本 30 条，共 210 处；另把 `story/root` 的英文从原版的 `Minecraft` 改成品牌名 `Minicraft`（中文侧本来就是品牌名）。id、parent、tab、desc、trigger 全部未动
  - 为什么：这 33 条的英文标题与原版逐字相同（中文也基本沿用官方译名），是唯一"成体系照抄官方本地化"的地方；其余 67 条是本项目自创进度，标题也是自创，按 D2 不动。**3 条刻意保留**：`story/root` 是品牌名；`nether/root`（下界）与 `end/root`（末地）是维度专名，属于 D3 判定不动的术语表，改了会与界面上其它地方不一致。改法上刻意避开原版的**双关/梗**（`Isn't It Iron Pick`、`Bring Home the Beacon`、`The Cake Is a Lie` 那类），改成陈述机制的说法，这样连"创造性表达"也不沾
  - 验证：`npm run test:i18n` **550/0**（含三条硬约束：中文标题与 `advancements.ts` 原文逐条相等、de/ru/fr/pt 不含中文且与英文相同的 ≤10 条、法语不许出现 ASCII 撇号——第一次跑就靠这条抓到 3 处 `l'` 应为 `l’`）；`npm run test:advancement` **116/0**；`npm run audit:i18n` 六语言 2894/2894 通过；`npm run typecheck` + `typecheck:tools` 清洁；30 条新标题在 zh/en 表内无重复
  - 批次：20261025-0316
- [x] [合规3] 10 幅画改名 + 按自创构图重画（去掉 Zetterstrand 原作的构图对应，`大金刚` 必删）：`src/core/registry/paintings.ts` + `src/render/TextureAtlas.ts` → `npm run test:painting && npm run test:textures`
  - 做了什么：1×1 七幅换成 `日出 / 河谷 / 远山 / 夜空 / 篝火 / 孤树 / 沙丘`（dawn / river / hill / night / campfire / tree / desert），多格三幅换成 `壁画 4×4 / 挂毯 4×3 / 旧海图 2×2`（mural / banner / chart，**大金刚直接消失**）；`TextureAtlas` 的七张 painter 与 `MULTI_PAINTING_ART` 全部按新构图重写（矩形清单，无任何一幅对应他人作品）；`atlasLayout` 的七个 tile 名同步；旧多格画名做成了**只读别名** `LEGACY_MULTI_NAMES`，老存档里的大画仍能读回来；顺手修掉六语言里已经过期的「画」物品说明（还写着"只有 7 幅、多格大画没做"）与 `TASKS` B14 的差异说明
  - 为什么：这 10 幅原来是照着 Zetterstrand 的署名画作摆的构图（名字也照抄），"认得出是哪一幅"就是改编，`大金刚` 还叠了任天堂形象。**只换画面与名字、保留尺寸档位与 1×1 的下标顺序**（D9）：尺寸是玩法，下标进方块状态，调序会让老存档里挂好的画集体换脸。多格画的名字进存档，所以用别名而不是硬改（D10）
  - 验证：`npm run test:painting` **66/0**（新增 6 条别名断言：三个旧名字各自映射正确、旧名字尺寸仍是 4×4、别名目标都在表里、现用名字不在别名键上）；`npm run test:textures` **33/0**；`npm run test:frame` **169/0**（`describeState` 的「贴北墙·炸弹」→「贴北墙·篝火」随名字改）；`npm run test:i18n` 550/0、`audit:i18n` 2894/2894 通过（物品说明改了六语言）；`typecheck` + `typecheck:tools` 清洁；`npm run audit:diffs` 重算了差异台账
  - 批次：20261025-0316
- [x] [合规4] 设置页补「非官方 · 与 Mojang / Microsoft 无关」声明 + 资源包免责（只导自己拥有的包）：`src/core/i18n/locales/*/settings.ts` + `src/ui/SettingsScreen.ts` → `npm run test:settings && npm run test:ui && npm run audit:i18n`
  - 做了什么：新增两条键 `settings.notice`（设置页底部：非官方、与 Mojang / Microsoft 无关、贴图与音效全部由代码生成）与 `settings.resourcePack.hint`（资源包行下方：只能导入你自己拥有的包，本应用不提供也不分发官方素材），六语言各一份；`SettingsScreen` 加 `makeFooterNotice()` / `makePackHint()` 两个节点（footer 用 `prepend` 插在"恢复默认"之上，不动原有组装顺序）；`index.html` 加 `.settings-notice` / `.settings-note` 两条样式（10px 灰字，触屏横屏降 9px）
  - 为什么：首页那句"非官方"页脚被用户按审美删过（批次 20261024-1152），但商店版本必须有一个**用户自己找得到**的免责位置——放设置页底部：不占首屏、六语言都有、投诉时能指出来。资源包那一行单独加免责，是因为它长期被当作"换个官方外观"的入口，法律上只能导自己的包（D6）。措辞刻意只讲"与谁无关 + 素材由代码生成"，不写"复刻的是哪个游戏"——写清对象等于自认使用了他人作品
  - 验证：`npm run test:settings` **119/0**；`npm run test:ui` **979/0**（新增 1 条断言：三条链路都得在——源里引用两个键、CSS 有两条样式、六语言表里都有这两条键，少一处就红）；`npm run audit:i18n` 六语言 2896/2896 通过；`npm run test:i18n` 550/0；`typecheck` + `typecheck:tools` 清洁
  - 批次：20261025-0316
- [x] [合规5] 读档容错：不认识的方块 / 物品 id 跳过并记日志，不再整档失败：`src/core/save/` → `npm run test:save && npm run test:migration`
  - 做了什么：新增 `src/core/save/SaveIssues.ts`（纯数据记账本：按 `种类|细节` 累加、最多 32 种、溢出只计数、可清零）；三条读档路径接上——`ChunkEdits.applyTo()` 遇到注册表里不存在的方块 id **不写世界**（保留地形）并记账、`Inventory.restoreStack()` 丢掉不认识的物品 id 时记账、`Paintings.restorePaintings()` 跳过认不出的画名时记账；`SaveGame.open()` 打开世界时清零；诊断日志的 `meta.saveIssues` 带上这份账
  - 为什么：存档里的方块与物品都是**数字 id**，所以改命名空间其实不会让老档读不回来（这条顺带纠正了我原先的判断）；真正会丢东西的是"这个 id 当前版本不存在了"。三种路径原本都是**静默**处理：方块回退成空气（那一片被挖空）、物品直接消失、画跳过——静默是对的（不能因为一个坏 id 让整档打不开），但必须留痕，否则玩家报"我的东西没了"时导出日志里查不到任何线索
  - 验证：`npm run test:save` **120/0**（新增 8 条：不认识的方块不写世界且保留地形、记账 detail 正确、不认识的物品丢掉且记账、同一 id 累加而不新增、总数含重复、清零后归零、清单为空）；`npm run test:migration` 28/0；`npm run test:diag` 89/0；`npm run test:unit` 全绿；`typecheck` 清洁
  - 批次：20261025-0316
- [x] [合规6] 内部命名空间 `minecraft:` 换成自有前缀（方块 / 物品 / 命令 / 联机协议 / 存档一起）：`src/core/registry/*`、`src/core/commands/*`、`server/` → `npm run check`（全量 177 套）
  - 做了什么：新增 `src/core/registry/ids.ts`（`NAMESPACE = 'minicraft'` + `normalizeId()` / `shortId()` / `hasNamespace()`，旧前缀只用于**读**）；全局替换 1100 处字面量（87 个 .ts + `tools/*.js` 的验收脚本）；所有"按名字查表 / 去前缀"的地方改用 `shortId()`（`itemNames` 7 处、`advancementText` 4 处、`AudioEngine` 4 处、`CommandHelp` 3 处、`StatusEffects` 1 处、`structureNames` 1 处、`food` 1 处、`main` 2 处）；命令解析入口（`resolveItemId` / `resolveBlockId`）先 `normalizeId()` 再查，所以 `/give minecraft:stone`、`/locate structure minecraft:village` 这类**老文本仍然可用**（`command-test` 里恰好就有这两条用例）；进度读档把老 id 归一化（否则达成记录整片消失）
  - 为什么：命名空间是内部标识符，但本项目是独立产品，没必要继续借用别人的前缀。**顺带发现一处真正在用户眼前的东西**：进度页第一个页签的标题原本是「我的世界」、英文是「Minecraft」，已改成「方块世界」/「Block World」（页签 id `minecraft` → `world`）——这才是这次改名前唯一会被玩家看见的商标痕迹
  - 验证：`npm run test:offline` **176/176 套全绿**（85.4s）；`npm run test:unit` 372/372；`npm run test:advancement` **120/0**（新增 4 条：旧前缀的达成记录读得回来、旧→新 id 映射、计数进度也接上）；`npm run test:i18n` 550/0；`npm run audit:i18n` 2896/2896 通过；`typecheck` + `typecheck:tools` 清洁。排查中还修了两处被漏掉的正则（`CommandHelp` 的 `replace(/^minecraft:/)`、`bastion-test` 里逗号连写的混合字符串）
  - 批次：20261025-0316
- [x] [合规7] 补 `LICENSE` + `THIRD-PARTY-NOTICES`（three / ws 的 MIT）+ 隐私政策页（Play 强制）：根目录新增文件 + `docs/privacy.md` → `npm run build` 产物内可检索到三份声明
  - 做了什么：新增 `LICENSE`（保留所有权利，含"不得改名二次上架 / 不得用于商业分发"条款）、`THIRD-PARTY-NOTICES.md`（three.js 0.186.1 与 ws 8.22.0 的完整 MIT 原文）、`public/third-party-notices.txt`（同内容纯文本，`vite build` 会复制进 `dist/`）、`public/privacy.html`（中英双语隐私政策：不收集个人数据、存档只在本地、联机的数据交换范围、第三方组件、变更与联系方式）；`README` 的「许可」节补三条指引
  - 为什么：MIT 要求"分发物中保留版权声明与许可全文"，网页版的"分发物"就是 `dist/`，所以声明必须放在 `public/`（只放仓库根目录等于没分发）；隐私政策是 Play 的**必填项**，需要一个可公开访问的 HTTPS 链接，而 `/privacy.html` 就是这个项目自己的站点路径，比外链第三方托管更不容易失效。隐私文案按**代码实际行为**写（无账号、无统计/广告 SDK、存档仅在 IndexedDB/localStorage）
  - 验证：`npm run build:fast` 后 `dist/privacy.html`（5.7KB）与 `dist/third-party-notices.txt`（3.4KB）都在；`npm run test:ui` **980/0**（新增 1 条断言：两份文件都在 `public/` 且声明里有 three.js authors / Einar Otto Stangvik）；`npm run audit:docs` 通过；`npm run check:manifests` 通过；`typecheck:tools` 清洁
  - 批次：20261025-0316

## 批次 20261025-0117 · 2026-10-25 · 会话 203dac00

- [x] [U1] 删掉玩家可见的建造入口与全部建造工具（C2~C5）：删 `src/ui/BuildToolbar.ts`、`src/ui/buildToolbarLayout.ts`、`src/buildtools/{Selection,Fill,Clipboard,templates}.ts`；`src/main.ts` 删对应 import / `buildMode` / `buildRequest` / `buildToolbar` 字段与构造回调 / `refreshBuildToolbar` / 选区-填充-复制-粘贴-镜像-模板 的全部方法（`selectCorner` `clearSelection` `startFill` `stepFillRunner` `cancelFill` `copySelection` `pasteClipboard` `placeTemplate` `stepPasteRunner`）与每帧调用 / `setBuildModeForTest` `buildToolbarStateForTest`；Esc 面板分支、左键选区分支、`updateArmSwing` 与 `updateBreaking` 里的 `buildMode` 判断一并删；`index.html` 删 `/* ---------------- 建造工具（创造5 …` 到 `.build-page.hidden { display: none; }` 整段 CSS → `npm run typecheck` 通过且 `npm run check:fast` 全绿
  - 做了什么：删 `src/ui/BuildToolbar.ts`、`src/ui/buildToolbarLayout.ts`、`src/buildtools/{Selection,Fill,Clipboard,templates}.ts`、`tools/buildtools-test.ts` 与 `package.json` 的 `test:buildtools`；`main.ts` 去掉 6 条 buildtools import、选区/填充/剪贴板/粘贴/建造模式 6 个字段、`BuildToolbar` 构造回调 70 行、`创造2~4` 的 12 个方法（`selectCorner`…`placeTemplate`）、`refreshBuildToolbar`、Esc 面板分支、左键一次性请求分支、`updateArmSwing`/`updateAttacking`/`updateBreaking` 三处 `buildMode` 判断、每帧 `setAvailable`+`stepFillRunner`+`stepPasteRunner`、`dispose()`、`FILL_UNDO_LIMIT`，以及 10 个 `*ForTest` 接口；`index.html` 删 123 行建造抽屉 CSS。
  - 为什么：用户要"打开就是原版那套操作"，所以整个功能簇（界面 + 工具能力）一起删，不留死代码。**偏离原计划的两处**（都为了让这条提交自己就能编译通过）：① `tools/buildtools-test.ts` 的 5 个 import 全指向被删的模块，`typecheck:tools` 与离线 runner 都会红，所以测试的删除从 U3 提前到这里（U3 只剩文案与 `AGENTS.md` 套件数）；② `tools/texture-test.ts` 有一条静态断言读 `main.ts` 里的 `new BuildToolbar(` 位置，换成 `new CommandBlockEditor(`（守的仍是"图集铺像素早于 UI 构造"这条次序）。`BlockIcon.ts` 与 `texture-test.ts` 的历史注释同步标注"该界面已移除"。
  - 验证：`npm run typecheck` 通过；`npm run typecheck:tools` 通过；`npm run check:fast` 全绿（vitest 372 条 + 离线 176/176 套，套件数已从 177 掉到 176）。浏览器手验留到整批收尾前统一做。
  - 批次：20261025-0117
- [x] [U2] 删掉撤销 / 重做（C1）与 Ctrl+Z / Ctrl+Y：删 `src/buildtools/UndoStack.ts`；`src/main.ts` 删 `undoStack` 字段、`undoAllowed` `undoBegin` `undoEnd` `undoRecord` `undoPush` `undoLast` `redoLast` `applyUndoStep` 与 `undoStateForTest`，以及破坏/放置路径上 24 处 `undoBegin/undoRecord/undoPush/undoEnd` 调用、`switchDimension` 里的 `undoStack.clear()`、键盘 Ctrl+Z / Ctrl+Y 分支 → `npm run typecheck && npm run check:fast` 全绿（重点回归：徒手破坏、放方块、门/床/旗/甘蔗整块破坏）
  - 做了什么：删 `src/buildtools/UndoStack.ts`（`src/buildtools/` 目录随之空掉，整个目录消失）；`main.ts` 去掉 import、`undoStack` 字段、`undoAllowed`/`undoBegin`/`undoEnd`/`undoRecord`/`undoPush`/`undoLast`/`redoLast`/`applyUndoStep` 八个方法、`UNDO_WAKE_LIMIT` 常量、Ctrl+Z / Ctrl+Y 两个键盘分支、`undoForTest`/`redoForTest`/`undoStateForTest`、`switchDimension` 里的 `undoStack.clear()`；破坏路径 4 处 `undoBegin/undoEnd` 配对（门 / 旗 / 床 / 海带-甘蔗-脚手架整柱）、`breakBedPair`/`breakDoorPair`/`breakBannerPair`/`breakColumn` 里的 `undoRecord`、主破坏路径那 1 处、放置路径 3 处（`mergeInto` / `mergeIntoTarget` / 普通放置的 `undoPush`）。
  - 为什么：撤销在原版就没有，它是建造工具的一半；留着等于一套"只有快捷键、没有入口"的隐藏功能，与"别复杂"相反。删法上有个易错点：`undoRecord(bx, by, bz, id, state, …)` 里的 `state` 是**专为撤销读的**，删调用后这四个局部 `const state` 就没人用了（`noUnusedLocals` 会红），所以连同一起删——但 `breakBannerPair` 开头那个 `state` 还喂 `isBannerTop()`，保留。放置路径的 `placeBeforeState`/`extraBeforeId`/`extraBeforeState`/`mergeBeforeId`/`mergeBeforeState`/`targetBeforeState` 同理，都是"写入前读一份给撤销用"，一并删。
  - 验证：`npm run typecheck` 通过；`npm run check:fast` 全绿（vitest 372 条；离线 runner 报"本次改动没有离线套件覆盖 `src/main.ts`"，属预期——这条是浏览器行为）；逐处确认过删掉的都是纯旁路记录语句，主线（破坏分支的 `return`、放置分支的 `setBlockAndUpdate` / `queueBlockChange` / 掉落实体）一行没动。
  - 批次：20261025-0117
- [x] [U3] 删文案与套件数：六语言 `src/core/i18n/locales/{zh,en,de,ru,fr,pt}/editor.ts` 删全部 `buildtools.*` 与 `template.*` 键（含文件头注释里的 buildtools 说明），`tools/i18n-test.ts` 里两条用 `buildtools.fill.done` 验复数配合的断言换成仍存在的同形键；`AGENTS.md` 的「N 套离线测试」按实际套件数改（测试与 `test:buildtools` 已在 U1 删掉，177→176，以 `npm run audit:tasks` 的报错为准，不要手猜）→ `npm run typecheck && npm run test:i18n && npm run audit:tasks` 全绿
  - 做了什么：六语言 `editor.ts` 删掉 `buildtools.*` 与 `template.*` 共 59 条/语言（zh 62 行含三处分组注释），并清掉 `buildtools`/`template` 相关的分组注释与残留空行；四种语言的 `plural.ts` 删掉 4 条 `buildtools.*.done` 复数表与那条分组注释；`tools/i18n-test.ts` 里葡/法两条"过去分词跟着配合"的断言原本就拿 `buildtools.fill.done` 当样本，改成 `station.brewLeft`（保住"复数表里第二条键也走同一套"这条覆盖）；`README.md`/`AGENTS.md`/`.continue/HANDOFF.md` 的「177 套」→「176 套」共 8 处。
  - 为什么：键删了但 `plural.ts` 与测试还引用，会分别变成"指向不存在键的复数表"和 `t()` 回落原文的假绿，所以三处必须同一条提交。套件数由 `audit:tasks` 从 `package.json` 现算，它只校 README，但 AGENTS/HANDOFF 是入口文档，一起改免得下次对不上——`npm run audit:tasks` 现在会输出「README / HANDOFF / AGENTS 的离线测试套数都与 package.json 一致（176 套）」。
  - 验证：`npm run typecheck` 通过；`npm run test:i18n` 547 通过 / 0 失败；`npm run audit:tasks` 全绿（含套数一致性）；`npm run check:fast` 全绿（vitest 372 条 + 离线 155/155 命中套）。`grep -rn buildtools src/ tools/` 已无残留。
  - 批次：20261025-0117
- [x] [U4] 文档与台账收尾：`.continue/HANDOFF.md` 删「建造工具条只在建造模式接管左键」那半句；`.continue/OVERVIEW.md` 删建造工具条条目；`.continue/TASKS.md` 把创造1~5 对应条目改掉（本项目扩展、不属差异台账），按脚本口径更新覆盖率；`.continue/notes/kids-features.md` §3.2 加一行「后续变更：已整体移除（批次 20261025-0117）」但**保留决策留档原文**；`.continue/notes/modules.md` 有建造模块条目则同步 → `npm run check` 全绿（含三张台账）
  - 做了什么：`HANDOFF.md` 里"低龄向三块"改成"两块"并写明建造工具已在批次 20261025-0117 整体移除；`OVERVIEW.md` 删掉「建造工具 = 44×56 总开关 + 模态抽屉」整条，坑那一行里"建造工具条 92×236 压住跳跃键"的例子保留但标注"该工具条已移除、教训对任何边缘浮动面板仍成立"；`notes/kids-features.md` §3.2 加 `> 后续变更（批次 20261025-0117）：已整体移除` 引用块，C1~C5 表格与原文**一字未改**。
  - 为什么：这三处是"当前状态"描述，留着会让人以为还有建造模式；`kids-features.md` 是决策留档，只加"后来怎样了"，不重写当时的理由。`TASKS.md` 与 `notes/modules.md` **没动**：查过全表，创造1~5 从来没有登记成 A~O 条目（唯一相关的是 20261024-0344 那条已完成记录，属历史事实），`modules.md` 也没有建造模块条目——覆盖度 / 差异 / 提交总数三张台账都是脚本现算的，手改只会漂。
  - 验证：`npm run check` 全绿（typecheck + audit:i18n + vitest 372 + 离线 176/176 套 + audit:tasks/coverage/diffs/docs）；`BROWSER_CHECK=1 npm run check:browser` → 「控制台干净：跑 15 秒，0 条错误（含进世界）」，即删完后进创造世界不报错。
  - 批次：20261025-0117

---
## 批次 20261025-0105 · 2026-10-25 · 会话 75e33034

- [x] [P1] 新建 `say` 文案分组（六语言）+ 把「状态与战斗」类聊天消息接线：新增 `src/core/i18n/locales/{zh,en,de,ru,fr,pt}/say.ts` 并注册进六份 `index.ts`，`src/main.ts` 的伤害/回血/饥饿/氧气/着火/盾牌/不死图腾/极限模式/重生回退 18 条消息改走 `t()`/`tp()` → `npm run typecheck && npm run test:i18n`
  - 做了什么：新建 `locales/*/say.ts`（`say.*` 键，六个语言各 19 条）并加进六份 `index.ts` 的合并；`main.ts` 的 `emitPlayerNotices()` 整段（伤害/生命/饥饿/氧气/着火）+ 盾牌破防与碎裂 + 不死图腾 + 极限模式死亡 + 重生回退两条改走 `t()`/`tp()`
  - 为什么：聊天栏（左上角弹出那一行与展开后的记录）是**唯一"字符串进来就显示"的出口**，硬编码中文一走进去就是"界面全英文、左上角冒一句中文"，而参数是 `string`，类型系统抓不到
  - 验证：`npm run typecheck` 通过；`npm run test:i18n` 547 通过 / 0 失败；`npm run audit:i18n` 六语言 2883/2883、✓ 审计通过；`npm run test:ui` 978 通过（两条按中文字面量匹配的断言改成按键 + 回中文表核对措辞）
  - 批次：20261025-0105
- [x] [P2] 把「交互与方块」类提示接线（牛奶/药水/箭/花盆/盔甲架/唱片机/音符盒/容器被压/重生锚/磁石/交易/睡觉/钓鱼/幻翼/断开联机/种子不一致）：`src/main.ts` + `core/survival/Sleep.ts` + `core/registry/villagerTrades.ts` 改用文案键 → `npm run test:i18n && npm run test:sleep`
  - 做了什么：44 条搬进 `say.*`（六语言）；药水名改 `itemLabel(potion.id)`、效果清单走 `joinList()`；花盆取物改 `itemLabel(植物物品)`；钓鱼提示的 2 秒取 `BITE_WINDOW_SECONDS`；单/多两条钓鱼模板分开（`×N` 在各语言里位置不同）；`sleepRefusal()` / `tradeBlocker()` 保持返回句子、内部查表
  - 为什么：这些句子散在 20 多个 `this.chat.push(...)` 里，含变量的一律走 `tp()`（不在调用处拼串）；`sleepRefusal` / `tradeBlocker` 的调用点各只有一处，改成原因码会让 `bed-test`(4 条) 与 `villager-test`(3 条) 白改
  - 验证：`test:bed` 117 / `test:villager` 233 / `test:fishing` 110 / `test:anchor` 21 / `test:note` 23 / `test:commandblock` 26 / `test:ui` 978 全绿；`test:i18n` 547 通过
  - 批次：20261025-0105
- [x] [P3] 把「世界事件与天气」类播报接线（袭击/巡逻队/铁傀儡/凋灵/末地门/进度/效果/不祥之兆/天气四句）：`src/main.ts` + `core/world/WeatherState.ts` → `npm run test:i18n && npm run test:weather`
  - 做了什么：21 条搬进 `say.*`（六语言）；进度播报的标题与说明改走 `advancementTitle()` / `advancementDesc()`；效果等级走 `{level}` 占位（无等级传空串）；`weatherNotice()` 保留判据、句子取值时查表
  - 为什么：进度播报原来直接读 `def.title` / `def.desc` 的中文原文，英文模式下会出现"Advancement made: 石器时代——用镐挖一块圆石"这种半截混排（与 Q16 修成就面板是同一个根因，只是漏了聊天栏这条）
  - 验证：`test:weather` 58 / `test:raid` 34 / `test:advancement` 116 / `test:effects` 68 / `test:survival` 111 / `test:villager` 233 / `test:ui` 978 全绿；`test:i18n` 547 通过
  - 批次：20261025-0105
- [x] [P4] 聊天面板「展开」角标改成可翻译 + 加硬编码守卫：`index.html` 的 `content: '展开'` 改 `attr(data-expand-badge)`、`ui/ChatInput.ts` 写入、`tools/i18n-test.ts` 断言 `chat.push()`/`hudToast.show()` 字面量不再含中文 → `npm run test:i18n`
  - 做了什么：新增 `chat.expandBadge`（六语言）；`index.html` 改成 `content: attr(data-expand-badge)`；`ChatInput.renderLog()` 在行确实被截断时写 `dataset.expandBadge`（放得下就摘掉）；`i18n-test` 新增 3 条守卫（聊天出口不吞中文字面量 / `index.html` 的 CSS `content` 无中文 / 角标走属性 + 键），`ui-test` 那条按 `content: '展开'` 匹配的断言跟着改
  - 为什么：静态 CSS 不参与切语言重绘，角标写死在样式表里英文模式永远显示「展开」；而守卫挡的是整类问题——`chat.push` / `hudToast.show` 的入参直接落 DOM，漏一条就是一句中文，类型系统看不见
  - 验证：`npm run test:i18n` 550 通过 / 0 失败（新增 3 条）；`npm run test:ui` 978 通过；`npm run typecheck` 通过
  - 批次：20261025-0105

## 批次 20261024-2335 · 2026-10-24 · 会话 d19faf6b

- [x] [P1] `tools/run-tests.mjs`：非打包套件（net/guard/screenshot/shotdiff/browser-check）改成按触发文件命中，不再"一律跑" → `node tools/run-tests.mjs --changed` 在干净工作区 0 命中且 <2s；在 `server/` 下放一个临时未跟踪文件后应只命中 net
  - 做了什么：新增 `NON_BUNDLE_TRIGGERS`（net → `server/`；四套工具自检 → 各自的 `tools/x.mjs` + `tools/x-test.mjs` + `tools/browser.mjs`），`--changed` 里 `if (!s.bundle) return true` 换成前缀匹配；没登记的套件保持全跑
  - 为什么：这五套没有 esbuild metafile 才被"一律跑"兜底，而它们恰好最慢且串行（net 12s 真起服务端 + guard 10s 真起浏览器），干净工作区也要 22.3s，内循环因此失效。核对过它们的真实依赖：net 只起 `server/`，四套工具自检只 readFileSync `tools/*.mjs` 与 package.json
  - 验证：干净工作区 `--changed` 739ms / 0 套（原 22.3s / 5 套）；改 `server/index.mjs` → 只命中 net（12.1s）；改 `tools/audit-tasks.mjs` → 0 套（600ms）；全量 `node tools/run-tests.mjs` 177/177 绿
  - 批次：20261024-2335
- [x] [P2] `.continue/hooks/selftest.mjs`：按 `hooks/*.mjs` 内容哈希缓存结论，文件没变时不重复跑 → 连跑两次 `node .continue/hooks/check.mjs hooks` 第二次 <500ms；动一下 `hooks/lib.mjs` 后必须重跑
  - 做了什么：`selftest.mjs` 顶部加内容哈希 + `process.version` 缓存（落盘 `.continue/.logs/.selftest-cache.json`），只缓存通过的结论；`--no-cache` / `CONTINUE_SELFTEST_NO_CACHE=1` 强制真跑，开关登记进 `.continue/README.md` 的可调开关表
  - 为什么：钩子自检每次提交都跑、5.2s，而它只把钩子拷进临时目录灌事件，不读项目里任何别的东西——文件没变结论不可能变。失败不缓存，避免"一次红、永远红"
  - 验证：连跑两次第二次 26ms 且输出带"缓存"字样；给 `hooks/lib.mjs` 追加一行后 5155ms 真跑（未命中）；还原后再次真跑 5220ms；`check.mjs --fast` 的 hooks 项 5.2s → 25ms
  - 批次：20261024-2335
- [x] [P3] 核对整条链路的提速结果并写进 `.continue/TIPS.md` → `node .continue/hooks/check.mjs --fast` 从 32s 降到 ≤8s，`npm run check:fast` ≤5s
  - 做了什么：把四套工具自检的 `tools/` 一把抓细化成逐个文件（改任一 `tools/*-test.ts` 不再触发 10 秒浏览器）；新增 `notes/tips-tooling.md` 条目（兜底规则不能覆盖最慢的几套 + 钩子自检缓存）；修掉 AGENTS.md 里过期的时间数字
  - 为什么：`tools/` 下有 170 多份离线套件入口，一把抓等于"改个测试文件就起浏览器"，粗粒度兜底会把刚省下的时间又吐回去
  - 验证：`node .continue/hooks/check.mjs --fast` 4.0s（原 31.6s）、`npm run check:fast` 3.8s（原 26.2s）；改 `tools/audit-tasks.mjs` 后 `--changed` 0 套 600ms；`git commit` 的提交前门禁 33s → 4s
  - 批次：20261024-2335
- [x] [P4] 修 `npm run check` 因 HANDOFF「提交总数」自指而长期红灯 → `npm run check` 退出码 0（提交总数改成"下限 + 校准点"口径）
  - 做了什么：口径改成 `提交总数 N（锚定 <短哈希>）`，`tools/audit-tasks.mjs` 核对 `git rev-list --count <哈希> === N`，不符时直接打印"重新锚定到当前 HEAD：…"可粘一行；HANDOFF 那一行与 `notes/tips-tooling.md` 的旧"处置"（教人写 HEAD+1，正是死结来源）一起改写
  - 为什么：旧口径要求等于 `git rev-list --count HEAD`，而每个提交都让它 +1，把它改成 `HEAD+1` 的那个提交自己又让 HEAD 变大——自指死结，实测写着 1764、实际 1767，`npm run check` 长期红，每跑一次白等 42s 再去改一个注定追不上的数字
  - 验证：`npm run audit:tasks -- --print` 全绿（"d4340a02 是第 1769 个提交"）；把数字改成 1700 后正确报红并给出建议行；`npm run check` 退出码 0（42s，原 exit 1）
  - 批次：20261024-2335

## 批次 20261024-2156 · 2026-10-24 · 会话 167f6a14

- [x] [修33] 手持武器改成"按图标轮廓挤出的 3D 像素模型"：`src/render/itemModel.ts`（新）+ `HandRenderer` + `PlayerRenderer` + `TextureAtlas.readTile()` → `test:render` 272 通过
  - 做了什么：正反两片按图标的不透明像素逐个出四边形（每片取自己那一格的 UV）；侧壁只在"不透明像素挨着透明像素"的边上生成，厚度跟着轮廓走；掩码先跑两遍 Scale2x（EPX）到 4× 把斜边台阶抹平；侧壁按朝向压暗；四边形绕序按期望法线自动纠正。第一人称挤出 0.035 屏高、第三人称 0.06 格，方块仍是立方体。读不到像素时退回原来的薄盒子。
  - 为什么：用户："手里拿的那个武器能有 3D 的效果、分辨率再高一点、同时增加一点厚度"。旧的 0.52×0.52×0.03 薄盒子只有一块板的厚度，侧看是一条边；手写绕序那版有一半侧壁被背面剔除，画面上是一圈带缺口的"毛刺"。
  - 验证：`npm run test:render` 272 通过（断言改成挤出的实体：顶点数、厚度、内容尺寸、每面单格 UV、侧壁压暗、顶点色与 aShade 同源）；`npm run check` 全绿。**按用户要求，改完不再做浏览器截图自测**，观感由用户手测。
  - 批次：20261024-2156
- [x] [修34] **推翻上一版的几何挤出，改成"烘好的 2.5D 贴图"**：`src/render/heldSprite.ts`（新）+ `HandRenderer` + `PlayerRenderer`（删 `itemModel.ts`）→ `check:fast` 全绿（`test:render` 267）
  - 做了什么：图标按 6 倍（96px）双线性放大 → 平滑边缘；同一张图的纯色剪影沿右下错位叠 22 层（逐层变暗）→ 厚度 ≈ 0.12 屏高；放大后的图标盖在最前。第三人称同源（74px / 10px 厚度）。几何降回一个四边形 + 118×118 小贴图，按物品缓存，切物品只换 `uMap`。
  - 为什么：用户："搞得太丑了……指的是尽量边缘平滑，3D 效果厚一点，不要搞得那么薄、那么单细"。按轮廓挤出在斜视下会让 1/4 像素格的台阶变成一圈毛刺，且厚度受几何精度限制。第一人称手里的东西相对镜头固定，厚度烘进贴图与真几何看不出区别，画布抗锯齿还能给出真平滑。
  - 验证：`npm run check:fast` 全绿（`test:render` 267）；**按用户要求不再做浏览器自测**，观感由用户手测。
  - 批次：20261024-2156
- [x] [修35] **改回"清晰优先"：Scale2x 放大替代双线性；修第三人称看不见**：`heldSprite.ts` + `HandRenderer` + `PlayerRenderer` → `check:fast` 全绿 + 一次浏览器核对
  - 做了什么：图标放大从"双线性 96px"换成 **Scale2x×2（4×）**（补台阶、颜色不变、不糊），贴图关 mipmap、放大用 Nearest；厚度裙边改成"图标自己压暗"（`source-atop`）而不是填灰，厚度 15px → **8px**（≈2 个像素格）。第三人称手持物改 `side: DoubleSide`（它是平面，单面时总有一侧背对镜头被剔除 → 整件消失），握点外移前移、yaw 归零。
  - 为什么：用户："太糊了，起码要像一把剑吧，而且要清晰"+"三人称视角看不到手拿物品了"。双线性放大是糊的根因；第三人称消失是平面 + 单面剔除。
  - 验证：`npm run check:fast` 全绿（`test:render` 267，断言随材质改为双面）；浏览器只跑了一轮（第一人称剑/苹果清晰有厚度、第三人称前后两视角都可见），其余交用户手测。
  - 批次：20261024-2156

## 批次 20261024-2122 · 2026-10-24 · 会话 167f6a14

- [x] [修31] 第三人称手持物变成"交叉的剑"：`src/render/PlayerRenderer.ts` → 前后两种视角逐件截图 + 新增 1 条渲染断言
  - 做了什么：把第三人称手持物的材质从 `side: DoubleSide` 改回默认的 `FrontSide`，并在测试里钉一条断言（`side === THREE.FrontSide`）。顺带把这段坑写进源码注释。
  - 为什么：薄盒子的**正反两面都贴了同一张图标**，开双面渲染之后，从正面看时背面的那张**镜像图标**会透过正面的透明区显出来 —— 斜向的剑于是变成"两把剑交叉"（另一件的面包则变成蝴蝶结）。第一人称那份材质一直是默认单面，所以只有第三人称出问题。
  - 验证：`node .tmp/tp-shot.mjs diamond_sword bread` 在 `third-back` / `third` 两套视角重截：剑是**单刃**、面包是**完整一块**，两侧看都正常；`node .tmp/tp-probe.mjs` 确认物品的世界朝向在两套视角下完全一致（`up`/`fwd` 同一组数），差异只来自镜像；`npm run check` 全绿（`test:render` 270 → **271**）。
  - 批次：20261024-2122
- [x] [修32] 台账：`DONE.md` / `notes/batches.md` / `OVERVIEW.md` 补这条修正 → `npm run check`
  - 做了什么：新增 2122 一节、批次索引一行；OVERVIEW 的手持物条目补一句"第三人称手持物必须单面渲染"。
  - 为什么：这条错误的观感很具体（"交叉的剑"），但根因（透明贴图 + 双面渲染 + 正反同贴）不写下来下次还会犯。
  - 验证：`npm run check` 全绿。
  - 批次：20261024-2122

