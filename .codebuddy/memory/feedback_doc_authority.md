---
name: 文档冲突时以谁为准
description: 代码 > TASKS.md > HANDOFF/AGENTS；派生数字只由脚本生成、不手抄；摘要类文件无权威性，合并信息后删掉
type: feedback
---

文档说法冲突时按 **代码 > `.continue/TASKS.md`（状态唯一事实源）> `.continue/HANDOFF.md` / `AGENTS.md`** 取舍；
取舍时**别把另一边的信息丢掉**，把独有内容并进权威文件，再删掉冗余文件（用户原话："能够合并到一起最好"）。

- 派生数字（进度/套数/配方数/提交数/覆盖率/差异）**只由脚本生成**，手抄必漂；
  `npm run check` 里的 `audit:tasks` / `audit:coverage` / `audit:diffs` / `audit:docs` 会当场抓。
- 摘要类文件（`PENDING.md`、临时清单）**没有权威性**：只允许贡献正文里没有的信息，并完就删，不是两边都更新。
- "队列清空"不等于"做完了"，也不等于"没东西可做"：用 hash 或 TASKS 逐条核，**别拿批次号猜**（批次号撞过四次）。

**Why:** 同一事实写两处必然有一处漂——真实抓到 `PENDING.md` 手抄 `281/9/3` + 提交号 `8ba4261b` 全部过期，而它全仓零引用。
**How to apply:** 写文档时引用而非复制数字与事实；合并完先跑门禁（`npm run check` / `check:fast`），不要先信自己写的话。
