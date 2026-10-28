# AGENTS.md · AI 会话入口

> 「Minecraft 基岩版 1.18 复刻（Web / WebGL2）」。
> 任务与进度记录在 `.continue/`（continue-do 框架：队列 → 钩子逐条递 → 收尾归档）。
> **先读这一张表，再决定要不要展开**——这个仓库的文档以前有 8000+ 行"每次会话都全读"，
> 那是最贵的一笔开销，**请顺着索引按需读，不要一把梭**。

## 1. 先读这两份

| 文件 | 读它是为了 | 怎么读 |
| --- | --- | --- |
| [`.continue/README.md`](./.continue/README.md) | **机制**：文件分工、编号、队列与四种标记、钩子行为、收尾五步、门禁 | 第一次接手整份读一遍；之后按节查（§3 队列 / §6 钩子 / §7 坑） |
| [`.continue/HANDOFF.md`](./.continue/HANDOFF.md) | **本项目的当前状态 + 约定**：进度快照、命令、数据链路四处、界面约定、该问人的五种情况 | 整份读完（约 180 行） |

本会话队列：`.continue/doing/<session_id>.md`（`UserPromptSubmit` 钩子会把会话 ID、队列路径、批次号注入回来）。

> 2026-10-22 升级到 continue-do 新版：队列目录从 `queues/` 改成 `doing/`，踩坑文档
> `EXPERIENCE.md` 改成 `TIPS.md`，模块总览新增 `OVERVIEW.md`。旧文件都已删除或迁移，
> **不要再新建同名文件**（`HANDOFF.md` / `TASKS.md` / `NOTES.md` / `OVERVIEW.md` / `TIPS.md` /
> `DONE.md` / `README.md` 各管一件事，见 `README.md` §1）。

## 2. 按需展开（**只在需要时读**）

| 什么时候读 | 读哪一份 |
| --- | --- |
| 这个模块现在有什么、有哪些坑（**动它之前先看这一节**） | [`.continue/OVERVIEW.md`](./.continue/OVERVIEW.md) |
| 动手前想避开已经踩过的坑（渲染/光照/地形/界面/生物 AI） | [`.continue/TIPS.md`](./.continue/TIPS.md)（**按关键词 grep，别整份读**） |
| **一批做完了要收尾** | `node tools/ledger.mjs --batch <批次号> --note "一句话背景"`：DONE 插入 + 超限归档 + HANDOFF 数字（`audit-tasks --fix`）+ 队列归档，**一条命令**。仍然手写的只有 `batches.md` 一行摘要和 `TASKS.md` 的任务条目（脚本会打印该用哪个编号） |
| 想知道某个模块当时怎么做的、为什么这么做 | [`.continue/notes/modules.md`](./.continue/notes/modules.md)（模块台账）+ [`.continue/notes/decisions.md`](./.continue/notes/decisions.md)（设计决策与判定不做） |
| 想查某一批当时做了什么、怎么验的 | [`.continue/DONE.md`](./.continue/DONE.md)（最近的在上）；更早的在 `DONE.archive.md` |
| **要改任意"操作型工作站"（熔炉/酿造台/营火/锻造台…）** | [`.continue/notes/stations.md`](./.continue/notes/stations.md)（通用契约 + 站台矩阵 + 接入 checklist） |
| 想知道"这一项和原版哪里不一样" | [`.continue/TASKS.md`](./.continue/TASKS.md) 文末的差异台账（脚本生成） |
| 长期待办 / 覆盖率 | [`.continue/TASKS.md`](./.continue/TASKS.md)（按 `[~]` 或 `TASKS.md` 的段字母 grep，**不要通读**；需求号是 `A1`~`O16`，不是 `T<n>`） |
| 这个大任务拆成了哪几批、走到哪个里程碑了（**开新批次前 / "为什么不往下走了"**） | [`.continue/notes/milestones.md`](./.continue/notes/milestones.md)（机制）+ 当前队列里的 `## 里程碑 MSn` 节点。平时不读 |

## 2.5 一仓多产物（2026-10-29 重排）

`web/`（游戏源码与构建，产物 `web/dist`）· `android/`（Capacitor 壳 + 签名闸门）·
`ios/`（对等壳，Swift 源码已就位、Xcode 工程待补）· `server/`（node / rust / ios 原生库）·
`windows/` `mac/`（预留）。**改游戏代码只动 `web/src`**；目录与保护方案的落地状态见
[`docs/CODE-PROTECTION-STATUS.md`](./docs/CODE-PROTECTION-STATUS.md)。

## 3. 命令：内循环用快的，提交前用全的

```bash
npm run dev            # 开发服务器 http://localhost:5173

# —— 改代码时的内循环（秒级）——
npm run check:fast     # typecheck + 单测 + 只跑被本次改动命中的离线套件（实测 ~4s）
npm run build:fast     # 只验"能不能出包"（关 sourcemap，产物内容与正式构建一致）

# —— 提交前（全量，约 40s，大头是 182 套离线测试 26s）——
npm run check          # typecheck + 182 套离线测试 + 三张台账，任一失败即非零退出
                       # （CI 也跑同一道：.github/workflows/check.yml）
```

单套调试仍可直接跑老命令（`npm run test:reach`、`npm run test:perf` …）；
离线测试的聚合入口是 `npm run test:offline`（`tools/run-tests.mjs`）。
`git commit` 还会跑框架的 `checks.fast`（`.continue/config.json`）：编号 / 文档体量 / 配置 / `check:fast`
（钩子自检按 hooks 内容哈希缓存，重复提交时是毫秒级）。

## 4. 硬性约定（细节见 `.continue/HANDOFF.md` §4 与 `README.md` §3）

1. **每个独立改动单独提交**：review → 中文 commit message → commit → push，全程不等确认。
2. **不停下来等确认**：按 `.continue/doing/<session_id>.md` 队列自己推进；遇到困难自己解决并把结论记下来。
   要急停就 `touch .continue/auto.off`（连提交守卫一起停，删掉即恢复）。
3. **锚点文档里的数字一律由脚本生成**（进度口径 / 覆盖率 / 差异 / 提交总数）——
   手抄过的都漂过，`npm run audit:tasks` 会当场抓住。
4. **测试是门禁，不要为了跑得快去削它**：`tools/run-tests.mjs` 只是把"进程开销"
   挤掉（32s → 9s），套件数与断言一条没少。
5. **机制细节只看 `.continue/README.md`**：批次号、队列标记、收尾五步都不在这里复述
   （这里抄过的旧版口径已经过期，抄一遍就会漂）。队列头部有钩子注入的 `> 批次：`，照抄即可。
