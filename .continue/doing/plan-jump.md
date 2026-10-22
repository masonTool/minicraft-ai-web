# 计划 · 跳一跳（替换推箱子 / 打砖块）

> 状态：执行中
> 创建：2026-10-23
> 设计细则（DoD / 原版差异 / 参数表 / 架构 / 风险）：`.continue/notes/jump-game.md`
> 机制说明：`notes/plan.md`（阶段 = 一批；队列头 `> 计划：` 绑定；完成到里程碑硬停等验收）

## MS1 · 单游戏骨架：能进、能退、画面铺满

- 验收：`npm run check:fast` + `grep -riE "sokoban|breakout" src tools index.html` 无输出 + 构图截图比例达标（≥55% / ≥20%）
- [~] `MS1.1` 去旧与契约：删两个旧游戏；目录/进度/菜单改单游戏（最高分 v2）；跳一跳纯逻辑（config + logic）与离线断言 → 验收 `npm run test:minigame`
- [ ] `MS1.2` 画面骨架：柱子渲染（顶/侧/底三套 UV）/ 相机 / 横屏构图 / 人物接入 + 构图比例断言 → 验收 `npm run jump:shot`

## MS2 · 能玩一局：蓄力起跳、落点计分、掉落结算

- 验收：`npm run jump:e2e` + `npm run check` 全量
- [ ] `MS2.1` 蓄力/起跳/落点/计分/人物与方块动画 → 验收 `npm run test:minigame`
- [ ] `MS2.2` 相机跟随 + 下一方块生成 + 结算面板 / 再来一局 / 最高分落盘 + 首个 E2E → 验收 `npm run jump:e2e`

## MS3 · 好玩且稳定：特殊方块、难度、音效、手感

- 验收：`npm run check` + `npm run build:fast` + `npm run minigame:perf` + 用户真机确认
- [ ] `MS3.1` 特殊方块（音乐盒 +30 / 魔方 +10）+ 难度平衡脚本 + 音效（WebAudio 合成）→ 验收 `npm run jump:balance`
- [ ] `MS3.2` 力度条 / HUD 打磨 + 真机手感微调 + 回归与文档 → 验收 门禁全绿
