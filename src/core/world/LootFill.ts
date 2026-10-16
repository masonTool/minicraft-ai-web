/**
 * 结构箱的填充（K8 尾巴）
 *
 * 结构生成在 Worker 里只写"这一格放箱子 + 哪张战利品表"（表序号进方块状态的 bits 4-7），
 * 真正的物品在这里掷点——**只在主线程做**，因为容器（`BlockEntityStore`）是主线程的东西，
 * 也就不必把物品数组跨线程传回来。
 *
 * 三条关键性质：
 *  1. **确定性**：随机源是"世界种子 + 箱子坐标"的位置哈希（`PositionalRng`），
 *     所以同一只箱子无论被填过几次、无论在哪个存档里，内容都一样。
 *     竖直方向也参与种子——上下叠着放的两只箱子不该抽到一模一样的东西。
 *  2. **只填一次**：容器已经存在就跳过；填完把 `chest.looted` 置位并进存档。
 *     没有这一步，玩家掏空箱子 → 区块卸载 → 再加载，箱子会**满血复活**（无限刷矿物）。
 *  3. **不动玩家自己放的箱子**：状态里的表序号是 0（玩家放箱子时状态就是 0），直接跳过。
 *
 * 调用时机：区块进入世界之后（`World.events.onChunkLoaded`）——那时方块、状态都在，
 * 而且这一格的容器一定还没被创建过。
 */

import { CHUNK_SIZE_X, CHUNK_SIZE_Z, Chunk, SECTION_COUNT, WORLD_MAX_Y, WORLD_MIN_Y } from './Chunk.ts';
import type { BlockEntityStore } from './BlockEntityStore.ts';
import { Block } from '../registry/blocks.ts';
import { chestLootIndex } from '../registry/blockState.ts';
import { lootTableByIndex, rollLoot } from '../registry/loot.ts';
import { CHEST_SIZE } from '../container/Chest.ts';
import { PositionalRng } from '../gen/Features.ts';
import type { DimensionId } from '../gen/Dimension.ts';
import type { ItemStack } from '../container/Inventory.ts';

export interface LootFillStats {
  /** 本次填了几只箱子 */
  chests: number;
  /** 一共放进去几件物品 */
  items: number;
}

/**
 * 把这一区块里"带战利品表、且还没被填过"的箱子填上。
 *
 * @param seed 世界种子（决定内容，必须与游戏里的一致）
 * @returns 填了几只箱子、几件物品（测试与调试统计用）
 */
export function fillLootChests(
  chunk: Chunk,
  dimension: DimensionId,
  seed: number,
  store: BlockEntityStore,
): LootFillStats {
  const stats: LootFillStats = { chests: 0, items: 0 };
  const originX = chunk.cx * CHUNK_SIZE_X;
  const originZ = chunk.cz * CHUNK_SIZE_Z;

  for (let section = 0; section < SECTION_COUNT; section++) {
    // 空 section 直接跳过：自然地形大部分 section 是空的，这一条能省掉大部分扫描
    if (chunk.sectionIsEmpty(section)) continue;
    const fromY = Math.max(WORLD_MIN_Y, Chunk.sectionMinY(section));
    const toY = Math.min(WORLD_MAX_Y - 1, fromY + 15);

    for (let y = fromY; y <= toY; y++) {
      for (let z = 0; z < CHUNK_SIZE_Z; z++) {
        for (let x = 0; x < CHUNK_SIZE_X; x++) {
          if (chunk.get(x, y, z) !== Block.CHEST) continue;
          const index = chestLootIndex(chunk.getState(x, y, z));
          if (index <= 0) continue; // 玩家自己放的箱子（状态是 0）
          const worldX = originX + x;
          const worldZ = originZ + z;
          // 已经有容器 = 已经填过（或从存档里读回来的）：绝不能再来一次
          if (store.get(dimension, worldX, y, worldZ)) continue;
          const table = lootTableByIndex(index);
          if (!table) continue;

          // 竖直方向也参与种子：上下叠着的两只箱子内容不该一样
          const rng = new PositionalRng(worldX, worldZ, (seed ^ Math.imul(y + 1, 0x9e3779b1)) | 0);
          const loot = rollLoot(table, () => rng.next());
          if (loot.length === 0) {
            // 掷出一堆空手：也把箱子建出来并置位，否则每次加载都要重掷
            const empty = store.getOrCreateChest(dimension, worldX, y, worldZ);
            empty.looted = true;
            stats.chests++;
            continue;
          }

          const chest = store.getOrCreateChest(dimension, worldX, y, worldZ);
          placeLoot(chest, loot, rng);
          chest.looted = true;
          stats.chests++;
          stats.items += loot.length;
        }
      }
    }
  }
  return stats;
}

/** 把掷出来的战利品塞进**随机的空格子**（原版也是随机槽位，看起来才像"翻出来的"） */
function placeLoot(
  chest: { get(index: number): ItemStack | null; set(index: number, stack: ItemStack | null): void },
  loot: readonly ItemStack[],
  rng: PositionalRng,
): void {
  const free: number[] = [];
  for (let i = 0; i < CHEST_SIZE; i++) if (!chest.get(i)) free.push(i);
  if (free.length === 0) return;

  for (const stack of loot) {
    if (free.length === 0) return;
    const pick = Math.min(free.length - 1, rng.int(free.length));
    const slot = free[pick]!;
    free.splice(pick, 1);
    chest.set(slot, { id: stack.id, count: stack.count });
  }
}
