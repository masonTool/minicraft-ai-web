# 决策记录 · 会话 9f2dcf8178d4474f8c0f3f8f4e52851c

> 批次 20261027-1235 · 暂停菜单接线（阶段 3 第一页）

## D17 · "canvas 这一层接着没有"用一个独立标志记，不用 `menu.isOpen`
- 决定：`main.ts` 加 `pause2dEngaged`，进/出 canvas 暂停菜单时置 true/false；`syncPauseMenu2d()` 用它做边沿检测，还原 DOM 也只认它。
- 为什么：激活某一项时是"先 `menu.close()`（收起 canvas 层）再 `button.click()`（让 DOM 去做真正的动作）"，此刻 `isOpen` 已经 false，但 DOM 面板与 HUD 还处于"让位"状态。用它当还原判据就会漏还原 —— 第一版真机表现是**退出暂停后 HUD 永久消失**（快捷栏、血条全没了，Esc 也再打不开）。
- 影响：多一个字段，少一类"只在某条退出路径上出现"的隐形 bug。退得回去：把两处还原逻辑挪回 `isOpen` 判据即可（但别这么做）。

## D18 · 暂停菜单的行来自 DOM 按钮，而不是一张手写动作表
- 决定：`syncPauseMenu2d()` 扫 `#settings-screen .settings-panel .pause-actions button`，用 `textContent` 当行标签、按 `offsetParent !== null` 过滤隐藏项、激活时 `button.click()`。canvas 侧不认识"继续/设置/删世界"这些语义。
- 为什么：手写动作表要和 `SettingsScreen` 保持三份同步——文案（6 语言 i18n 键）、条件显隐（多人那颗只在联机时出现）、以及**后来被删掉的按钮**（`pause.advancements` 在批次 20261024-1152 被移除，抄表的人不会知道）。用 DOM 当唯一真源，这三样全部自动继承，且删除世界那种二次确认也走原路径。
- 影响：canvas 菜单的"能力上限"= DOM 面板现有的按钮；要加一行必须在 DOM 里真加按钮（这是**优点**，避免两套 UI 各自长功能）。代价是每次打开要多扫一次 DOM（6 个元素，可忽略）。
