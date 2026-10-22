# 队列 · 会话 eb9037a4afda43cfb1b08ffd96ae6de9

> 状态：执行中
> 创建：2026-10-22
> 批次：20261022-2220

> 用户报的三个问题 → 两条线：**引导卡点不动**（层叠被触摸视角面吃掉）、**门开不了**
> （红石无状态重算把手动状态覆盖 + 开着的门被渲染成空几何），外加**引导难度**（铁矿石
> 在地下 y≈16，原本文案没说）。
>
> 口径：改法尽量小，不新增系统、不改玩法语义。门那两处是**修 bug**，不是新机制；
> 引导文案只补"在哪找"，不改步骤表（8 步的目标与顺序仍是 `notes/kids-features.md` 拍板的那份）。

- [x] [引导4] 引导卡与按钮点不动：`index.html` 给 `.tutorial-root` 抬层（`position: relative` + `z-index: 1`，与 `#hotbar` 同一处方）→ `npm run test:tutorial` 新增静态断言通过
  - 做了什么：`.tutorial-root` 从 `pointer-events: auto` 扩成 `pointer-events: auto; position: relative; z-index: 1`，并就地写明原因
  - 为什么：触摸端 `#touch-ui > #touch-look` 铺满全屏、`pointer-events: auto`，而它在 DOM 里排在 `#hud-right` 之后；两者都没 z-index 时后出现的在上层，手指点卡片命中的是视角面（表现：卡片看得见但收起键/「不再提示」点不动，反而把身后方块挖了）。快捷栏批次 95 踩过同一个坑，处方就是 `z-index: 1`
  - 验证：`npm run test:tutorial` 108 → **110 条**全过（新增"引导卡抬了层"静态断言，读 `index.html`）；`npm run check` 全绿
  - 批次：20261022-2220
- [x] [引导5] 引导太难做：铁镐一步的说明补"铁矿石在地下 y≈16 最多、往下挖约 50 格"（中英各一条）→ `npm run test:tutorial` 断言文案里有该提示
  - 做了什么：`I18n.ts` 改 `tutorial.survival.ironPickaxe.desc` 两条（中/英），补"在哪找"的具体位置；步骤表、目标判定、卡片几何一律没动
  - 为什么：用户原话是"引导不要那么难实现"——核对下来难点不在代码而在**目标不可执行**：铁矿石分布在 y -24~56、众数 y=16（`OreGenerator`），地表约 63~70，等于要往下挖 45~50 格，而原文案只说"粗铁放进熔炉"。只补最实用的一句，不改 8 步的设计（那是 `notes/kids-features.md` 拍板的），也不加新目标
  - 验证：`npm run test:tutorial` 新增"铁镐一步说了铁矿石在哪找（y≈16）"断言通过（110 条全过）
  - 批次：20261022-2220
- [x] [门1] 开着的门变透明：`meshBoxes('door')` 改为始终返回 `doorBox(state)`（开着的门只是**没有碰撞**，不是不画）→ `tests/collision.test.ts` 补一条渲染断言
  - 做了什么：`meshBoxes('door')` 去掉 `isDoorOpen(state) ? [] : ...`，改为始终 `[doorBox(state)]`；`doorBox` 内部本来就按开关把门板转到门轴那一侧，开着的几何一直是死代码
  - 为什么：渲染盒抄了碰撞盒那条判据（注释还写着"没有碰撞体积"），于是门一开整扇消失——正好对上用户"上半部分透明了"。碰撞侧的空数组仍留在 `collisionBoxes`，两者差异由断言钉住
  - 验证：`tests/collision.test.ts` 13 条全过（新增"开着的门仍要画、且薄边从 Z 转到 X"与"碰撞仍为空"两条）；`npm run check` 全绿
  - 批次：20261022-2220
- [x] [门2] 手动开门被红石立刻关回：`RedstoneEngine.applyOpenableLoad` 改成**电平沿触发**（门/活板门/栅栏门三类都覆盖），换维度时清缓存 → `npm run test:redstone` 新增 3 条断言
  - 做了什么：加 `openablePower: Map<string, boolean>`（每个可开合方块的"上次电平"）；`applyOpenableLoad` 只在电平变化时动门，第一次见到"没电却开着"的门放过（避免把玩家手动开的门关回去）；方块不再是可开合类型时删条目；`setDimension` 调 `clearOpenablePower()`
  - 为什么：引擎是"洪泛 + 整体重算"，每次方块变化都按**当前电平**重写负载，而手动开合不改电平；`toggleDoor` 先写下半再写上半、两次写入各触发一次重算，于是下半被关回、上半留下来 —— 这就是"半扇门 + 再也恢复不了"。原版语义是**电平变化才驱动一次**，改完之后手动状态不会被无关重算覆盖
  - 验证：`npm run test:redstone` 174 → **179 条**全过（新增 5 条：手动开的门/活板门/栅栏门不被重算关回、旁边方块变化不影响、上下半仍同步）；`npm run check` 全绿
  - 批次：20261022-2220
- [x] [自测] 全量门禁：`npm run test:tutorial` / `test:redstone` / `npm run check` 全绿 → 分两次提交（引导、门）并 push
  - 做了什么：`327b7c61`（引导：抬层 + 文案 + 2 条断言）、`10eddcbd`（门：渲染盒 + 电平沿 + 6 条断言），推送到 `origin/main`
  - 为什么：两处独立可回滚，按"每个独立改动单独提交"拆开
  - 验证：`npm run test:tutorial` 110 条、`test:redstone` 179 条、`npx vitest run tests/collision.test.ts` 13 条、`npm run check`（typecheck + 全部离线套件 + 三张台账）、`npm run build:fast` 896ms 出包，全部通过；两次提交的 `checks.fast` 均通过
  - 说明：**未做浏览器/真机自测**（按既有约定不主动跑端到端）：点击是否真的落到卡片上、开门手感仍需真机确认
  - 批次：20261022-2220
