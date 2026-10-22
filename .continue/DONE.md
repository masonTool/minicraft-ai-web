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

> `notes/` 是本节的**溢出位**，不是第二套机制——这里只留一行索引。

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

