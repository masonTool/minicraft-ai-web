/**
 * 潜影盒（批次 72，B45 / H17 的最后一件）：与箱子**同一个容器**（27 格），所以这里是空子类。
 *
 * 它存在的理由与木桶/发射器那两个空子类一样——**身份**：
 *  1. 存档里的 `kind` 跟着方块走（`shulker_box` / `chest`）；
 *  2. 界面标题与提示要靠它分辨；
 *  3. 它是这一族里**唯一"内容物跟着物品走"**的那一件：挖下来时内容塞进掉落的物品里
 *     （`ItemStack.contents`），放下时再倒回方块——那两条路径都按方块 id 判定，
 *     这个类型只是给"它和箱子不是一回事"留一个落点。
 *
 * ⚠️ 与木桶同一条教训：凡是要**区分**子类的地方（`ContainerSave.kindOf`）必须先判子类。
 * 反过来，按 `Chest` 判定的地方（`Transfer.containerSlotCount`、`hasContent`）自动覆盖子类。
 */

import { CHEST_SIZE, Chest } from './Chest.ts';
import type { ItemStack } from './Inventory.ts';
import { restoreStacks, serializeStacks } from '../save/ContainerSave.ts';

/**
 * 潜影盒的格数（与箱子同 27 格）。
 *
 * ⚠️ 这里**必须**从 `CHEST_SIZE` 派生，而不是自己写一个 `27`：
 * `ContainerSave` 要读这个数去建格数表，而它与本模块**互相 import**
 * （本模块的 `shulkerContentsOf` 要用那边的槽位读写）——两个模块互相引用时，
 * **顶层读对方的 const 会读到 undefined**（批次 58 踩过一次，批次 72 又踩了一次）。
 * 派生自 `Chest.ts` 之后，读它的那一侧（`ContainerSave`）改读 `CHEST_SIZE`，
 * 环还在，但没有任何跨模块的顶层读取。
 */
export const SHULKER_BOX_SIZE = CHEST_SIZE;

export class ShulkerBox extends Chest {}

/**
 * 把潜影盒里的内容取成"可以塞进物品"的形式（**挖下来**时用）。
 *
 * 为什么要单独一个函数：这条路径的错法都很安静——少拷一个字段（"读档后附魔没了"）、
 * 或者把容器的活实例直接塞进物品（"改背包顺手改了方块里的那份"）。
 * 抽出来之后它能在离线测试里逐条钉住，`main` 那边只剩一次调用。
 * ⚠️ 没有盒子（比如方块与容器不同步）时返回**全空**，而不是抛错：挖方块不该因为
 * 容器表缺一条就崩掉（这与"旧存档缺字段 → 空箱子"是同一条宽容策略）。
 */
export function shulkerContentsOf(box: Chest | undefined): (ItemStack | null)[] {
  const slots: (ItemStack | null)[] = [];
  for (let i = 0; i < SHULKER_BOX_SIZE; i++) slots.push(box ? box.get(i) : null);
  return serializeStacks(slots);
}

/**
 * 把物品里带着的内容**倒回**潜影盒（**放下**时用）。
 *
 * 反向的那一条：`contents` 是外部数据（可能来自旧存档或手改），所以走 `restoreStacks`
 * 逐项校验，脏数据一律丢掉；`undefined` 表示"这个盒子里本来就没东西"。
 */
export function fillShulkerBox(box: Chest, contents: unknown): void {
  const slots = restoreStacks(contents, SHULKER_BOX_SIZE);
  for (let i = 0; i < slots.length; i++) box.set(i, slots[i] ?? null);
}
