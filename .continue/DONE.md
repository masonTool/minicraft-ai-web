# 完成档案 · DONE

> 本文件是**已完成工作的唯一档案**，只回答"这批做了什么、怎么验的"。
> 「当时怎么做的、为什么」→ `NOTES.md`（按模块）；「下次怎么避开」→ `EXPERIENCE.md`（按主题）。
> **一条内容只写一个地方**，别在三份文档里各抄一遍。
>
> 读法：**最近的队列在最上面**；历史在文末两节（批次 1~613 / HANDOFF 批次流水）。
> 2026-10-22 迁移 continue-do 时，旧的单队列归档（`auto-continue.md` + `auto-continue-archive.md`）
> 与 `docs/HANDOFF-ARCHIVE.md` 里的批次流水都并了进来，`docs/HANDOFF-ARCHIVE.md` 随之下线。
>
> 触发：队列里 `[ ]` / `[~]` 都没了，**用户确认收尾之后**，整份队列搬到这里并补完成说明，
> 同时走完 `HANDOFF.md §1` 的五步（TASKS → 自问 NOTES / EXPERIENCE → 删队列）。

## 归档格式

```md
## 批次 24（提交 24→27）· 2026-10-22 · 会话 0679751e

**做了什么**：一句话概括这份队列的目标。

**条目**（原文照搬，状态保持原样，`[阻塞]` 也要带上）：

- [x] T1 …
- [阻塞] T2 …（卡住原因 / 用户怎么处理的）

**完成说明**：
- 验证方式与结果（跑了什么命令、结论是什么；没验证就如实写"未验证"）；
- 遗留问题 → 还有后续就记到 `TASKS.md`，不要留在已归档的队列里；
- 「为什么这么做」如果**下一批还会被绊到**，别展开写在这里——写进 `NOTES.md`，
  这里只留一行指针（如"取舍见 NOTES.md · 批次号口径"）。
```

> 标题里的批次号 = 队列头部的 `> 批次：`（开工时的提交总数）；
> 括号里的第二个数是收尾时的提交总数，两者之差就是这批动了多少次提交。
> ⚠️ **2026-10-22 之前的两个归档小节没有批次号**——批次号机制在这次迁移才引入，不要倒推补号。

<!-- 实际归档放下面，最新的放最上面 -->

## 批次 1355（提交 1355→1363）· 2026-10-22 · 会话 06a11957

**做了什么**：清台账盲区（一条缩进条目整条隐身 + `M18` 重号）、把 A7/O4 两条"已做完却仍标进行中"收口、
M23 队伍前后缀从数据层接到名字牌、M8 把背包面板与设置面板两屏共 105 处中文文案接进 i18n，
外加修掉让全量 `npm run check` 长期变红的 `test:hooks` 漂移。共 6 条（T1~T5 + 一条 `[发现]`）。

**条目**（原文照搬）：

- [x] T1 修 TASKS 台账盲区：`.continue/TASKS.md` 第 4289 行 ` - [~] M18 **操作界面对齐基岩版**` 行首多一个空格，`audit-tasks.mjs` 的正则锚在列 0 于是整条没进台账（不在 294 里、也不参与重号检查），同时 M 段两条 `M18`（第 4214 行「物品中文名」与这条「操作界面」）重号一直没被抓出 →
      **改**：去掉行首空格；把「操作界面对齐基岩版」改号为 **M24**；`tools/audit-tasks.mjs` 的条目正则改为容忍行首空白，并在**条目有缩进**时打印警告 →
      **验收**：`npm run audit:tasks -- --print` 通过且总数由 294 变 **295**、进行中由 8 变 **9**
- [x] T2 A7 / O4 口径校准收口：两条的"缺截图/缺控制台门禁"注记早已过期——`shot` / `guard` / `shotdiff` /
      `check:browser` 都在仓库里且各有自测 →
      **验收**：三套自测全绿（14 / 17 / 23 / 15 条）+ `audit:tasks -- --print` 三处锚点一致
- [x] T3 M23 队伍**前后缀**（`/team modify <队> prefix|suffix`）：`Teams.ts` 加字段 + `sanitizeAffix` +
      存档往返（不升 DB_VERSION）+ `composeNameTag` + `nameTagStyleFor` + `MobNameTag` 换 `style` 参数 →
      **验收**：`test:nametag` 91 → **143 条**
- [x] [发现] `npm run check` 整体是红的：`tools/hooks-test.mjs:342` 断言旧版 `state.attempts[...]`，
      而 v3 钩子早已改成 `currentStreak`（`5815cd72` 改了钩子没改自测）→ 修断言到当前实现，
      并保留"计数必须累加并逐轮落盘""隔离后复位"两条行为断言
- [x] T4 M8 i18n 第 N 片：**背包界面**文案接线（`src/ui/InventoryScreen.ts`）→ **验收**：`test:i18n` 扩守卫
- [x] T5 M8 i18n 第 N+1 片：**设置界面**文案接线（`src/ui/SettingsScreen.ts`）→ **验收**：`test:i18n` 再扩

**完成说明**：

- **验证方式**：每条单独提交、单独跑 `check:fast`；收尾跑 **`npm run check` 全绿**——
  169/169 套离线 + `test:hooks` 91 项断言 + 三张台账（`audit:tasks` 295 项 / 覆盖度 / 差异 66 条·注意 188 条）
  + 文档体量。单套成绩：`test:nametag` 91→143、`test:commands` 434、`test:save` 111、
  `test:i18n` 95→**113**、`test:settings` 111、`test:ui` 919+7→**926**。
- **台账口径变化**：294 → **295** 项（缩进条目归位）；完成 283 → **286**、进行中 8 → **6**
  （A7 / O4 / M24 三条收口；M8 与 M23 仍是 `[~]`，其中 M23 只剩"队友免伤""碰撞开关"两项，都要联机）。
- **遗留（已写进 TASKS 对应条目，不在这里展开）**：
  M8 剩的是**数据不是文案**（页签名 / 朝向名 / `StationNeed.label` / 职业名 / 图案名 / 物品名本身）；
  M23 剩两项；L7/L4 生物同步仍等用户拍板方案。
- **批次号口径事故**：T2(`3b373580`)/T3(`6411217c`) 的提交信息把"提交总数"当批次号写成了 1357/1359，
  这批正确批次号是 **1355**。已推送、不改写历史，特此留痕。
- 取舍见 `NOTES.md` · 「i18n 守卫按字面量判的边界」「`[发现]` 的优先级没进文档」两条；
  坑见 `EXPERIENCE.md` · 「钩子日志会被清空，断点证据要进仓库」。

## 2026-10-21 · 会话 ac183009

**做了什么**：收尾 M23 队伍颜色、M8 界面文案接线、`waterlogged` 状态位、浏览器验收门禁、
`/clone` `/data` `/locate` 与 6 条 gamerule —— 共 23 条（Q1~Q23），队列已清空。

**条目**（原文照搬；`[跳过]` 是当时核对后作废的条目，留痕不删）：

#### 优先级 1：M23 队伍颜色（收尾 M23 唯一能独立做的一项）

- [x] Q1 新增 `core/entity/NameTagColor.ts`（纯逻辑）：从队伍名 → 颜色 id → `#rrggbb` 的映射表（原版 16 色），
      `colorForMob(mob, scoreboard)` 返回该生物名字该用的颜色（无队伍 → `null` = 沿用默认白）。
      验收：新文件 30 行内，不引 DOM/渲染；`test:nametag` 增 8 条（有队伍/无队伍/队伍名不存在/16 色全覆盖）
- [x] Q2 `render/MobNameTag.ts` 接颜色：`drawName` 增加 `color: string | null` 参数，
      有颜色时用它画字（描边仍走深色）；`show()` 增加同参数并纳入"是否要重画"的判据
      （现在只比 `lastName`，名字没变但队伍变了就不会重画）。
      验收：`test:nametag` 增 3 条（颜色变了要重画、null 用默认白、颜色串格式合法）
- [x] Q3 `main.ts` 接线：`updateNameTags()` 里把 `colorForMob(...)` 的结果传给 `tag.show()`，
      队伍变动的来源是 `scoreboard`/`teams` 快照（已有，见 M23 批次 402）。
      验收：`npm run check:fast` 通过；进游戏 `/team add red` + `/team modify red color red` 后
      给自己身边的命名生物看到红字

#### 优先级 2：合成配方 —— **2026-10-21 核对后大幅缩水**

- [跳过] Q4~Q7 ~~补 16 色地毯 / 玻璃板 / 陶瓦 / 混凝土 / 床 / 旗帜 / 蜡烛 的染色配方族~~
      —— **核对后确认：地毯/玻璃板/陶瓦/床早已做完；旗帜与蜡烛的物品本身不存在**
      （`items.ts` 里搜不到），要做得先加方块 + 物品 + 贴图 + 渲染，是另一个量级的活
- [跳过] Q4b ~~补"真正的配方缺口"~~ —— **没有需要补的**：`test:reach` 62 项全绿，
      生存里拿不到的只剩 3 件白名单（成书 / 已填地图属界面步骤，`redstone_ingredient` 是旧 id）。
      745 这个数低是**分母口径**问题（原版 1000+ 含大量 block state 变体与 1.17 后新方块族），
      不是缺配方。以后再想动这一块，**先拿 `test:reach` 的实测缺口当依据**，别凭封面百分比排期。

#### 优先级 3：A7/O4 浏览器验收门禁（把"靠人工看"变成自动）

- [x] Q8 仓库内置 `playwright` devDependency + `tools/screenshot.ts`：
      给定 URL/视口/等待条件截一张图到 `.tmp/shots/`（不进仓库）。
      验收：`npm run shot -- /` 能出图；不引入 CI 强制依赖（没装浏览器时脚本给提示并退出 0）
- [x] Q9 `tools/console-guard.ts`：用 playwright 打开页面、收集 `console.error` 与 `pageerror`、
      进一个世界跑 20 秒，任何一条错误即非零退出。
      验收：手工制造一个 `console.error` 能让它变红；正常跑绿
- [x] Q10 把 Q9 挂进 `npm run check`（可选开关 `BROWSER_CHECK=1`，默认不跑以免 CI 无浏览器时红）。
      验收：`BROWSER_CHECK=1 npm run check` 通过；默认 `npm run check` 行为不变
- [x] Q11 `tools/shot-diff.ts`：与上一张同名截图做像素差，超过阈值就报红（回归用）。
      验收：同一页面两次截图差为 0；改一处颜色后能报出差异区域

#### 优先级 4：M8 剩余界面文案接线（50% → 接近 100%）

- [x] Q12 背包界面文案接线（`InventoryScreen.ts`）：标题/分类名/搜索占位/丢弃提示。
      验收：`test:i18n` 增 5 条；切英文后重开背包整页无中文
- [x] Q13 工作站界面文案接线（熔炉/工作台/箱子/酿造台/附魔台/铁砧）：通用契约见 `docs/STATION-LOGIC.md`。
      验收：`test:i18n` 增 6 条；每个站台的标题与按钮都走文案键
- [x] Q14 聊天与命令提示接线（`ChatInput.ts` + 命令报错文案）。
      验收：`test:i18n` 增 4 条；`/help` 的英文模式下不出现中文
- [x] [发现] 命令执行反馈还有 111 句各不相同的自然语言没接 i18n：`src/core/commands/Commands.ts`
      里 `out.info`/`out.error` 的运行时文案（`已将时间设置为 …`、`找不到物品：…`、
      `时间格式不对：…`、`已给予 … ×N`、`已将 X 传送到 Y` 等，句式 37 种）。Q14 只接了调度层
      6 条 + 39 条 `用法：`（走 `usageError()` 的字段词表），这些逐句的没法用词表压。
      证据：`npx esbuild` 后运行 `executeCommand('/time set notatime')` 在英文模式下仍输出
      「时间格式不对：notatime」（Q14 浏览器实测，见 HANDOFF 批次 617 注记）。
      → 做完的标准：在 `I18n.ts` 加 `cmd.*` 键组，把这 111 句改成 `t()`/`tp()`；
      并让 `test:i18n` 从 `Commands.ts` 抽取**所有**含中文的 `out.*` 调用断言"必须走 t/tp"，
      防以后新加命令又写死中文。`CommandHelp.ts` 的 140 条帮助标签另算，不含在本条。
- [x] Q15 地图/成就/死亡界面文案接线。
      验收：`test:i18n` 增 4 条；`keyParity()` 仍然全绿

#### 优先级 5：`waterlogged` 状态位（流体系统唯一剩下的缺口）

- [x] [发现] 成就数据层（100 条 title + 98 条 desc + 5 个标签页名）仍是中文：
      `src/core/progress/advancements.ts` 的 `title:` / `desc:` 字段与 `ADVANCEMENT_TABS[].title`。
      Q15 只接了 `AdvancementScreen.ts` 的**界面文案**（Close / All / Earned / Available /
      lockedHint / toast），数据本身没接。证据：Q15 浏览器实测，英文模式下成就面板是
      `Advancements 已达成 1/100 Close All ... 我的世界 1/29 下界 0/5` —— 界面词全英文、内容全中文。
      → 做完的标准：给 `AdvancementDef` 加 `titleEn` / `descEn`（或一张 `advancementText.data.ts`
      按 id 映射，零依赖），`AdvancementScreen` 与 `AdvancementToast` 都按语言取；
      `test:i18n` 加两条断言：100 条都有英文、英文模式下打开成就面板 `cjk` 为 0。
- [x] Q16 ~~新增 `core/world/Waterlogged.ts`~~ —— **核对后确认早已实现**（批次 469），
      而且超出验收标准。证据：`blockState.ts:904-914`（`WATERLOGGED_MASK=0b10000000` +
      `isWaterlogged` / `withWaterlogged`）、`blocks.ts:5291`（`canBeWaterlogged` 按形状判
      9 种族：slab/stairs/fence/wall/trapdoor/pane/door/fence_gate/sign）、
      `blocks.ts:5313`（`waterloggedPlacementState` 落点是水就自动置位）、
      `blocks.ts:5324`（`blockAfterBreak` 含水 → 变回水）。
      `npm run test:waterlogged` **30 条全绿**（验收要求 25 条）。
      不需要 `core/world/Waterlogged.ts` —— 这一位属于**方块状态**，读写放
      `registry/blockState.ts`、白名单放 `registry/blocks.ts` 才是合理的分层。
- [x] Q17 ~~`Waterlogged` 接存档~~ —— **不需要改**：`save/ChunkEdits.ts` 的
      `packEdit(id, state)` 用 `PACK_STATE_MASK = 0xff` 存**整个状态字节**，
      bit7 天然被带上；`restoreStack` 那条路不在这一层（那是物品栈，不是方块）。
- [x] Q18 ~~流体引擎认 `waterlogged`~~ —— **批次 621 完成**（这是 Q16~Q19 里唯一真缺的一块）。
      `Fluids.ts` 新增两个判据 + 三个接入点：
      ① `isWaterAt()` —— 这一格"有没有水"（流动水也算），用于"含水方块参与扩散"；
      ② `isWaterSourceAt()` —— 这一格算不算**0 级供源**（含水方块算，流动水不算）；
      ③ `canFillWaterlogged()` + `fillWaterlogged()` —— 把台阶**灌满**而不是覆盖它；
      `countAdjacentSources` / `desiredFluidState`（含水源计数与横向供源）、
      `fluidTick`（含水方块也跑 tick，但**跳过自身重算**，否则会被写成空气或 0 级水）全接上。
      ⚠️ 两个必须分开的判据：第一版把 `isWaterAt` 直接塞进供源计数，结果**流动的水被当成水源**，
      断源的细流靠同级邻居自己续命、永远干不了 —— `test:tick` 当场红了两条
      （"到达最大扩散距离后不再往外流"、"同级邻居不算供源"），改成 `isWaterSourceAt` 才修好。
      `test:waterlogged` **30 → 55 条**（新增 25 条：水的一员判定、可灌判据、纵向/横向灌满、
      含水台阶当水源灌满相邻坑、岩浆不灌、已含水不重复灌、以及"四周堵死时含水台阶不被毁"的负对照）。
- [x] Q19 ~~网格与渲染~~ —— **已实现**（批次 469）：`core/mesh/ChunkMesher.ts:746`
      在网格化时读 `isWaterlogged(chunk.getState(...))`，`:757` 还会跳过相邻含水格的
      面剔除（否则水面会被邻居挡掉）。

#### 优先级 6：命令 36 → 40 与游戏规则 24 → 30

- [x] ~~Q20 `/clone` 区域复制~~ —— **批次 622 补齐三块**（复制本体批次 431 已有）：
      ① **方块状态**：`CloneIo` 加可选 `readState` / `writeState`，快照存两条平行数组
         （体积上限 32768，对象数组在手机上多一倍内存）；`CommandContext` 加可选
         `getBlockState?` / `setBlockState?`，`main.ts` 注入（顺带 `wakeFluidsAround`）。
         可选是为了老 stub 不改也能跑；不给时状态按 0。
      ② **自重叠拒绝**：`cloneBoxesOverlap()` —— 原版同。允许的话"把房子往东挪 2 格"
         会得到半新半旧的结果，玩家会以为指令坏了。
      ③ **越界拒绝**：`cloneBoxInWorld()` 查 Y（-64~320，来自 `Chunk.ts`）。
         越界的写会被世界**静默丢弃**，那样会回"已复制 N 格"却什么都没发生 —— 比报错难查。
      新增 `shiftCloneBox()` 供两处判据共用。
      `test:commands` 311 → **330 条**（+19：状态随复制三种朝向、无状态接口负对照、
      六条重叠判据、五条越界边界含贴地板/贴天花板、三条命令层拒绝）。
      ⚠️ 没做"复制到未加载区块"：本项目 `ctx.getBlock` 对未加载区块返回 0（空气），
      不会报错也不会崩 —— 表现是复制出一片空气。要正确拒绝需要先问 `world.isLoaded`，
      而 `CommandContext` 目前没有这条；留下一条差异记在 TASKS。
- [x] Q21 `/data get|merge|modify`：读写方块实体与实体 NBT 的一个子集。
      验收：`test:commands` 增 5 条；`/data get block` 能读出箱子第 1 格 —— **批次 623 完成**。
      新增 `core/commands/BlockData.ts`（零运行时依赖：路径解析 / 方块实体快照 / 血量夹取），
      `CommandContext` 加四个**可选**方法（`blockEntityAt` / `setBlockEntitySlots` /
      `entityData` / `setEntityData`，可选是为了老 stub 不改也能跑）；
      `main.ts` 注入四个实现 + `mobById`（`mob:12` → Mob 实例，线性扫，不缓存）。
      路径白名单只认真实存在的字段：方块 `Slots` / `Slots[i]`，实体 `Health` / `CustomName`。
      **`modify` 明确拒绝**并给替代写法（能被它改的只有血量一项，为它引入运算语法不值得）。
      `test:commands` 330 → **381 条**（+51，验收要求 +5）。
      浏览器实测（新建世界 → 创造模式 → 真实聊天框敲命令）15 条路径全对：
      `get 根` → `(-14,70,4) = minecraft:chest（状态位 0，方块实体 chest，共 27 格，0 格有东西）`、
      `merge slot0` → `已把 … 的 Slots[0] 设为 钻石（diamond） ×8`、
      `get Slots[0]` → `Slots[0] = 钻石（diamond） ×8`、`get Slots[1]` → `Slots[1] =（空）`、
      `越界 30` → `格号越界：30（这种容器只有 27 格，0 ~ 26）`、
      `Health 999` → `已把血量设为 20 / 20（超出上限，已夹到上限）`、`Health abc` → `Health 需要一个数字：abc`。
      ⚠️ **实测抓出两个坑**：① `filledSlots` 要跳过 `count: 0` 残留，否则根节点多列一行空气；
      ② 三个坐标原来是 `Number(raw)` 直接转，`~` 变 NaN 直接报用法错误 ——
      浏览器里第一条 `/data get block ~ ~-1 ~`（"看我脚下是什么"，最自然的写法）就被拒了，
      改走 `parseCoordinate` 才通（`parseBlockXYZ` 抽出来给 get/merge 共用）。
      ⚠️ 遗留（与 Q20 同源）：`blockEntityAt` 走 `containerOfBlockAt`（会建实例），
      对从未打开过的空箱子 `get` 一次会在容器表里多一条空记录；空容器不进存档，无数据后果。
- [x] Q22 `/locate`：按结构类型找最近的结构（复用现有的结构放置判定）。
      验收：`test:commands` 增 4 条（找到/找不到/类型不存在/跨维度）—— **批次 624 完成**，
      **验收的 4 条原本就有 2 条**（找到 / 找不到），真正缺的是另外两条与一批隐藏问题。
      **主体（`nearestStructure` / `nearestBastion` / `nearestFortress` / `nearestEndCity`）批次 464/465 已做完**，
      这一批补的是三条失败路径 + 双语 + 中文名：
      ① 原来"名字不存在 / 属于别的维度 / 这一带没生成"**三种失败回执一模一样**（都是"附近没有找到"），
         玩家会一直往远处走；② 整个回执是模板字符串拼的，**英文模式下整句中文原样漏出**
         （`test:i18n` 只跑不带参数的 `/locate`，永远走不到成功分支，所以从没红过）；
      ③ 结构名只有 key、没有中文名，`/help` 里只能手打。
      新增 `core/commands/structureNames.data.ts`（零依赖：23 条 = 18 主世界 + 3 下界 + 2 末地，
      各带中文名 / 英文名 / 维度 / 别名 / `locatable`）；命令层改成"查名字 → 校验维度 →
      判断有没有定位实现 → 才真去找"，四种失败各说各的。
      `locatable: false` 的两条（下界化石 `nether_fossil`、末地船 `end_ship`）会生成但还没有
      `nearestXxx`，单独报"还不能用 /locate 找"，不冒充"附近没有"。
      `test:commands` 381 → **408 条**（+27，验收要求 +4）。其中一条把这份手抄清单与
      `STRUCTURE_KINDS` / `NETHER_STRUCTURE_KINDS` / `END_STRUCTURE_KINDS` **逐个 key 对齐**
      （手抄就会漂，漏一行即红）。
      浏览器实测（创造模式，三个维度各跑一遍，problems=0）：
      主世界 `最近的村庄在 191, 67, 322（约 372 格）`；
      `nosuchthing` → `没有这种结构：nosuchthing（这个维度有 village / … / desert_well）`；
      `end_city` → `末地城 只在末地生成，这里是主世界（…）`；
      下界 `最近的堡垒遗迹在 -119, 36, -229（约 261 格）`、`村庄 只在主世界生成，这里是下界（…）`；
      末地 `最近的末地城在 -686, 61, -591（约 904 格）`、`村庄 只在主世界生成，这里是末地（可定位的有 end_city / end_ship）`。
      ⚠️ 实测踩到一个**假 bug**（已排除）：第一轮在下界问 `village` 竟然成功、`bastion` 反而说
      "只在主世界生成" —— 原因是在下界被岩浆烧死了、3 秒后重生成回主世界。
      切成创造模式重测即正常。**验证维度相关的命令必须先 `gamemode creative`**。
- [x] Q23 补 6 条 gamerule（逐条核对哪些依赖的子系统其实已经就位）。
      验收：`test:commands` 增 3 条；`audit:coverage` 的游戏规则数上涨 —— **批次 625 完成**，
      24 → **31 条（100%）**，`test:commands` 408 → **427**（+19）。
      逐条核对依赖的子系统是本条目的重点，结论分两类：
      **① 真接进行为（4 条）**：
      · `freezeDamage` —— 细雪冻伤（批次 548）早有，只缺开关。`tickFreeze` 里一句
        `if (env.freezeDamage === false) return;`；**关的只是伤害，计时照样累加**
        （重开不会白嫖 7 秒）；判据写 `=== false` 而不是 `!env.freezeDamage`，缺省才是"开"。
      · `doVinesSpread` —— 藤蔓蔓延（批次 50）早有。`TickWorld` 加 `vineSpreadEnabled?` 回调，
        `vineBehavior` 开头判一次；关掉后**已有藤蔓还在**。
      · `snowAccumulationHeight` —— 雪层堆高（批次 50）早有。`snowHeightLimit?` 回调，
        上限取 `min(limit, MAX_SNOW_LAYERS)`；**只管堆多高，融化不受影响**。
      · `spectatorsGenerateChunks` —— `main.viewDistanceNow`：旁观 + 规则关 → 半径压到 0。
      **② 只登记不接行为（3 条，已弹窗确认）**：
      · `doTraderSpawning` —— 流浪商人有种类/刷怪蛋/音色，但 `MobSpawner` 里
        **没有"按周期自发刷新"**（`naturalSpawn: false`）。
      · `playersSleepingPercentage` —— 单人下"躺下就睡"，比例 ≤ 100 全成立。
      · `maxCommandChainLength` —— 只做**脉冲**命令方块，一次脉冲就一条，≥1 全等价。
      三条都写了注释说明"现在不生效"，默认值与原版一致（true / 100 / 256）。
      ⚠️ **顺手修掉一个会静默改值的坑**：`/gamerule` 的数值上限原来一律夹 0~100，
      而 `maxCommandChainLength` 要 65536 —— 统一夹取会把它悄悄压成 100。
      新增 `GAME_RULE_RANGES` 逐条范围 + `clampRuleNumber()`，`normalizeGameRules`
      与 `/gamerule` 共用；夹取时回执明说「超出范围，已夹到 N」。
      `test:tick` 103 → **118**（藤蔓/雪层正反对照 + 主循环接线断言）、
      `test:survival` 107 → **111**（冻伤开关）。
      浏览器实测（创造放细雪 → 切生存，`/data get entity @s Health` 读真实血量）：
      冻伤开着 20 秒 → 累计 **4 点**「受到 1 点伤害：冰冻」、血量 20 → 18；
      `freezeDamage false` 后 14 秒 → 新增 **0 点**（还自然回血到 19）；
      重开 12 秒 → 新增 **2 点**。`snowAccumulationHeight 99` → 「已夹到 8」、
      `maxCommandChainLength 999999` → 「已夹到 65536」、列表里 7 条都能看到。
      ⚠️ 实测踩到两个坑（都记在 TASKS）：① 验血量**别数心形 DOM**（半颗心的裁剪与
      `display:none` 混在一起，判不准），改用 `/data get entity @s Health`；
      ② `/setblock` 只能在创造模式用，**先创造放方块再切生存**，否则方块根本没放上去
      （第一轮就是这样：以为冻伤没生效，实际细雪没放上）。

**完成说明**：
- 关键取舍：Q4~Q7 的判断是错的（以为 16 色地毯 / 染色玻璃板 / 彩色陶瓦 / 床的染色配方缺失，
  实际批次 37 / 79 早就做完），四条一律作废并在原位留痕；以后排期先拿 `npm run test:reach`
  的实测缺口当依据，别按封面百分比。
- 验证与结果：`test:commands` 311 → 427 条、`test:waterlogged` 30 → 55 条、`test:i18n`
  随各面板递增；`/data` `/locate` `/gamerule` 均有浏览器实测（明细写在条目里）。
- 遗留：Q20 / Q21 同源的"未加载区块静默返回空气"差异记在根 `TASKS.md`；
  旧队列文件里的机制说明（卡死保护 / 自插额度 / 风险弹窗 / 流程七步）已并入
  [`.continue/HANDOFF.md`](./HANDOFF.md)，这里不再重复。
