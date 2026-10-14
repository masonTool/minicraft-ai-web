---
name: 自动 Git 提交与版本记录
description: 每次代码改动后自动 review + 提交 + push，且每个独立改动单独提交一次以保留版本记录
type: feedback
---

每完成一次代码修改，自动执行：review 变更 → 生成中文 commit message → `git add` → `git commit` → `git push`，无需用户确认。

并且**每个独立改动单独提交一次**，不要攒成一个大提交，以保留清晰可回溯的版本记录。

**Why:** 用户明确要求（多次强调）自动化提交流程，并额外要求保留版本记录，便于回溯和回滚历史改动。

**How to apply:** 在本项目（Minecraft 复刻）中，任何文件变更（无论大小）落地后立即提交；提交粒度按"一个功能点/一个修复"划分，message 用中文简述改动内容。若仓库尚未初始化，先 `git init` 并建立初始提交。
