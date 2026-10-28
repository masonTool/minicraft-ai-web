/**
 * 末影箱（批次 71，B44）：**一份 27 格，跟着玩家走**。
 *
 * 它和这一族前面几件（箱子/木桶/漏斗/投掷器/发射器/堆肥桶）的根本差别是
 * **内容不挂在任何一格方块上**：
 *  - 箱子那几件的内容按坐标存（`BlockEntityStore` 的键是"维度 | x,y,z"），
 *    所以"哪一格箱子"决定"看到哪一份内容"；
 *  - 末影箱恰恰相反——世界里**所有**末影箱打开的都是**同一份**，
 *    它属于玩家而不是属于坐标（原版也是如此）。于是：
 *    · 它**不进容器表**，也不进容器存档；
 *    · 它的存档走玩家存档（`PlayerSave.enderChest`），那是本项目现成的
 *      "非坐标"通道（不需要给存档加新的 store）；
 *    · 破坏末影箱**不会掉内容**、活塞推它也不会丢东西（内容压根不在这儿）。
 *
 * 单独一个类而不是在主程序里散放一个 `Chest` 字段：这样"永远同一份"这条规矩
 * 能被离线断言（`open()` 两次拿到的必须是同一个实例），存档的摊平/写回也有确定的落点。
 */

import { CHEST_SIZE, Chest } from '../container/Chest.ts';
import { restoreStacks, serializeStacks } from '../save/ContainerSave.ts';
import type { ItemStack } from '../container/Inventory.ts';

export class EnderChest {
  /** 那一份共享的容器（27 格）——**只有这一个实例** */
  private readonly chest = new Chest();

  /** 打开末影箱：无论在哪一格、哪个维度打开，拿到的都是同一份 */
  open(): Chest {
    return this.chest;
  }

  /**
   * 存档用：把 27 个槽位摊成数组。
   *
   * ⚠️ 交给存档前要走 `serializeStacks` 拷一份（附加数据逐项抄、空槽写 null）——
   * 直接把容器里的对象交给存档，就等于把活实例挂进了存档数据（改背包会顺手改存档）。
   */
  slots(): (ItemStack | null)[] {
    const slots: (ItemStack | null)[] = [];
    for (let i = 0; i < CHEST_SIZE; i++) slots.push(this.chest.get(i));
    return serializeStacks(slots);
  }

  /** 读档：把存档里的内容写回那一份容器（脏数据由 `restoreStacks` 丢掉） */
  restore(raw: unknown): void {
    const slots = restoreStacks(raw, CHEST_SIZE);
    for (let i = 0; i < slots.length; i++) this.chest.set(i, slots[i] ?? null);
  }
}
