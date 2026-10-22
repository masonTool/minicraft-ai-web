# 完成档案 · DONE

> 本文件是**已完成工作的唯一档案**，只回答"这批做了什么、怎么验的"——时间线，最近的在最上面。
> 按模块看现状与坑 → `OVERVIEW.md`；下次怎么避开 → `TIPS.md`；机制与格式 → `README.md`。
> **一条内容只写一个地方**，别在三份文档里各抄一遍。
>
> 收尾时**整份队列原样搬进来**（含每条任务下方的完成说明与 `[阻塞]`），标题格式 
> `## 批次 <号> · <日期> · 会话 <sid 前 8 位>` 见 `README.md` §3；这里不放格式样例（会被当成真批次）。
>
> 体量上限 300 行，超了跑 `node .continue/hooks/archive-done.mjs` 把最旧的批次整节搬进
> `DONE.archive.md`。2026-10-22 之前的历史（批次 1~613 / HANDOFF 批次流水 / 旧队列）已整份在那边。

## 设计决策与判定不做（2026-10-22 由 NOTES.md 并入）

> 这一节**不是时间线**：按主题记「当时怎么做的、为什么」，也就是"下一批还会被绊到"的那些结论。
> 并进 DONE 是因为框架只有六份文件（老版 `NOTES.md` 的下场就是被并进来），单开第七份必然被漏读。
> 新增一节追加在末尾；**单节 ≤ 15 行**，超了拆进 `notes/<模块>.md` 并在这里留一行索引。
> 只写结论与理由，不贴大段代码（代码在 git 里，会漂）。

### 索引：溢出文档

> `notes/` 是本节的**溢出位**，也是**入口文档放不下的细则**的落点（如 `notes/plan.md`）；
> 它不是第二套机制——规则仍只在入口文档说一次，这里只放细节。这里只留一行索引。

- **计划机制细则**（三层结构 / 三条分支 / 门禁 / 机器管不到的）→ [`notes/plan.md`](./notes/plan.md)；
  `README.md` §3 第 10 条只留指针（README 有 400 行硬上限）
- **模块能力台账**（约 900 行的表，按模块名搜）→ [`notes/modules.md`](./notes/modules.md)
  （2026-10-22 从 `docs/HANDOFF-ARCHIVE.md` 整份搬来）
- **历史经验总表**（2026-10-22 之前约 400 条，未按模块拆分，按关键词 grep）→
  [`notes/tips-history.md`](./notes/tips-history.md)（2026-10-22 从 `TIPS.md` 整段迁出）
- **批次索引**（一行一批，新→旧）→ [`notes/batches.md`](./notes/batches.md)
  （2026-10-22 从 `OVERVIEW.md` 迁出，不再占它的 200 行预算）
- **操作型工作站**（熔炉 / 酿造台 / 营火 / 锻造台…的通用契约 + 站台矩阵 + 接入 checklist）→
  [`notes/stations.md`](./notes/stations.md)（2026-10-22 从 `docs/` 迁来）
- **运维手册**（`window.__mc` 调试接口 + PWA / Pages / 套壳发布）→
  [`notes/ops.md`](./notes/ops.md)（从根 `HANDOFF.md` §5.5 / §6 抽出并合并）
- **低龄向功能规划**（新手引导 / 创造工具 / 单机小游戏的架构选型、4 项拍板、护栏与判定不做）→
  [`notes/kids-features.md`](./notes/kids-features.md)（2026-10-22 本轮讨论定稿）

### 长期待办 / 判定不做 / `[发现]` 优先级 → [`notes/decisions.md`](./notes/decisions.md)

> 三节正文（长期待办只有一份 · 判定不做 M17/O1/L4/L5 · `[发现]` 的优先级）已按本节自己的规矩
> （**单节 ≤ 15 行**）拆进 `notes/decisions.md`——它们合计 31 行 / 4.7KB，把 `DONE.md` 的
> 40KB **字节**门禁顶爆了（行数才 290，按行看是"没超"）。查理由去那份文件，这里只留索引。

---
## 批次 20261022-2338 · 2026-10-22 · 会话 b09ae4d7

**做了什么**：把"一批最多 8 条"这条**文档建议**换成分层机制——任务大过一个批次就写
`doing/plan-<名字>.md`（里程碑 → 阶段，**阶段 = 一批**），队列头部 `> 计划：` 绑定，
之后每批做完钩子自动从计划取下一阶段；**完成到里程碑就硬停**，要跑该里程碑的验收并弹窗等开发者拍板。
条数判据改成行数（完成时长 / 队列 500 行 / 目标变了）。共 7 条。

**条目**（原文照搬）：

- [x] [机制1] `lib.mjs` 加 plan 解析：`parsePlan()` / `parsePlanRef()` / 游标 / 里程碑完成判定 → `node -e` 冒烟脚本自测解析 4 种输入；`node .continue/hooks/check.mjs` 仍绿
  - 做了什么：`lib.mjs` 新增一节「计划（plan-*.md）」：`PLAN_FILE_RE` / `isPlanFile` / `planPath` / `listPlans` / `parsePlanRef`（队列头 `> 计划：x.md`，只认前 5 行）/ `parsePlan`（里程碑 + 验收 + 确认 + 阶段 + 批次号）/ `readPlan` / `milestoneComplete`
  - 为什么：三件事都做成**派生**而不是落盘状态——① 游标 = 第一条 `[~]`（没有就第一条 `[ ]`），不存任何 cursor 字段；② 阶段归属 = 阶段号 `MS<n>.<k>` 的前缀，不需要边界标记，跨里程碑只比前缀；③ 里程碑的"已确认"写在计划文件里（`- 确认：已验收 · 批次 x`），不依赖 `.continue/logs/` 的会话 state（那是本机、gitignore，换机器就丢）
  - 为什么 `milestoneComplete` 必须收 `alsoDone`：调用点总是"队列已清空、但计划里这一条还没勾"——只看计划永远差一条，边界**从不触发**且没有任何报错（off-by-one 静默失效）
  - 为什么确认行只认当前小节内：跨小节复用会让「MS1 已验收」被读成「MS2 也验收过了」，等于自动放行整个里程碑关卡；有断言钉住
  - 验证：`node --input-type=module -e` 冒烟 **18 条断言**全过（围栏内的阶段不计入 / 游标取第一条 `[~]` / 标题·验收·批次号解析 / MS2 不继承 MS1 的确认 / 第 7 行的 `> 计划：` 不生效 / 单阶段里程碑做完即完成 / 全勾 `open=false`）；`node .continue/hooks/check.mjs --fast` 五项全绿（ids / docs / config / hooks / project）
  - 批次：20261022-2338
- [x] [机制2] `auto-continue.mjs` 三个分支：无 plan 时行为**一字不变** / 有 plan 且未到边界 → 下令「收尾本批 + 从 plan 取下一条阶段 + 重置队列」/ 到边界 → 硬停请开发者验收 → 确认后开下一里程碑 → `node .continue/hooks/check.mjs` 绿（旧 14 条自检全过）
  - 做了什么：`wrapSteps(keepQueue)` 把收尾五步参数化（计划模式下第 5 步从"删队列"变成"重置队列"）；`!pick` 分支里加计划四路：① 队列头 `> 计划：` 指向的文件不存在 → 告警；② 计划里没有未完成阶段 → 整体收尾（这次删队列 + 删计划）；③ `milestoneComplete(plan, ms, 当前阶段)` 为真 → **硬停**（收尾 + 勾阶段 + 跑里程碑验收 + 弹窗三选一）；④ 否则 → 续批（收尾 + 勾阶段 + 取下一阶段 + 重置队列，且明说"不要问用户"）。重复下发用 `state.planStep`（键 = `计划名:阶段号`）挡住
  - 为什么"到边界"用 `milestoneComplete(plan, ms, 当前阶段)` 而不是 `plan.cursor.ms !== 下一个.ms`：判据必须是**做完这一条之后**里程碑才齐，这是"完成到里程碑才停"；直接看计划永远差一条，关卡从不触发且不报错
  - 为什么重复提醒要单独一个 `state.planStep` 而不是复用 `autoWrapped`：两者语义不同（前者是"关卡已提醒"、后者是"收尾已下发"），混用会让"里程碑停住"被误判成"收尾已下发"而直接放行
  - 为什么"先收在这里"复用 `> 状态：讨论中`：不新增第五种标记，暂停语义现有机制已经表达完整；新增标记要同时改 `classify` / `audit-ids` / 三份文档，收益不值
  - 验证：手工跑四个分支全对——A 未到边界 → 输出「这一批做完了，计划里还有下一阶段」并点名 `MS2.1 → MS2.2`；B 到边界 → 「里程碑完成，停下等验收」并列出 `npm run test:hud` 与三条"不许"；C 计划引用丢失 → 「不存在 / 不是没有计划，是引用写错了」；D 无 `> 计划：` → 仍走原「自动收尾」文案（**逐字未变**）。`node .continue/hooks/check.mjs hooks` 旧 14 条自检全过
  - 批次：20261022-2338
- [x] [机制3] `selftest.mjs` 补 plan 场景：续批、边界停、写 `确认：已验收` 后放行、`> 计划：` 指向不存在的文件要告警（不静默）、无 plan 队列行为不变 → `node .continue/hooks/check.mjs hooks` 全绿且新增 ≥ 5 条
  - 做了什么：`selftest.mjs` 加 `plan()` / `planQueue()` 两个构造器（在临时副本的 `doing/` 里写真实同构的 plan 与带 `> 计划：` 的队列），新增 **7 条** 用例：① 未到边界 → 续批并点名 `MS2.2`；② 到边界 → 硬停 + 列出里程碑验收命令 + 禁止替用户写确认；③ 硬停只提醒一次、第二轮放行；④ 上一里程碑已写 `确认：已验收` → 不再停，继续下一里程碑；⑤ 阶段全做完 → 整体收尾并删计划；⑥ `> 计划：` 指向不存在的文件 → 显式告警且**不**走普通收尾；⑦ 无 `> 计划：` 时第五步仍是「删除队列文件」
  - 为什么第 ⑦ 条最重要：它是这次改动的回归底线——存量会话（没有计划）的收尾文案必须**逐字不变**，否则加了计划反而改坏了在跑的批次；这条用 `5. 删除` 存在 + `不要删除队列文件` 不存在两个条件同时钉
  - 为什么第 ④ 条要构造两个里程碑：只写一个已确认的里程碑测不出"会不会误停"——游标必须已经落到**下一个**里程碑、且那个里程碑还没做完，才区分得出"已验收就放行"和"每次到边界都停"
  - 验证：自检条数 **36 → 43**（新增 7 条全部被收集并通过）；`node .continue/hooks/check.mjs hooks` ✓ 2441ms
  - 批次：20261022-2338
- [x] [机制4] 注入协议改措辞与 plan 段：`queue-init.mjs` 第 8 条由「建议 ≤ 8 条」改成行数判据 + 新增 plan/里程碑段；`.codebuddy/skills/continue-task/SKILL.md` 与 `assets/.continue/` 副本同步 → `grep -rn "≤ 8 条"` 只剩历史档案；`node .continue/hooks/check.mjs` 绿
  - 做了什么：① `queue-init.mjs` 第 8 条改写为「一批多长看行数，不看条数」（判据：完成说明 > ~80 行 / 队列 > 500 行 / 目标变了；条数只是经验值 8~12），新增第 9 条「任务大过一批先写计划」+ `MS1` 模板围栏；第 7 条把 `doing/` 说明改成"住着队列与计划两类"；② `README.md` §3 第 9 条同步改写、新增第 10 条并指向新文件；③ 新建 `.continue/notes/plan.md`（三层结构 / 格式 / 三条分支表 / 5 条门禁 / 机器管不到的 3 件事）；④ `SKILL.md` 的「长任务分阶段」拆成「行数判据 + 计划」两条；⑤ `assets/.continue/` 回灌 README 与 4 个钩子
  - **顺带修掉一个真 bug（改写后才暴露）**：`queue-init` 的注入原本用 `process.stdout.write` 紧跟 `process.exit(0)`。stdout 是管道时它是异步的，注入文本从 3.5KB 涨到 5KB 后**JSON 在中间被截断**，`JSON.parse` 抛错 → 自检报的是"没有注入会话 ID"，差点被当成解析逻辑写错。新增 `lib.writeFd(fd, text)`（`fs.writeSync`）并替换 `emitAllow` / `emitBlock` / `queue-init` 三处写出口。这类截断**没有任何报错**，宿主只会静默丢掉整个注入
  - **顺带修掉一个设计漏洞**：`queue-init` 的「其他会话还有未完成队列」会把 `plan-*.md` 当成别人的队列（里面全是 `[ ]` 阶段），每次注入都劝 AI「去接管 / 删掉它」——那是本会话在用的计划。在 `others` 的过滤里排掉 `plan-` 前缀
  - 为什么 README 只留指针、细则放 `notes/plan.md`：README 有 400 行硬上限（改前正好 400），而机制细则（三条分支 + 门禁 + 边界）值得完整写下来；`notes/` 不在每轮上下文里，按 `notes/plan.md` 一句话就能到
  - 为什么 `notes/plan.md` 不会变成第二个 `NOTES.md`：它只有一件事（计划怎么写），有两个固定消费点（写计划前 / 排查"为什么不往下走"），且**每行信息都能从批次索引反查回来**——所以它永远可以安全瘦身
  - 验证：注入实测（新会话）`len 3678`，`≤ 8 条` **false**、行数判据 true、计划段 true、"完成到里程碑就停" true、`plan-<名字>.md` true、"重置" true；`node .continue/hooks/selftest.mjs` **43 项全过**；`node .continue/hooks/check.mjs --fast` **五项全绿**（ids / docs / config / hooks / project），README 400 行踩在上限内
  - 批次：20261022-2338
- [x] [机制5] `tools/audit-docs.mjs` 加 5 条门禁（plan 行数/字节、阶段按 MS 分组连续、plan 批次号存在、队列头 `> 计划：` 引用完整、注入文本仍有 plan 段）→ `npm run audit:docs` 绿；故意造一个坏 plan 能红
  - 做了什么：`tools/audit-docs.mjs` 新增「计划的结构与引用完整性」一节（6 条断言）：① `plan-*.md` ≤ 500 行 / 60KB；② 阶段号必须归在自己小节对应的里程碑下；③ 同一里程碑的阶段必须**连续**（`MS1.1/MS2.1/MS1.2` 判红）；④ 阶段行挂的批次号必须在 `notes/batches.md` / `DONE.md` / `DONE.archive.md` / `doing/` 里存在，且 `[x]` 阶段必须有批次号；⑤ 计划里最多一条 `[~]`；⑥ 队列头 `> 计划：x.md · 阶段 MSa.b` 的文件与阶段都必须存在；⑦ `queue-init.mjs` 注入里必须还有 `plan-<名字>.md` 与「完成到里程碑就停」
  - 为什么复用 `lib.mjs` 的 `parsePlan` 而不在这里另写一份：两份解析迟早不同步，那时的症状是"计划能写成、门禁也绿、钩子读不懂"——**没有任何报错**
  - 为什么第 ③ 条（阶段连续）值得单独一条门禁：跨里程碑判定全部靠"比较 `MS` 前缀"，一旦阶段交错（`MS1.1 → MS2.1 → MS1.2`），前缀比较的对象就不是"当前里程碑"了，边界会在错误的位置触发或永不触发
  - 为什么第 ⑦ 条要查注入文本：`queue-init.mjs` 是框架文件，重装会整份覆盖回旧版；覆盖后计划机制会**无声消失**，而其它门禁全绿（这跟批次 1363 踩过的 `DOC_LIMITS.TASKS` 被改回 600 是同一类事故）
  - 验证：`npm run audit:docs` 绿（`计划：0 份`）；故意造坏数据后 **4 条问题全部命中**——编号与小节不一致、假批次号 `20990101-9999`、2 条 `[~]`、队列头引用不存在的 `plan-nope.md`；删掉坏数据后复绿
  - 批次：20261022-2338
- [x] [机制6] 文档接线：`README.md`（§1 分工 / §3 队列规则 / §6 Stop 行为）、`AGENTS.md`（§2 表格一行）、`HANDOFF.md`（§4 约定）→ `npm run audit:docs` 与 `npm run audit:tasks -- --print` 绿
  - 做了什么：① `AGENTS.md` §1 去掉"六份文件"这个会随文件数漂的数字；§2 按需展开表补一行「这个大任务拆成了哪几批、走到哪个里程碑了 → `notes/plan.md` + `doing/plan-*.md`（平时不读）」；② `HANDOFF.md` §4 加两段约定：「大任务先写计划」（阶段=一批 / 队列头绑定 / 重置而非删除 / 完成到里程碑硬停 / 确认行只在用户答复后写）与「一批多长看行数不看条数」；③ README 的机制接线在第 4 条已做（§3 第 9/10 条 + §1 判据去重），§6 的 Stop 行为表**不改**——三条分支的细则写在 `notes/plan.md`，README 只留指针
  - 为什么 README §6 不再抄一遍分支表：§6 是"钩子怎么工作"的机制索引，抄一份分支表就等于多一处会漂的副本；`notes/plan.md` 已经是那份细则的唯一来源
  - 为什么顺手改了 HANDOFF 的「提交总数」：`npm run audit:tasks --print` 判它过期（写着 1407、实际 1412）。这个锚点只能手写、容差 ±2，所以**每次收尾提交时要再对一次**（收尾那次会让 HEAD 再涨 1~2）
  - 验证：`npm run audit:docs` 五项全 ✓（HANDOFF 191/520 行；计划检查 `0 份`）；`npm run audit:tasks -- --print` 六项全 ✓（编号无重复 / 各段连续 / 进度口径一致 / README 路线图一致 / 提交总数一致 1412 / 172 套一致）；`node .continue/hooks/check.mjs --fast` 五项全绿
  - 批次：20261022-2338
- [x] [机制7] 全量验证 → `npm run check` 全绿（172 套 + 三张台账 + 文档门禁）；`node .continue/hooks/check.mjs` 五项绿
  - 做了什么：跑全量门禁 + 框架五项门禁，并复核注入文本
  - 验证：`npm run check` **exit 0**——typecheck / 172 套离线 / `audit:tasks`（编号无重复、各段连续、进度口径一致、README 路线图一致、提交总数一致、172 套一致）/ `audit:coverage`（覆盖度台账与表一致）/ `audit:diffs`（差异 66 条 / 注意 188 条一致）/ `audit:docs`（五项全 ✓）/ `check:browser`（默认跳过，与既有口径一致）；`node .continue/hooks/check.mjs --fast` 五项绿；新会话注入实测 3678 字符且旧措辞为 `false`
  - 批次：20261022-2338

## 批次 20261022-2330 · 2026-10-22 · 会话 eb9037a4

**做了什么**：生存引导按用户要求缩到石镐（8→4 步），并修掉"9 个方块图标永久空白"——图集还没铺像素时就有 UI 画了图标，坏结果被缓存住。共 4 条。

> 图标那条不是猜的：截图像素分析定位到空的 9 格，正好是建造工具条用到的 9 件方块；
> 工具条在 `atlas.ensureUploaded()` 之前构造，用的是 `deferPaint` 的空图集。

- [x] [引导6] 生存引导 8 步 → 4 步（终点石镐）：`src/tutorial/steps.ts` 删熔炉/铁镐/床/小屋 + 去掉 bed 家族，`I18n.ts` 删 8 条文案，`boot.ts` 注释同步 → `npm run test:tutorial` 全绿
  - 做了什么：`SURVIVAL_STEPS` 只留 log / table / wood_pickaxe / stone_pickaxe；`TutorialFamily` 去掉 `bed`（`familyOfItem` 同步）；中英各删 4 键；石镐一步的说明补"往下挖几格就是石头"（最后一步最容易卡住的地方）
  - 为什么：用户明确"做到石镐就够"——铁要挖到 y≈16 再烧，是一条 45~50 格深的链子，卡住的人只会把卡片关掉。步骤表是数据，删了不影响判定/存档结构
  - 验证：`npm run test:tutorial` 110 → **113 条**全过；其中两条专门钉老存档：`completed` 里带已删的 4 个 id 时只认连续前缀 4 个 → **直接判定引导完成，不倒退**；另有一条断言"熔炉/铁镐/床/小屋不在表里"，防以后无声加回去
  - 批次：20261022-2330
- [x] [图标1] 9 个方块图标永久空白：`main.ts` 把 `atlas.ensureUploaded()` 挪到 App 构造最前面（早于 TutorialCard/BuildToolbar），`TextureAtlas` 暴露 `isPainted`，`BlockIcon` 未铺像素时**不画也不缓存** → 真浏览器复验 9 个图标不透明像素 > 0
  - 做了什么：`main.ts` 把"进世界先铺图集 + clearBlockIconCache"整段搬到构造函数第一行；`TextureAtlas` 加 `get isPainted()`；`blockIconCanvas` 在 `cache.set` 之前加 `if (!atlas.isPainted) return null`（回退到单格贴图，宁可空一次也不留坏缓存）
  - 为什么：主菜单阶段图集是 `deferPaint` 的空画布，`BuildToolbar` 构造时就画了 9 个方块图标（BRICKS/GLASS/SAND/CHEST/CRAFTING_TABLE/OAK_PLANKS/OAK_LOG/OAK_LEAVES/COBBLESTONE），拼出来全透明，缓存只按 `atlas.revision` 失效 → 这一页里那 9 个方块在快捷栏/创造栏/分类栏**全都**空白，切分类也不会好
  - 验证：headless Chromium（792×360 / dpr 3 / 触屏）建生存世界 → 开背包 → 统计全部 1129 个创造格的 canvas 不透明像素：修前 `空白 9 个（4,5,6,7,8,11,43,45,70）`，修后 **空白 0 个**
  - 批次：20261022-2330
- [x] [图标2] 自愈与断线：进世界清一次图标缓存（旧会话/旧版本留下的坏图标不必刷新页面就恢复）+ `tools/texture-test.ts` 加 4 条静态断言 → `npm run test:textures`
  - 做了什么：`clearBlockIconCache()` 现在在进世界时也调一次（原先只在"回前台"那条路径里）；`test:textures` 新增一节：铺图集的语句必须早于 `new TutorialCard(`/`new BuildToolbar(`、`clearBlockIconCache` 至少两处、图集有 `isPainted`、守卫在 `cache.set` 之前
  - 为什么：这两种错（次序错、缓存毒化）都**不会报错**，只会少画东西；能断言的只有"代码形状"，所以静态断言比截图回归可靠
  - 验证：`npm run test:textures` 29 → **33 条**全过
  - 批次：20261022-2330
- [x] [自测] 全量门禁：`npm run check` 全绿（172 套 + 三张台账 + 文档）→ 分两次提交并 push
  - 做了什么：`0c5adeab`（引导，4 文件）、`848e03e7`（图标，4 文件）
  - 验证：`test:tutorial` 113 条、`test:textures` 33 条、`npm run check` 全绿；两次提交的 `checks.fast` 均通过
  - 说明：图标那条做了浏览器复验（有复现脚本、前后都量了不透明像素）；引导只跑了离线套件
  - 批次：20261022-2330

---
## 批次 20261022-2220 · 2026-10-22 · 会话 eb9037a4

**做了什么**：修用户真机报的三件事——引导卡按钮点不动（触摸视角面吃掉点击）、生存模式找不到铁（文案没给位置）、橡木门打不开且上半扇透明（渲染盒抄了碰撞判据 + 红石整体重算覆盖手动状态）。共 5 条。

> 口径：改法尽量小，不新增系统、不改玩法语义。门那两处是**修 bug**，不是新机制；
> 引导文案只补"在哪找"，不改步骤表（8 步的目标与顺序仍是 `notes/kids-features.md` 拍板的那份）。

- [x] [引导4] 引导卡与按钮点不动：`index.html` 给 `.tutorial-root` 抬层（`position: relative` + `z-index: 1`，与 `#hotbar` 同一处方）→ `npm run test:tutorial` 新增静态断言通过
  - 做了什么：`.tutorial-root` 从 `pointer-events: auto` 扩成 `pointer-events: auto; position: relative; z-index: 1`，并就地写明原因
  - 为什么：触摸端 `#touch-ui > #touch-look` 铺满全屏、`pointer-events: auto`，而它在 DOM 里排在 `#hud-right` 之后；两者都没 z-index 时后出现的在上层，手指点卡片命中的是视角面（表现：卡片看得见但收起键/「不再提示」点不动，反而把身后方块挖了）。快捷栏批次 95 踩过同一个坑，处方就是 `z-index: 1`
  - 验证：`npm run test:tutorial` 108 → **110 条**全过（新增"引导卡抬了层"静态断言，读 `index.html`）；`npm run check` 全绿
  - 批次：20261022-2220
- [x] [引导5] 引导太难做：铁镐一步的说明补"铁矿石在地下 y≈16 最多、往下挖约 50 格"（中英各一条）→ `npm run test:tutorial` 断言文案里有该提示
  - 做了什么：`I18n.ts` 改 `tutorial.survival.ironPickaxe.desc` 两条（中/英），补"在哪找"的具体位置；步骤表、目标判定、卡片几何一律没动
  - 为什么：用户原话是"引导不要那么难实现"——核对下来难点不在代码而在**目标不可执行**：铁矿石分布在 y -24~56、众数 y=16（`OreGenerator`），地表约 63~70，等于要往下挖 45~50 格，而原文案只说"粗铁放进熔炉"。只补最实用的一句，不改 8 步的设计（那是 `notes/kids-features.md` 拍板的），也不加新目标
  - 验证：`npm run test:tutorial` 新增"铁镐一步说了铁矿石在哪找（y≈16）"断言通过（110 条全过）
  - 批次：20261022-2220
- [x] [门1] 开着的门变透明：`meshBoxes('door')` 改为始终返回 `doorBox(state)`（开着的门只是**没有碰撞**，不是不画）→ `tests/collision.test.ts` 补一条渲染断言
  - 做了什么：`meshBoxes('door')` 去掉 `isDoorOpen(state) ? [] : ...`，改为始终 `[doorBox(state)]`；`doorBox` 内部本来就按开关把门板转到门轴那一侧，开着的几何一直是死代码
  - 为什么：渲染盒抄了碰撞盒那条判据（注释还写着"没有碰撞体积"），于是门一开整扇消失——正好对上用户"上半部分透明了"。碰撞侧的空数组仍留在 `collisionBoxes`，两者差异由断言钉住
  - 验证：`tests/collision.test.ts` 13 条全过（新增"开着的门仍要画、且薄边从 Z 转到 X"与"碰撞仍为空"两条）；`npm run check` 全绿
  - 批次：20261022-2220
- [x] [门2] 手动开门被红石立刻关回：`RedstoneEngine.applyOpenableLoad` 改成**电平沿触发**（门/活板门/栅栏门三类都覆盖），换维度时清缓存 → `npm run test:redstone` 新增 3 条断言
  - 做了什么：加 `openablePower: Map<string, boolean>`（每个可开合方块的"上次电平"）；`applyOpenableLoad` 只在电平变化时动门，第一次见到"没电却开着"的门放过（避免把玩家手动开的门关回去）；方块不再是可开合类型时删条目；`setDimension` 调 `clearOpenablePower()`
  - 为什么：引擎是"洪泛 + 整体重算"，每次方块变化都按**当前电平**重写负载，而手动开合不改电平；`toggleDoor` 先写下半再写上半、两次写入各触发一次重算，于是下半被关回、上半留下来 —— 这就是"半扇门 + 再也恢复不了"。原版语义是**电平变化才驱动一次**，改完之后手动状态不会被无关重算覆盖
  - 验证：`npm run test:redstone` 174 → **179 条**全过（新增 5 条：手动开的门/活板门/栅栏门不被重算关回、旁边方块变化不影响、上下半仍同步）；`npm run check` 全绿
  - 批次：20261022-2220
- [x] [自测] 全量门禁：`npm run test:tutorial` / `test:redstone` / `npm run check` 全绿 → 分两次提交（引导、门）并 push
  - 做了什么：`327b7c61`（引导：抬层 + 文案 + 2 条断言）、`10eddcbd`（门：渲染盒 + 电平沿 + 6 条断言），推送到 `origin/main`
  - 为什么：两处独立可回滚，按"每个独立改动单独提交"拆开
  - 验证：`npm run test:tutorial` 110 条、`test:redstone` 179 条、`npx vitest run tests/collision.test.ts` 13 条、`npm run check`（typecheck + 全部离线套件 + 三张台账）、`npm run build:fast` 896ms 出包，全部通过；两次提交的 `checks.fast` 均通过
  - 说明：**未做浏览器/真机自测**（按既有约定不主动跑端到端）：点击是否真的落到卡片上、开门手感仍需真机确认
  - 批次：20261022-2220

---
## 批次 20261022-1954 · 2026-10-22 · 会话 335c7acf

**做了什么**：低龄向三块一次做完——新手引导（12 步路标 + 右上角任务卡 + 存档仓）、创造建造工具（撤销 / 选区填充 / 复制镜像 / 建筑模板 / 工具条）、单机小游戏（会话框架 + 方块渲染 + 主菜单入口 + 推箱子 10 关 + 打砖块 10 关 + 回归与性能对比）。共 14 条。

**条目**（完整原文与逐条说明见 [`doing/20261022-1954-kids-features.md`](./doing/20261022-1954-kids-features.md)，已冻结；这里只留一行结论）：

- [x] [引导1] 引导数据与纯逻辑 · 60 条断言；元素族按方块名判，不手抄 6 种原木 / 16 色床的 id
- [x] [引导2] 任务卡界面 · 挂 `#hud-right`、可折叠成"图标 3/8"徽章、5 种视口都不压暂停键与快捷栏（83 条）
- [x] [引导3] 存档与接线 · 第 13 个对象仓（`DB_VERSION` 10→11），老存档无数据即不弹（94 条）
- [x] [创造1] 撤销 / 重做 · 栈上限 64，批量写入一次性归并
- [x] [创造2] 选区与框选填充 · 32³ 体积上限，超预算分批执行
- [x] [创造3] 复制 / 粘贴 / 镜像 · 快照往返一致、镜像坐标正确、越界裁剪
- [x] [创造4] 建筑模板 · 小屋 / 桥 / 树 / 塔，落位前做碰撞与支撑检查
- [x] [创造5] 建造工具条与输入互斥 · 只在"建造模式"激活时接管左键，不激活时长按破坏照常
- [x] [小游戏1] 会话框架 · 主循环开头早退、按钮/Esc/异常三条退出路径可重入（26 条）；端到端由小游戏6 的 `minigame:perf` 补齐
- [x] [小游戏2] 方块渲染与关卡格式 · 按图集 tile 分组（draw call = 方块种类数）、字符画关卡逐条报错
- [x] [小游戏3] 入口与进度 · 首页第三颗 `world-secondary`（第一颗 `.world-primary` 仍是开始游戏）、`localStorage: mc.minigame.v1`、不锁关
- [x] [小游戏4] 推箱子 10 关 · BFS 验证 10 关全部可解且都在步数上限内（1~15 步），共 150 条
- [x] [小游戏5] 打砖块 10 关 · 固定 1/120 子步（时间步长无关）、撞砖单轴反转、10 关逐关能清屏，共 208 条
- [x] [小游戏6] 回归与性能 · `minigame:perf` 9 项（几何体 92→93→92 回落、纹理 2→2、帧率不劣化）、`check` 172 套、`build:fast` 858ms、`guard` 0 错误；补 `TutorialCard.setSuppressed()` 让位

---

## 批次 20261022-2014 · 2026-10-22 · 会话 1fc8c4d7

**做了什么**：把 continue-task skill 纳入版本管理，并把上一批的 5 个框架补丁回灌到 skill 的 `assets/`，让重装源与运行版一致。共 2 条。

**条目**（原文照搬）：

- [x] [机制-6] 把 continue-task skill 纳入版本管理，并把本批 5 个钩子 + README 同步进 skill assets：`.gitignore` 放行 `.codebuddy/skills/continue-task/`；`cp .continue/hooks/{lib,auto-continue,audit-ids,audit-docs,selftest}.mjs` 与 `.continue/README.md` 到 `assets/.continue/` → `git check-ignore` 不再命中、`git ls-files` 有 skill、`diff -rq` 两份 hooks 无差异
  - 做了什么：根 `.gitignore` 把 `.codebuddy/skills/` 改成 `.codebuddy/skills/*` + `!.codebuddy/skills/continue-task/`；把本批改过的 5 个钩子（`lib` / `auto-continue` / `audit-ids` / `audit-docs` / `selftest`）与 `.continue/README.md` 拷进 `assets/.continue/`，让 skill 成为补丁的源；`git add` 整个 `continue-task`（26 个文件）。
  - 为什么：上一批改的是"已安装的框架"，skill 的 `assets/` 还是旧模板；只把 skill 纳入 git 而不回灌补丁，下次重装就会把 5 个修复覆盖掉。纳入版本管理后，重装源与运行版一致。
  - 验证：`diff -rq .continue/hooks assets/.continue/hooks` 无差异；`diff -q` README 无差异；`git check-ignore` 不再命中；`git ls-files` 26 个；`check-framework.mjs` 通过；`test-install.mjs` 19 项通过；`node .continue/hooks/check.mjs` 五项全过；`npm run check` exit 0。
  - 批次：20261022-2014
- [x] [机制-7] 更新“skills 是本地”的文档口径：`HANDOFF.md` §5 的跨机器边界表把 `continue-task` 移到“随仓库走”，其余本地技能保持忽略；同步 `assets/.continue/README.md` → `grep` 口径正确、`npm run check` 绿
  - 做了什么：`HANDOFF.md` §5 的跨机器边界表把 `.codebuddy/skills/continue-task/` 移到"随仓库走"，注明它是框架补丁的源、重装用它；其它技能仍留在"只在本机"。
  - 为什么：skill 已入库，旧表还写着"skills 全是本地"，下一个人会以为可以直接删/不同步；资产 README 在上一批已同步，本次无需再改。
  - 验证：`grep -n "continue-task" .continue/HANDOFF.md` 指向"随仓库走"那列；`git check-ignore` 不再命中；`check.mjs` 五项全过；`npm run check` exit 0（audit-tasks 用容差 2 通过：写着 1379、实际 1381）。
  - 批次：20261022-2014
- [ ] [机制-8] 收尾：把队列原样搬进 `DONE.md`、更新 `OVERVIEW` / `TASKS` / `TIPS` / `notes/batches.md` 与 `HANDOFF` 提交总数锚点，删队列 → `node .continue/hooks/check.mjs` 与 `npm run check` 全绿

---

## 批次 20261022-1950 · 2026-10-22 · 会话 1fc8c4d7

**做了什么**：把 continue-do 机制按上一轮评估的五个问题硬化：入口去重、未验证判定、TIPS 历史表迁出、批次索引迁出、字节门禁。共 5 条。

**条目**（原文照搬）：

- [x] [机制-1] 入口文档去重 + 防漂断言：`AGENTS.md` / `.continue/HANDOFF.md` 删掉"批次号 = 提交总数"的过期复述，只留指向 `README.md` 的指针；`tools/audit-docs.mjs` 加一条"入口文档不得复述过期机制"的检查 → `npm run audit:docs` 绿，且人为写回旧句会红
  - 做了什么：`AGENTS.md` §4 第 5 条改成"机制细节只看 README"的指针；`HANDOFF.md` §1 删掉"批次号 = 提交总数"和手写的"最近一批 1363"，改成看 `DONE.md` 标题；`tools/audit-docs.mjs` 新增正则 `/批次号\s*[=＝:：]\s*[^\n]{0,16}提交总数/`，扫 `AGENTS.md` 与 `HANDOFF.md`。
  - 为什么：钩子实际注入的是 `20261022-1950`，入口文档却还写着"提交总数"；新会话第一份读到的就是错的，而行数门禁查不出语义漂。
  - 验证：`npm run audit:docs` 绿；临时往 `AGENTS.md` 追加旧句 → 检查红并给出"改成指向 README"的提示，还原后重新绿；`node .continue/hooks/check.mjs` 五项全过；`npm run check` 全绿。
  - 批次：20261022-1950
- [x] [机制-2] 修"未验证"误判：`auto-continue.mjs` 去掉 `UNPROVEN_RE` 里的 `跳过`、验证行改为只认 `验证：` 开头；`selftest.mjs` 补三条用例（"默认跳过"不弹窗 / "没跑"要弹窗 / 正文提"验证"不算凭证）；`README.md` 同步措辞 → `node .continue/hooks/check.mjs hooks` 绿
  - 做了什么：`UNPROVEN_RE` 去掉 `跳过`；新增 `VERIFY_RE = /^\s*(?:[-*]\s*)?验证\s*[:：]\s*(.*)$/`，只把 `验证：` 开头的一行当凭证（原来正文里只要出现"验证"两个字就算）；`selftest.mjs` 加三条用例（默认跳过不弹窗 / 没跑要弹窗 / 正文提"验证"但没有凭证行仍算缺说明）；`README.md` 两处措辞同步。
  - 为什么：本项目 `check:browser` 默认跳过，诚实的验证行会带"跳过"二字，旧正则把它判成未验证，等于每次自动收尾都弹窗；同时"验证"任意出现就能冒充凭证，门禁太松。两个方向一起修。
  - 验证：`node .continue/hooks/check.mjs hooks` 通过（新增三条用例）；`npm run check` 全绿。
  - 批次：20261022-1950
- [x] [机制-3] TIPS 历史表迁出主文件：把 `.continue/TIPS.md` 第 87 行起的「历史经验总表」（约 170KB）整段搬到 `notes/tips-history.md`，TIPS 只留按模块的坑；`OVERVIEW.md` 移除同名模块并改指新文件 → `node .continue/hooks/check.mjs ids docs` 绿，TIPS ≤ 150 行
  - 做了什么：用 `sed -n '92,$p'` 把「历史经验总表」的表格（408 行 / 约 189KB）整段搬到 `notes/tips-history.md`（表头另写，表格原文未改），TIPS 截到前 84 行；`OVERVIEW.md` 删掉同名模块、两处指路改到新文件，头部补一行索引；`DONE.md` 的溢出文档索引补一行。
  - 为什么：TIPS 用 499 行装了 190KB，行数门禁看不出真实 token 成本；而且 80% 内容是一张没有模块列的总表，"按模块 grep"在多数模块上名存实亡。迁出后 TIPS 只装按模块整理的坑，总表作为历史归档按关键词搜。
  - 验证：`node .continue/hooks/check.mjs ids docs` 绿；`npm run audit:docs` 绿；`wc -l` 口径 TIPS 84 行、OVERVIEW 190 行；`grep -rn "TIPS.md#历史经验总表"` 无残留；`npm run check` 全绿。
  - 批次：20261022-1950
- [x] [机制-4] 批次索引迁出 OVERVIEW：`OVERVIEW.md` 的「三、批次索引」表搬到 `notes/batches.md`，只留一行指针；`audit-ids.mjs` 同时读两份做 DONE↔索引 交叉核对 → `node .continue/hooks/check.mjs ids` 绿，OVERVIEW ≤ 190 行
  - 做了什么：新建 `notes/batches.md`（表头 + 3 行索引）；`OVERVIEW.md` 的「三、批次索引」只留两行指针（199 → 185 行）；`audit-ids.mjs` 的索引核对改成 `OVERVIEW` 与 `notes/batches.md` 的并集；`DONE.md` 溢出索引补一行；顺带把 `HANDOFF.md` 的提交总数锚点 1374 → 1377（连做三次提交后 `audit:tasks` 当场报差 3，这正是它该干的）。
  - 为什么：批次索引每批 +1 行，是 OVERVIEW 200 行预算里唯一只增不减的部分；移走后 OVERVIEW 185 行，留出约 3 批余量。
  - 验证：`node .continue/hooks/audit-ids.mjs --strict` exit 0（若新文件没被读到，3 个批次会变成 3 条 warning，strict 下即失败）；`check.mjs ids docs` 绿；`npm run check` exit 0；`wc -l OVERVIEW` = 185。
  - 批次：20261022-1950
- [x] [机制-5] 文档体量门禁加字节口径：`lib.mjs` 增 `DOC_BYTE_LIMITS`，`audit-docs.mjs` 同时查行数与字节；`tools/audit-docs.mjs` 的重装守卫同时盯 `TASKS_BYTES` → `node .continue/hooks/check.mjs docs` 绿，临时灌大 TIPS 会红
  - 做了什么：`lib.mjs` 新增 `DOC_BYTE_LIMITS`（README 40KB / DONE 40KB / OVERVIEW 24KB / TASKS 900KB / TIPS 60KB / 队列 60KB）；`audit-docs.mjs` 同时查行数与字节，成功时打两行摘要；`tools/audit-docs.mjs` 的重装守卫加 `TASKS_BYTES`，并把"键不见了"从静默 `continue` 改成报错；README 的 `docs` 说明同步。
  - 为什么：TIPS 曾用 499 行装 190KB，行数门禁完全看不出来；行数只适合"条目密度稳定"的文件，带大表格的必须同时看字节。
  - 验证：`audit-docs.mjs` 绿（行数 / 字节两行摘要）；临时往 `TIPS.md` 灌 200KB → 红（202KB > 60KB），还原后绿；把 `TASKS_BYTES` 改名 → 项目守卫报"不见了"并 exit 1，还原后绿；`npm run check` exit 0。
  - 批次：20261022-1950

---

## 批次 20261022-1944 · 2026-10-22 · 会话 0a49498a

**做了什么**：把 `.continue/NOTES.md`（框架六份文件之外的第七份）整份并入 `DONE.md`，并让全仓引用改指新位置。共 2 条。

**条目**（原文照搬）：

- [x] 把 `NOTES.md` 的四节正文并入 `DONE.md`（新建「设计决策与判定不做」节，原文照搬不改写）→ `DONE.md` 仍 ≤300 行、`node .continue/hooks/check.mjs` 绿
  - 做了什么：`DONE.md` 头部区（第一个 `## 批次` 之前）新增 `## 设计决策与判定不做（2026-10-22 由 NOTES.md 并入）`，收下原 `NOTES.md` 的四节：三份溢出文档的索引、长期待办只有一份、判定不做（M17/O1/L4/L5）、`[发现]` 的优先级；原文照搬，只把二级标题降成 `###` 免得与 `## 批次` 混淆。
  - 为什么放头部区：`archive-done.mjs` 按 `## 批次 ` 切分，head 永远原地留着、只搬批次小节；放文末会被并进**最旧那个批次**的段落、一归档就跟着搬走。
  - 代价：这一节不吃时间线的归档，只受 300 行总上限约束（现在 107 行）。
  - 验证：`node .continue/hooks/check.mjs` 五项全过；`audit-docs` → DONE.md 107/300。
  - 顺带：`OVERVIEW.md` 批次索引把已归档的 1355 补回来（`audit-ids` 把归档里的批次也算"已归档"，缺行会告警）；为守住 200 行上限，压掉一行说明文字。
  - 批次：20261022-1944
- [x] 删掉 `NOTES.md`，并改掉 5 处指向它的说明（`TASKS.md` 头部、`HANDOFF.md` 三处、`AGENTS.md` §2、`notes/modules.md` 第 7 行）→ `grep -rn "NOTES.md"` 只剩历史档案、`npm run check` 绿
  - 做了什么：删 `NOTES.md`；`HANDOFF.md` 三处（索引表两行、明确不做那段、跨机器目录清单里的 `NOTES`）、`TASKS.md` 头部、`AGENTS.md` §2、`notes/modules.md` 第 7 行全部改指 `DONE.md` 头部的「设计决策与判定不做」节。
  - 为什么：删文件不改引用 = 下一轮照着指过去扑空；`AGENTS.md` 第 19 行那句"不要再新建同名文件（… `NOTES.md` …）"**故意保留**——它正是防止有人把第七份文档再造出来。
  - 验证：`node .continue/hooks/check.mjs` 五项全过；`npm run audit:tasks -- --print` 七条全过；全仓 `grep -rn "NOTES.md"` 只剩本队列、`DONE.md`（并入说明）、`AGENTS.md`（禁用清单）与框架 `SKILL.md`。
  - 批次：20261022-1944

---

