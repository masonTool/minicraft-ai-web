# 完成档案 · DONE

> 本文件是**已完成工作的唯一档案**，只回答"这批做了什么、怎么验的"——时间线，最近的在最上面。
> 按模块看现状与坑 → `OVERVIEW.md`；下次怎么避开 → `TIPS.md`；机制与格式 → `README.md`。
> **一条内容只写一个地方**，别在三份文档里各抄一遍。
>
> 收尾时**整份队列原样搬进来**（含每条任务下方的完成说明与 `[阻塞]`），标题格式
> `## 批次 <号> · 日期 · 会话 <前 8 位>`。

---
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


## 批次 20261023-0744 · 2026-10-23 · 会话 b09ae4d7

**做了什么**：用户确认的 3 组机制调整 + worktree 并行，共 6 条。① 计划启用门槛收紧到
「任务 > 16 个队列条目才建，每个里程碑 ≥2 个阶段」；② 计划改成**会话专属** `doing/plan-<会话ID>.md`，
与队列同名配对——队列头 `> 计划：` 整行删除，连带删掉「解析头部 / 校验写法 / 校验位置 / 引用丢失告警」
四道防线；③ 收尾不再 `rm` 队列，改 `archive-queue.mjs` 归档到 `logs/doing-archive/<会话ID>-<时间戳>.md`；
④ 并行任务改走 `git worktree`（`npm run continue:worktree`），分支自动推远程、合并时机交给人。
框架与机制一起改：`SKILL.md` 与 `assets/.continue/` 同步回灌。

**条目**（原文照搬）：

- [x] [门槛1] Plan 启用门槛收紧：任务 > 16 个队列条目才建计划、里程碑至少 2 个阶段（`notes/plan.md` / `README.md` §3 第 10 条 / `queue-init` 第 9 条 / `HANDOFF.md` §4 / `audit-docs` 新断言）→ `npm run audit:docs` 绿；造一个单阶段里程碑能红
  - 做了什么：`notes/plan.md` 新增 **§0「什么时候才需要计划（门槛 16）」**（≤16 条不建计划、>16 条才建、每个里程碑 ≥2 阶段，附一张门槛表与"为什么门槛定这么高"）；§5 把"里程碑粒度"改成两条"机器管不到的"（该覆盖多少用户价值 / 该不该进计划）；`README.md` §3 第 10 条首句改成"预计 > 16 条才用计划"并补"每个里程碑 ≥ 2 个阶段"（**仍 3 行、仍 400 行**）；`queue-init` 第 9 条同步；`HANDOFF.md` §4 同步；`audit-docs` 加"里程碑 0 阶段 / 1 阶段"的检查
  - **为什么这条只提示、不判红**：实测本仓库那份 `plan-jump.md` 就是单阶段，而它属于**另一个正在跑的会话**——判红会当场卡住它的提交，而"拆别人的计划"等于改它这一批的执行流程。里程碑粒度是**判断**不是结构，所以走 `i18n-audit` 用过的同一口径（**只报告、不失败，判死是人的事**）；真正的硬约束放在注入协议与 `notes/plan.md` §0（新计划不许这么写）。为此给 `audit-docs` 加了 `hints` 通道（只打印、不设 `failed`）
  - 为什么门槛是 16：一批 8~12 条，16 ≈ 两批。**≤16 条的任务不存在"跑到一半忘了初衷"的风险**，为它建计划设里程碑，只有打断的代价、没有防护的收益；而且"每批都停"会让人开始无脑点"继续"，关卡退化成形式
  - 验证：`npm run audit:docs` 绿，且对 `plan-jump.md` 打出**提示**而非错误；造一个"空里程碑 + 单阶段里程碑"的假计划 → 两条提示都按时打印、仍然 `文档体量检查通过`（不判红）；删掉假计划后复绿；`README.md` 仍 400 行
  - 批次：20261023-0744
- [x] [会话1] 计划改成会话专属 `plan-<session_id>.md`：`lib.mjs` 加 `planNameFor/planPathFor`、删 `parsePlanRef`、`QUEUE_HEAD_LINES` 6→5；`auto-continue.mjs` 按 sid 读计划并删「引用不存在」分支；`audit-docs` 删两条头部检查、加「孤儿计划」；`selftest` 夹具改成 `plan-<sid>.md` + 删除第 6 行用例 + 新增「名字不对就不生效」；迁移 `plan-jump.md` 并清掉两份队列里的 `> 计划：` 行 → `node .continue/hooks/check.mjs` 五绿 + `npm run audit:docs` 绿
  - 做了什么：① `lib.mjs` 新增 `planNameFor(sid)` / `planPathFor(sid)` / `sessionOfPlan(name)`（`PLAN_FILE_RE` 加捕获组），删掉 `parsePlanRef` / `planPath` / `listPlans`，`QUEUE_HEAD_LINES` **6 → 5**（第 6 行原本就是为 `> 计划：` 让位）；② `auto-continue.mjs` 改成 `readPlan(planPathFor(sid))`，**删掉「队列引用的计划文件不存在」整段（约 40 行）**——没有引用就没有错引用；③ `audit-docs` 删掉「声明写法不对」「声明位置超窗」两条，`plans` Map（零消费者）一并删掉，新增**孤儿计划**判红（`plan-X.md` 必须有 `X.md`），注入文本探针改成 `plan-<本会话ID>.md`；④ `selftest` 夹具改成 `plan(sid, body)` + `planQueue(sid, body)`（不再写 `> 计划：`），删两条过期用例（第 6 行同构、引用丢失告警），新增「文件名不配对 → 当没有计划」；⑤ 文档同步 `notes/plan.md` / `README` §3 第 10 条 / `queue-init` 第 7+9 条 / `SKILL.md` / `AGENTS.md` §2 / `HANDOFF.md` §4；⑥ **迁移** `plan-jump.md` → `plan-b75f5b898109486f8b2988e8849149e1.md`，并删掉那份队列里的 `> 计划：plan-jump.md` 行
  - 为什么这一改能删掉三条机制：绑定写在队列头 = **同一件事存两份**，于是要"解析头部""校验写法""校验位置""引用丢失告警"四道防线去兜它。绑定搬进文件名后，这四道全部消失，只剩一条"名字必须配对"的门禁——**少一份副本，就少一类会漂的失效**
  - 为什么 `QUEUE_HEAD_LINES` 退回 5：6 是上一批为 `> 计划：` 落在第 6 行临时加的。声明没了，留 6 就是没有依据的数字；常量本身保留（`hold` / `parseBatch` 两处仍共用一个值）
  - 为什么迁移别人的计划文件：改完不迁，`plan-jump.md` 立刻变成孤儿（新门禁判红），会卡住那个会话的提交。改名是纯文件名动作，不动它的阶段/批次内容；同时把它队列里那行已经失效的 `> 计划：` 删掉（不改任何 `[ ]`/`[x]` 状态）
  - 验证：`node .continue/hooks/selftest.mjs` **44 项全过**（删 2 加 1）；`node .continue/hooks/check.mjs --fast` **五项全绿**；`npm run audit:docs` 绿且孤儿检查在迁移前确实红过（用 `plan-jump.md` 实测）；`README.md` 仍 400 行
  - 批次：20261023-0744
- [x] [备份1] 收尾不再删队列，移到 `logs/doing-archive/<sid>-<YYYYMMDDHHmmss>.md`：新增 `archive-queue.mjs` + `wrapSteps` 第 5 步改文案 → `selftest` 断言"收尾后队列不在 `doing/`、备份在 `logs/doing-archive/` 且带时间戳"
  - 做了什么：① 新增 `.continue/hooks/archive-queue.mjs <session_id>`：`mkdir -p logs/doing-archive` + `rename` 到 `<会话ID>-<YYYYMMDDHHmmss>.md`，打印相对路径并写日志行；② `wrapSteps` 的第 5 步从「删除队列文件」改成「**归档**队列文件（跑上面那条命令，不要 `rm`）」；③ 全链路措辞对齐（`auto-continue` 的 7 处、`queue-init` 第 6/7 条、`README` §3 收尾五步与流程摘要与"只算一条"那条、`pre-commit` 注释）；④ `install.mjs` 的 `REQUIRED` 加这个文件（新项目装出来必须有它）
  - 为什么不再 `rm`：队列原文确实整份搬进了 `DONE.md`，但那是**加工过的**（重排、合并、改错字）；事后想核对"当时那条到底怎么写的"就没有原件了。代价只是一个 `mv`、落在 gitignore 里，不进仓库也不进提交
  - 为什么文件名要带 `<会话ID>-` 前缀：`logs/` 里已经住着钩子的运行日志 `<会话ID>.md`，同名会撞；时间戳还能区分同一会话的多个批次（每批归档一次）
  - 为什么交给脚本而不是让 AI 手敲 `mv`：时间戳 `YYYYMMDDHHmmss`（本地时区）手敲必错，而**错的时间戳不会报错**，只是以后按时间排序时乱序——这类"派生且必须唯一有序"的字符串一律脚本生成
  - 为什么没有第三态"删"：计划全部完成时也该归档（用户的要求是"先不要删"），所以只有两态——普通批走"归档"、计划续批走"重置"
  - 验证：`node .continue/hooks/selftest.mjs` **45 项全过**（新增一条真跑 `archive-queue.mjs`：断言 `doing/` 里没了、`logs/doing-archive/` 里多一份且名字匹配 `^<sid>-\d{14}\.md$`；另一条断言收尾第五步文案是"归档队列"而非"删除"）；`node .continue/hooks/check.mjs --fast` 五项全绿；`check-framework.mjs` 通过；`README.md` 仍 400 行
  - 批次：20261023-0744
- [x] [并行1] worktree 并行：新增 `.continue/hooks/worktree.mjs` + `npm run continue:worktree`、`HANDOFF.md` §4 写合并约定 → `--dry-run` 打印计划且不建目录
  - 做了什么：① 新增 `.continue/hooks/worktree.mjs <名字> [--dry-run]`：在仓库旁建 `<仓库>-wt-<名字>`、开分支 `continue/<名字>`（基于 HEAD）、**立刻 `git push -u origin`**；带三条拒绝（名字不合法 / 已在 worktree 里 / 目录或分支已存在）；push 失败只告警不中断（树已经能用）；② `npm run continue:worktree` 指向它；③ **放在 `.continue/hooks/` 而不是 `tools/`**，并加进 `install.mjs` 的 `REQUIRED` 与 `assets/`——这样它是框架的一部分，新项目装出来就有；④ `HANDOFF.md` §4 加「并行工作树」段（建树 → **必须在新路径另开会话** → 合并时机由用户定 → 冲突处置约定）；⑤ 注入协议第 1 条把"串行开发"改成"**一棵树上只有一个会话在干活**，要并行就开工作树"；⑥ `SKILL.md` 加一条、`README` §7.2 那句补上工作树指路
  - 为什么合并约定要写死：`DONE.md` / `notes/batches.md` 是**追加型**（各一批一节，两边都留即可）；`TASKS.md` 是**状态位**（两边可能都勾了同一条，必须按语义手工合）；`doing/*.md` 各是各的会话文件、不会冲突。不写下来，每次合并都要重新想一遍
  - 为什么必须"新建会话"而不能沿用原会话：钩子的注册命令是相对路径，**cwd 决定它读写哪棵树**。从原会话跑，`queue-init`/`auto-continue` 读写的永远是原工作区的 `doing/`，等于没隔离。这是工具边界，不是框架能绕过的，所以脚本最后直接把 `cd <新路径>` 印出来
  - 为什么脚本拒绝"在 worktree 里再开树"：用 `--git-dir` 与 `--git-common-dir` 是否相同来判断；树里套树会让 `PROJECT_ROOT` 反推和 git 操作都变复杂，且没有真实场景需要
  - 验证：`npm run continue:worktree -- demo --dry-run` 打印三步计划、**不建任何目录/分支**；缺参数时打印用法并 exit 2；`node .continue/hooks/check.mjs --fast` 五项全绿；`check-framework.mjs` 通过；`README.md` 仍 400 行
  - 批次：20261023-0744
- [x] [同步1] 框架侧一起改：`SKILL.md` + `assets/.continue/`（README + 改过的钩子）回灌 → `diff -rq` 无差异；`check-framework.mjs` 与 `test-install.mjs` 通过
  - 做了什么：`SKILL.md` 的三段（收尾自动 / 一批多长 / 任务大过一批用计划）在本批各条里同步改完，并新增「并行靠工作树」一条；`assets/.continue/README.md` 与 6 个钩子（`lib` / `auto-continue` / `queue-init` / `selftest` / `pre-commit` / `archive-queue` / `worktree`）回灌，`diff -rq` 无差异；`install.mjs` 的 `REQUIRED` 补上两个新脚本
  - 为什么这一条必须单独走一遍：**框架与机制要一起改**——运行版改了而打包源没改，重装一次就把本批三条改动全抹掉，而且症状是"过几天又变回去了"，没有任何报错。本仓库踩过同一个坑（`DOC_LIMITS.TASKS` 被重装改回 600），所以 `audit-docs` 里留了探针，这里再靠 `diff -rq` 兜一层
  - 验证：`diff -rq assets/.continue/hooks .continue/hooks` **无差异**；`diff -q` README **一致**；`check-framework.mjs` 技能自查通过（模板↔安装器一致、注册命令带 `--event=`）；`test-install.mjs` 安装器回归 **19 项**通过
  - 批次：20261023-0744
- [x] [验] 全量验证：`npm run check` / `node .continue/hooks/check.mjs` / 两项 skill 自检全绿，删掉刹车 `.continue/auto.off`
  - 做了什么：跑全量门禁、框架五项、两项 skill 自检；删掉改钩子期间挂的刹车 `.continue/auto.off`；把 HANDOFF 的「提交总数」锚点对齐到实际（1440）
  - 为什么锚点要手动对：`audit:tasks` 只判「过期」不写回，容差 ±2；而本仓库现在**多个会话并行提交**，这个锚点会持续漂——它是共享文档的固有代价，收尾时得再对一次
  - 验证：`npm run check` **EXIT 0**（typecheck / 172 套 / `audit:i18n` / 三张台账 / 文档门禁）；`node .continue/hooks/check.mjs` **五项全绿**；`check-framework.mjs` 通过；`test-install.mjs` **19 项**通过；`.continue/auto.off` 已删除（`ls` 无此文件）
  - 批次：20261023-0744


<号> · <日期> · 会话 <sid 前 8 位>` 见 `README.md` §3；这里不放格式样例（会被当成真批次）。
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
