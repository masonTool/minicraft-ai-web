# 自动继续队列

> 由 `.codebuddy/hooks/auto-continue.mjs`（Stop 钩子）读取。
> 只要这里还有 `- [ ]` 或 `- [~]` 的条目，AI 在每轮结束时会自动继续，不会停下来等确认。
>
> - 紧急刹车：`touch .codebuddy/auto-continue.off`
> - 恢复自动：`rm .codebuddy/auto-continue.off`
> - 单次会话次数上限：环境变量 `AUTO_CONTINUE_MAX`（默认 12）

---

> ### 本文件的排列（批次 337 起由 `npm run docs:trim` 维护）
>
> 它同时干两件事：**待办队列**（Stop 钩子读它决定要不要自动继续）与**最近 3 批的记录**。
> - **批次 1~333 的流水已搬到** [`auto-continue-archive.md`](./auto-continue-archive.md)
>   （内容一字未改；那边全是 `- [x]`，不影响钩子的"要不要继续"判定）；
> - 本文件只留**当前队列** + **最近 3 批**（`npm run docs:trim` 自动归档，上限 320 行）；
> - **找最新进度**：看最上面的「当前队列」；**下一步做什么**：看队列里剩下的条目；
> - 钩子只认**行首**的 `- [ ]` / `- [~]`；
> - ⚠️ 条目总数与行数不要手抄，`npm run audit:docs` 会核对。

---

## 当前队列

> 批次 399 重新补的队列（原来这一段停在 344、写着"队列已清空"，
> 而文件尾部已经记到 396——**钩子只看有没有 `- [ ]`**，所以那段时间一直是"队列空"）。
> 排序依据是"覆盖度台账里缺得最多 + 越晚排越堵"：配方（65%）→ 群系（69%）→
> 记分板（`/execute if score` 的前置）→ i18n → 长尾行为。

- [x] 批次 400：配方第一批——补"有物品没配方"的缺口（配方 654 → **680**），
      并在 `test:crafting` 里补 20 条**行为断言**（摆对了出、摆错了不出）
- [x] 批次 401：D20 收口——**不是加群系，是把口径改对**：1.18 主世界就是 50 个，
      我们全有；分母 72 → 61（55/61 = 90%），`D20` 勾成 `[x]`
- [x] 批次 402：M23 记分板第一批——纯逻辑 + `/scoreboard` + `/execute if score`
      （存档仓 / 侧边栏 HUD / 队伍还没做，M23 保持 `[~]`）
- [x] 批次 403：M8 i18n 框架 + 第一片界面（zh/en 两张表 + `language` 设置 +
      暂停菜单 5 个按钮与 4 个分组名；英文只翻了 13 条，台账仍记 50%）
- [x] 批次 404：F9 第一批——潜行 1.5 格高（站立 1.8 / 潜行 1.5，眼高 1.62 → 1.27，
      顶上有方块时强制蹲）；爬行 / 游泳姿态 / 水流推动 / 溺水计时仍归 F9（`[~]`）
- [x] 批次 405：G10 收口（**无新代码**：Shift 快速移动 / 双击收集 / 拖拽分配 / 丢出
      在批次 127/128/129/161 就全做完了，是台账漏勾）
- [x] 批次 406：J19 猪 / 炽足兽可骑乘（马/驴/骡/羊驼的骑乘批次 253/254 早就有，
      这一批只补"不用驯服 + 不能跳 + 工厂入口 + 空手点上车"）
- [x] 批次 407：J21 蜜蜂生态收口（蜂蜜等级 0~5 / 玻璃瓶挤蜜归 0 / 被蛰中毒且只蜇一次；
      蜜蜂本体批次 374 已有，`bee_nest` 兼作蜂箱）

> ⚠️ 403~407 都是**系统级**改动（各自要碰界面/物理/输入/存档），
> 不是"数据表加一行"那一档——按项目自己的九步流程，一条一批。
> 原批次 404 把三件事塞进一条，已拆开（"拆不动的大项要留回队列并写明为什么"）。

**当前队列（批次 504 之后）**。⚠️ **多人与 i18n 由用户单独处理，不要再排进来**（L1~L7、M8）。

- [x] 批次 503：**织布机界面（J25 收口）**。前置已就位：图案数据与 64 张贴图（497）、
      `ItemStack.bannerPattern` 与四处链路（502）。
      ① `core/container/Loom.ts`：旗帜格 + 染料格，`canApplyPattern` / `applyPattern` 纯判据
      （非旗帜、非染料、同一图案、空槽四种拒绝；成功后扣 1 染料并改 `stack.bannerPattern`）；
      ② `BlockEntityStore` 的 `BlockContainer` 联合类型 + `getOrCreateLoom` + `ContainerSave` 登记；
      ③ `InventoryScreen` 新 `loom` 模式（左旗帜/右染料/图案按钮列，复用 `stonecutter-list` 样式，
      手机横屏封顶可滚）；
      ④ 主程序右键 `Block.LOOM` 开界面；**删掉 `cycleBannerPattern`**（否则右键免费换图案
      绕过染料消耗，界面的消耗规则形同虚设）；
      ⑤ 断言 `test:loom`（新套件，套数 152 → 153，README/HANDOFF/AGENTS 三处同步）；
      ⑥ 差异：图案仍 4 种、单层，染料只作消耗（图案色随旗面自动取反色，原版由染料决定）。

- [x] 批次 505：**制图台（K7 尾巴）**。三件事：复制 / 缩放 / 锁定，全部落在 `MapData` 上。
      ① 数据：`MapData` 加 `scale`（0~2）与 `locked`；`mapCellIndex` 用
      `span = MAP_CHUNK_SPAN << scale`（格子数仍 32，覆盖 512 → 1024 → 2048 格）；
      `markExplored` 在 `locked` 时返回 null；`zoomOut(map)` 把 2×2 旧格 OR 成一格
      （按中心对齐：`floor((i-16)/2)+16`），`copyMap` 深拷、`lockMap` 置位。
      ② 方块 `cartography_table`（新 id）+ 3 张图（纸/木架）+ 配方 2 纸 + 2 木板，
      **登记进 `GenerationSources` 的那个列表按需**（村庄/林地府邸可放，但不强求）。
      ③ `core/container/CartographyTable.ts`：地图格 + 材料格 + **算出来的产物格**；
      `refresh()` 按材料算产物（纸=放大、空地图=复制、玻璃板=锁定），
      材料不足/已是最大缩放/已锁定时给原因；产物槽进 `isComputedResultSlot`。
      ④ 三处登记（BlockEntityStore / Transfer / ContainerSave）+ `InventoryScreen`
      的 `cartography` 模式（两格 + 产物 + 提示行）+ main 右键入口与拆方块入口。
      ⑤ 断言 `test:cartography`（缩放重采样/覆盖翻倍/锁定后不再记/复制等价/
      产物三态/材料消耗/存档往返）；套数 153 → 154（三处文档同步）。
      ⑥ `MapScreen` 的格子换算要跟着 `scale` 走（现在写死 512 格 → 32 格）。
      ⚠️ 差异：一格 = `scale+1` 个区块（原版按方块像素）；不做"地图挂在展示框里"。

**队列已清空（批次 511 之后）**。下一批候选（写成散文，钩子不捡）：
1. **506 AI 目标选择器**：全仓没有 target selector，生物只追玩家；先做纯逻辑。
2. **507 结构布局深度**：林地府邸 3~6 间/层（原版 50+）、要塞单层、堡垒只有一种布局。
3. **508 村民体系第二批**：走动/POI/每日刷新/价格浮动（依赖 501 的持久化）。
5. **性能**：N1 顶点压缩、N3 缓冲池（单独成批）；**悬案 E23** 先按 HANDOFF §5 复现。

---

## 流程（一轮批次照着走，别凭记忆）

> 这段是"每批都要走的九步"，把散在 AGENTS.md / HANDOFF 里的约定收成一张清单。
> 顺序有意义：**先写纯逻辑与断言，再接界面与主程序**——反过来的话，
> 界面里那些"看起来对"的分支会掩盖规则本身的错。

1. **读队列**：`HANDOFF.md` §1 的状态 + 本文件最后一段的"下一批候选"；
   别从 `TASKS.md` 从头扫（287 条，扫一遍就没有预算做正事了）。
2. **定范围**：一条 `[ ]` 拆成"能一批收掉"的（数据 / 规则 / 一处 UI / 一套断言）。
   拆不动的（群系、结构、多人大改）留回队列，并写一句"为什么这批不做"。
3. **纯逻辑先行**：`core/...` 里写不引 DOM / 不引世界的模块（`Grindstone.ts` / `Book.ts` /
   `Map.ts` / `Shield.ts` / `Navigation.ts` 都是这么来的），规则里的每个"如果"都能单独断言。
4. **数据链路四处一起补**：`restoreStack` / `stackExtras` / `sameExtras` / `Transfer.cloneExtras`。
   漏第一处＝读档丢数据，漏第三处＝两件不同的东西被并堆吞掉一件，漏第四处＝漏斗搬一趟丢数据。
5. **接界面**：面板挂 `<body>`、层叠层 12、Esc 自己收、关闭时调 `onClose` 交还输入权；
   手机横屏是主场景（面板封顶、内容自滚、按钮固定底部）。
6. **接主程序**：右键入口排在"必须先命中方块"之前或之后**要有理由**；
   容器类记得 `CONTAINER_BLOCKS` + `containerOfBlockAt`（拆方块不吞东西）。
7. **写断言**：新开 `test:<名词>` 套件（`package.json` 加一行 script），
   `npm run test:offline` 会把它自动收进聚合跑；顺手改被影响的老断言
   （配方表总数、可达性缺口、图标表）。
8. **改台账**：`TASKS.md`（条目状态 + ⚠️ 差异注记）、`HANDOFF.md`（§1 快照 + 批记录）、
   `README`（套数）、本文件（批次记录 + 下一批候选），然后
   `npm run audit:tasks`（会顺手重写 README 路线图）与 `npm run audit:diffs`。
9. **门禁与提交**：`npm run check` 全绿 → `npm run build:fast` 能出包 →
   中文提交信息（"批次 NNN：一句话 + 分组要点"）→ commit → push。
   push 若报 "Could not read from remote repository"，先用
   `GIT_SSH_COMMAND='ssh -o BatchMode=yes -o ConnectTimeout=8' git push` 重试一次（本次遇到过）。

**不做的三件事**：不跑浏览器自动化验收（用户要求）；不为了快而削测试；
不手抄派生数字（进度、套数、配方数、提交数一律由脚本核对）。

---

## 批次 509：村民每日补货 + 价格浮动（J11 尾巴）（2026-10-20）

- [x] B509-1 `TradeOffer.demand`（0~6）+ `tradeDemand` / `tradePriceDelta`
  （floor(demand/2)，最多 +3）+ `adjustedTradeCosts`（加在第一样收货上）
- [x] B509-2 `recordTradeUse`：次数 +1（夹到 maxUses）、需求 +1（封顶）
- [x] B509-3 `Villager.restock()`：次数清零、需求 -1；`advanceDay` 遍历已加载村民调用
- [x] B509-4 `tradeBlocker` / `tradeSettlement` 改走调整后的价格（否则"显示能做、实际扣不够"）
- [x] B509-5 `demand` 进村民存档与实体寄存（`sanitizeVillager` 逐项夹紧、长度不符整份丢弃）
- [x] B509-6 交易界面：价格用调整后的数量；需求量进指纹（价格变了重建行）
- [x] B509-7 `test:villager` 141 → **170 条**
- ⚠️ 差异：原版一天补两次，这里一天一次；价格不随难度/声望变（只随需求）

## 批次 510：村民作息走动（J11 尾巴）（2026-10-20）

- [x] B510-1 `core/world/VillagerRoutine.ts`（纯函数）：白天去工作站、其它时间去床边；
  `normalizeTimeOfDay` / `villagerRoutine` / `routineTarget` / `villagerArrived`
- [x] B510-2 `Villager.home` + `setHome` / `walkToward` / `standStill`
  （`idle` 是 protected，走动与停住都收在实体自己身上）
- [x] B510-3 村庄人口生成时把**招他来的那张床**设为家
- [x] B510-4 家 / 工作站坐标进存档与实体寄存（`sanitizePoint` 逐项校验，脏数据整份丢）
- [x] B510-5 主程序每 0.5 秒下发作息指令（在实体 tick 之前）
- [x] B510-6 `test:villager` 170 → **200 条**；`test:spawn` 下界采样 30 → 120 轮（修偶发）
- ⚠️ 仍缺：不躲僵尸（恐慌与铁傀儡联动）；走位是直线、不绕路

## 批次 511：村民恐慌 + 铁傀儡联动（J11 收口）（2026-10-20）

- [x] B511-1 `core/entity/VillagerPanic.ts`：10 种威胁 id、8 格内最近、反向逃跑 6 格、
  恐慌 5 秒、速度 ×1.35
- [x] B511-2 `Mob.speedMultiplier()` 钩子（默认 1）；`Villager` 恐慌时覆盖
- [x] B511-3 `Villager.panicFrom` / `panicStep` / `advancePanic` / `movementScale`
- [x] B511-4 主程序每 0.5 秒扫威胁 → 恐慌源进 `panicThreats`；铁傀儡**优先**打它
- [x] B511-5 作息排在守卫之前结算（优先集必须先有）
- [x] B511-6 `test:villager` 200 → **227 条**
- [x] B511-7 **J11 勾掉**：完成 233 → **234**、进行中 50 → **49**
- ⚠️ 差异：没有恐慌粒子/举手动画、没有 gossip 与声望
