# AGENTS.md · AI 会话入口

> 「Minecraft 基岩版 1.18 复刻（Web / WebGL2）」。
> **先读这一份（1 分钟），再按下面的表决定要不要展开**——
> 这个仓库的文档以前有 8000+ 行"每次会话都全读"，那是最贵的一笔开销，
> 批次 101 拆过一轮，**请顺着索引按需读，不要一把梭**。

## 1. 先读这一份（约 480 行）

| 文件 | 读它是为了 | 怎么读 |
| --- | --- | --- |
| [`.continue/HANDOFF.md`](./.continue/HANDOFF.md) | **唯一接手文档**：队列机制 + 当前状态 + 命令 + 硬性约定 | **整份读完**；本会话队列是 `.continue/queues/<session_id>.md` |

> 以前这些内容分成三处（根 `HANDOFF.md` / `.continue/HANDOFF.md` / `docs/HANDOFF-ARCHIVE.md`），
> **2026-10-22 全部并回一份**：机制与状态在本文；历史流水进 `.continue/DONE.md`；
> 模块台账进 `.continue/notes/`；避坑进 `.continue/EXPERIENCE.md`；长期待办进 `.continue/TASKS.md`。
> 旧文件（根 `HANDOFF.md`、根 `TASKS.md`、`docs/HANDOFF-ARCHIVE.md`、`docs/EXPERIENCE.md`、
> `docs/STATION-LOGIC.md`）都已删除或迁移，**不要再新建同名文件**。
> `HANDOFF.md` §1 只留最近 6 批（`npm run docs:trim` 自动归档进 `DONE.md`，上限 520 行）。

## 2. 按需展开（**只在需要时读**）

| 什么时候读 | 读哪一份 |
| --- | --- |
| 想知道某个模块当时怎么做的、为什么这么做 | [`.continue/notes/modules.md`](./.continue/notes/modules.md)（模块台账）+ [`.continue/NOTES.md`](./.continue/NOTES.md)（决策索引） |
| 想查某一批（批次 1~613）当时做了什么 | [`.continue/DONE.md`](./.continue/DONE.md) 文末「历史批次」 |
| 动手前想避开已经踩过的坑（渲染/光照/地形/界面/生物 AI） | [`.continue/EXPERIENCE.md`](./.continue/EXPERIENCE.md)（**按关键词 grep，别整份读**） |
| **要改任意“操作型工作站”（熔炉/酿造台/营火/锻造台…）** | [`.continue/notes/stations.md`](./.continue/notes/stations.md)（通用契约 + 站台矩阵 + 接入 checklist） |
| 想知道"这一项和原版哪里不一样" | [`.continue/TASKS.md`](./.continue/TASKS.md) 文末的差异台账（脚本生成） |

## 3. 命令：内循环用快的，提交前用全的

```bash
npm run dev            # 开发服务器 http://localhost:5173

# —— 改代码时的内循环（秒级）——
npm run check:fast     # typecheck + 单测 + 只跑被本次改动命中的离线套件
npm run build:fast     # 只验"能不能出包"（关 sourcemap，产物内容与正式构建一致）

# —— 提交前（全量，约 10s）——
npm run check          # typecheck + 169 套离线测试 + 三张台账，任一失败即非零退出
                       # （CI 也跑同一道：.github/workflows/check.yml）
```

单套调试仍可直接跑老命令（`npm run test:reach`、`npm run test:perf` …）；
离线测试的聚合入口是 `npm run test:offline`（`tools/run-tests.mjs`）。

## 4. 硬性约定（细节见 `.continue/HANDOFF.md` §5）

1. **每个独立改动单独提交**：review → 中文 commit message → commit → push，全程不等确认。
2. **不停下来等确认**：按 `.continue/queues/<session_id>.md` 队列自己推进；遇到困难自己解决并把结论记下来。
   要急停就 `touch .continue/auto-continue.off`（只管自动继续，队列不动）。
3. **锚点文档里的数字一律由脚本生成**（进度口径 / 覆盖率 / 差异 / 提交总数）——
   手抄过的都漂过，`npm run audit:tasks` 会当场抓住。
4. **测试是门禁，不要为了跑得快去削它**：`tools/run-tests.mjs` 只是把"进程开销"
   挤掉（32s → 9s），套件数与断言一条没少。
5. **批次号 = 开工时的提交总数**（钩子注入到队列头部 `> 批次：`），不用自增计数器；
   收尾按 `.continue/HANDOFF.md` §3 的五步走，commit message 带 `批次 n`。**细节只在那份，这里不抄**
   （抄一遍就会漂：这里曾写死"当场任务补 `C. 已完成`"，而本项目的总表是 A~O 分节）。
