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

### 索引：三份溢出文档

> `notes/` 是本节的**溢出位**，不是第二套机制——这里只留一行索引。

- **模块能力台账**（约 900 行的表，按模块名搜）→ [`notes/modules.md`](./notes/modules.md)
  （2026-10-22 从 `docs/HANDOFF-ARCHIVE.md` 整份搬来）
- **操作型工作站**（熔炉 / 酿造台 / 营火 / 锻造台…的通用契约 + 站台矩阵 + 接入 checklist）→
  [`notes/stations.md`](./notes/stations.md)（2026-10-22 从 `docs/` 迁来）
- **运维手册**（`window.__mc` 调试接口 + PWA / Pages / 套壳发布）→
  [`notes/ops.md`](./notes/ops.md)（从根 `HANDOFF.md` §5.5 / §6 抽出并合并）

### 长期待办只有一份：`.continue/TASKS.md`（2026-10-22，合并根 TASKS）

- 做了什么：把仓库根的 `TASKS.md`（293 项、A~O 分节 + 覆盖度 / 差异台账）整体并入
  `.continue/TASKS.md`，根文件删除；三张台账脚本（`audit:tasks` / `coverage-report` / `diff-ledger`）
  与 README 路线图全部改读这一份。
- 为什么：机制只能有一套。"根表 + 队列视角表"两份并存时，收尾要写两处、且必然漂
  （这正是前面几轮反复出问题的地方）。
- 代价与边界：`TASKS.md` 现在 5000+ 行，**不要通读**，按 `[~]` 搜或看 README 路线图；
  它由脚本核对，手改只改条目状态与正文，别动标记块。
- 什么时候该重看：条目多到一份文件搜不动了 → 按段落字母拆 `notes/tasks-<段>.md` 并留索引。

### 判定不做：M17 真机四项、O1、L4、L5（2026-10-21，迁移自旧队列《明确不做》）

- 做了什么：这四项的**理由**留在这里，状态仍以 `TASKS.md` 为准（M17 / O1 / L4 是 `[~]`，L5 是 `[-]`）。
- 理由：
  - M17 真机四项（发热 / 真实触控延迟 / 内存压力 / 不同机型）——**AI 做不了**，要用户拿真机跑，
    清单在 `TASKS.md` M17 末尾；
  - O1 与原版噪声参考值对齐 —— **拿不到原版参考值**（同 O5：仓库与当前环境都没有那份素材）；
  - L4 生物权威模拟 —— 投入远超收益：现在是"客户端模拟 + 服务端转发"，改成服务端权威要重写整套
    实体循环，单机玩家一分钱好处都没有；
  - L5 局域网发现 —— 浏览器发不了 UDP 广播 / mDNS，技术上不可能。
- 为什么写在这：旧队列文件已并入 `DONE.md`，理由散在 1.4 万行里等于丢失；"下次又提"是要付代价的。
- 什么时候该重看：真机测试有代理手段 / 拿到原版噪声素材 / 浏览器支持 UDP。

### `[发现]` 的优先级：排在所有用户任务之后（批次 1355 查证）

- 做了什么：确认 `auto-continue.mjs` 挑任务的顺序是"先找非 `[发现]` 的条目、`[发现]` 兜底"
  （`pickNext` 里那条正则）。
- 为什么：`[发现]` 是 AI 干活时顺手插的，用户排的活优先——这样"AI 不会拿自己发明的任务把用户的队列顶掉"。
- 代价与边界：表现上像"钩子漏了一条"（待办三选一却递了中间那条）。
- 什么时候该重看：用户觉得"我插的 `[发现]` 一直轮不到"时 → 把它写进 `.continue/HANDOFF.md` §4，
  或给 `[发现]` 加一个"是否插队"的可选前缀。

---
## 批次 1363 · 2026-10-22 · 会话 0a49498a

**做了什么**：把 continue-do 从旧版升级到新版（钩子 / 目录 / 三份新文档），并把本项目的文档体系与门禁按新框架重新落地。共 7 条（Q1~Q7）。

**条目**（原文照搬）：

- [x] Q1 让框架门禁变绿：`DONE.md` 拆出 `DONE.archive.md`（主文件 ≤300 行）+ `lib.mjs` 的 `DOC_LIMITS.TASKS` 放宽到 7000（本项目台账是脚本输入）+ `config.json` 的 `checks.fast` 接回框架聚合入口、`project` 用 `npm run check:fast` → `node .continue/hooks/check.mjs` 五项全绿
  - 做了什么：① `DONE.md` 14316 → 287 行，第 289 行起（历史批次 1~613、HANDOFF 批次流水、旧队列）整段原文搬到 `DONE.archive.md`；② `lib.mjs` 的 `DOC_LIMITS.TASKS` 600 → 7000 并写明理由；③ `config.json` 的 `checks.fast` 从项目自己的 `npm run check:fast` 改回框架聚合入口（原来那样等于**静默跳过** ids/docs/config 三项），`checks.project` 填 `npm run check:fast`。
  - 为什么：`TASKS.md` 5506 行不是"清单太长"，而是**脚本输入**——`diff-ledger.mjs` 读条目里的 ⚠️ 注记、`coverage-report` 读状态、`audit-tasks` 读编号，压到 600 行等于删它们的语料。`DONE` 则是纯时间线，机械归档无损。
  - 验证：`node .continue/hooks/check.mjs` → ids / docs / config / hooks / project 五项全过，exit 0。
  - 遗留：`lib.mjs` 属框架文件，重装会覆盖；要靠 `tools/audit-docs.mjs` 的守卫当场报出来（Q3 补）。
- [x] Q2 退役旧契约自测：`tools/hooks-test.mjs` 停用，`test:hooks` 改为委派 `node .continue/hooks/check.mjs hooks`，删掉与新框架脱节的 581 行断言 → `npm test` 绿
  - 做了什么：删 `tools/hooks-test.mjs`（581 行）；`package.json` 的 `test:hooks` 改成 `node .continue/hooks/check.mjs hooks`；`tools/audit-tasks.mjs` 里解释 `test:hooks` 为何不算离线套件的那段注释同步改口径。
  - 为什么：那份自测断言的是**旧钩子契约**（三个收尾选项 / `NOTES`+`EXPERIENCE` / `queues/` 路径），框架一升级就整片红；而框架自带的自检（`selftest.mjs`，在临时副本里灌事件）覆盖同一批行为还多出 `pre-commit`、`一次提交只勾一条` 两条，且**跟着框架一起升级**。留两份等于留着下一次漂移。
  - 验证：`npm run test:hooks` → 框架 hooks 自检通过；`npm test` 八段全过（vitest 150 / 离线 169 套 / 截图 14 / guard 17 / browser-check 15 / shotdiff 23）。
  - 边界：`test:hooks` 这个键名保留，`tools/run-tests.mjs` 与 `audit-tasks.mjs` 的 `NON_SUITE_KEYS` 名单因此不用动。
- [x] Q3 项目工具适配新目录：`tools/audit-docs.mjs` 的 `queues/` → `doing/`、`docs:trim` 不再搬 DONE → `npm run audit:docs` 与 `npm run audit:tasks` 绿
  - 做了什么：`tools/audit-docs.mjs` 里 ① 队列目录 `queues/` → `doing/`（含输出文案）；② `docs:trim` 搬走的历史批次改写进 **`DONE.archive.md`**（原来写 `DONE.md`，会把框架 300 行的时间线上限顶爆）；③ 新增 `PROJECT_DOC_LIMITS` 守卫，检查 `.continue/hooks/lib.mjs` 里 `TASKS` 是否仍放宽到 7000；④ 归档体积观察点同时看 `DONE.md` 与 `DONE.archive.md`。
  - 为什么：`lib.mjs` 是框架文件，重装**总是覆盖**，放宽会被悄悄改回 600，症状是"重装后每次提交都被拒、报错只说 TASKS 太长"。把它记进项目自己的门禁，重装当场变红并给出改回哪几项。
  - 验证：`node tools/audit-docs.mjs --print` → 三项全 ✓；`npm run audit:tasks -- --print` → 七条断言全 ✓。
  - 顺带：删掉旧 `hooks-test` 遗留并被误提交的假队列 `.continue/doing/hooks-test-other-4.md`。
- [x] Q4 `EXPERIENCE.md` 并入 `.continue/TIPS.md`（症状 → 根因 → 处置 → 适用面，模块名与 OVERVIEW 对齐）→ `check.mjs` 的 ids 绿
  - 做了什么：`EXPERIENCE.md` 461 行整份并入 `TIPS.md`（463 行）：① 两条已经写成四段式的（钩子日志 / 文案字面量断言）按框架格式重排，分别落到 `## 工程与基础设施`、`## 界面与音频`；② 其余 379 行"症状 → 根因"两列表原样保留为 `## 历史经验总表`（框架的办法是"按模块拆"，但拆这 400 条要先逐条判定模块，质量不可控，先保留可 grep 的整体，新坑按模块写）；③ 顺手修掉表里一处历史缺陷——有一行用字面量 `\n` 把两条并成了一行；④ 删掉旧文件。
  - 为什么：两份"踩坑文档"并存时 AI 只会读到其中一份（技能文档明说这条）；而表格逐条重分类是独立的一批活，混进框架迁移会让两边都做不干净。
  - 验证：`node .continue/hooks/audit-ids.mjs` → 通过（TIPS 的三个分节名与 OVERVIEW 的 `###` 一一对上）；`audit-docs` → TIPS.md 463/500。
  - 遗留：`## 历史经验总表` 仍未按模块拆——留在总表里，按关键词 grep（见 OVERVIEW 同名小节）。
- [x] Q5 `OVERVIEW.md` 落地真实模块索引 + 补批次索引表（批次 24 / 1355），`NOTES.md` 保留为决策索引并挂进入口
  - 做了什么：`OVERVIEW.md` 从 53 行模板写成 199 行：15 个模块各一段（实现挂 `A1`~`O16` 台账段 + 批次，坑只留一行摘要指向 `TIPS.md` 同名分节），外加批次索引表；模板的 §一「模块索引」表**删掉**（它与 §二 的标题逐字重复，违反"一条内容只写一处"）。
  - 为什么：框架靠"模块名"把 OVERVIEW ↔ TIPS 串起来，所以模块名必须与 `TASKS.md` 的 A~O 分段对齐，而不是另起一套；`T<n>` 号在本项目不存在，明细写台账段号。
  - 验证：`audit-ids` 通过（模块名与 TIPS 一一对上、DONE 的批次 1355 在索引表里）；`audit-docs` → OVERVIEW 199/200。
  - 遗留：只有 200 行预算，199 行已经贴顶——下批再往里加模块会顶爆，届时应先把"验证 / 存档与多人"这类短节合并。
- [x] Q6 `HANDOFF.md` 瘦身：队列 / 标记 / 钩子机制章节改成指向 `.continue/README.md`，只留项目约定、当前状态、命令 → `npm run audit:docs` 绿且 ≤520 行
  - 做了什么：`HANDOFF.md` 484 → 178 行：① 删掉与 `README.md` 逐字重复的三节（队列与标记 / 钩子怎么工作 / 容易踩的地方），开头换成一张"想查什么读哪一份"的索引表；② 把 §8 下面挂的 69 行批次摘要（批次 505~613）搬进 `DONE.archive.md`；③ 保留本项目的四类内容——当前状态（含进度口径 / 提交总数 / 技术栈）、命令、约定（数据链路四处 / 界面 / 自建任务额度 / 明确不做 / 跨区块地物约定 / 该问人的五种情况）、跨机器边界与悬案；④ 门禁那一节按"三道门"重写（`npm run check` / `checks.fast` / `DOC_LIMITS` 的局部放宽）。
  - 为什么：机制只有一份（`README.md`，随框架升级）；HANDOFF 里抄一遍就是在给自己造第二份真相——这次升级里它已经漂了（`queues/`、`EXPERIENCE.md`、`NOTES.md`、旧刹车文件名全过期）。而 `audit:tasks` 要解析的那三句话（进度口径 / 提交总数 / **169 套**）原样保留，所以派生数字仍然被脚本钉着。
  - 验证：`npm run audit:tasks -- --print` 七条全 ✓（提交总数 1368 与实际一致）；`node tools/audit-docs.mjs --print` → HANDOFF 179 行 / 0 条批次记录，通过。
  - 顺带：`tools/agent-setup.mjs` 的队列目录 `queues/` → `doing/`（不改的话 `npm run agent:setup` 会报"队列目录不存在"）；`TASKS.md` / `NOTES.md` / `notes/modules.md` 里指向 `EXPERIENCE.md`、`queues/` 的说明同步改掉。
- [x] Q7 收口：`AGENTS.md` 并入框架入口、删掉全部 `*.continue-do.md` 备份 → 全量 `npm run check` 绿
  - 做了什么：① `AGENTS.md` 重写：§1 先读两份（`README.md` 机制 + `HANDOFF.md` 状态与约定）、§2 按需展开表补齐 `OVERVIEW.md` / `TIPS.md` / `DONE.archive.md` 并删掉已删除文件的链接、§4 的刹车开关改成 `.continue/auto.off`（旧的 `auto-continue.off` 已并入框架）；② 删掉三份 `*.continue-do.md` 模板备份（`AGENTS.md` / `TASKS.md` / `DONE.md`）——两份指令并存时 AI 会读到冲突的两套规则。
  - 为什么：`AGENTS.md` 是每个会话第一份读到的文件，它指错一次，后面所有文档都白写（这一轮它连着指了三份已经不存在的文件）。
  - 验证：`node .continue/hooks/check.mjs` → ids / docs / config / hooks / project **五项全过**；`npm run check` 全链路通过（typecheck + vitest + 169 套离线 + 三张台账 + `audit:docs` + browser-check 跳过）；`npm test` 八段全过。

---

