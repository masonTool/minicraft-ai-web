# AGENTS.md · AI 会话入口

> 「Minecraft 基岩版 1.18 复刻（Web / WebGL2）」。
> **先读这一份（1 分钟），再按下面的表决定要不要展开**——
> 这个仓库的文档以前有 8000+ 行"每次会话都全读"，那是最贵的一笔开销，
> 批次 101 拆过一轮，**请顺着索引按需读，不要一把梭**。

## 1. 先读这两份（加起来约 450 行）

| 文件 | 读它是为了 | 怎么读 |
| --- | --- | --- |
| [`HANDOFF.md`](./HANDOFF.md) | 当前状态、硬性约定、常用命令、悬案 | **整份读完**（约 340 行；只留最近 6 批，更早的在归档里） |
| [`.continue/HANDOFF.md`](./.continue/HANDOFF.md) | **队列机制**（怎么排、钩子怎么认、收尾怎么算） | **整份读完**（约 230 行）；本会话队列是 `.continue/queues/<session_id>.md` |

> 这两份原本分别是 1409 行与 4108 行，**批次 101 做过上下文瘦身**：
> 已经做完的流水搬到了 `.continue/DONE.md` 与 `.continue/notes/`，内容一字未改，
> 只是不再"每轮都读一遍"。
> **2026-10-22 迁移 continue-do**：单队列 `auto-continue.md` 换成会话级队列
> （`.continue/queues/`）；旧队列与批次流水（485 段 + `docs/HANDOFF-ARCHIVE.md` 的流水）
> 全部并进 `.continue/DONE.md`，模块台账进 `.continue/notes/modules.md`，
> 避坑表进 `.continue/EXPERIENCE.md`——旧目录与旧文件都已下线，不要再新建同名文件。
> **批次 198 又收了一次**：HANDOFF §1 只留最近 6 批（167~191 搬去归档），
> 并把"离线测试套数"的核对从 README/HANDOFF 两处扩到 **README / HANDOFF / 本文件** 三处。

## 2. 按需展开（**只在需要时读**）

| 什么时候读 | 读哪一份 |
| --- | --- |
| 想知道某个模块当时怎么做的、为什么这么做 | [`.continue/notes/modules.md`](./.continue/notes/modules.md)（模块台账）+ [`.continue/NOTES.md`](./.continue/NOTES.md)（决策索引） |
| 想查某一批（批次 1~613）当时做了什么 | [`.continue/DONE.md`](./.continue/DONE.md) 文末「历史批次」 |
| 动手前想避开已经踩过的坑（渲染/光照/地形/界面/生物 AI） | [`.continue/EXPERIENCE.md`](./.continue/EXPERIENCE.md)（**按关键词 grep，别整份读**） |
| **要改任意“操作型工作站”（熔炉/酿造台/营火/锻造台…）** | [`docs/STATION-LOGIC.md`](./docs/STATION-LOGIC.md)（通用契约 + 站台矩阵 + 接入 checklist） |
| 想知道"这一项和原版哪里不一样" | `TASKS.md` 文末的差异台账（脚本生成） |

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

## 4. 硬性约定（细节见 `HANDOFF.md` §2）

1. **每个独立改动单独提交**：review → 中文 commit message → commit → push，全程不等确认。
2. **不停下来等确认**：按 `.continue/queues/<session_id>.md` 队列自己推进；遇到困难自己解决并把结论记下来。
   要急停就 `touch .continue/auto-continue.off`（只管自动继续，队列不动）。
3. **锚点文档里的数字一律由脚本生成**（进度口径 / 覆盖率 / 差异 / 提交总数）——
   手抄过的都漂过，`npm run audit:tasks` 会当场抓住。
4. **测试是门禁，不要为了跑得快去削它**：`tools/run-tests.mjs` 只是把"进程开销"
   挤掉（32s → 9s），套件数与断言一条没少。
5. **批次号 = 开工时的提交总数**（钩子注入到队列头部 `> 批次：`），不用自增计数器。
   收尾按 `.continue/HANDOFF.md` §1 的五步走：`DONE.md` → `TASKS.md` →（自问）`NOTES.md` /
   `EXPERIENCE.md` → 删队列；commit message 带 `批次 n`。
