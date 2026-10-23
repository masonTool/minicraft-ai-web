# 完成档案 · DONE

> 本文件是**已完成工作的唯一档案**，只回答"这批做了什么、怎么验的"——时间线，最近的在最上面。
> 按模块看现状与坑 → `OVERVIEW.md`；下次怎么避开 → `TIPS.md`；机制与格式 → `README.md`。
> **一条内容只写一个地方**，别在三份文档里各抄一遍。
>
> 收尾时**整份队列原样搬进来**（含每条任务下方的完成说明与 `[阻塞]`），标题格式
> `## 批次 <号> · 日期 · 会话 <前 8 位>`。

---
## 批次 20261023-0927 · 2026-10-23 · 会话 b09ae4

**做了什么**：把 e2e 的现场挪进 skill 自己的目录并排除出版本库（框架进库、数据不进库）、
模型固定成 `deepseek-v4.1-flash-official`、摸清 CLI 登录态的真实位置并写成可执行的 CI 配置。
过程中实跑四次，**前三次的失败各暴露一个真问题**（轮次不够 / 网络误诊 / 未登录误诊），都修掉了；
第四次 15 项全过：队列建了 → 钩子递了 → DONE 有批次节 → 队列归档 → git 5 个提交。共 4 条。

**条目**（原文照搬）：

- [x] [目录1] 测试数据挪进 skill：`scripts/e2e.mjs` 的数据根改到 `.codebuddy/skills/continue-task/.e2e/`，在 skill 内加 `.gitignore`，删掉根 `.gitignore` 里作废的 `.skill-e2e/` → `git check-ignore` 命中、`git status` 干净
  - 做了什么：`DATA_ROOT` 从 `<仓库>/.skill-e2e` 改成 `<skill>/.e2e`；新增 `.codebuddy/skills/continue-task/.gitignore`（一行 `.e2e/`）；根 `.gitignore` 里那段 `.skill-e2e/` 删掉（作废配置留着比没有更坏）
  - 为什么放 skill 目录里：这套测试是**随 skill 走**的，现场也该跟着它；而且 `.gitignore` 放在 skill 内侧，别人把这个目录拷进自己仓库时**自带排除规则**，不用再改根 `.gitignore`
  - 验证：建 `.e2e/probe/a.txt` 后 `git check-ignore -v` 命中 `.codebuddy/skills/continue-task/.gitignore:3:.e2e/`；`git status` 里不出现现场；实跑一次后现场被自动删除（`--keep` 才留）
  - 批次：20261023-0927
- [x] [模型1] 模型固定 `deepseek-v4.1-flash-official`（默认参数，可用 `--model` 覆盖）→ `--dry-run` 打印出模型名
  - 做了什么：`DEFAULT_MODEL = 'deepseek-v4.1-flash-official'`，`--model` 可覆盖；CLI 调用里显式传 `--model`；`--dry-run` 打印"模型 deepseek-v4.1-flash-official（默认）"
  - 为什么固定而不是"继承本机默认"：本机默认模型随时会换，换了之后断言结果就跟着变（同一套代码今天过明天不过），排查时根本分不清是框架退化还是模型换了。**测试要钉住变量**
  - 为什么仍允许 `--model` 覆盖：换模型对比行为是正常需求，留一个显式入口即可
  - 验证：`npm run skill:e2e -- --dry-run` 打印模型名；实跑的命令行里能看到 `--model deepseek-v4.1-flash-official`
  - 批次：20261023-0927
- [x] [CI1] 把「CI 怎么登录」写成可执行配置：新增手动触发的 `.github/workflows/skill-e2e.yml`（还原 `local_storage` → 设 `CODEBUDDY_CONFIG_DIR`）+ SKILL.md 写清步骤 → `yaml` 静态可读、默认不在 push 上跑
  - 做了什么：摸清了 CLI 的登录态存放位置——`auth-type` 是 `cli-external-link`，`~/.codebuddy/.credentials.json` 里**只有 MCP OAuth**，真正的 Bearer 在 `~/.codebuddy/local_storage/`（444KB）。实测：只把 `local_storage/` 拷进空目录 + `CODEBUDDY_CONFIG_DIR=<该目录>`，401 消失、模型正常回话。据此写了 `skill-e2e.yml`（`workflow_dispatch` 手动触发）：装 CLI → 从 secret 还原 `local_storage` → 先探一次登录 → 跑 `npm run skill:e2e` → 失败上传现场；SKILL.md 写明三条命令导出 secret
  - 为什么**只手动触发**：一次几分钟且花 token，放 push 上等于每次提交都烧钱
  - 为什么不用整个 `~/.codebuddy`：里面有 `projects/` 会话历史，几百 MB，塞不进 secret；实测只要 `local_storage/`
  - 诚实说明：这个 workflow **只在本地做了静态审阅，没在真 GitHub Actions 上跑过**（没有仓库 secret 可验）。secret 缺了会 `::error::` 明确失败，不会静默绿
  - 验证：`--dry-run` 与 SKILL.md 的导出命令一致；`local_storage` 单独可用的结论来自两次对照实验（空目录 401 / 只带 local_storage 通过）
  - 批次：20261023-0927
- [x] [验] 真跑一次 e2e（已登录环境）+ `npm run check` 全绿
  - 做了什么：连跑四次，前三次分别暴露了三个真问题（见下），第四次通过；跑完全量门禁
  - **三次失败都不是白的**：① 12 轮不够——模型写完 `hello.txt` 就结束了，根本没建队列，于是把轮次放到 40 并把提示词写成"建队列 → 逐条勾 → 收尾"的可对照清单；② 网关 502 / DNS 解析失败——环境问题被当成框架问题误诊，于是加了"环境跳过"分支（沿用 `check:browser` 的口径，`--strict` 可把跳过改成失败）；③ 未登录 401——同样按跳过处理，并验静态级
  - 验证：第四次 **15 项全过**——钩子日志有 `queue-init`/`auto-continue`、队列建过、`DONE.md` 出现 `## 批次`、队列归档到 `logs/<sid6>/queue-<14位>.md`、git 5 个提交；`npm run check` **EXIT 0**；`node .continue/hooks/check.mjs` 五项全绿
  - 批次：20261023-0927


## 批次 20261023-0914 · 2026-10-23 · 会话 b09ae4

**做了什么**：先核对了"运行版 ↔ skill 打包源"（14 个钩子逐字节一致、`REQUIRED` 无遗漏），
然后在 **skill 里**加了一层**端到端自测** `scripts/e2e.mjs`：临时项目 → 装框架 →
用真实 `codebuddy -p` 跑一个小任务 → 断言"队列建了 → 钩子递了 → 收尾做了 → 归档落位"。
测试数据落在 `.skill-e2e/`（已 gitignore）：**框架进库、现场不进库**。共 4 条。

**条目**（原文照搬）：

- [x] [一致1] 运行版与 skill 打包源逐字节一致、预留钩子全在 install 清单里、注入探针与文档措辞同步 → `diff -rq` 无差异 + `check-framework` / `test-install` 通过
  - 做了什么：核对了四件事——① `assets/.continue/hooks` 与 `.continue/hooks` **14 个文件逐字节一致**；② `assets/.continue/README.md` 与运行版一致；③ `install.mjs` 的 `REQUIRED` 22 条覆盖了磁盘上**全部** 14 个钩子（我用脚本比对"磁盘上有但 REQUIRED 没列"= 无）；④ `notes/batches.md` 的历史行故意不改（那是当时的做法，改历史等于伪造台账）
  - 为什么每次都要真比对而不是"我记得同步了"：上一批就漏过一次——改了运行版没回灌 assets，重装一次改动全被抹掉，症状是"过几天又变回去了"且零报错
  - 验证：`diff -rq` 无输出；`check-framework.mjs` 通过；`test-install.mjs` 19 项通过
  - 批次：20261023-0914
- [x] [e2e1] 新增 `scripts/e2e.mjs`：建临时项目 → 装框架 → 用 `codebuddy -p` 跑一个小任务 → 断言队列/递任务/收尾/归档/日志全链路 → `--dry-run` 能打印计划且不建目录
  - 做了什么：新增 `.codebuddy/skills/continue-task/scripts/e2e.mjs`（约 260 行）——临时项目 `git init` + 初始提交 → 跑 `install.mjs --no-detect` → `codebuddy -p "<小任务>" --session-id <固定 32 位 hex> --max-turns N --permission-mode bypassPermissions --output-format json` → 断言 `logs/<sid6>/run.md` 里有 `[queue-init`／`[auto-continue`、队列建过（现存或已归档）、`DONE.md` 出现 `## 批次`、`git rev-list` ≥ 3、队列最终落到 `logs/<sid6>/queue-<14位>.md`；失败保留现场并打印 CLI 输出尾部
  - 为什么固定 `--session-id`：断言要按会话 ID 推导路径（`<sid6>.md`、`logs/<sid6>/`），随机 ID 会让"归档到哪儿"每次都变，断言写不出来
  - **为什么要这一层（不是重复 `test-install`）**：前两个脚本只看静态产物。实测过一类事故——钩子写 stdout 后立刻 `exit` 导致 JSON 被截断，静态检查全绿，但注入整份被宿主丢掉、任务永远递不出来。只有真跑一遍才看得见
  - **未登录（401）不判失败**：CLI 仍会加载 `settings.json` 并触发钩子，所以"注册对不对、注入有没有被截断、钩子会不会崩"这三件**已经真的验过了**；模型那一轮没发生，队列自然不建。于是分两级——静态级通过就 exit 0 并说明"登录后重跑才能验到队列/收尾/归档"
  - 验证：`--dry-run` 只打印计划、**不建目录**；实跑两次（未登录环境）→ 静态级 4 项全 ✓（日志有、queue-init 有、auto-continue 有、钩子没崩）并正确跳过模型级；缺参数时 exit 2
  - 批次：20261023-0914
- [x] [e2e2] 接线：`.gitignore` 忽略测试数据目录、`package.json` 加 `skill:e2e`（**不进 test:* 前缀**，避免台账套数漂）、SKILL.md 写清怎么跑 → `npm run skill:e2e -- --dry-run` 通过
  - 做了什么：`.gitignore` 加 `.skill-e2e/`（框架进库、现场不进库）；`package.json` 加 `skill:e2e`；`SKILL.md` 新增「1.5 三层自检」——把三个脚本的分工、`--dry-run/--keep`、三条约定（模型继承本机 / 数据不进仓库 / 没装 CLI 就跳过）写清楚
  - 为什么**不用** `test:` 前缀：`audit-tasks` 会拿 `package.json` 里 `test:*` 的**数量**去核对 README/AGENTS/HANDOFF 里写的"172 套"，加一个就会三处全红；而且 `npm run check` 会把它带上——一次几分钟、还花 token，不该进每次提交的门禁
  - 为什么数据目录放在仓库内而不是 `/tmp`：`install.mjs` 要写 `.git/hooks`、`git` 要能提交，仓库内更接近真实项目；用 gitignore 隔离即可，也让失败现场好找
  - 验证：`npm run skill:e2e -- --dry-run` 打印计划且**没有**创建 `.skill-e2e/`；`node -e` 确认 script 已注册；`git status` 里没有 `.skill-e2e`（被忽略）
  - 批次：20261023-0914
- [x] [验] `npm run check` + `node .continue/hooks/check.mjs` 全绿
  - 做了什么：跑全量门禁与框架五项；清掉 e2e 留下的现场（`.skill-e2e/`）
  - 验证：`npm run check` **EXIT 0**；`node .continue/hooks/check.mjs` **五项全绿**；`check-framework.mjs` 通过；`test-install.mjs` 19 项通过
  - 批次：20261023-0914


## 批次 20261023-0903 · 2026-10-23 · 会话 b09ae4

**做了什么**：三处命名收敛成一套——① 文件名里的会话 ID 只取**前 6 位**（只截 UUID 形态，
`s-plan-next` 这类短标识原样保留，否则一截就撞）；② 计划/决策改成**后缀式**
（`b09ae4-plan.md` / `b09ae4-decision.md`），同一会话三份文件在目录里排在一起；
③ `logs/` **按会话分目录**（`logs/<会话ID>/run.md` + `<queue|plan|decision>-<时间戳>.md`），
不再几十份归档堆在 `doing-archive/` 一个目录里。新增「队列头部完整 ID 前 6 位 == 文件名」
门禁作为截短的前提——它第一次生效就抓到我自己的手误。共 6 条。

**条目**（原文照搬）：

- [x] [名1] `lib.mjs`：加 `shortSid()`（**只截 UUID 形态**）、队列/计划/决策三个文件名改成 `<sid6>` / `<sid6>-plan.md` / `<sid6>-decision.md`、日志与锁移进 `logs/<sid6>/run.md`、`listQueues` 只列队列 → `node -e` 断言三种名字与目录
  - 做了什么：`shortSid()` 只对 **32 位 hex / 带横线 UUID** 取前 6 位，其它形态原样返回；`queueFileName()` / `planNameFor()` / `decisionNameFor()` / `queuePath()` / `planPathFor()` / `decisionPathFor()` 全部走它；`PLAN_FILE_RE` / `DECISION_FILE_RE` 改成**后缀式**（`^(.+?)-plan\.md$`）；`logPath()` → `logs/<sid6>/run.md`，锁跟着走（`withLogLock` 改成建父目录）；`listQueues()` 排除两类非队列文件
  - 为什么只截 UUID：真实会话 ID 是 32 位 hex，前 6 位足够区分同时在跑的几个人；而 `s-plan-next` 这类**本身就是短标识**的 ID（自检夹具、平台自定义 ID）一截就撞（`s-plan-next`/`s-plan-edge` 都变 `s-plan`），两个会话共用一份队列比文件名长严重得多
  - 为什么文件名用后缀式：`plan-b09ae4.md` 与队列 `b09ae4.md` 的公共前缀在最前面，按名字排序时**同一个会话的三份文件会散开**；`b09ae4-plan.md` 排在一起，看目录就知道哪几份属于同一个会话
  - 验证：`node --input-type=module -e` 六项——`shortSid(full)=b09ae4`、`shortSid(uuid)=b09ae4`、`shortSid('s-plan-next')` **原样**、`queue/plan/decision` 三个名字、`logPath` = `logs/b09ae4/run.md`、`isPlanFile('s-plan-next.md')=false` / `isPlanFile('b09ae4-plan.md')=true`
  - 批次：20261023-0903
- [x] [名2] 归档改成按会话分目录：`archive-queue.mjs` 写 `logs/<sid6>/<kind>-<ts>.md`；`auto-continue` 指令里的路径同步 → 归档后文件落在会话目录、名字带时间戳
  - 做了什么：`archive-queue.mjs` 的源文件名改由 `queueFileName/planNameFor/decisionNameFor` 算，目标目录换成 `archiveDirFor(sid)`，文件名只留 `<kind>-<YYYYMMDDHHmmss>.md`（目录里已经有会话 ID，不再重复）；`auto-continue` / `queue-init` 指令里 6 处路径文案同步
  - 为什么文件名里去掉会话 ID：目录已经是 `logs/b09ae4/`，再写 `b09ae4-queue-…` 是同一事实第二遍——而且以前所有会话的归档都堆在 `logs/doing-archive/` 一个目录里，几十份之后根本分不清哪些属于同一轮
  - 为什么 `queue-` 前缀：同一个会话目录里要住着队列 / 计划 / 决策三类备份，靠前缀区分；时间戳保证同一会话多批不互相覆盖
  - 验证：`selftest` 的两条归档用例改成断言 `logs/<sid>/queue-<14位>.md` 与 `logs/<sid>/plan-<14位>.md`、`logs/<sid>/decision-<14位>.md`，52 项全绿
  - 批次：20261023-0903
- [x] [名3] 迁移现存文件：`doing/` 三个（含别的会话的队列与计划）+ `logs/` 旧日志与旧归档归位 → `ls` 结果符合新规则，且两个别的会话的队列仍能被读到
  - 做了什么：`doing/` 四份改名（`4024a9d4…`→`4024a9.md`、`b75f5b89…`→`b75f5b.md`、`plan-b75f5b89…`→`b75f5b-plan.md`、本会话队列→`b09ae4.md`）；`logs/` 归位 13 项——7 份旧的 `logs/<full>.md` 运行日志变成 `logs/<sid6>/run.md`，4 份旧归档变成 `logs/<sid6>/<kind>-<ts>.md`，随后删掉空的 `doing-archive/`
  - 为什么必须和代码同一个提交：钩子改成按 6 位找队列，**不迁 = 另外两个会话的队列当场“消失”**（它们下一轮就会被当成“没有队列”而静默停摆），而且不会报任何错
  - 顺带被自己的门禁抓了一次：我把 `b75f5b` 手打成 `b75f5b8`（7 位），新加的「头部会话 ID 前 6 位 == 文件名」当场判红，改回来才绿——这条门禁第一次生效就是抓我
  - 验证：`ls .continue/doing/` = `4024a9.md b09ae4.md b75f5b-plan.md b75f5b.md`；`npm run audit:docs` 绿（含头像核对）；Stop 钩子实测能找到 `doing/b09ae4.md` 并递出「第 1/6 条」
  - 批次：20261023-0903
- [x] [名4] 门禁与自检：`audit-docs` 文件名规则跟着改 + 新增「队列头部会话 ID 前 6 位必须等于文件名」；`selftest` 断言跟着改 → 造一个头像不符的队列能红；自检全绿
  - 做了什么：`audit-docs` 加一条硬校验（每条队列读头部 `# 队列 · 会话 <full>`，`shortSid()` 后必须等于文件名）；门禁摘要文案改成 `doing/*-plan.md、*-decision.md`；`selftest` 的夹具与断言全部跟着改（计划文件 `s-x-plan.md`、归档目录 `logs/<sid>/`、日志 `logs/<sid>/run.md`）
  - 为什么这条门禁是**截短 ID 的前提**：文件名只留 6 位，理论上两个会话可能撞；撞了之后后开的会**直接接管**前一个的队列（勾错条目、写错 DONE），而且零报错。头部保留完整 ID 就是为了在这里对一次账
  - 顺带修了自检里 8 条写死 `logs/<sid>.md` 的断言——它们读的是文件路径，路径一变就全红，正好逼着一次改干净
  - 验证：造 `zzzzzz.md`（头部写 `ffff…`）→ 判红「头部会话与文件名不一致」；改成一致后绿；`selftest` **52 项全绿**
  - 批次：20261023-0903
- [x] [名5] 文档与打包源：注入协议 / README / notes/plan.md / HANDOFF / AGENTS / SKILL.md / assets 全链路 → `grep` 无旧写法；`check-framework` / `test-install` 通过
  - 做了什么：`queue-init` 第 9/10 条、`README` §3 第 10 条与收尾第 ⑤ 步、`notes/plan.md`（标题 / 三层结构 / §3 判定 / §4 门禁表 / §5 跨会话接手 / §6 图里两处标签）、`notes/session-decisions.md`、`HANDOFF` §4 两段、`AGENTS` §2、`SKILL.md` 全部改成后缀式 + `logs/<会话ID>/`；`assets/` 回灌 hooks 与 README
  - 为什么连 `notes/batches.md` 的历史行不改：那些行记的是**当时**的做法（`plan-<会话ID>.md`），改历史等于伪造台账；新批次行写新命名，两行并存正好能看出改名发生在哪一批
  - 验证：`grep -rn "doing-archive|plan-<会话ID>|decision-<会话ID>"` 只剩历史批次行；`diff -rq assets/.continue/hooks .continue/hooks` 无差异；`check-framework` 通过；`test-install` 19 项通过；`check.mjs --fast` 五项绿
  - 批次：20261023-0903
- [x] [验] `npm run check` + `node .continue/hooks/check.mjs` 全绿
  - 做了什么：跑全量门禁与框架五项，核对 `assets` 与运行版一致
  - 验证：`npm run check` **EXIT 0**（typecheck / 172 套 / `audit:i18n` / 三张台账 / 文档门禁）；`node .continue/hooks/check.mjs` **五项全绿**；`diff -rq assets/.continue/hooks .continue/hooks` 无差异
  - 批次：20261023-0903


## 批次 20261023-0845 · 2026-10-23 · 会话 b09ae4d7

**做了什么**：修掉上一批收尾时留下的一处**真实数据损坏**——`DONE.md` 里 0823 的批次标题
被塞进了文首引用行（`> \`## 批次 ## 批次 …`），`^## 批次` 匹配不到；而"DONE ↔ 批次索引"的核对
当时只是 warning，于是审计输出「通过（1 个提示，不阻塞）」，坏标题留了一整天。
本批把它修好、把那条核对升级成**判红**，并补了一张整条链路的流程图。共 3 条。

**条目**（原文照搬）：

- [x] [修1] 修 `DONE.md`：0823 的批次标题被塞进头部引用行（`> \`## 批次 ## 批次 ...`），`^## 批次` 匹配不到 → 复位成正确标题，`node .continue/hooks/audit-ids.mjs` 0 提示
  - 做了什么：把文首那段说明行补回原样（`> \`## 批次 <号> · 日期 · 会话 <前 8 位>\``），并把 0823 的节恢复成正常的 `## 批次 20261023-0823 · …` 标题 + `---` 分隔
  - 怎么会坏的：上一批收尾往 `DONE.md` 插批次节时用了 `text.partition('## 批次 ')`。裸子串的**第一个命中不在批次区，而在文首说明的引用行里**（那行恰好写着标题格式），插入点落进了引用块中间，于是标题变成 `> \`## 批次 ## 批次 …`，`^## 批次` 再也匹配不到
  - 为什么值得单独修：它不是格式难看——`audit-ids` 的「DONE ↔ 批次索引」核对靠这个锚点，锚点失效等于这条收尾核对对它**永久失明**；当时只报了「1 个提示，不阻塞」，所以坏了一整天没人发现
  - 验证：`grep -c '^## 批次' .continue/DONE.md` **2 → 3**（0823 / 0744 / 0022 三节都在）；`node .continue/hooks/audit-ids.mjs` 从「1 个提示」变成**零提示通过**
  - 批次：20261023-0845
- [x] [门禁1] 「收尾漏步」判红：`audit-ids` 的 DONE↔批次索引双向核对由 warning 升为 problem（当期 DONE 缺索引行 / 索引缺归档节），归档区仍只提示 → 删掉一条索引行能红
  - 做了什么：把原来两条一律 `warnings.push` 的核对拆成三类——① 当期 `DONE.md` 有批次但索引没行 → **problem**；② 索引有批次但 DONE 与 DONE.archive 都没有节 → **problem**；③ `DONE.archive.md` 有批次但索引没行 → 仍 warning
  - 为什么升级：这两条正对着「收尾五步有没有做完」——搬 DONE 与补索引是同一件事的两半，只做一半就是没收尾。它原来只是提示，而实测**真的漏了一次**（上一条的坏标题事件），当时输出是「编号审计通过（1 个提示，不阻塞）」，等于这条核对形同虚设
  - 为什么归档区留在 warning：那批历史可能早于"批次索引"这套机制，判红会逼人补一行假数据，反而污染台账
  - 复用了文件里已有的 `strict` 思路：提示与错误分开、由这里决定哪些够格判红，而不是把 `strict` 全局打开（那会把历史遗留一起变成红灯）
  - 验证：删掉 `notes/batches.md` 里 0823 那行 → 判红「DONE.md 有批次 20261023-0823，但批次索引里没有这一行——收尾漏了补索引」；恢复后零提示通过
  - 批次：20261023-0845
- [x] [文档1] 全局流程图：把「队列 → 递任务 → 收尾 → 计划分支 → 归档 → 门禁」画成一张图写进 `notes/plan.md`，并顺手在 TIPS 记「往 DONE 插批次节必须按行锚点」
  - 做了什么：`notes/plan.md` 新增 **§6「整条链路一张图」**（mermaid 流程图 + 三条"图里看不出来但必须知道"的要点：门禁只看写没写、所有卡住都有升级路径、归档不删）；`TIPS.md` 加「往 `DONE.md` 插批次节只能按行锚点切」
  - 为什么放 `notes/plan.md` 而不是 README：README 有 400 行硬上限、且只该留指针；这张图的消费点是"排查它为什么不往下走了"，和 §3 分支表完全重合，放一起才找得到
  - 为什么图里要标出"三条升级路径"：这套机制最贵的故障形态是**静默停止**（钩子崩了、计划关卡空转、队列条目卡住）。三条路径现在都有兑现：`run.mjs` → exit 2 / `planStreak` → 「计划卡住了」/ `BLOCKED_MAX` → `[阻塞]`，图里点出来，排查时才知道该去哪儿看
  - 验证：`notes/plan.md` 156 行；`npm run audit:docs` 绿；TIPS 新节在「工程与基础设施」首位
  - 批次：20261023-0845
- [x] [验] `npm run check` / `node .continue/hooks/check.mjs` 全绿 + 框架回灌
  - 做了什么：回灌 `assets/.continue/hooks/audit-ids.mjs`；跑全量门禁与框架五项；对齐 HANDOFF 的提交总数锚点
  - 教训：这一步本该在归档**之前**做完——我先跑了 `archive-queue.mjs` 才想起来「验」还没勾，只好把队列取回来补完再归档一次
  - 验证：`npm run check` **EXIT 0**；`node .continue/hooks/check.mjs` **五项全绿**；`diff -rq assets/.continue/hooks .continue/hooks` 无差异
  - 顺带加了一条门禁（本批自己踩出来的）：`DONE.md` 里不允许出现 `- [ ]` 条目——归档跑在勾完之前会把未完成条目写进档案，而其它检查全绿、没人会去看那个方括号；`audit-ids` 现在会判红（只看当期 DONE，归档区是历史不判）
  - 批次：20261023-0845


## 批次 20261023-0823 · 2026-10-23 · 会话 b09ae4d7

**做了什么**：修掉用户指出的那处硬伤——**钩子自己崩了却静默放行**（一次真实事故：改机制时
`lib.mjs` 删了导出、`auto-continue.mjs` 还在 import，钩子 import 阶段 SyntaxError，node 以 1 退出，
宿主按"未阻止"放行，队列就此停摆且一声不吭）；并落地两条新机制（计划也归档、决策留底），
加上上一轮审计出的 H1/H2/H3/M1 三处硬伤与一处误判。共 7 条。

**条目**（原文照搬）：

- [x] [崩溃1] 钩子崩溃不许静默放行：新增 `.continue/hooks/run.mjs` 包装器（子进程跑真钩子，退出码 0/2 原样透传；其它一律转成 exit 2 + 明确告警），改 `.codebuddy/settings.json` 注册与 `install.mjs` 的 `HOOKS`/`commandFor`/匹配逻辑 → 故意改坏一个 import，Stop 应拿到 exit 2 + 告警而不是静默放行
  - 做了什么：① 新增 `.continue/hooks/run.mjs`：转发 stdin（宿主的 payload 从这里进）、子进程跑真钩子、**退出码 0 / 2 原样透传**，其它（崩溃 / 信号 / 超时）一律翻成 `exit 2` + 一段"这是框架自己坏了 + 怎么修"的告警；**它不 import `lib.mjs`**（存在理由之一就是 lib 坏了，再去 import 同一棵树就没有兜底意义）。② `.codebuddy/settings.json` 四条注册改成 `node .continue/hooks/run.mjs <脚本> --event=<事件>`。③ `install.mjs` 的 `commandFor()` 同步、`findHook`/`groupOf` 的匹配从"路径 + 脚本名"放宽到"脚本名"（包装器形态下路径是 `run.mjs`）、`REQUIRED` 加 `run.mjs`。④ `README` §6 与 `SKILL.md` 各登记一句
  - 为什么这条是真硬伤（用户截图里的那次事故）：`lib.mjs` 先删了 `parsePlanRef`、`auto-continue.mjs` 还在 import，钩子 **import 阶段** `SyntaxError` → node 以 **1** 退出 → 宿主按"非 0 非 2 = 未阻止"**静默放行**。于是队列卡住、收尾指令也不发，而整个对话里一声不吭——现象只是"它不动了"，看上去像"没待办"或"AI 不听话"，唯独不像"框架坏了"
  - 为什么放行比红灯更贵：一次 exit 2 顶多打断一轮、且消息里写着怎么修；一次静默放行会把整条队列停在无人知晓的地方，代价是之后若干轮的错误归因
  - 验证：① 正常透传——`run.mjs auto-continue.mjs --event=Stop` 拿到 `exit 0` 且 stdout 的 JSON **逐字未变**；② 崩溃——临时写一个 `import { definitelyNotExported } from './lib.mjs'` 的钩子，包装器输出 `exit 2` + 完整 `SyntaxError` + 修复指引；③ `selftest` **45 → 47 项全过**（新增两条：崩溃拦截 / 正常透传）；④ `test-install.mjs` 19 项通过（含"安装后必须有 run.mjs"）；⑤ `check-framework.mjs` 通过；⑥ `check.mjs --fast` 五项全绿；`README.md` 399 行
  - 批次：20261023-0823
- [x] [归档2] 计划完成后**不删**，和队列一样加时间戳归档：`archive-queue.mjs` 支持 `--plan`（同一套命名），`auto-continue` 的完成分支改成归档计划 → `selftest` 断言"计划不在 doing/、备份在 logs/doing-archive/ 且带时间戳"
  - 做了什么：`archive-queue.mjs` 加 `--plan`（`base = plan-<sid>`，其余逻辑一字不差，同一条时间戳规则）；`auto-continue` 的"计划已全部完成"分支第 ② 步从"然后删文件"改成"跑 `archive-queue.mjs <sid> --plan` 归档"，并说明原文在哪儿；顺带把 `lib.mjs` / `auto-continue` 头部注释里"收尾后删文件"的旧口径改成"归档"
  - 为什么计划也要留底：`DONE.md` 记的是"做完之后回头看"，而计划记的是**当初怎么排的**——阶段边界、里程碑验收命令、被砍掉的阶段。删掉之后"为什么最后是这么切的"就只剩结果、没有推理过程
  - 为什么复用同一支脚本而不是再写一个：归档规则（目录、时间戳格式、幂等提示）只该有一份；多写一支就多一处会漂的命名
  - 验证：`selftest` **47 → 48 项全过**（新增一条真跑 `--plan`：断言 `doing/plan-<sid>.md` 已消失、`logs/doing-archive/plan-<sid>-<14位时间戳>.md` 存在且命名匹配）；`check.mjs --fast` 五项全绿；`assets` 与运行版一致
  - 批次：20261023-0823
- [x] [决策1] 决策留底机制 `doing/decision-<会话ID>.md`：格式契约、注入协议、`audit-docs` 门禁（文件名配对 + 决定/为什么 + 上限）、收尾归档 → 造一个缺"为什么"的决策条能红
  - 做了什么：① `lib.mjs` 加 `DECISION_FILE_RE` / `isDecisionFile` / `decisionNameFor` / `decisionPathFor` / `sessionOfDecision`（与计划的规则并列，前缀不同）；② `audit-docs` 把 `doing/` 分成**队列 / 计划 / 决策**三桶，新增四条断言——文件名按 `<会话ID>` 配对（孤儿判红）、至少一条 `## D<n>`、每条必须有 `- 决定：` 与 `- 为什么：`、≤300 行；③ 注入协议加**第 10 条**：需要拍板的地方按自己的判断做、不再弹窗，但每一处都要写进决策文件，格式 `## D<n>` + `- 决定` / `- 为什么` / `- 影响`，并明确「不可逆动作必须写进影响」；④ `archive-queue.mjs` 支持 `--decision`（与 `--plan` 同一套命名）；⑤ `wrapSteps` 第 5 步补"写过决策记录就再跑一次 `--decision`"；⑥ `HANDOFF` §4 加一段项目约定、新建 `notes/session-decisions.md`（为什么 / 格式 / 门禁 / 归档）；⑦ **本会话立刻用它记了 D1~D4**（包装器 / 一支归档脚本 / "影响"不判红 / 16 条不加字段）
  - 为什么"不问"必须配"留痕"：不提问题本身就降低了沟通成本，但**没有留痕就等于把决策从"两个人商量"变成"一个人猜"**——出错时连复盘入口都没有。决策文件是这条授权的另一半
  - 为什么只强制"决定 / 为什么"、"影响"不判红：前两条缺失时文件确实读不懂（硬错）；"影响"常常是"没影响"或"不确定，写这儿提醒"，判红会逼出敷衍话，反而稀释真正要看的信息。**结构错判红、判断类只提示**——和里程碑粒度走 `hints` 同一条口径（记为 D3）
  - 为什么复用同一支归档脚本：目录 / 时间戳格式 / 幂等提示只有一份；三支脚本就是三份会各自漂的时间戳，而**错的时间戳不报错**，只在以后排序时乱序（记为 D2）
  - 验证：造一个只有 `- 决定：` 的决策条 → 门禁判红并指出"缺 `- 为什么：`"；补齐后复绿；`selftest` **48 → 49 项**（新增 `--decision` 归档断言：文件移出 `doing/`、`logs/doing-archive/decision-<sid>-<14位>.md` 存在）；`check.mjs --fast` 五项全绿；`assets` 与运行版一致
  - 批次：20261023-0823
- [x] [隔离1] 修 H1（计划分支不隔离 → 卡住后永久空转）：同一 `planKey` 连续 N 轮仍在同一门时大声告警并停止重复建议，不再静默 idle → `selftest` 断言"连续 N 轮未推进 → 提示卡住"
  - 做了什么：进入计划分支时维护 `state.planKey` / `state.planStreak`（钥匙 = 计划名 + 当前阶段号）；四处"重复下发就放行一次"的 `idleAllow` 换成 `repeatOrStuck()`——超过 `BLOCKED_MAX`（默认 5）就 `emitBlock` 一条「**计划卡住了，需要人看一眼**」，列出卡在哪、怎么做、以及"不要把卡住伪装成完成"；同一把钥匙只升级一次（`state.planStuck`）
  - 为什么这是硬伤：队列条目有 `BLOCKED_MAX` 隔离兜底，**计划分支完全没有**——它走的是"下过指令就放行"。AI 一旦忘了勾阶段 / 重置队列，`planKey` 永远不变，于是**永久空转**：不隔离、不弹窗、不升级，连用户催一句也解不开，现象只是"它不动了"。实测过一次，是这套机制里最难查的形态
  - 为什么阈值复用 `BLOCKED_MAX` 而不是新开关：语义完全相同（"连续 N 轮没推进"），多一个开关就多一处要记的默认值
  - 验证：`selftest` **49 → 50 项**（`CONTINUE_BLOCK_AFTER=2`：第一轮下发续批、第二轮只放行、第三轮必须出现「计划卡住了」+「没有推进」）
  - 批次：20261023-0823
- [x] [空计划1] 修 H2：`parsePlan` 出 `stages.length === 0` 时**不走**"计划已全部完成"（否则空计划静默完结整批），改为显式告警 → `selftest` 断言"空计划 → 告警而不是整体收尾"
  - 做了什么：`cursor === null` 时先判 `plan.stages.length === 0`，是就单开一条告警：「**一条阶段都没有**」，给出"补阶段"与"归档计划"两条路，并禁止"随手补个假阶段让流程走下去"
  - 为什么必须单判：`cursor` 为空有两种来源——**全都做完了**，或者**一条都没写**（刚建没填 / 阶段行漏反引号）。按"完成"处理会把队列归档、计划归档，**什么都不留**，比报错糟得多
  - 验证：`selftest` **50 → 52 项**（与 H3 的两条断言一起加；空计划：必须出现「一条阶段都没有」，且**不得**出现 `[auto-continue · 计划已全部完成]`）
  - 批次：20261023-0823
- [x] [顺序1] 修 H3（硬停先重置队列再问用户 → 用户选"调整/先收"时队列已是下一阶段）：把收尾拆成"前四步"与"第 5 步重置"，硬停时先问、用户选继续才重置 → `selftest` 断言硬停指令里"弹窗"出现在"重置队列"之前
  - 做了什么：`wrapSteps(keepQueue, includeFifth)` 增加第二个参数（`false` = 只做前四步）；硬停指令重排成 **① 勾阶段 → ② 收尾前四步（明确"第 5 步先别做"）→ ③ 跑验收 → ④ 弹窗 → ⑤ 只有用户选"继续"才重置队列**；三个选项各自的后续动作写清楚（"调整计划"时队列原样未动、"先收在这里"只改 `> 状态：讨论中`）
  - 为什么原顺序是错的：旧指令让 AI 在**问用户之前**就把队列换成下一阶段的条目。用户若选"调整计划 / 先收在这里"，队列里已经是一堆**从没做过**的条目——状态与事实不符，而且没有任何东西会报错
  - 验证：`selftest` **52 项全过**（断言「弹窗问用户」出现在「只有用户选了」之前；且硬停消息里**不出现**第 5 步的重置文案）
  - 批次：20261023-0823
- [x] [计数1] 修 M1：`pre-commit` 的计数把 `plan-*.md` / `decision-*.md` 里新增的 `- [x]` 也算成"勾了一条队列条目"，同一提交既勾条目又勾阶段会被拒 → diff 只算真正的会话队列文件
  - 做了什么：`completedQueueItems()` 的 `git diff --cached` 加两条 pathspec 排除——`:(exclude).continue/doing/plan-*.md`、`:(exclude).continue/doing/decision-*.md`
  - 为什么：计数扫的是整个 `.continue/doing`，而计划和决策记录**也在里面、也用 `- [x]`**。于是"勾掉最后一条队列条目 + 顺手勾掉阶段"这种自然写法会被判成"一次勾了 2 条"而拒绝提交，逃生口又只有 `--no-verify`——那等于为了让门禁闭嘴而拆掉门禁
  - 为什么用 pathspec 而不是在 JS 里过滤文件名：diff 阶段就排掉，连内容都不用看；而且规则写在 git 自己能懂的地方，`git diff` 手工复核时也是同一套口径
  - 验证：造一份暂存状态（会话队列追加一条 `- [x]`，决策记录里也追加一条 `- [x]` 行），`git diff --cached … 带排除` 只数到 **1** 行（决策那条被排除）；不带排除会数到 2
  - 批次：20261023-0823
- [x] [验] 全量验证 + 框架回灌：`npm run check` / `node .continue/hooks/check.mjs` / `check-framework` / `test-install` / `assets` 与运行版一致，删刹车
  - 做了什么：`assets/.continue/` 回灌（README + 全部钩子，含新增的 `run.mjs`）；删掉改钩子期间挂的刹车；HANDOFF 的「提交总数」锚点对齐；跑四项门禁
  - 为什么这次全程挂刹车：本批起因就是"半套改动让钩子 import 崩了"——改 4 个钩子的期间如果别的会话触发 Stop，会撞上改了一半的逻辑。`auto.off` 是唯一能挡住这个窗口的开关
  - 验证：`npm run check` **EXIT 0**（typecheck / 172 套 / `audit:i18n` / 三张台账 / 文档门禁）；`node .continue/hooks/check.mjs` **五项全绿**；`check-framework.mjs` 通过；`test-install.mjs` **19 项**通过；`diff -rq assets/.continue/hooks .continue/hooks` 与 `diff -q` README **无差异**；`.continue/auto.off` 已删除
  - 批次：20261023-0823


