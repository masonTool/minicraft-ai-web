# 接手必读 · HANDOFF（当前状态 + 本项目约定）

> **机制不在这里**：队列格式、四种标记、钩子行为、收尾五步、日志与刹车开关 → [`.continue/README.md`](./README.md)
> （那是 continue-do 框架的说明书，随框架一起升级；本文件重复一遍必然漂）。
>
> 本文件只写**这个项目自己**的东西：现在到哪了、怎么跑、改代码的约定、还没结论的悬案。

| 想查什么 | 读哪一份 |
| --- | --- |
| 这一轮做什么（会话级） | `.continue/doing/<session_id>.md`（钩子会注入路径） |
| 长期待办 / 覆盖率 / 差异台账 | [`TASKS.md`](./TASKS.md)（三张派生表由脚本生成，别手抄） |
| 某个模块现在有什么、有哪些坑 | [`OVERVIEW.md`](./OVERVIEW.md) |
| 某个坑的细节（按模块 grep，别整份读） | [`TIPS.md`](./TIPS.md) |
| 设计决策与理由（含"判定不做"） | [`DONE.md`](./DONE.md) 头部的「设计决策与判定不做」节 → [`notes/modules.md`](./notes/modules.md) |
| 工作站契约 / 调试接口 / 打包发布 | `notes/` 下的对应文件（索引在 `DONE.md` 那一节里） |
| 某一批做了什么、怎么验的 | [`DONE.md`](./DONE.md)（最近的在上）；更早的在 `DONE.archive.md` |
| 机制（队列 / 钩子 / 门禁 / 收尾） | [`README.md`](./README.md) |

---

## 1. 当前状态

- 时间：2026-10-24 · 提交总数 1759（每个功能点一条，可逐条回滚；`npm run audit:tasks` 会核对这一句）
- 技术栈：TypeScript（严格模式）+ Vite + Three.js / WebGL2；无第三方运行时依赖（除 `three`）
- 进度口径：`TASKS.md` 共 295 项 —— 已完成 **287**、进行中 **5**、待办 0 条（另有 3 条主动放弃：D22 预设、L5 局域网发现、O5 原版对照截图）（其中 55 条是需求审计新补的**整组**缺口，逐组明细见 `.continue/notes/modules.md` 的「需求审计」一节）；
  （`npm run audit:tasks` 会核对这一行与本表，改完条目记得跑一次）
  其中相当一部分待办是长期大项（村民与交易、织布机等功能方块、信标与地图、喷溅/滞留药水等）
  —— **进行中口径以 `.continue/doing/<session_id>.md` 队列为准**，队列与总表分工不同，别只看总表
- **任务机制：continue-do**。队列 / 标记 / 批次号 / 收尾五步的规则**只在 `.continue/README.md`**，
  本文件不复述（2026-10-22 这里抄的口径已经过期：实际批次号是时间戳，见 README §2）。
- ⚠️ **历史批次号撞过四次**（272~283 / 295-x / 303 / 499~500）。引用旧提交一律按 **hash**，
  不要按批次号找——新号是 `YYYYMMDD-HHmm`，与旧号不可比。
- 最近一批不在这里手写：看 `DONE.md` 最上面的 `## 批次` 标题。
- **低龄向三块已落地**（批次 20261022-1954）：新手引导卡在右上角（面板打开时让位）、
  建造工具条只在"建造模式"接管左键、单机小游戏从主菜单第三颗按钮进（推箱子 / 打砖块各 10 关）。
  下一步候选见 [`notes/kids-features.md`](./notes/kids-features.md) 第二期（跑酷地图、迷宫寻宝、组件中心静态清单）。

---

## 2. 新机器 30 秒上手

```bash
git clone <远程地址> && cd <仓库目录>
npm install
npm run agent:setup    # 恢复 AI 记忆到本机 + 自检 hooks / 环境 / 进度（有问题会直接列出来）
npm run dev            # http://localhost:5173
```

> `agent:setup` 走的是 `tools/agent-setup.mjs`。本脚本此前在 `package.json` 里**没有对应的
> script 键**（文档写着 `npm run agent:setup`、实际会报 "Missing script"），已补回；
> 首次在新机器上接手时如又报缺失，先确认这一行还在。

然后对 AI 说一句：**「读 AGENTS.md 与 .continue/HANDOFF.md，按队列继续推进。」**
之后 Stop 钩子会自动按队列继续，不需要逐步确认（机制见 `README.md` §5 / §6）。

⚠️ **钩子配置在会话启动时拍快照**：改了 `.codebuddy/settings.json` 要重启会话才生效；
`.continue/logs/` 一直是空的，就是"钩子根本没跑"。

验收门槛：`npm run check` 全过（= `typecheck` + `npm test` + 三张台账 + 文档门禁），`npm run build` 能出包；
失败时先跑 `npm run audit:tasks`（直接指出三处锚点哪处漂了：本文件 / TASKS 顶部 / README 路线图）。

> **改代码时的内循环别用 `check`**（那是提交前的全量），用这两条：
> `npm run check:fast`（typecheck + 单测 + **只跑被改动命中的那几套离线测试**）、
> `npm run build:fast`（关掉 sourcemap 的构建，只验"能不能出包"，产物内容与正式构建一致）。

---

## 3. 命令

```bash
npm run dev                # 开发服务器
npm run check              # 【提交前】typecheck + 单测 + 177 套离线测试 + 三张台账 + 文档门禁（check:browser 默认跳过；BROWSER_CHECK=1 才真跑浏览器）
npm run check:fast         # 【改代码时】typecheck + 单测 + 只跑被改动命中的套件（秒级）
npm run shot               # 截图到 .tmp/shots/（没浏览器就跳过）；npm run guard = 控制台零错误门禁
npm run build              # 类型检查 + 生产构建（带 sourcemap，发布用）
npm run build:fast         # 只验"能不能出包"（SOURCEMAP=0，产物 hash 与正式构建一致）
npm test                   # typecheck:tools + vitest + 177 套离线测试 + 钩子自检
npm run test:offline:changed  # 只跑与本次 git 改动相关的离线套件
npm run audit:tasks        # 任务清单自检（编号重复/跳号 + 本文件进度口径是否过期）
npm run gen:stats          # 地形生成统计（耗时/洞穴占比/矿石产量）
npm run agent:setup        # 跨机器自检
```

`npm run check` 是一条链：`typecheck` + `test`（vitest + **177 套**自建离线测试 + `test:hooks`）
+ 三张台账（`audit:tasks` / `audit:coverage` / `audit:diffs`）+ `audit:docs`；
`test` 的聚合入口是 `tools/run-tests.mjs`（一次 esbuild 打包 + 多进程并行，32s → 9s）。
单套调试仍可直接跑 `npm run test:reach` 这类老命令。

> `test:hooks` 现在**委派给框架自带的自检**（`node .continue/hooks/check.mjs hooks`）：
> 那份自测跟着框架升级，不会再有"框架改了、本仓库的断言还停在旧契约"这种事（批次 1355 踩过）。

浏览器控制台 `window.__mc`（`src/main.ts` 末尾挂的 App 实例）的完整接口清单 →
[`notes/ops.md`](./notes/ops.md)；`tools/pixel-probe.mjs` 能把"看起来偏暗"
变成可对比的像素亮度数字。

---

## 4. 本项目约定（流程 / 数据链路 / 界面 / 门禁）

**一条 = 一个可独立验证的改动**（能单独 commit）。写清「改哪个文件 / 验收标准」，**不要写"接着上面那个
继续"**——上下文压缩后前面的细节会丢。长跑前先 `git commit` 一次，留个干净起点。

**做完一条的流程**（顺序有意义）：

1. 读队列第一条（长期缺口看 `TASKS.md` 的 `[~]`，别从头扫）；
2. 定范围：拆成"能一批收掉"的（数据 / 规则 / 一处 UI / 一套断言），拆不动的留回队列并写明为什么；
3. **纯逻辑先行**：`core/...` 里写不引 DOM / 不引世界的模块，每个"如果"都能单独断言；
4. **数据链路四处一起补**：`restoreStack` / `stackExtras` / `sameExtras` / `Transfer.cloneExtras`；
5. 接界面：面板挂 `<body>`、层叠层 12、Esc 自己收、关闭回调交还输入权；**手机横屏是主场景**；
6. 自测 → commit → 勾 `[x]`：`npm run check:fast` 通过、把实测数据写进中文 commit message；
7. 只做一条就停，下一条由钩子下一轮递过来。

**大任务在队列里插里程碑节点**（**不另建计划文件**；门槛：预计 > 16 条、或明显能切成几段）：
在**同一份队列**里每 8~12 条之后写一个节点：

```markdown
## 里程碑 MS1 · <名字>
- 验收：`<这一段做完要跑的命令>`
```

它前面的条目全部完成、而它还没有 `- 确认：已验收` 时，钩子**硬停**：先跑验收、把结果贴出来、
再弹窗问用户「继续下一段 / 调整队列 / 先收在这里」。只有拿到"继续"才补确认行、收尾本段、
换批次号、删掉已完成的条目，然后接着做；最后一个里程碑验收完之后才走正常五步收尾（含归档）。
**替用户写确认行 = 自己给自己验收**。格式与门禁见 `notes/milestones.md`。

**"一批多长"看行数不看条数**：判据是"完成说明预计 > ~80 行"/"队列 > 500 行"/"目标变了"，
条数只是经验值（通常 8~12 条）。硬塞进一批的代价是 `DONE.md` 一节滚过 300 行后自动归档搬不动。

**需要拍板的地方按我的判断做，但一律留底**：用户已授权"以你的意见为准"，所以不再弹窗问选项；
每一处都写进 `doing/<本会话ID>-decision.md`——`## D<n> · <决策点>` 下三行 `- 决定：` / `- 为什么：` / `- 影响：`。
「为什么」写依据与不确定的地方（人要能复核），「影响」写改了哪些行为、能不能撤回。
收尾时跟着队列一起归档到 `logs/<会话ID>/decision.md`（累积式）。细则见 `notes/session-decisions.md`。

**并行工作树**（已有队列在跑、新任务不想串行等）：`npm run continue:worktree -- <名字>` 在仓库旁建
`<仓库>-wt-<名字>`、开分支 `continue/<名字>` 并推远程。**建完必须在新路径里另开一个会话**——
钩子注册的是相对路径，cwd 决定它读写哪棵树，在原会话里跑等于没隔离。
收工后**合并时机由用户定**（`git merge --no-ff continue/<名字>`），框架不自动合并。冲突处置：
`DONE.md` / `notes/batches.md` 这类**追加型**两边都留（各一批一节，按批次号排）；
`TASKS.md` 的状态位按语义手工合（两边可能都勾了同一条）；`doing/*.md` 各是各的会话文件、不会冲突。

**AI 自插任务**：`- [ ] [发现] …`，三条硬条件（真实撞见 + 写证据 / 只插不删改 / 插完明说），
同时最多 5 条——满了钩子会要求先让用户过一遍。额度是防"为了有活干而发明任务"。

**明确不做的事**：状态记在 `TASKS.md`（`[-]` 标记，`audit:tasks` 会统计），
**判定理由**记在 `DONE.md` 头部的「判定不做」那节——免得下次又提一遍却想不起为什么。

**门禁三道**：

| 位置 | 跑什么 | 谁维护 |
| --- | --- | --- |
| `npm run check`（人 + CI） | typecheck + 177 套离线测试 + 三张台账 + `audit:docs` | 本仓库 |
| `.continue/config.json` 的 `checks.fast`（每次 `git commit`） | `node .continue/hooks/check.mjs --fast`（编号 / 文档体量 / 配置 / 项目 `check:fast`） | 框架 |
| `.continue/hooks/lib.mjs` 的 `DOC_LIMITS` | 入口文档体量上限。**本项目把 `TASKS` 从 600 放宽到 7000**（那份台账是三个脚本的输入），重装框架会覆盖，`npm run audit:docs` 会当场报出来 | 框架 + 本项目守卫 |

**跨区块地物 / 结构必须"只依赖世界坐标"**（J1/J2/J3 的硬性约定）：一棵树的树冠会伸进邻居区块，
村庄会横跨好几个区块。做法是"生成区块 C 时重放 3×3 邻域里各地物的实例，只写入落在 C 的部分"，
于是每个地物只属于一个区块。这条机制成立的前提是**地物的每个决策都是世界坐标的纯函数**——
一旦某处读了本区块的方块数据来做判断，拥有者与邻居就会得出两种结论，接缝上的树冠只会剩半边。为此：

- `OverworldGenerator.surfaceY(x,z)` 提供"世界坐标 → 地表高度"（4 个粗网格节点求零点再双线性插值）；
- 树干用**强制写入** + 只在拥有者区块里向下补齐（估算高度差 1~3 格时不会悬空）；
- 单列地物（草花蘑菇……）不参与邻域重放，直接用本区块真实地面校准落点；
- 下界的地板高度是解析式，天然满足这条约定。

**该停下来问人的五种情况**（命中就弹窗，给 2~4 个具体选项、推荐项放第一位）：

1. **不可逆的破坏**：删数据 / 改存档格式 / 改公开接口 / 强制推送；
2. **会波及其他队列**：要动的文件是另一条的地盘，或改动会让已通过的断言变红；
3. **多种合理做法且取向不同**：性能 vs 一致性、对齐原版 vs 修复体验；
4. **需求本身有歧义**：条目能理解成两个意思，做错了要返工；
5. **超出这条的范围**：做完发现必须顺手改一大片不在本次范围内的东西。

---

## 5. 跨机器同步的边界

| 随仓库走（git 跟踪） | 只在本机（已 gitignore） |
| --- | --- |
| `.continue/`（`doing/` / `DONE` / `OVERVIEW` / `TIPS` + `notes/` / `HANDOFF` / `TASKS` / `hooks` / `README`）、`AGENTS.md`、`README.md`、`docs/`、`src/`、`tools/` | `node_modules/`、`dist/`、`.tmp/`（构建与测试产物，含 `*.tsbuildinfo`） |
| `.codebuddy/settings.json`（钩子注册）、`.codebuddy/memory/`（AI 记忆的版本化副本）、`.codebuddy/skills/continue-task/`（**框架补丁的源**，重装用它） | `.continue/logs/`（日志 + 计数状态，每轮都变）、`.continue/auto.off`（刹车）、`.codebuddy/skills/` 的**其它**技能（本地）、截图 `shot-*.png` |

**唯一的外部依赖：git 远程仓库**（没有远程 = 代码只在本机）。查看 `git remote -v`，
没有就 `git remote add origin <地址>` 再 `git push -u origin main`。

---

## 6. 恢复一段会话

1. 新机器按第 2 节跑完，确认 `npm run agent:setup` 结论是「一切就绪」；
2. 打开 AI 会话，第一句给足上下文：
   「读 AGENTS.md 与 .continue/HANDOFF.md（含 .codebuddy/memory/MEMORY.md），然后继续推进队列」；
3. AI 会自动：读队列 → 改 `[ ]` 为 `[~]` → 实现 → 自测（`check:fast` 内循环、`check` 提交前）→
   每步单独提交推送 → 更新队列；
4. 中途想接管：`touch .continue/auto.off`；想让它继续：删掉该文件。

---

## 7. 待复核的悬案（下次接手优先看）

~~非完整方块展示平台整体偏暗~~ → **批次 565 补了"光照首次收敛后全量重刷"**；
**批次 616 真机查出更严重的"方块表面纯黑"并修掉**（两次根因见 `TASKS.md` E23：
越界光照返回 0 + 补刷只做一次）。现在改成"新区块加载后置脏标记、光照排空时补刷"。
真机若仍偏暗，才查顶点光照/材质本身。

**进行中条目的"哪些能自己做、各自卡在哪"** → `TASKS.md` 里 `[~]` 的条目
（原 `PENDING.md` 已并入，不再单独维护）。⚠️ **钩子不按上下文停**，只在命中第 4 节那五条时弹窗。

**`TIPS.md` 的「历史经验总表」还没按模块拆**（379 行两列表，2026-10-22 从 `EXPERIENCE.md` 并入时
保留了原样）。要拆的话：先按 `OVERVIEW.md` 的 15 个模块逐个归位、再删总表；别边拆边加新条目。
