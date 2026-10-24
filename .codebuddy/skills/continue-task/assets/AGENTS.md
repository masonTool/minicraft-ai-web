# AGENTS.md

本项目的任务与进度记录在 `.continue/`。

- **动手之前先读 [`.continue/README.md`](./.continue/README.md)** —— 机制、编号、格式约定、踩过的坑都在里面
- **主工作区只规划**：`doing/` 里已有别的会话队列时，队列写进 `.continue/doing/.worktree/todo/queue.md`（头部加一行 `> 树名：<英文单词>`）+ `context.md`，停手后 Stop 建树 `worktree_<单词>_<日期>`（分支同名）并开窗（README §9）；`doing/` 空着就直接在本会话干
- **工作树里做完就结束**：不自动合并、不 rebase、不删树，后续由用户处理
- 本会话队列：`.continue/doing/<session_id>.md`（钩子会告诉你会话 ID；工作树里才建）
- 长期需求：`.continue/TASKS.md`（每条带 `T` 编号）　历史归档：`.continue/DONE.md`
- 动某个模块前先看 `.continue/OVERVIEW.md` 里那一节：已实现什么、有哪些坑
- 坑的提示：`.continue/TIPS.md`（按模块 grep，别整份读）
