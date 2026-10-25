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

## D4 · `blockSpecs.ts` 只依赖叶子与纯数据模块，`blocks.ts` 静态 import 它

- 决定：spec 数据与只被 spec 用的辅助函数整体搬进 `blockSpecs.ts`；`blocks.ts` 用**静态** `import { SPECS }`（不再有顶层 await、不再需要给测试注入装配器）。搬运时 tsc 报出的 6 个"还在环上"的输入表（`SHAPED_PARENTS`/`COPPER_STAGES`/`COPPER_SHAPES`/`CORAL_KINDS`/`STEM_STAGES`/`copperId`）一并下沉到 `blockIds.ts`。
- 为什么：环是前两次失败的总根。现在的依赖链 `blockIds → blockSpecs → blocks` 是 DAG，静态 import 的初始化顺序天然正确（被依赖的先求值），既不需要 TLA 也不需要测试注入。**放弃的方案**：把 6 个输入表留给 `blocks.ts` 再让 `blockSpecs` 去 import（那就又是环），或把它们复制一份到 `blockSpecs`（两份数据必然漂）。
- 影响：`blocks.ts` 从 4511 行降到 ~2400 行、`blockSpecs.ts` 2191 行、`blockIds.ts` 931 行（三份职责清楚：id 分配 / 数据 / 行为与装配）。体积**暂时未变**（数据仍在包里），换桩在 `宿主9`。行为零变化（724 块往返 + 46 块行为哈希 + 149 套全绿 + 快照哈希逐字节一致）。退回方式：`git revert`。

## D5 · 桩与探针先做成"显式开关"，不默认打开

- 决定：`hostSpecsStub()` 只在 `SPECS_STUB=1` 时生效（默认关），`release-check` 的数据探针挂在同一开关上；主包基线维持 740 KB 不动。
- 为什么：打开开关后**生产包在门禁执行前就抛** `Cannot read properties of undefined (reading 'id')`——还有模块在模块初始化期读方块表，而门禁写在 `main.ts` 末尾。默认打开等于把一个白屏发上线。做成开关后：① 它是"数据是否真的搬干净"的可复现探针；② 修好入口（两段式）之前不影响任何现有发布路径；③ 基线不收紧，避免用一个没生效的优化去压门。
- 影响：当前发布路径**零变化**（体积、门禁、行为都不变）。`blockSpecs.stub.ts` 与插件插件代码留在仓库里备用。退回方式：删掉开关分支即可（默认关，删了行为也不变）。

## D6 · 用两段式入口（boot.ts → 装表 → import main）解决"空表下模块初始化期崩"

- 决定：`index.html` 指向新的 `src/boot.ts`；`boot.ts` 取 `core.bin` 装表成功后才动态 `import('./main.ts')`；`main.ts` 原有的门禁 IIFE 移除。桩默认打开（`SPECS_STUB=0` 可关）。
- 为什么：空表下崩溃的根因不是桩，而是**求值顺序**——主包的模块图里有一批模块在模块初始化期读方块表，而门禁写在 `main.ts` 末尾。把"装表"提到"加载主包"之前，从根上消除这类顺序依赖，而不是逐个去改那些顶层读取（那样每加一个模块都可能重新踩）。**上一批回退过这条路**：当时方块表还在主包里，入口 chunk 与 main chunk 各打一份，主包 1.2 MB → 2.0 MB；现在数据被桩掉，两份都是空的，重复打包的前提不存在。
- 影响：**体积口径变了**（`index-*.js` 只是引导器，游戏体在 `main-*.js`；首屏看合计）。实测合计 gzip 1199.1 KB 对上一提交 1196.8 KB **+2.3 KB**——拆包的共享模块重复，几乎抵消了数据移出的 7 KB。所以这一步的收益是**安全（数据不在包里）而非速度**，这一点必须写清楚，别当成性能优化。退回方式：`git revert` 本提交，并把 `index.html` 指回 `/src/main.ts`。
