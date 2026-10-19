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

- [x] 批次 337：文档门禁 + 批次编号器 + 修正过期正文
- [x] 批次 338：D20 群系第一批（海洋 4 → 9 种）
- [x] 批次 339：D20 群系第二批（深色森林 / 稀疏丛林 / 竹林 / 积雪沙滩）
- [x] 批次 340：群系平滑（3×3 多数投票）；窄区间变体改走"低频率区域"（下一批）
- [x] 批次 341：D21 结构第一批（沙漠神殿 + 丛林神庙）
- [x] 批次 342：D20 低频率区域变体（64 格哈希）+ 繁花森林 / 原始白桦林
- [x] 批次 343：M7 进度补 14 条（不依赖新内容）
- [~] 批次 344：J20 下界生态（猪灵/疣猪兽已落地；剩以物易物/猪灵蛮兵/炽足兽/蠹虫/潜影贝）

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

## 批次 343：M7 进度补 14 条（2026-10-20）

> 框架早就是"加一行数据"（10 种触发条件），这一批只补**触发源已经存在**的条目。

- [x] B343-1 story：`mine_wood`（木料表派生，不手抄 6 个 log id）、`mine_gold`
- [x] B343-2 nether：`obtain_blaze_rod`、`find_fortress`（下界疣）、`create_beacon`
- [x] B343-3 adventure：四种怪物单杀、`kill_all_mobs`（挑战，按敌对表派生）、
  `place_sign`、`lightning_rod`
- [x] B343-4 husbandry：`breed_all`（挑战，4 种家畜）；end：`kill_enderman`
- [x] B343-5 两处口径修正：place 类只用于种植（告示牌改走 obtain）；
  岩浆桶没有可达来源，**不做**（不编假条目）
- 门禁：test:advancement 116，离线 131 套全绿；进度 **26 → 40（40%）**

---

## 批次 344：J20 下界生态第一批——猪灵 / 疣猪兽（2026-10-20）

> 下界目前"有地形没生态"。这一批先把两只最常用的落地；以物易物与炽足兽留下。

- [x] B344-1 `PIGLIN_TYPE`：16 血 / 中立 / `angerRadius 16` / 金粒 + 2.5% 金锭 / 下界
- [x] B344-2 `HOGLIN_TYPE`：40 血 / 伤害 6 / 生猪排 2~4 + 皮革 / 下界
- [x] B344-3 刷怪蛋 1511/1512；图集追加 `spawn_egg_piglin` / `spawn_egg_hoglin`
- [x] B344-4 模型：hoglin → `quadruped`；声音档案复用 `piglin`
- [x] B344-5 口径更新：生物 44 → 46、蛋 40 → 42、下界刷怪集合 3 → 5 只
- [ ] B344-6 仍缺：以物易物、猪灵蛮兵、炽足兽（岩浆行走）、蠹虫、潜影贝
- 门禁：test:mob 132、spawn 56、reach 61、audio 86，离线 131 套

## 批次 344 收尾：以物易物（2026-10-20）

- [x] B344-7 `core/items/Barter.ts`：8 项权重表 + `barterRoll(random)`（纯函数）
- [x] B344-8 主程序：拿金锭点猪灵 → 扣 1 → 按表丢回战利品；`canUseItemOnMob` 同步
  （⚠️ 原版是丢在地上，触屏改成点它）
- [x] B344-9 `test:piglin` 63 条（逐项权重边界 / 数量上下限 / 中文名）
- [ ] B344-10 仍缺：猪灵蛮兵、炽足兽（岩浆行走）、蠹虫、潜影贝
