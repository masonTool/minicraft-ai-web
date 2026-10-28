/**
 * 地图离线测试（批次 196，H16）
 *
 * 地图的数据模型只有两件事：**中心**与**位图**。这一套全盯它们：
 *
 *  1. **格子与坐标**：一格 16 格方块、整张 32×32（512×512 格），出界一律 -1；
 *  2. **位图**：标一格、查一格、已标过不重复标、base64 往返、坏数据退化成全零；
 *  3. **探索度**：数出多少格（界面显示百分比用）；
 *  4. **物品与配方**：空地图/已填好的地图、8 纸 + 1 指南针。
 *
 * 运行：npm run test:map
 */

import { Item, CREATIVE_ITEMS, itemDef, maxStackOf } from '../web/src/core/registry/items.ts';
import { itemLabel, itemDescription, hasDescription } from '../web/src/core/registry/itemNames.ts';
import { TILE_ORDER } from '../web/src/render/atlasLayout.ts';
import { RECIPES, matchRecipe } from '../web/src/core/crafting/Recipes.ts';
import {
  MAP_BIT_BYTES,
  MAP_CHUNK_SPAN,
  MAP_COVER_BLOCKS,
  MAP_GRID,
  emptyMapData,
  encodeBits,
  decodeBits,
  exploredCount,
  isExplored,
  mapCellIndex,
  mapOffset,
  sanitizeMap,
  markExplored,
} from '../web/src/core/items/Map.ts';
import { restoreStack, sameExtras, stackExtras } from '../web/src/core/container/Inventory.ts';
import { tryInsertOne } from '../web/src/core/container/Transfer.ts';
import { Chest } from '../web/src/core/container/Chest.ts';

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.log(`  ✗ ${label}${detail ? `  →  ${detail}` : ''}`);
  }
}

function equal(label: string, actual: unknown, expected: unknown): void {
  check(label, Object.is(actual, expected), `实际 ${String(actual)}，期望 ${String(expected)}`);
}

const TILES = new Set<string>(TILE_ORDER);

console.log('\n[尺寸与格子]');
{
  equal('一格 16 格方块（= 一个区块）', MAP_CHUNK_SPAN, 16);
  equal('32×32 格', MAP_GRID, 32);
  equal('整张覆盖 512 格方块', MAP_COVER_BLOCKS, 512);
  equal('位图 128 字节', MAP_BIT_BYTES, 128);

  const map = emptyMapData(120.9, -40.2);
  equal('中心取整（X）', map.originX, 120);
  equal('中心取整（Z）', map.originZ, -41);
  equal('新地图一格都没探索', exploredCount(map), 0);
  equal('bits 解码出 128 字节', decodeBits(map.bits).length, 128);

  // 中心那一格：下标 = 16*32 + 16
  equal('中心格的下标', mapCellIndex(map, 120, -41), 16 * MAP_GRID + 16);
  equal('中心右边一格（+16 格）', mapCellIndex(map, 120 + 16, -41), 16 * MAP_GRID + 17);
  equal('中心下面一格（+16 格 Z）', mapCellIndex(map, 120, -41 + 16), 17 * MAP_GRID + 16);
  equal('中心左边一格（-1 格）', mapCellIndex(map, 119, -41), 16 * MAP_GRID + 15);
  equal('最左一格（中心往西 16 格）', mapCellIndex(map, 120 - 16 * 16, -41), 16 * MAP_GRID);
  equal('再往外一格就出界', mapCellIndex(map, 120 - 17 * 16, -41), -1);
  equal('上边出界', mapCellIndex(map, 120, -41 - 17 * 16), -1);
  equal('右下角最后一格', mapCellIndex(map, 120 + 15 * 16, -41 + 15 * 16), MAP_GRID * MAP_GRID - 1);
}

console.log('\n[标记与查询]');
{
  const map = emptyMapData(0, 0);
  check('没走过的地方是未探索', !isExplored(map, 0, 0));

  const marked = markExplored(map, 0, 0);
  check('标一格有变化', marked !== null);
  check('标完之后查得到', isExplored(marked!, 0, 0));
  equal('探索度 1', exploredCount(marked!), 1);
  equal('原数据没被动（不可变）', exploredCount(map), 0);

  equal('同一格再标一次 → null（调用方据此跳过写回）', markExplored(marked!, 0, 0), null);
  equal('出界标不进去', markExplored(marked!, 10000, 0), null);

  // 同一格里的不同位置都算"这一格"
  const corner = markExplored(map, 15, 15);
  check('同一格不同坐标标的是同一格', corner !== null && isExplored(corner!, 0, 0));

  let current = marked!;
  for (let i = 1; i <= 10; i++) {
    const next = markExplored(current, i * 16, 0);
    if (next) current = next;
  }
  equal('连着标 11 格 → 探索度 11', exploredCount(current), 11);
  equal('远端那格也查得到', isExplored(current, 10 * 16, 0), true);

  // base64 往返
  equal('位图往返一致', encodeBits(decodeBits(current.bits)), current.bits);
  equal('坏 base64 → 全零位图', exploredCount({ ...current, bits: '!!!not-base64!!!' }), 0);
}

console.log('\n[数据校验]');
{
  const map = markExplored(emptyMapData(64, -64), 64, -64)!;
  const restored = sanitizeMap(JSON.parse(JSON.stringify(map)));
  equal('读回来中心还在', restored?.originX, 64);
  equal('读回来位图还在', isExplored(restored!, 64, -64), true);

  const wrongLength = sanitizeMap({ originX: 1, originZ: 2, bits: btoa('short') });
  equal('位图长度不对 → 换成全空', exploredCount(wrongLength!), 0);
  equal('中心仍然保留', wrongLength?.originX, 1);

  equal('不是对象 → undefined', sanitizeMap('map'), undefined);
  equal('null → undefined', sanitizeMap(null), undefined);

  const offset = mapOffset(map, 64 + 32, -64 - 48);
  equal('偏移 X', offset.dx, 32);
  equal('偏移 Z', offset.dz, -48);
}

console.log('\n[物品与配方]');
{
  equal('空地图的名字', itemLabel(Item.MAP), '地图');
  equal('已填好的地图的名字', itemLabel(Item.FILLED_MAP), '已填好的地图');
  equal('空地图不可堆叠', maxStackOf(Item.MAP), 1);
  equal('已填好的地图不可堆叠', maxStackOf(Item.FILLED_MAP), 1);
  check('两个都有图标', TILES.has(itemDef(Item.MAP)!.tile) && TILES.has(itemDef(Item.FILLED_MAP)!.tile));
  check('两个都能在创造栏里拿到', CREATIVE_ITEMS.includes(Item.MAP) && CREATIVE_ITEMS.includes(Item.FILLED_MAP));
  check('两个都有说明', hasDescription(Item.MAP) && hasDescription(Item.FILLED_MAP));
  check('空地图的说明写了"右键"', itemDescription(Item.MAP).includes('右键'));

  const recipe = RECIPES.find((entry) => entry.result.id === Item.MAP);
  check('有空地图配方', recipe !== undefined);
  const cells = [
    Item.PAPER, Item.PAPER, Item.PAPER,
    Item.PAPER, Item.COMPASS, Item.PAPER,
    Item.PAPER, Item.PAPER, Item.PAPER,
  ];
  equal('8 纸 + 1 指南针 → 空地图', matchRecipe(cells, 3)?.id, Item.MAP);
  equal('中间不是指南针就合不出来', matchRecipe([...cells.slice(0, 4), Item.SHIELD, ...cells.slice(5)], 3), null);
}

console.log('\n[附加数据：存档 / 并堆 / 搬运]');
{
  const map = markExplored(emptyMapData(8, 8), 8, 8)!;
  const stack = { id: Item.FILLED_MAP, count: 1, map };
  const restored = restoreStack(JSON.parse(JSON.stringify(stack)));
  equal('读档回来中心还在', restored?.map?.originX, 8);
  check('读档回来位图还在', isExplored(restored!.map!, 8, 8));

  const extras = stackExtras(stack);
  check('stackExtras 带上了地图', extras.map?.originX === 8);

  const other = { ...map, bits: markExplored(map, 40, 8)!.bits };
  check('位图不同 → 不能并堆', !sameExtras(stack, { id: Item.FILLED_MAP, count: 1, map: other }));
  check('完全一样 → 可以并堆', sameExtras(stack, { id: Item.FILLED_MAP, count: 1, map: { ...map } }));

  const chest = new Chest();
  check('漏斗能塞进箱子', tryInsertOne(chest, stack));
  equal('箱子里的地图还带着位图', chest.get(0)?.map?.originX, 8);
}

console.log(`\n地图测试：${passed} 通过 / ${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
