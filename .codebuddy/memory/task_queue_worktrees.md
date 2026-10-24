---
name: 任务记账只有一套（.continue）
description: 队列/进度/踩坑只写 .continue/，机制细节看 .continue/README.md；不要再造第二套记账文件或别名入口
type: feedback
---

任务、进度、踩坑**只有一处**：`.continue/`（continue-do 框架），机制与命令一律以 `.continue/README.md` 为准
（本文件不复述规则，抄一遍就会漂）。

**Why:** 历史上并存过 `.codebuddy/auto-continue.md`、`npm run q` 系列、`queues/`、`EXPERIENCE.md` 等多套入口，
状态互相打架，最后全部删掉只留 `.continue/`。
**How to apply:** 需要新建队列、换批次、开工作树、归档，都跑 README 里那条命令，别自己造文件、别复活旧入口；
写进度只写 `.continue/`，不要另开 TODO / NOTES / STATUS 之类并行账本。
