# 决策记录 · 会话 937507d0458d4277ba340bcb48207050

> 批次：20261025-1032

## D1 · id 常量搬进叶子模块，用 `export *` 而非改 224 个引用方

- 决定：新建 `src/core/registry/blockIds.ts` 放 108 个纯字面量 id 常量；`blocks.ts` 同时 `export * from './blockIds.ts'` 与显式 `import { … } from './blockIds.ts'`。
- 为什么：`export *` 负责"引用方一行不改"，但它**不会**把名字带进本模块作用域——`blocks.ts` 自己还有引用（`WOOL_SPECS` 之类），所以两者都要写。另一种做法是逐个改 224 个引用文件的 import 路径，收益为零、风险高（同名常量散落两处后迟早漂）。
- 影响：`blocks.ts` 顶部多了一段 100 多行的 import 清单（纯粹是名字搬运）；新增一个 664 行的文件。退回去只需删文件 + 还原 `blocks.ts`（`git revert` 一个提交）。⚠️ 附带代价：`tools/ui-test.ts` 有两处按源码文本断言 id（"581 就是激活轨"），改成拼两个文件读——这类"按源码文本断言"的测试在重构时必然要跟着挪，属于已知摩擦。

## D2 · 先搬"纯类型"，再搬"id 派生表"，最后才搬 SPECS

- 决定：`宿主8`（搬 SPECS）拆成三步：① 纯类型（`BlockSpec` / `WoodBlockIds` / `WoodShapedIds`）→ 已完成；② id 派生表与取值函数（新插 `宿主10`）；③ 才是 SPECS 本身。
- 为什么：`blockSpecs.ts` 要读 `Wood` / `saplingId()` / `stoneVariantId()` 这些**由 `colors.ts` 与字面量算出来的** id 表，它们现在住在 `blocks.ts` 里——只要 `blockSpecs` 还 import `blocks.ts` 一天，环就在，静态 import 就崩。所以必须先让它们进叶子。纯类型先走的理由：**零运行时风险**，且它让后面两步的 import 声明能一次写对。
- 影响：行为零变化（`check:fast` 149/149、`test:hostcore` 33/0、`test:behaviors` 7/0）。`blockIds.ts` 从"只放字面量"扩成"只依赖纯数据/纯类型模块"，边界仍清晰。退回方式：`git revert`。

## D3 · id 派生表整体搬进叶子，`blocks.ts` 保留 `export *` 再导出

- 决定：30 个声明（木材/木制四件/树苗/床/牌子/石变体，含非导出的 `const`）一次性搬进 `blockIds.ts`；`blockIds.ts` 新增的依赖只有 `colors.ts`（纯数据）与 `TreeKind`（纯类型）。`blocks.ts` 继续 `export *`，224 个引用方零改动。
- 为什么：这些表是 `blockSpecs.ts` 的输入，留在 `blocks.ts` 里就必然形成 `blockSpecs → blocks → blockSpecs` 的环（前两次 TLA/banner 方案都是死在环上）。整组搬而不是逐个搬，是因为它们互相引用（`Wood` 依赖 `WOOD_ID_MAP`、`WoodShaped` 依赖 `WOOD_SHAPED_MAP`），拆开搬会出现"一半在叶子里、一半还在环上"的中间态——那种态编译能过但依赖方向仍然是错的，等于白搬。
- 影响：`blockIds.ts` 从 664 行长到 931 行，`blocks.ts` 从 4916 行降到 4511 行；行为零变化（快照哈希逐字节一致、149 套离线测试 + 724 块往返 + 46 块行为全对）。`blockIds.ts` 不再是"零 import 的绝对叶子"，但它的依赖全是纯数据/纯类型模块，无环——这是后续 `blockSpecs` 能直接读它的前提。退回方式：`git revert` 单个提交。
