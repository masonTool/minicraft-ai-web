/**
 * v2 容器存档冒烟：Chest/Furnace 内容序列化 → 新 store 恢复。
 */

import { BlockEntityStore } from '../../src/core/world/BlockEntityStore.ts';
import { restoreContainers, serializeContainers } from '../../src/core/save/ContainerSave.ts';

const store = new BlockEntityStore();
const chest = store.getOrCreateChest('overworld', 1, 64, 2);
chest.set(0, { id: 45, count: 3 });
chest.set(26, { id: 1, count: 64 });

const furnace = store.getOrCreateFurnace('overworld', 3, 64, 4);
furnace.set(0, { id: 1, count: 2 });
furnace.set(1, { id: 2, count: 7 });

const data = serializeContainers(store);
if (data.length < 2) {
  console.error(`FAIL: expected >=2 containers, got ${data.length}`);
  process.exit(1);
}

const restored = new BlockEntityStore();
restoreContainers(restored, data);
const restoredChest = restored.getChest('overworld', 1, 64, 2);
const restoredFurnace = restored.getFurnace('overworld', 3, 64, 4);
if (
  restoredChest?.get(0)?.id !== 45 ||
  restoredChest.get(0)?.count !== 3 ||
  restoredChest.get(26)?.count !== 64 ||
  restoredFurnace?.get(1)?.count !== 7
) {
  console.error('FAIL: container restore mismatch');
  process.exit(1);
}

console.log(
  `PASS: containers=${data.length} chest=${restoredChest.get(0)?.id}x${restoredChest.get(0)?.count} furnaceFuel=${restoredFurnace.get(1)?.count}`,
);
