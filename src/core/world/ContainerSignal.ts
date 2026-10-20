/**
 * 比较器读容器（批次 544）
 *
 * 原版的比较器放在箱子/漏斗/熔炉后面时，输出强度是**装满度**：
 * `floor(1 + 14 × Σ(每格数量/该格上限) / 总格数)`，空容器是 0。
 * 本项目以前是"背面的红石强度直通"，所以"箱子越满信号越强"这件事完全不存在。
 *
 * 拆成纯函数的原因与其它容器规则一致：它只依赖 `SlotSource`（`get`/`set`），
 * 不碰世界、不碰界面，因此可以直接拿一只 `new Chest()` 在离线测试里喂满/掏空。
 */

import type { BlockContainer } from './BlockEntityStore.ts';
import { containerSlotCount } from '../container/Transfer.ts';
import { maxStackOf } from '../registry/items.ts';

/**
 * 容器装满度（0~1）：每格按"数量 / 该物品的堆叠上限"算，空格算 0。
 *
 * 用**每格自己的上限**而不是统一 64：一盒药水（上限 1）装满 8 格时，
 * 在原版里就是"满"的信号，而不是"8/64 = 12%"。
 */
export function containerFullness(container: BlockContainer): number {
  const slots = containerSlotCount(container);
  if (slots <= 0) return 0;
  let filled = 0;
  for (let i = 0; i < slots; i++) {
    const stack = container.get(i);
    if (!stack || !(stack.count > 0)) continue;
    const max = Math.max(1, maxStackOf(stack.id));
    filled += Math.min(1, stack.count / max);
  }
  return filled / slots;
}

/**
 * 比较器读这个容器时的输出强度（0~15）。
 *
 * 与 Wiki 的 `getRedstoneSignalFromContainer` 同一条式子：空 = 0，
 * 满 = 15，中间线性。`floor` 之后夹到 15，避免"装满时算出 15.4"。
 */
export function containerSignalStrength(container: BlockContainer): number {
  const fullness = containerFullness(container);
  if (fullness <= 0) return 0;
  return Math.max(0, Math.min(15, Math.floor(1 + 14 * fullness)));
}
