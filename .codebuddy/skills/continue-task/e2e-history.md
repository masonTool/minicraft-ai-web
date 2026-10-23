# e2e 历史（入库）

> 用途：给"跑之前估算"提供依据。token 取自 CLI 的 json 输出（本轮累计 input + output）。
> 只记**真跑了模型**的场景；probe 场景不消耗 token，不记。
> 这张表由 `scripts/e2e.mjs` 自动追加，不要手改结构。

| 时间 | 场景 | 模型 | 耗时 | tokens | 结果 |
| --- | --- | --- | --- | --- | --- |
| 2026-10-23 11:46 | main | deepseek-v4.1-flash-official | 129s | 0 | fail |
| 2026-10-23 11:48 | main | deepseek-v4.1-flash-official | 263s | 3,258,313 | pass |
| 2026-10-23 14:33 | journey | deepseek-v4.1-flash-official | 249s | 0 | pass |
| 2026-10-23 15:50 | main | deepseek-v4.1-flash-official | 127s | 未知 | fail |
| 2026-10-23 15:50 | decision | deepseek-v4.1-flash-official | 184s | 2,262,787 | fail |
| 2026-10-23 15:50 | plan-split | deepseek-v4.1-flash-official | 264s | 2,495,932 | pass |
| 2026-10-23 15:50 | journey | deepseek-v4.1-flash-official | 139s | 2,005,054 | fail |
| 2026-10-23 15:52 | main | deepseek-v4.1-flash-official | 186s | 未知 | pass |
| 2026-10-23 15:52 | decision | deepseek-v4.1-flash-official | 209s | 2,834,165 | fail |
| 2026-10-23 15:52 | plan-split | deepseek-v4.1-flash-official | 257s | 1,504,413 | pass |
| 2026-10-23 15:52 | journey | deepseek-v4.1-flash-official | 153s | 1,925,705 | pass |
| 2026-10-23 16:11 | decision | deepseek-v4.1-flash-official | 88s | 1,147,135 | pass |
