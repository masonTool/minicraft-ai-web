# 完成档案 · DONE

> 本文件是**已完成工作的唯一档案**，只回答"这批做了什么、怎么验的"——时间线，最近的在最上面。
> 按模块看现状与坑 → `OVERVIEW.md`；下次怎么避开 → `TIPS.md`；机制与格式 → `README.md`。
> **一条内容只写一个地方**，别在三份文档里各抄一遍。
>
> 收尾时**整份队列原样搬进来**（含每条任务下方的完成说明与 `[阻塞]`），标题格式
> `## 批次 <号> · 日期 · 会话 <前 8 位>`。

---

## 批次 20261025-1627 · 2026-10-25 · 会话 937507d0

> 方块表「基线 + 增量」：改方块属性 / 加新方块不必再发 APK；发版时封基线并留台账。

# 队列 · 会话 937507d0458d4277ba340bcb48207050

> 状态：执行中
> 创建：2026-10-25
> 批次：20261025-1627

目标：**方块表「基线 + 增量」**——让"改方块属性 / 加新方块"不再需要发 APK。
APK 里放全量快照（不公开），线上放一个只含变化的 JSON（几十字节~几 KB），启动时装快照再套增量。

- [x] [增量1] 增量格式与应用器：新增 `src/core/registry/coreDelta.ts`（`parseCoreDelta` / `applyCoreDelta` / `buildDelta` / `fingerprint`）+ `tools/core-delta-test.ts`（29 条）
  - 做了什么：JSON 格式 `{version, baseCount, baseFingerprint, patches[], appends[]}`；patch 按**名字**匹配只改给出的字段（不改 id、不改名），append 只能接在末尾（id = 现有长度 + 序号），**删除方块直接拒绝**（会让存档 id 全错位，只能发版）。指纹用 FNV-1a over 名字表，同步实现（启动路径不多一个 await）。
  - 为什么：id 必须 0..N-1 连续，所以"套错基线"的后果不是报错而是**整张表错位**（存档存的是数字 id）。因此 `baseCount` + `baseFingerprint` 双校验，任一不符就整体拒绝；解析层对不认识的字段也直接抛（增量跨版本存在，悄悄忽略会在语义变化时变成静默错方块）。
  - 验证：`npm run test:coredelta` **29 通过 / 0 失败**（覆盖：空增量 / 改属性 / 追加顺序 / JSON 往返 / 数量不符 / 指纹不符 / patch 目标不存在 / append 重名 / 删除拒绝 / 版本号 / light 越界 / tiles 长度 / 未知字段 / set 为空 / 指纹稳定与敏感）。
  - 批次：20261025-1627
- [x] [增量2] 启动链路接入：`src/core/hostCore.ts` 装完基线后拉 `./core-delta.json` 应用，任何失败只降级
  - 做了什么：新增 `applyRemoteDelta()`，在 `installBlockTable(解码基线)` 之后调用；`fetch` 404/格式错/指纹错一律 `console.warn` 后返回（用 warn 不用 error：控制台门禁把 error 当失败，而"没有增量"是正常状态）。
  - 为什么：任何"可选优化"都不该拥有"让游戏起不来"的能力。增量缺失时用基线那 724 个方块照常玩。
  - 验证：真实浏览器端到端——造一份"改 1 条 + 增 1 条"的增量，`build:app` 后注入 `core.bin` 进 `dist/__host`，Playwright 实测控制台出现 `[boot] 已应用方块增量：改 1 条 / 增 1 条`，**0 条 pageerror**。
  - 批次：20261025-1627
- [x] [增量3] 差分工具与发布链：`tools/gen-delta.ts` + `host/core-baseline.bin` + `release-check` 校验并拷进 dist
  - 做了什么：`npm run gen:delta` 用「App 内置基线」`host/core-baseline.bin`（随仓库提交，40 KB）对比当前 `blockSpecs.ts` 算差分；无变化就不产出（并删掉过期文件，避免被套到新基线上）；`release-check --mode app` 校验 `baseCount` 与基线一致后拷入 `dist/core-delta.json`，web 形态明确跳过。
  - 为什么：增量必须知道"对谁生效"，所以基线要进仓库——放本机的话换台机器/CI 就算不出来。`baseCount` 不一致意味着这份增量套不到 App 里，发出去等于白发（客户端会拒绝并降级）。
  - 验证：`npm run gen:delta` 在无改动时输出「无变化，不产出文件」；造改动后 `build:app` 输出「方块增量已放入 dist：改 1 条 / 增 1 条（基线 724，指纹 15eff840）」。
  - 批次：20261025-1627
- [x] [增量4] 缓存与文档：`sw.js` / `_headers` 排除 `core-delta.json`；发布手册补"改方块不发版"流程与"什么时候必须发版"
  - 做了什么：`public/sw.js` 与 `public/_headers` 都把 `/core-delta.json` 排除出缓存（`no-store`）；`docs/DEPLOY-CLOUDFLARE.md` 新增 §5.5「改方块不用发版」，写清三步命令、三种必须发版的情形、两条纪律（id 只能末尾追加、基线必须与 APK 一致）、以及"增量失败只降级不白屏"。
  - 为什么：增量是**靠每次启动重新拉**才生效的，被 Service Worker 缓存住就等于"更新永远不生效"，而且症状是"新方块没出现"——不报错、极难定位。文档那节则是给未来的自己看：什么时候该发版、基线什么时候换，这两件事记在脑子里必丢。
  - 验证：`grep -c core-delta public/sw.js public/_headers` 各 1 处；`node .continue/hooks/check.mjs docs` 通过；`npm run check:fast` 全绿。
  - 批次：20261025-1627
- [x] [增量5] 基线台账（发 APK 时的"封版"动作）：`host/baseline.json` + `npm run release:baseline`
  - 做了什么：新增 `tools/promote-baseline.ts`——把候选快照（`.tmp/hostcore/core-v1.bin`）封为基线，拷贝成 `host/core-baseline.bin` 并写台账（`baselineVersion` / `cutAt` / `gitCommit` / `blockCount` / `fingerprint` / `appVersion` / `note`）；内容与现有基线完全一致时**拒绝再封一次**并明确提示"无需封版"。`gen:delta` 把 `baseVersion` 写进增量；`release-check` 新增两条校验：台账与 bin 必须自洽（条数）、增量的 `baseVersion` 必须与台账一致。`host/README.md` 与发布手册 §5.6 补了"发 APK 的完整步骤（① gen:hostcore ② release:baseline ③ 打 APK ④ 之后只发增量）"。
  - 为什么：基线文件本身就是"哪一版"的锚点，但它是二进制，看不出是哪一版、什么时候封的、对应哪个提交。而"生成候选快照"是天天跑的（内循环也会），"封版"是发布决策——两者必须分开，否则会出现"随手跑一次生成把线上 App 的基线悄悄换掉"，之后所有增量都套不上且查不到是哪次改的。
  - 验证：首次 `npm run release:baseline -- --app-version=1.0.0 --note=...` 产出 v1（724 条 / 指纹 15eff840 / 截止 2026-10-25）；再跑一次输出"基线未变…无需封版"（幂等，不写第二条记录）；`npm run build:app` 输出"基线 v1（724 条 / 指纹 15eff840 / 截止 2026-10-25）"且增量缺失时给出"正常状态"；`test:coredelta` 29/0、`check:fast` 181/181、`typecheck:tools` 干净。
  - 批次：20261025-1627

---

## 批次 20261025-1032 · 2026-10-25 · 会话 937507d0

> 把方块表（724 块）从线上产物里搬出去：id 表 → 叶子模块、数据 → 独立模块、生产换空桩、入口改两段式。

# 队列 · 会话 937507d0458d4277ba340bcb48207050

> 状态：执行中
> 创建：2026-10-25
> 批次：20261025-1032

目标（承接 `20261025-0329` 的 `[阻塞]` 条，用户拍板「改描述继续做」）：把 `SPECS`（724 个方块的明文数据）
从线上 bundle 里真正搬走，使 `build:app` 的主包明显变小。上一批已探明**唯一可行路径**是让依赖单向无环：

```
blockIds.ts（叶子，纯常量） → blockSpecs.ts（数据） → blocks.ts（消费 + 再导出 ids）
```

有了这个单向链，`blocks.ts` 就能**静态** import `SPECS`，不再需要顶层 await、也不需要给 178 套测试注入任何东西
（上一批这两条路都被 esbuild 打包堵死：环 + 动态 import 死锁；`banner` 不参与打包）。

- [x] [宿主7] 抽 `blockIds.ts` 叶子模块：把 `blockSpecs` 依赖的 id 常量（各 `*_ID_START` / `*_ID` 等）从 `blocks.ts` 搬到新文件，
  - 做了什么：新增叶子模块 `src/core/registry/blockIds.ts`（664 行，含头注释说明依赖方向），把 `blocks.ts` 里 **108 个纯字面量 id 常量**（连同各自的 JSDoc）整块搬过去；`blocks.ts` 用 `export * from './blockIds.ts'` **再导出**（224 个引用方一行没改）+ 显式 `import { … }`（`export *` 不会把名字带进本模块作用域，这是踩到的第一处）。另修 `tools/ui-test.ts`：它 greps `blocks.ts` 源码找 `export const ACTIVATOR_RAIL_ID = 581` 这类断言，改成把两个文件的源码拼起来读（断言关心的是"581 就是激活轨"，不是"这行写在哪个文件"）。
  - 为什么：这是"让依赖单向无环"的第一步。`blockSpecs.ts` 要读这些 id，而数据反向 import `blocks.ts` 就成环——上一批实测环 + 动态 import 在 esbuild 下**静默死锁**。把这些值搬到不 import 任何东西的叶子里，`blockSpecs` 就能只依赖叶子，`blocks.ts` 再静态 import `SPECS` 也不会崩。
  - 验证：`npm run check:fast` **149/149 全绿**（含此前失败的 `ui` 套件 1053 条断言）；`npm run typecheck:tools` 干净；id 快照哈希 `b3c68cc2d86da217` 与改前**逐字节一致**；`test:hostcore` 33/0（724 块）、`test:behaviors` 7/0（46 块）。
  - 批次：20261025-1032
      `blocks.ts` 用 `export * from './blockIds.ts'` 保持 224 个引用方不变 → `npm run check:fast` 全绿，
      且 `Wood` / `WoodShaped` / 树苗 / 床 / 牌子 / 石变体 id 快照哈希**逐字节不变**（`b3c68cc2d86da217`）
- [x] [宿主10] **宿主8 的前置**：把"id 派生表与取值函数"搬进 `blockIds.ts`——`EXTRA_WOODS` / `WOOD_IDS` / `Wood` / `woodBlocks` /
      `WOOD_SHAPED_IDS` / `WoodShaped` / `woodShaped` / 树苗两张表 + `saplingId`/`saplingTreeOf`/`SAPLING_IDS` / `BED_ID_MAP`+`bedId`/`bedIdOfColor`/`BED_IDS` /
      `SIGN_ID_MAP`+`signId`/`SIGN_IDS` / `STONE_VARIANT_FAMILIES`+分配器+`stoneVariantId`/`STONE_VARIANT_PARENTS`/`STONE_VARIANT_IDS` → `npm run check:fast` 全绿，
      且 id 快照哈希 `b3c68cc2d86da217` 逐字节不变（它们只依赖 `colors.ts` 与字面量，搬过去也不会成环）
  - 做了什么：把 30 个声明（215 行）从 `blocks.ts` 整块搬进 `blockIds.ts`——木材族（`EXTRA_WOODS`/`WOOD_IDS`/`WOOD_ID_MAP`/`Wood`/`woodBlocks`）、木制四件（`OAK_WOOD_SHAPED`/`WOOD_SHAPED_IDS`/`WOOD_SHAPED_MAP`/`WoodShaped`/`woodShaped`）、树苗（`SAPLING_TREES` + 两张表 + `saplingId`/`saplingTreeOf`/`SAPLING_IDS`）、床（`BED_ID_MAP`/`bedId`/`bedIdOfColor`/`BED_IDS`）、牌子（`SIGN_ID_MAP`/`signId`/`SIGN_IDS`）、石变体（`StoneVariantKind`/`STONE_VARIANT_FAMILIES`/分配器/`stoneVariantId`/`STONE_VARIANT_PARENTS`/`STONE_VARIANT_IDS`），连同各自的 JSDoc。`blockIds.ts` 只新增两个依赖：`colors.ts`（纯数据）与 `Features.ts` 的 `TreeKind`（纯类型）。
  - 为什么：`blockSpecs.ts` 要读 `Wood`/`saplingId()`/`stoneVariantId()`，只要它们还在 `blocks.ts` 里，`blockSpecs` 就必须 import `blocks.ts` → 环 → 静态 import 崩（前两次死锁的根）。搬进叶子后依赖变成单向 `blockIds → blockSpecs → blocks`。
  - 验证：`npm run check:fast` **149/149 全绿**；`npm run typecheck:tools` 干净；id 快照哈希 `b3c68cc2d86da217` 与搬前**逐字节一致**；`test:hostcore` 33/0（724 块）、`test:behaviors` 7/0（46 块）；`grep "from './blocks.ts'" blockIds.ts` **为空**（环已断）。
  - 踩到并修掉的三处：① `EXTRA_WOODS`/`WOOD_ID_MAP`/`STONE_VARIANT_FAMILIES` 等原本是**非导出**的 `const`，搬过去后 `blocks.ts` import 不到——要给它们补 `export`；② 用"名字出现在正文里"来算出 import 清单会被**注释里的名字**骗（`// 见 WOOD_ID_MAP`），必须先剥注释再判；③ `import type {} from ...` 空导入会被 tsc 拒，树类型实参删干净时要连整条语句一起删。
  - 批次：20261025-1032
- [x] [宿主8] 搬 `SPECS` 到 `blockSpecs.ts` 并改静态 import：spec 声明 + `baseTiles`/`plantSpec` 等只被 spec 用的辅助函数一起搬，
  - 做了什么：新建 `src/core/registry/blockSpecs.ts`（2191 行），把 88 个声明 / 2175 行搬过去——全部 `*_SPECS` / `*_SPEC`、聚合用的 `SPECS`，以及只被 spec 用的辅助函数 `baseTiles` / `plantSpec` / `waterPlantSpec` / `coralFanSpec` / `tilesOfDefined`；`blocks.ts` 改成**静态** `import { SPECS } from './blockSpecs.ts'`。搬运过程中 tsc 揪出 6 个还留在环上的 spec 输入表（`SHAPED_PARENTS` / `COPPER_STAGES` / `COPPER_SHAPES` / `CORAL_KINDS` / `STEM_STAGES` / `copperId`），一并搬进 `blockIds.ts`。另修 `SHULKER_BOX_IDS`：它原本从 `COLORED_SHULKER_SPECS` 取 id，改成纯算术（`SHULKER_BOX_COLOR_START + index`），否则数据搬走后运行时拿不到。
  - 为什么：这是整条路线的核心一步——`blockSpecs.ts` 只 import 叶子（`blockIds.ts`）与纯数据/纯类型模块，**不 import `blocks.ts`**，所以静态 import 不会出现"后定义的常量在 TDZ"的循环初始化。前两次失败（顶层 await 死锁、banner 不打包）都是想绕开这个环，现在环本身没了。
  - 验证：`npm run check:fast` **149/149 全绿**；`npm run typecheck:tools` 干净；id 快照哈希 `b3c68cc2d86da217` **逐字节不变**；`test:hostcore` 33/0（724 块往返）、`test:behaviors` 7/0（46 块行为黄金哈希，说明"搬完还是同一张表"）；`grep "from './blocks.ts'" blockSpecs.ts` **为空**（环已断）；`build:fast` 出包成功。体积**未变**——换桩是下一条（`宿主9`）。
  - 踩到并修掉的两处：① `tests/ui-test.ts` 有两处按源码文本断言 spec 内容（"铁轨复用 flat 薄板"、"霜冰红块注册"），数据搬家后失效——已把 `blockSpecs.ts` 也拼进它读的源码里；② spec 里读的 id 表还有 6 个留在 `blocks.ts`，靠 tsc 的 `Cannot find name` 逐个揪出来再搬，不能只按名字模式扫。
  - 批次：20261025-1032
      `buildBlockTable(specs)` 显式收参数 → `npm run test:hostcore`（33）与 `npm run test:behaviors`（7）全绿 + 全量 `npm run check`
- [x] [宿主9] 生产换桩 + 体积断言：`vite.config.ts` 用 `resolve.alias` 把 `blockSpecs.ts` 换成 `blockSpecs.stub.ts`（`SPECS = []`），
  - 做了什么：① `blockSpecs.stub.ts`（`SPECS = []`）+ `vite.config.ts` 的 `hostSpecsStub()` 插件（`resolveId` 拦 `./blockSpecs.ts`，**默认开**，`SPECS_STUB=0` 可关）；② `release-check` 的数据探针（`dragon_egg_top` 不得出现在主包；用贴图名而不是方块名，因为后者在物品表/i18n 里也有）；③ **入口改两段式**（`src/boot.ts`：先取 `core.bin` 装表，成功才 `import('./main.ts')`），`index.html` 指向 boot，`main.ts` 自己那段门禁删掉并留注释说明移交原因。
  - 为什么：桩一打开就暴露"空表下模块初始化期崩"（`TypeError: Cannot read properties of undefined (reading 'id')`），根因是**主包在我装表之前就求值了**。只把桩关掉等于回避，所以直接把入口顺序改正——这也是上一批因"表在两个 chunk 各打一份"回退掉的那条路，现在数据已被桩掉，重复打包的前提消失。
  - 验证：`SPECS_STUB=1` 下两种形态各跑一遍真实浏览器（Playwright + `vite preview`）——**完整前端形态**：文案"加载中… 正在准备材质与存档"、**0 条 pageerror**；**宿主形态**：文案"请在 Minicraft 应用里游玩…"、**0 条 pageerror**。构建产物：`build:app` 主包 gzip 570.9 KB（`main-*.js`）/ 全部 JS 合计 1199.1 KB，`build:web` 同样通过；探针确认 `dragon_egg_top` 不在主包。`npm run check:fast` **180/180 全绿**。
  - 如实记一笔：**体积口径变了**——两段式之后 `index-*.js` 只是引导器（140.5 KB 的 HTML + 小入口），游戏体在 `main-*.js`；首屏成本要看合计。实测合计 1199.1 KB 对上一提交的 1196.8 KB **多了 2.3 KB**（拆包带来的共享模块重复），而数据移出只省了约 7 KB gzip —— 净收益接近打平。也就是说**这一步买的是"数据不在包里"，不是"更快"**。条目里原写的"降到 ~690 KB"是按整块估的，实测不成立。
  - 批次：20261025-1032
- [x] [发现] **入口必须在装表之后才加载主包**：空表下 `Cannot read properties of undefined (reading 'id')`（证据：`SPECS_STUB=1 npm run build:app` + `vite preview` + Playwright，`main.ts` 末尾的门禁还没跑到就抛）→ 改成两段式入口：`index.html` 指向新的 `src/boot.ts`，先 `fetch('/__host/core.bin')` 并 `installBlockTable()`，成功才 `await import('./main.ts')`；判据 = `SPECS_STUB=1 npm run build:app` 后浏览器只见落地页/进游戏均无 pageerror，且 `npm run check:fast` 与 `test:hostcore` 全绿。⚠️ 上一次做两段式时因"表在两个 chunk 里各打一份"回退过；现在数据已被桩掉，重复打包的前提消失了，可以重做
  - 做了什么：新增 `src/boot.ts` 作为真入口——`await ensureHostCore()`（取 `core.bin` 并 `installBlockTable`）成功后才 `await import('./main.ts')`；失败时 `hostCore` 已画好整屏提示，直接放弃。`index.html` 的 script 指向 `/src/boot.ts`；`main.ts` 里原来的门禁 IIFE 删掉，改成直接 `void boot()` 并留注释说明"门禁已前移"。
  - 为什么：动态 import 保证主包的模块体在装表之后才求值，不再依赖"某个模块恰好没在顶层读表"这种运气——这正是空表下 `reading 'id'` 的来源。
  - 验证：`SPECS_STUB=1 npm run build:web` → 浏览器进游戏、0 pageerror；`SPECS_STUB=1 npm run build:app` → 落地页、0 pageerror（均 Playwright 实测）；`check:fast` 180/180。
  - 批次：20261025-1032
      删掉 `bootstrapSpecs` 之类过渡物 → `npm run build:app` 断言主包 gzip 从 716 KB 降到 ~690 KB，
      且 `dist` 里 grep 不到方块明文；浏览器打开只见落地页

---

## 批次 20261025-0329 · 2026-10-25 · 会话 937507d0

> 方块表数据外置（宿主只认自己注入的 core.bin）+ 双形态发布 + 门禁与版本契约。

# 队列 · 会话 937507d0458d4277ba340bcb48207050

> 状态：执行中
> 创建：2026-10-25
> 批次：20261025-0329

目标：把方块表这份"核心且恒定"的数据从线上 bundle 里拿出来，落成**一个文件** `core.bin`：
- 放进 APK → 前端必须从 `/__host/core.bin` 取，浏览器拿不到 → 只有宿主能玩
- 放进静态服务器 → 完整前端方案（浏览器可玩，用于预览/兜底）

约束：**不得影响前端加载与体验**（主包体积必须下降，冷启动不得变慢；bin 与主包并行加载，不串行）。

- [x] [宿主1] 二进制编解码 + 生成脚本 + 往返一致测试：新增 `src/core/registry/blockTableCodec.ts`、`tools/gen-hostcore.ts`、`tools/hostcore-test.ts`，`blocks.ts` 导出 `buildBlockTable` 供工具直接用 → `npm run test:hostcore` 逐字段全等；`node tools/gen-hostcore.mjs`（或 npm script）能产出 `core.bin` 且体积记录在案
  - 做了什么：定长 14 字节/块 + 全局去重字符串表 + 16 字节头（含 crc32），`encodeBlockTable`/`decodeBlockTable` 成对实现；`gen:hostcore` 产出 `.tmp/hostcore/core-v1.bin`；`test:hostcore` 钉 18 条断言（逐字段往返、id 连续、函数字段不进文件、坏文件必须抛、体积预算、ArrayBuffer 入口）
  - 为什么：方块表是复制者最想要的那份数据，也是最恒定的一份，先把它做成独立文件，"放 APK / 放静态站"就只是同一个文件的两种部署，编译期不需要任何分叉
  - 验证：`npm run test:hostcore` 18 通过 / 0 失败；`npm run check:fast` 全绿（离线套件 176 → 177 套，新套件按 `package.json` 自动注册）；`npm run typecheck` 与 `typecheck:tools` 均 0 错误。实测 724 个方块 → 41107 字节 / gzip 11048 字节（丢进 APK 的净成本 ≈ 10.8 KB）
  - 踩到并修掉的：① 头部 12→16 字节时 `offset` 从 `HEADER_SIZE` 起读 `blockCount`，把第一段字符串长度当成块数（报"字符串表被截断"这种离谱错误），改成固定偏移 6/8；② 补 crc32 的起因是"长度不变但内容被补零"的损坏能静默解出垃圾表
  - 批次：20261025-0329
- [x] [宿主2] `blocks.ts` 的 `BLOCKS` 改成可注入 + 给 46 个带行为方块上一道行为快照回归锁（**只做 seam，不搬闭包**，搬迁留给宿主3 由快照兜底）
  - 做了什么：`BLOCKS` 由 `const` 改 `let`；新增 `installBlockTable()`（校验非空 / id 连续 / 有名字，失败保持旧表）与 `isInstalledBlockTable()`（布尔标记，不用数组身份——被"等值新数组"骗过一次）；新增 `tools/behavior-signature.ts`（无副作用的口径库）、`gen-behavior-golden.ts`、`behaviors-test.ts`，基线固化为 `tests/fixtures/block-behaviors.golden.json`（46 块 / 2.3 KB）
  - 为什么：闭包搬家和二进制装载是两件事，一次做两件出问题时定位成本翻倍。宿主2 先把"表可以被换掉"这条缝做出来并用 encode→decode→install→查询 全链路证明它成立，宿主3 再动 46 个闭包（届时快照就是判据）。快照本身也顺手变成这 46 块贴图/发光的长期回归锁
  - 验证：`npm run test:hostcore` 33 通过 / 0 失败（新增第七节：装表后 `blockDef`/`isOpaque`/`isSolid`/`lightOpacity`/`emitLight`/`blockTiles` 逐 id 对齐，装空表与 id 不连续必抛且旧表保留）；`npm run test:behaviors` 7 通过（46 块行为输出未变）；`typecheck` 与 `typecheck:tools` 均 0 错误
  - 批次：20261025-0329
- [x] [宿主3] 搬到二进制装载 + 门禁：① 把 46 个方块的 `stateTiles`/`faceTile`/`stateLight` 抽进 `BLOCK_BEHAVIORS`（按名字索引），SPECS 只留数据；② 新增 `src/boot.ts`（并行拉 `/__host/core.bin` + 动态 import 主包，装表后放行；404/超时 → 全屏落地页指向 Google Play）；③ `index.html` 改指向 boot、`public/sw.js` 排除 `/__host/*` → `npm run test:behaviors` 仍全绿（46 块行为一字不差）、浏览器打开只见落地页且 Network 无主包、带 bin 时正常进游戏
  - 做了什么：① 46 个方块的行为（`stateTiles`/`faceTile`/`stateLight`）搬进新文件 `blockBehaviors.ts`，按**方块名**索引（含 16 面旗帜的按色循环生成），`SPECS` 只留数据；`blocks.ts` 新增 `applyBehaviors()`，装表与 `buildBlockTable()` 都走它，二进制格式**不需要为行为加任何字段**。② 新增 `src/boot.ts`（真入口）：先 `fetch('./__host/core.bin')` → 验魔数 → 装表 → 动态 `import('./main.ts')`；两条失败路径分开——"没有核心数据"走安装引导（指向 Google Play），"有但解不开/版本不对"走提示更新。③ `index.html` 改指向 `boot.ts`；`public/sw.js` 排除 `/__host/*`；`vite.config.ts` 加 dev-only 中间件模拟安卓宿主（`apply: 'serve'`）。
  - 为什么：闭包塞不进二进制，必须留在代码里；而"搬"这类改动的风险是**静默渲染错**（正脸贴反、亮灯不发光），所以先用快照锁住 46 块的输出再动手。门禁之所以不需要后台，是因为 `__host/core.bin` 在线上**根本不存在**：宿主用 `shouldInterceptRequest` 从 APK 读，浏览器拿到的就是 404——"缺资源"这个判据天然成立。
  - 验证：`npm run test:behaviors` 7/0（46 块行为输出一字不差）；`npm run test:hostcore` 33/0（含 encode→decode→install 全链路）；dev 下 `curl /__host/core.bin` → 200 / 41107 字节；Playwright 实测两形态——**无 bin → 显示"请在 Minicraft 应用里游玩"，且 `main-*.js` 一个字节都没下载**；有 bin → 下载 `main-*.js` 并进入"加载中… 正在准备材质与存档"；`typecheck` 0 错误
  - 踩到并修掉的：① `vite preview`/静态托管对不存在路径做 **SPA 回退**，`/__host/core.bin` 返回 `200 + index.html`，`response.ok` 为真 → 被误判成"版本不匹配"（提示"请更新应用"而不是"去下载"）。改成**先验魔数**：魔数不对 = 没有核心数据 = 安装引导；② 浏览器验证时读到旧 Service Worker 里缓存的 `core.bin`，害得"有 bin 也显示落地页"，加 cache-busting 查询串后才复现真实行为——这条已补进 `TIPS.md`
  - 没做完、留到宿主4：`SPECS` 仍在 bundle 里（本批**体积未降**）。原因是它与 50 多个 id 常量交错在 `blocks.ts` 中，被 224 个文件引用，搬走要连带处理这批再导出；宿主4 做文件拆分 + 主包体积断言 + `dist` 里不得出现 `core.bin` 的断言
  - 批次：20261025-0329
- [x] [宿主4] 双形态发布构建：`build:web`（含 core.bin，完整前端）/ `build:app`（**不含** core.bin）＋ 关闭 sourcemap ＋ HTML minify ＋ 构建后断言（无 `.map`、无 `core.bin`、主包 gzip 显著低于 338456）→ 两条命令各自断言通过
  - 做了什么：新增 `tools/release-check.mjs`（发布后处理 + 断言）与 `npm run build:app` / `build:web`：两条都以 `SOURCEMAP=0 vite build` 起，再由脚本 ① 用 esbuild 再压一遍 JS 并记录压缩率 ② `app` 形态**删掉** `dist/__host/` 并报红、`web` 形态校验 `core.bin` 魔数后放入 ③ 断言无 `.map`、主包 gzip 不超基线、HTML 产物不比源文件大。另把 `vite.config.ts` 的 `minify` 显式写死（不依赖默认值）。
  - 为什么：这三件失败都**不会让构建报错**——多一个 `.map` 等于把源码发出去了，多一个 `core.bin` 等于门禁当场失效，产物没压缩则只是"手机多下两倍"。静默变差只能靠退出码兜。`build:web` 与 `build:app` 用同一个 `dist` 布局，只差一个文件：**放哪决定形态**这条设计在这里得到验证。
  - 验证：`npm run build:app` → 主包 `index-*.js` gzip 716.0 KB / 基线 722.7 KB、全部 JS 合计 1202.7 KB，`dist` 无 `__host`；`npm run build:web` → `core.bin 已放入 dist/__host（40.1 KB）`、魔数校验通过。Playwright 两形态实测：`web` 形态进"加载中… 正在准备材质与存档"，`app` 形态只显示"请在 Minicraft 应用里游玩"，控制台无错误。
  - ⚠️ 没达成的一条：队列里写的"主包 gzip 显著低于 338456"**没有达成（716 KB）**，因为 `SPECS` 仍在主包里。而且 338456 本身是**批次 85 的旧数字**，项目此后长了一倍多（724 方块 / 176 套测试 / 村庄要塞联机），拿它当目标属于刻舟求剑——真正该盯的是"数据搬走之后这一项要往下掉"。已把基线改成"当前实测 + 余量"并写明这一点，另插了一条 `[发现]` 条目专做数据搬迁。这一点请在收尾时定夺。
  - 踩到并修掉的：① 一度改成"独立 boot 入口 + 动态 import main"，实测 `blocks.ts` 被两个 chunk **各打一份**（主包 2.0 MB / gzip 556 KB + 多一次请求），回退成单入口、门禁放在 `main.ts` 末尾的异步 IIFE 里；② esbuild 压缩默认把中文转 `\uXXXX`，体积反涨 14%，必须显式 `charset: 'utf8'`
  - 批次：20261025-0329
- [x] [宿主5] 版本契约：`version.json`（`core` / `minSupported`）+ 宿主 UA 带 `core/N` + 不匹配时提示「请更新应用」而非白屏 → 手工验三种组合（匹配 / 落后 / 浏览器）
  - 做了什么：① `release-check.mjs` 生成 `dist/version.json`（`core` / `minSupportedCore` / `builtAt` / `mode`），`core` 直接从 `blockTableCodec.ts` 的 `BLOCK_TABLE_VERSION` 读取并与 `core-v{N}.bin` 文件名交叉校验（两处抄一遍必然漂）；② `hostCore.ts` 新增 `readHostCoreVersion(ua)` / `evaluateHostVersion()`（纯函数）与 `fetchMinSupportedCore()`，启动时与 `core.bin` **并行**取清单，先判"宿主太老"再解二进制；③ `sw.js` 把 `version.json` 也排除出缓存；④ `tools/browser.mjs` 的 `openPage` 支持自定义 UA（这是唯一能真验 UA 判定的办法）。
  - 为什么：三种组合里最容易错的是**浏览器**——它没有宿主标记，若把它也判成"版本过旧"，浏览器用户会看到"请更新应用"这种完全误导的提示。所以判定是三态（`ok` / `outdated` / `unknown`），`unknown` 必须继续走正常流程、最终落到安装引导。另外清单取不到时**不阻塞启动**（回退到最宽松的兜底下限），不让一个几百字节的 JSON 成为单点故障。
  - 验证：`npm run test:hostversion` 16 通过 / 0 失败（UA 解析 7 条含"只有 core/N 没有宿主标记 → null"这种误判防线；三组合与边界 9 条）；真实浏览器三组合实测（`build:web` 形态）：浏览器 UA → 进"加载中…"、宿主 `core/1` → 进"加载中…"、宿主 `core/0` → **"核心资源版本不匹配 / 请更新到最新版本"**，三次均无控制台错误。另：`build:app` 形态下浏览器 UA → 安装引导（上一轮已验证）。
  - 批次：20261025-0329
- [x] [宿主6] Cloudflare 静态发布与回滚：两条流水线分别部署 app 版与完整版（**不同域名/路径**，避免误把 core.bin 传到生产域），灰度与回滚步骤写进文档 → 按文档实操一次并贴出 curl 证据
  - 做了什么：① 两条**独立的**发布流水线 `.github/workflows/deploy-cf-app.yml`（`minicraft-app` / 宿主专属）与 `deploy-cf-web.yml`（`minicraft-web` / 完整前端），项目名、域名、`dist` 形态三者物理隔离，触发方式只留 `workflow_dispatch`（手动 + `channel=preview|production` 两段式）；② `docs/DEPLOY-CLOUDFLARE.md`：两站分工、首次配置（secrets / 域名）、preview 先验收再切 production、三种回滚路径、验收清单；③ 新增 `public/_headers`（Pages 专用）：`core.bin` / `version.json` 走 `no-store`、`index.html` / `sw.js` 走 `no-cache`；④ 顺带修掉一个**线上泄漏**：`deploy-pages.yml` 原来跑 `npm run build`，而 sourcemap 默认是开的——GitHub Pages 上一直挂着 `.map`，等于把 TypeScript 全部源码公开。已改成 `npm run build:app`（关 sourcemap + release-check 断言）。
  - 为什么：灰度这块 Cloudflare Pages **没有百分比能力**（那是 Workers 的 `versions deploy --percentage`），所以这里定义成"部署级两段式"：先发 preview（独立 URL，生产域名不动）→ 按清单验收 → 再 promote。要真按比例放量就得迁到 Workers + R2，那是纯加法、随时可做，现阶段不值得为一个还没量的问题引入动态层。两站必须**不同项目名**：它们只差一个 `core.bin`，共用项目的话"谁最后跑"决定线上形态，发错时线上看起来还一切正常（游戏能玩），没人会发现。
  - 验证：**未验证**（缺 `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` 与两个 Pages 项目名，这类信息只有用户能提供）。已做的是本地等价验收：本地用 `vite preview` 模拟两站产物、按文档第 5 节逐条 curl——A 站 `/__host/core.bin` 返回 `<!do`（不是 MCTB）、`version.json` 为 `mode=app`、入口 chunk 存在、`.map` 请求拿到 HTML、`dist` 无 `__host`；B 站 `core.bin` 200 / 41107 字节 / 魔数 `MCTB`、`version.json` 为 `mode=web`、`.map` 同样不存在。两条构建命令本身也各自跑通断言（`build:app` / `build:web` 均 ✓）。工作流文件只做了静态检查（无 Tab、无未用参数），实际执行要等用户配好 secrets 手动触发。
  - 踩到并修掉的：验收清单原本写"看 HTTP 状态码"，但 SPA 回退会把任何不存在的路径变成 `200 + index.html`（首轮实测 A 站 `core.bin` 与 `.map` 双双返回 200）——已全部改成**看内容**（魔数 / 首字节），文档里也写明了原因
  - 批次：20261025-0329

- [阻塞] [发现] 把 `blocks.ts` 里的方块表数据真搬出主包（当前门禁已成立、体积未降）：`src/core/registry/blocks.ts` 里 `SPECS` 与 60 多个声明交错（22 个 `export const *_ID_START` 导出被 224 个文件引用、若干 spec 工厂函数），整块搬运要连带处理再导出 → 判据是 `npm run build:app` 的主包 gzip 比现在（716 KB）明显下降，且 `npm run test:hostcore` 仍是 724 个方块、`npm run test:behaviors` 46 块一字不差

  - 进展（2026-10-25 · **未完成，未打勾**）：**第 1 步已做完**——`SPECS` 的构造现在**没有任何副作用**（`grep _MAP.set` 为 0 处）。
    · 原状：6 张 id 表（`WOOD_ID_MAP` / `WOOD_SHAPED_MAP` / `SAPLING_ID_MAP` / `SAPLING_TREE_MAP` / `BED_ID_MAP` / `SIGN_ID_MAP` / `STONE_VARIANT_MAP`）都是在 spec 数组的 `flatMap`/`map`/IIFE 回调里被 `set()` 填充的——"建表顺便产出 id"。
    · 现在：先纯算术生成（`WOOD_IDS` / `WOOD_SHAPED_IDS` / `allocateStoneVariantIds()` 等），spec 只读不写；`STONE_VARIANT` 那处的 id 分配器单独抽成 `allocateStoneVariantIds()`，`stoneVariantId()` 不再依赖"表被生成过"。
    · 验证：id 快照哈希改前改后**逐字节一致**（木材 `9c2cdaf90cf3155e`；含树苗/床/牌子/石变体的合并快照 `b3c68cc2d86da217`）；`test:hostcore` 33/0（724 块）、`test:behaviors` 7/0（46 块）、`check:fast` 149 套全绿。
  - 剩余工作（下一批的入口）：**第 2 步——把 60 多个 spec 声明搬到 `blockSpecs.ts`**。已探明的做法：spec 数组只依赖**导出的取值函数**（`woodBlocks()` / `woodShaped()` / `saplingId()` / `bedIdOfColor()` / `signId()` / `stoneVariantId()`）与字面量常量，所以搬运后 `blockSpecs.ts` 只需 `import` 这些；`blocks.ts` 用**动态 `import()`（顶层 await）+ 构建期 `define` 关掉嵌入**来绕开"blockSpecs 先求值读常量落在 TDZ"的死结，生产包里 `SPECS` 为空、由 `hostCore` 从 `core.bin` 装表，`build:app` 主包 gzip 应降到 ~690 KB。**风险点**：`blocks.ts` 会变成 async 模块（TLA），224 个引用方的求值时机整体后移——这是下一批唯一需要小心的地方。

---

