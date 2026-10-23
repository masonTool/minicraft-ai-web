---
name: continue-task
description: This skill installs the continue-do persistent task-queue framework into a project (per-session task queues under `.continue/doing/` plus Stop / UserPromptSubmit hooks), then verifies the environment so the framework actually runs. It is meant for long-running, cross-session AI development of large projects. Use it when the user asks to install, enable, reinstall or diagnose continue-task / continue-do in a project. It is an installer only — the framework's documentation ships with the files it copies. Hooks run in both WorkBuddy and the CodeBuddy IDE, but hosts differ in how many times they accept a Stop hook's feedback per user message (WorkBuddy: unlimited; CodeBuddy IDE: 1 by default, governed by the `loop_limit` field the installer writes) — tell the user which applies before installing.
---

# continue-task

安装 continue-do 持续任务队列框架。这是安装器；框架怎么用，装完后看项目里的 `.continue/README.md`。

## 用途与平台要求

**用途**：给**大型项目的持续型 AI 开发**用。它把需求、本轮队列、完成档案、模块现状、踩坑经验
全部落到项目的 `.continue/` 里，让 AI 的进度**跨会话、跨上下文窗口不丢**，把"一次对话干完一件事"
变成"一条队列逐条推进、做不完下次接着做"。

其它好处（简略）：

- **进度外置**：进度是文件、进版本库，会话被中断也不丢；队列没做完不许停。
- **一次改动 = 一条任务 = 一个提交**：Stop 钩子只递一条，**递出时就把那条标成 `[~]`**（不靠 AI 自己写），
  pre-commit 拒绝一次勾掉多条。
- **门禁由脚本跑**：编号、跨文件引用、文档体量、钩子自检、提交前检查都由脚本执行，
  不看 AI 自证。
- **钩子崩了不会静默放行**：注册命令都经 `.continue/hooks/run.mjs`，它把"钩子自己崩了"（exit 1）
  翻成 exit 2 + 告警——否则宿主会当"本轮无需阻止"，整条队列停摆且一句提示都没有。
- **有刹车**：`> 状态：讨论中` 停单份队列，`touch .continue/auto.off` 全停，随时人工接管。
- **并行靠工作树**：`npm run continue:worktree -- <名字>` 建独立 worktree + 分支并推远程，
  **必须在新路径另开会话**（钩子按 cwd 判断读写哪棵树）；合并时机由用户定。
- **收尾自动**：队列全打勾 → 直接归档进 `DONE` / `OVERVIEW` / `TASKS` 并删队列，不弹窗等确认；
  只有 `[阻塞]`、或打了勾却缺验证 / 自述"未验证、跳过"的条目，才会要你拍板。
  **有计划时不是删队列而是重置它**（换成下一阶段的条目 + 新批次号），删了计划链就断在这里。
- **一批多长看行数，不看条数**：判据是"完成说明预计 > ~80 行"/"队列 > 500 行"/"这一阶段目标变了"；
  条数只是经验值（通常 8~12 条），不是上限。换批要新号时跑
  `node .continue/hooks/queue-init.mjs --new-batch`（号由脚本生成，不手编）。
- **任务预计 > 16 条队列条目才用计划**（≤16 条直接做完、不设里程碑）：`doing/<会话ID>-plan.md`，
  与队列 `<会话ID>.md` **同名配对**（文件名即绑定，队列头不写 `> 计划：`）；里程碑 → 阶段（阶段 = 一批），
  之后每批做完自动取下一阶段，**完成到里程碑就硬停**、要跑该里程碑的验收再弹窗问开发者。

**⚠️ 这个框架依赖会话钩子（hooks）。两个宿主的钩子都会跑，差别只在
Stop 反馈每条用户消息能被采纳几次：**

| 运行环境 | Stop 续跑 | 结论 |
| --- | --- | --- |
| WorkBuddy | 无上限，直到队列空 | **有效**，一条消息能跑完整个队列 |
| CodeBuddy IDE | 默认 **1 次**（宿主字段 `loop_limit` 缺省为 1） | 安装器写 `loop_limit=100` 后**有效**；没写时一条消息只推进一条 |
| CodeBuddy CLI | 未实测（同产品线，取决于版本有没有这个字段） | 安装器已写 `loop_limit`；装完按第 6 步实测一轮即可确认 |

**别说"IDE 钩子会中断"**：会话注入、递任务、提交守卫、pre-commit 都能跑，被截断的只是续跑次数。
排查用：IDE 按 `stopHookCount < loop_limit` 判定，计数每条用户消息清零，`loop_limit` 取所有
Stop group 的最大值（`-1` 不限，非数字算 1）；WorkBuddy 没有这个计数。

## 安装

### 1. 一条命令装完

在**目标项目根目录**执行：

```bash
node <本技能目录>/scripts/install.mjs
```

它会自己处理所有分支（全新项目 / 存量项目 / 老版本升级），**装完还会自检**——
必备文件缺任何一个就非零退出并列出缺什么。

常用参数：

| 参数 | 作用 |
| --- | --- |
| `--dry-run` | 只报告会做什么，不写任何文件。先跑这个看清楚再真装 |
| `--force` | 文档已存在时也覆盖（默认是另存 `*.continue-do.md`，保护用户进度） |
| `--ci` | 额外写 `.github/workflows/continue-do.yml`（跑与本地完全相同的 `check.mjs`）。默认不写；已有同名文件不覆盖 |

### 1.5 三层自检（都不需要人肉核对）

| 脚本 | 回答什么问题 | 快慢 |
| --- | --- | --- |
| `scripts/check-framework.mjs` | 打包源**自己**一致吗（模板↔安装器、注册命令带 `--event=`、脚本与开关都在本文里有交代） | 秒级 |
| `scripts/test-install.mjs` | 装出来的**形状**对吗（必备文件齐不齐、装完的自检跑得通） | 秒级 |
| `scripts/e2e.mjs` | 装好之后**真的转得动吗**：跑真场景，断言"队列 / 递任务 / 收尾 / 归档 / 计划 / 阻塞 / 并行" | 分钟级、花 token |

前两个只看静态产物，挡不住"注入 JSON 被截断""队列文件名写错"这类**静默失效**——那种情况静态检查全绿，但任务永远递不出来。`e2e.mjs` 就是为了这一层。

#### 六个场景、两种执行器

| 场景 | 执行器 | 验什么 |
| --- | --- | --- |
| `main` | model | 主干：**3 条**极小任务 → 逐条递 / 逐条勾 / 收尾（DONE 有批次节）/ 归档 |
| `blocked` | probe | 同一条连续 N 轮没做完 → 标 `[阻塞]` → 之后请用户拍板 |
| `decision` | model | 需要拍板的地方自己决定，并写进 `<sid>-decision.md`（`决定`/`为什么`），归档时跟着队列一起走 |
| `plan-split` | model | 30 条的大任务 → **是否切成 plan**，里程碑/阶段是否合理（只验切分，不实现） |
| `plan-run` | probe | plan 执行：**里程碑边界硬停**（先问人后重置队列）+ **完成之后的整体收尾与归档** |
| `worktree` | probe | 别的会话有队列 → 注入提示 → 建树+分支+推本地 bare origin → 树内隔离 → `merge --no-ff` 回主分支 |
| `journey` | model+probe | **完整旅程（可选，不进 `--all`）**：两批任务（含跨批次累积归档）+ 计划里程碑硬停与完成 |

**为什么要 probe**：像"连喂 5 轮没做完"这种分支，靠"让模型故意不干活"根本触发不了；而它又是最容易静默失效的地方。probe 仍然跑在**装出来的真实框架**上，只是不经过模型——验的是机制，不是"模型乖不乖"。

```bash
npm run skill:e2e                          # 只预检，不跑
npm run skill:e2e -- --all --yes            # 六个全跑（含模型，会烧 token）
npm run skill:e2e -- --scenario blocked     # probe 场景不用 --yes
npm run skill:e2e -- --clean                # 只清现场（test.md 保留）
npm run skill:e2e -- --dry-run             # 只看计划
npm run skill:e2e -- --turns 30 --model <id> --timeout 480 --strict
```

### 跑之前必须确认（会烧 token）

脚本**默认只做预检、不跑**。带上 `--yes` 才真跑；含模型场景时缺 `--yes` 会打印下面这份东西然后退出：

```
· main（model）
    主干：真模型依次做完 3 条小任务（逐条递 / 逐条勾 / 收尾 / 归档）
    预计：约 3,258,313 tokens / 约 4 分钟  —— 历史 1 次的中位数
```

- 数字来自 **`e2e-history.md`（入库账本）**里的同场景实测；没有历史就退化成经验值，
  并**明确标「估算，非实测」**——不编。
- probe 场景不消耗 token、几秒跑完，**不需要** `--yes`。

### 六条约定

- **数据目录在 skill 里**：`.codebuddy/skills/continue-task/.e2e/<场景>-<时间戳>/`，
  同目录 `.gitignore` 已排除。**框架进库、现场不进库**。
- **现场默认保留**：跑到一半重跑某个用例时**不会**动别的用例的现场；`--fresh` 才清上一轮。
- **模型取本机正在用的那个**：读 `~/.codebuddy/settings.json` 的 `model`（去掉 `custom-local:` 前缀）；
  读不到就报错要 `--model`，**绝不猜**。
- **环境问题不算失败**：没装 CLI / 未登录（401）/ 网络挂掉 → 只验静态级并标 `⏭ 跳过`；
  `--strict` 可以把跳过收紧成失败。
- **记录三处**：`.e2e/test.md` 是**汇总表**（场景 / 执行器 / 测什么 / 耗时 / tokens / 结果 + 失败明细 + 单测表）；
  **每个场景跑完就写一次**（`report.md` 与 `test.md` 里的本轮那一节都刷新，标题写「进行中」并列出还剩哪些场景），
  整轮结束后再用终版覆盖——所以**中途停下也能看到已完成场景的结果**，不用等十几分钟；
  **每个场景目录里另有 `report.md`**（逐条断言 + 实测值/失败原因），点进目录就能看懂这个目录是干嘛的；
  `test.md` 里也有同一份「明细」（每个场景一张逐条表），所以只看汇总文件就知道**具体哪几条过了**；
  `e2e-history.md` 是**入库账本**（每次模型场景的耗时与 tokens），给下次估算当依据（整轮结束才追加）。
- **跑全套自动清场**：`--all` 会先清掉上一轮现场（一轮 = 一批目录 = 一节报告）；单跑某场景不清，
  `--keep-all` 可保留。
- 不进 `test:*` 前缀，所以 `npm run check` 不会带上它，也不会把台账里的"套数"改乱。

**CI 怎么跑**：`.github/workflows/skill-e2e.yml`（**只手动触发**，一次几分钟且花 token）。
它需要登录态——CLI 的 `auth-type` 是 `cli-external-link`，登录信息落在配置目录的
`local_storage/` 里（实测：只拷这一个子目录 + 设 `CODEBUDDY_CONFIG_DIR` 就能跑）。

```bash
# 本机已登录时，把登录态打包成 secret（约 400KB，不是整个 ~/.codebuddy）
cd ~/.codebuddy && tar czf - local_storage | base64 | pbcopy
# → GitHub: Settings → Secrets → Actions → CODEBUDDY_LOCAL_STORAGE_B64
```

### 2. 安装器做了什么

| 内容 | 已存在时 |
| --- | --- |
| `.continue/hooks/*.mjs`、`.gitignore` | **总是覆盖**（框架代码，不覆盖等于升级失效） |
| `.continue/config.json` | **只补缺失的键**，已有值一律保留（用户改过的 `checks.fast` 升级后仍在）；不是合法 JSON 就不碰并报错 |
| git `pre-commit` | 写一个垫片调用 `hooks/pre-commit.mjs`：提交前跑 `checks.fast`（失败拒绝），并拒绝"一次提交勾掉多条队列条目"（`CONTINUE_MAX_ITEMS_PER_COMMIT`，默认 1）。**`.continue/hooks/pre-commit.mjs` 不存在时直接放行**（框架被删/切到没装框架的分支，残留垫片不能把仓库卡成提交不了）。已有**非本框架**的 pre-commit 时不覆盖，只打印"加哪一行"的提示 |
| `.continue/doing/` | 只保证目录存在，**里面一个文件都不动**（可能有进行中的队列） |
| `.continue/TASKS.md` / `DONE.md` / `OVERVIEW.md` / `TIPS.md` / `README.md` | 与模板**逐字节相同**→视为已装，跳过；**内容不同**→另存 `<名>.continue-do.md`，原文件保留 |
| `AGENTS.md` | 同上 |
| 项目已有文档 | **只读扫描**并列出"待集成"候选（目标文档 + 行数 + 依据），不写任何文件；合并按下一节做 |

两个设计要点：

- **幂等**。重装不会给每份文档都造一个备份——只有"内容真的和模板不同"才另存，
  且同名备份已存在时不覆盖。所以可以随时重跑安装器来升级框架代码。
- **永不覆盖用户进度**。文档冲突一律另存，用户合并完自己删。

### 2.5 集成已有文档（存量项目必做，让用户平滑切换）

安装器只做**只读扫描**，给候选与目标建议；**内容判断与合并由你做**：

```bash
node <技能目录>/scripts/scan-docs.mjs          # 人读表格
node <技能目录>/scripts/scan-docs.mjs --json   # 机器读（字段：path/lines/target/reason/registered）
node <技能目录>/scripts/scan-docs.mjs --all    # 连无法归类的也列出来
```

扫描范围：跳过 `.git` / `node_modules` / `.continue` / `dist` 等目录，只认 `.md/.markdown/.mdx/.txt`；
按文件名优先、正文特征兜底，给出 `TASKS / DONE / OVERVIEW / TIPS / README` 建议。
已经写成 `> 来源：<路径>` 的文档标记为已登记，**不会重复提示**（幂等）。

合并规矩（违反会被 `check.mjs` 拦）：

| 已有文档 | 并到哪 | 怎么并 |
| --- | --- | --- |
| 待办 / Roadmap / Issue 列表 | `TASKS.md` | 未完成 → `- [ ] T<n>`，编号接当前最大号、**永不复用**；有意空缺写 `作废编号：T9~T15` |
| CHANGELOG / 已完成清单 | `TASKS.md` 的 `C. 已完成` + `DONE.md` | 完成项落成 `- [x] T<n>`（一个需求一个号）；`DONE` 里只加一节 `## 迁移导入 · <日期> · 来源 <路径>`，**不编批次号**、不逐条复制 |
| 架构 / 模块 / 设计说明 | `OVERVIEW.md` | 按模块落到 §二，挂 `T<n>` + 「迁移导入」；§一 同步加模块索引 |
| 踩坑 / FAQ / 排查笔记 | `TIPS.md` | 四段式（症状 → 根因 → 处置 → 适用面）；模块名必须与 `OVERVIEW` 的 `###` 小节**完全一致** |
| README / 开发约定 | `.continue/README.md` 的「项目约定」 | 只搬**会改变做法**的约定；`README` 有 400 行上限，装不下就留在原文件并在 `AGENTS.md` 指路 |

四条硬要求：

1. **只搬结论，不搬全文**；每段带一行 `> 来源：<相对路径>`（既是溯源，也是扫描器的"已登记"标记）；
2. **原文件一律保留**：用户可能还在用；合并完告诉用户"以后以 `.continue/` 为准"，不要默默删；
3. **不编批次号、不编 `T` 号**：批次号只由 `queue-init` 生成，历史导入用 `## 迁移导入` 这类非批次标题；
   `T` 号只增不改，DONE 里出现的 `[Tn]` 必须在 TASKS 里有对应的 `[x]` 条目；
4. 合并完必须 `node .continue/hooks/check.mjs` 全绿；文档超上限先精简再写入，别为了搬全撑爆。

**边界**：扫描器给的是"建议"。无关文档（第三方 LICENSE、子包 README、临时笔记）在回复里说明跳过；
拿不准的用弹窗问用户，不要硬并。

### 3. 项目自己的检查（可选）

框架**自带** `config.json`，`checks.fast` 指向 `hooks/check.mjs --fast`，装完就有内置检查
（编号审计、文档体量、钩子自检；`node .continue/hooks/check.mjs --list` 看实时清单）。
**`checks.fast` 允许改**——重装时 `config.json` 只补缺失的键，你改过的值会保留。

**安装器会自动探测项目怎么测**，把命令写进 `checks.project`（`scripts/detect-tests.mjs`，只读）。
它只看**现成证据**：package.json 的 `scripts.test` → `test:unit` 等 → vitest/jest/mocha/ava 依赖 →
有测试文件则 `node --test`；然后 `Cargo.toml` → `go.mod` → Python（pytest 优先、退回 unittest）→
`pom.xml` → gradle → `*.csproj` / `*.sln` → `phpunit.xml` → `Gemfile` → `Makefile`，
取**第一个命中**的生态。

三条边界：

- **用户已有非空的 `checks.project` 一律不覆盖**（手写的比探测值可信），日志会写"保留已有值"；
- `--no-detect` 关掉探测；`--dry-run` 只报告会填什么，不落文件；
- **npm 的占位脚本**（`npm init` 默认那条 `Error: no test specified` + `exit 1`）判成"没有测试"。
  真把它接进门禁会让每次提交都变红，比没接上更糟——这是有意为之。

#### 探测不到测试时（装完必须处理，别略过）

安装输出里会出现这样一段：

```
· 这个项目还没有可自动跑的测试——门禁里只会跑框架自检（编号 / 文档 / 配置 / 钩子）
  · <依据：为什么判成没有测试>
  建议（做完重跑安装器即可自动接进门禁，也可直接写进 checks.project）：
    1. …
```

**你要做的**（顺序别调）：

1. **先弹窗问用户**要不要现在补一个最小可跑测试，三个选项：
   "现在就搭（我按建议建一条最小断言）" / "先不搭，门禁只跑框架自检" / "我自己来，别动代码"。
   推荐第一个，但**决定权在用户**；
2. 用户同意才动手，且**只建最小的一条**（一条断言能跑通即可，不搭框架、不加依赖、不改构建）；
3. 跑通后**重跑安装器**，让它把 `project` 自动填上；或在 `checks.project` 里手写这条命令；
4. 用户选"先不搭"就**如实写进告知**（第 7 步第 9 条），不要沉默——门禁少一层要让人知道。

**不要**替用户建测试框架、不要凭空加依赖、不要为了让门禁"有东西可跑"而写一个永远为真的断言。

要手写或改命令就编辑 `checks.project`：

```jsonc
{
  "checks": {
    "fast": "node .continue/hooks/check.mjs --fast",  // 框架内置检查，别删
    "project": ["npm test"],                          // 字符串或数组，按顺序跑
    "timeoutSec": 60                                  // 单条命令的超时，要小于钩子注册的 300s
  }
}
```

要点：

- `check.mjs` 会**先跑内置检查、再跑 `project`**，所以内置检查不可能被漏掉；命令由钩子亲自执行看退出码，
  写进提示词让 AI 自证没有意义。
- `project` 里的命令必须**秒级**。跑一轮几十秒的命令放进来，等于让每条任务都卡一次——那还不如不开门禁。
- 重装框架时 `config.json` 只补缺失的键，你加的 `project`、改过的 `fast` 都会保留。

### 4. 三条提醒

- `*.continue-do.md` 只是备份，**不要留在仓库里**——agent 会同时读到两份指令，
  内容一冲突就说不清哪份算数。和用户合并完就删掉（第 7 步要提醒）。
- 老版本留下的 `.continue/HANDOFF.md` / `NOTES.md`：内容分别并入 `README.md` /
  `DONE.md` 后删掉。两套说明并存时，AI 只会读到其中一半。
- **老版本的目录/文件名**（`queues/` → `doing/`、`EXPERIENCE.md` → `TIPS.md`）：
  **不需要手动搬**，`queue-init.mjs` 每会话首次启动会自动对齐（幂等，实现见
  `lib.mjs` 的 `migrateLegacyLayout()`），并在注入里报告搬了哪几个。
  装完**重启一次会话**就会触发。

### 5. 注册钩子（安装器自动完成）

安装器会写 `.codebuddy/settings.json`（不存在就新建），四条注册的唯一登记处是
`scripts/install.mjs` 里的 `HOOKS` 常量——**不要照着文档手抄**，这里也不再复制一份清单。

- 按 `command` 是否含 `.continue/hooks/<脚本名>` 判重，**只追加缺的**；
  `UserPromptSubmit` 追加到第一个 group，`Stop` 追加到**本框架自己的** group；
  别的钩子、别的配置项一律不动；
- **Stop group 上写 `loop_limit`**（常量 `STOP_LOOP_LIMIT`，默认 100 = 宿主允许的最大有限值）：
  宿主按 group 取最大值，不写就等于 1（每条用户消息只推进一条任务）。已有值不动；
  如果本框架的钩子和用户自己的钩子混在同一个 group 里（老版本装的），**不写**并告警——
  写进去等于放宽别人的续跑次数；
- 装完自检会核对四条注册、`--event=`、以及**读回 settings 复算生效的 `loop_limit`**；
  用户级 `.codebuddy/settings.json` 里若有别的值（如 `-1` 不限），会警告说明实际以哪个为准；
- 文件不是合法 JSON 时**不改动**，安装器以 exit 1 报错，修好再重跑。

`auto-continue.mjs` 挂在**两个事件**上：Stop 递任务，UserPromptSubmit 只把轮次计数归零。

注册命令**一律带 `--event=<自己的事件>`**（`node .continue/hooks/auto-continue.mjs --event=Stop`）：
钩子靠它把来源写进日志行首（`[auto-continue · Stop]`），不靠 payload 猜字段名。老版本装的注册没有这个参数，
重装时安装器**就地补上**（不整条重写，保住你挂在命令前的环境变量）；自检与 `check-framework.mjs` 各查一次。

⚠️ 注册完**必须重启会话**：钩子配置在会话启动时拍快照，不热加载。改完文件当场测试会发现
"钩子根本没跑"（`.continue/logs/` 一直是空的）。

### 6. 验证环境

逐条跑，**任何一条不符合就停下来修**，修好再继续：

| # | 检查 | 命令 | 期望 |
| --- | --- | --- | --- |
| 1 | **安装器自检通过** | `node <技能目录>/scripts/install.mjs` 的退出码 | `0`；非 0 时按它列出的 `✗` 逐条修。文件齐全、四条钩子注册都由它核对，不再手数 |
| 2 | Node 可用且 >= 18 | `node -v` | `v18` 或更高 |
| 3 | **内置检查全绿** | `node .continue/hooks/check.mjs` | 全部 `✓`、exit 0。其中 `hooks` 一项在**临时副本**里灌事件，覆盖了递任务、会话注入、提交守卫、pre-commit 的行为，不会弄脏工作区 |
| 4 | 提交前门禁接上了 | `git rev-parse --is-inside-work-tree` 为 `true`，且安装输出里没有"已有非本框架的 pre-commit"警告 | 不是 git 仓库 → 告诉用户提交守卫与 pre-commit 都不会生效；有那条警告 → 把提示的那一行加进用户自己的 pre-commit |
| 5 | **Stop 能连续推进** | 重启会话后建一个 3 条的队列，发**一条**消息，别插话 | 连续做完 3 条 → 宿主无上限或有 `loop_limit`；只做完 1 条 → 上限是 1，看 `.continue/logs/<sid>.md` 里有没有 `续跑第2次` |

第 3 条若失败，先分清是"命令配错"还是"项目本来就有失败"：
前者改 `config.json`，后者要告诉用户——pre-commit 会拒绝所有提交，等于装上就跑不动。

第 5 条是**唯一能用一条命令坐实的平台差异**，别用"平台名"下结论：
日志里出现 `续跑第 N 次` 说明宿主确实在续跑；只到第 2 次就停说明上限为 1。
上限为 1 不是框架坏了，改 `.codebuddy/settings.json` 里 Stop group 的 `loop_limit`（数字，`-1` 不限）
并重启会话；不想改就告诉用户"每条消息推进一条，说继续即可"。

### 7. 告知用户

1. **第一句先说用途**：这是给大型项目做持续型 AI 开发的任务队列框架，进度写在 `.continue/` 里、
   跨会话不丢；再简略带一句其它好处（一次任务一个提交、脚本门禁、随时可刹车、**默认提交后自动推送**——
   不想推就把 `.continue/config.json` 的 `git.push` 设成 `false`）；
2. **紧接着说清"能连续推进几条"**（见上文表格）：WorkBuddy 一条消息能跑完整队列；
   CodeBuddy IDE 默认一条消息只推进一条，安装器已写 `loop_limit`（默认 100），
   **重启后按第 6 步第 5 条实测一轮**再下结论。不要笼统说"IDE 不支持"——会话注入、递任务、
   提交守卫在 IDE 里都生效，说的是续跑次数；
3. 装了哪些文件、哪些因为已存在被跳过；`*.continue-do.md` 备份要用户自己合并，
   **合并完删掉**（两份指令并存时 AI 会读到冲突的两套规则）；
4. **已有文档的集成结果**（第 2.5 步）：扫到几份、把哪几份并进了哪个文档、哪几份跳过及原因；
   `> 来源：` 标注的位置也要说，方便用户以后溯源；
5. 环境验证结果（第 6 步逐条结论，不要只说"通过"）；
6. 钩子要**重启会话**才生效（第 5 步）；重启后 `queue-init` 只在该会话第一条消息时注入，
   本会话已经错过了注入时机；
7. 告诉他怎么暂停：把队列头部的 `> 状态：执行中` 改成 `> 状态：讨论中` 就不递任务，
   改回来继续；要连提交守卫一起停就 `touch .continue/auto.off`（删掉即恢复）；队列不会丢。
8. **收尾是自动的**：队列全部打勾后，钩子直接下令收尾（搬 `DONE` → 更新 `OVERVIEW` → 勾 `TASKS`
   → 自问 `TIPS` → 删队列），**不再弹窗问"要不要收尾"**；只有出现 `[阻塞]`、或打了勾却缺验证 /
   自述"未验证、跳过"的条目时，才会弹窗要你拍板那几条（改描述继续做 / 删除 / 先留着并收尾）。
9. **门禁里到底跑了什么**：说清 `checks.fast`（框架自检）与 `checks.project`（项目自己的测试，
   安装时自动探测填入）各是什么；**没探测到时**要说明你建议补什么、以及用户选了"先不搭"还是"先搭上"。

### 8. 改这个技能的时候（维护者看）

技能自己的规矩由技能自己的脚本查，**不装进用户项目**：

| 脚本 | 查什么 |
| --- | --- |
| `scripts/detect-tests.mjs` | 安装器装完后自动跑的测试探测（只读）：npm / Rust / Go / Python / Maven / Gradle / .NET / PHP / Ruby / Make 的识别顺序与判据。改规则后拿几种项目形态各跑一次看 `--json` |
| `scripts/check-framework.mjs` | 模板里的钩子都在安装器 `REQUIRED` 里、必备文档都会被拷贝、`assets/` 没混入本仓库的批次号与模块名、注册命令都由 `commandFor()` 拼且带 `--event=`、模板默认值与文档说法一致、`scripts/` 下每个脚本与 `install.mjs` 的每个开关都在本文件里有交代 |
| `scripts/test-install.mjs` | 安装器回归：全新 git 项目 / 非 git 目录 / 已有同名文档 / 已有自定义 config / 已有别的钩子 / 已有别人的 pre-commit / `--dry-run` 不落文件 / `--ci` / 老注册缺 `--event=` 时升级 / 已有文档扫描 / 来源登记幂等，共 11 项 |
| `scripts/scan-docs.mjs` | 存量文档发现（只读）：目录跳过、扩展名过滤、文件名与正文分类、`> 来源：` 已登记判定。改分类规则后跑一次 `node scripts/scan-docs.mjs --all` 看效果 |

两条都在**本仓库里手动跑**（这个仓库只剩技能目录，没有 `.continue/` 可以挂 `checks.fast`），
改完技能、提交前各跑一次：

`node .codebuddy/skills/continue-task/scripts/check-framework.mjs && node .codebuddy/skills/continue-task/scripts/test-install.mjs`

要连**装出来的框架**一起验（这两条都只查静态一致性），就在空目录里装一遍再跑它的自检：

```bash
T=$(mktemp -d) && cd "$T" && git init -q
node <技能目录>/scripts/install.mjs
node .continue/hooks/check.mjs          # ids / docs / config / hooks 四项全绿
```
