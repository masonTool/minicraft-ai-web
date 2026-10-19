# AGENTS.md · AI 会话入口

> 「Minecraft 基岩版 1.18 复刻（Web / WebGL2）」。
> **先读这一份（1 分钟），再按下面的表决定要不要展开**——
> 这个仓库的文档以前有 8000+ 行"每次会话都全读"，那是最贵的一笔开销，
> 批次 101 拆过一轮，**请顺着索引按需读，不要一把梭**。

## 1. 先读这两份（加起来约 450 行）

| 文件 | 读它是为了 | 怎么读 |
| --- | --- | --- |
| [`HANDOFF.md`](./HANDOFF.md) | 当前状态、硬性约定、常用命令、悬案 | **整份读完**（约 310 行；只留最近 6 批，更早的在归档里） |
| [`.codebuddy/auto-continue.md`](./.codebuddy/auto-continue.md) | **"进行中"的唯一口径**（队列）+ 最近 3 批 | **整份读完**（约 110 行；历史已归档） |

> 这两份原本分别是 1409 行与 4108 行，**批次 101 做过上下文瘦身**：
> 已经做完的流水搬到了 `docs/HANDOFF-ARCHIVE.md` 与
> `.codebuddy/auto-continue-archive.md`，内容一字未改，只是不再"每轮都读一遍"。
> **批次 198 又收了一次**：HANDOFF §1 只留最近 6 批（167~191 搬去归档），
> 并把"离线测试套数"的核对从 README/HANDOFF 两处扩到 **README / HANDOFF / 本文件** 三处。

## 2. 按需展开（**只在需要时读**）

| 什么时候读 | 读哪一份 |
| --- | --- |
| 想知道某个模块当时怎么做的、为什么这么做 | [`docs/HANDOFF-ARCHIVE.md`](./docs/HANDOFF-ARCHIVE.md) |
| 动手前想避开已经踩过的坑（渲染/光照/地形/界面/生物 AI） | [`docs/EXPERIENCE.md`](./docs/EXPERIENCE.md) |
| **要改任意“操作型工作站”（熔炉/酿造台/营火/锻造台…）** | [`docs/STATION-LOGIC.md`](./docs/STATION-LOGIC.md)（通用契约 + 站台矩阵 + 接入 checklist） |
| 想知道"这一项和原版哪里不一样" | `TASKS.md` 文末的差异台账（脚本生成） |

## 3. 命令：内循环用快的，提交前用全的

```bash
npm run dev            # 开发服务器 http://localhost:5173

# —— 改代码时的内循环（秒级）——
npm run check:fast     # typecheck + 单测 + 只跑被本次改动命中的离线套件
npm run build:fast     # 只验"能不能出包"（关 sourcemap，产物内容与正式构建一致）

# —— 提交前（全量，约 10s）——
npm run check          # typecheck + 132 套离线测试 + 三张台账，任一失败即非零退出
                       # （CI 也跑同一道：.github/workflows/check.yml）
```

单套调试仍可直接跑老命令（`npm run test:reach`、`npm run test:perf` …）；
离线测试的聚合入口是 `npm run test:offline`（`tools/run-tests.mjs`）。

## 4. 硬性约定（细节见 `HANDOFF.md` §2）

1. **每个独立改动单独提交**：review → 中文 commit message → commit → push，全程不等确认。
2. **不停下来等确认**：按队列自己推进；遇到困难自己解决并把结论记下来。
3. **锚点文档里的数字一律由脚本生成**（进度口径 / 覆盖率 / 差异 / 提交总数）——
   手抄过的都漂过，`npm run audit:tasks` 会当场抓住。
4. **测试是门禁，不要为了跑得快去削它**：`tools/run-tests.mjs` 只是把"进程开销"
   挤掉（32s → 9s），套件数与断言一条没少。
