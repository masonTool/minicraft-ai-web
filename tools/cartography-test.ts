/**
 * 制图台离线测试（K7，批次 505）
 *
 * 三件事各自都有"改数据"的风险，所以断言分三层：
 *  ① 地图数据：放大重采样（中心对齐）、锁定后不再记、复制互不影响；
 *  ② 制图台规则：三种材料各对应一种动作、四种拒绝、扣材料只扣该扣的；
 *  ③ 注册与存档：方块 / 配方 / 容器种类 / 存档往返。
 *
 * 运行：npm run test:cartography
 */

import { Block, GLASS_PANE_ID, blockDef } from '../web/src/core/registry/blocks.ts';
import { reasonText, type ReasonRef } from '../web/src/core/container/reason.ts';
import { Item } from '../web/src/core/registry/items.ts';
import { blockLabel } from '../web/src/core/registry/itemNames.ts';
import { RECIPES } from '../web/src/core/crafting/Recipes.ts';
import { BlockEntityStore, CONTAINER_BLOCKS } from '../web/src/core/world/BlockEntityStore.ts';
import { SLOT_COUNTS, kindOf, restoreContainers, serializeContainer } from '../web/src/core/save/ContainerSave.ts';
import { acceptingSlots, containerSlotCount } from '../web/src/core/container/Transfer.ts';
import {
  CARTO_MAP,
  CARTO_MATERIAL,
  CartographyTable,
  planCartography,
} from '../web/src/core/container/CartographyTable.ts';
import {
  MAP_CHUNK_SPAN,
  MAP_GRID,
  MAP_MAX_SCALE,
  copyMap,
  emptyMapData,
  exploredCount,
  isExplored,
  lockMap,
  mapCellIndex,
  mapSpanOf,
  markExplored,
  sanitizeMap,
  zoomOutMap,
  type MapData,
} from '../web/src/core/items/Map.ts';

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

function filled(data: MapData): { id: number; count: number; map: MapData } {
  return { id: Item.FILLED_MAP, count: 1, map: data };
}

// ---------------------------------------------------------------- 1. 地图数据

console.log('\n[地图数据：缩放]');
{
  const base = emptyMapData(0, 0);
  equal('新地图是 0 档', base.scale, 0);
  equal('0 档一格 = 1 个区块', mapSpanOf(base), MAP_CHUNK_SPAN);
  equal('未锁定', base.locked, undefined);

  const marked = markExplored(markExplored(base, 0, 0)!, 40, 0)!;
  equal('标了两格', exploredCount(marked), 2);
  // 注意：`mapCellIndex` 返回的是**展平下标**（cz * 32 + cx），z=0 落在第 16 行
  equal('40 在 0 档是第 18 列', mapCellIndex(marked, 40, 0) % MAP_GRID, 16 + Math.floor(40 / MAP_CHUNK_SPAN));

  const zoomed = zoomOutMap(marked)!;
  check('放大成功', zoomed !== null);
  equal('档位 +1', zoomed.scale, 1);
  equal('一格 = 2 个区块', mapSpanOf(zoomed), MAP_CHUNK_SPAN * 2);
  check('中心那一格仍然是探索过的', isExplored(zoomed, 0, 0));
  check('40 格（旧第 18 格）合并到新第 17 格后仍然探索过', isExplored(zoomed, 40, 0));
  equal('覆盖范围翻倍后仍然只有 2 格（合并到同一格时会更少）', exploredCount(zoomed), 2);

  const zoomed2 = zoomOutMap(zoomed)!;
  equal('再放大一档', zoomed2.scale, 2);
  equal('已到最大档', zoomOutMap(zoomed2), null);
  equal('最大档 = 4 个区块一格', mapSpanOf(zoomed2), MAP_CHUNK_SPAN * 4);

  // 对齐：中心线不能被切成两半（15/16 成对、17/18 成对）
  const edge = markExplored(emptyMapData(0, 0), MAP_CHUNK_SPAN, 0)!;
  const edgeZoomed = zoomOutMap(edge)!;
  equal('中心右侧第一格合并后仍在中心右侧', mapCellIndex(edgeZoomed, MAP_CHUNK_SPAN, 0) % MAP_GRID, 16);
  check('中心那一格的点不会跑到左边', !isExplored(edgeZoomed, -MAP_CHUNK_SPAN * 2, 0));
}

console.log('\n[地图数据：锁定]');
{
  const map = markExplored(emptyMapData(0, 0), 0, 0)!;
  const locked = lockMap(map);
  equal('锁定位', locked.locked, true);
  equal('锁定后不再记新格子', markExplored(locked, 100, 0), null);
  check('原有格子还在', isExplored(locked, 0, 0));
  equal('未锁定的同一张图还能记', exploredCount(markExplored(map, 100, 0)!), 2);
}

console.log('\n[地图数据：复制与脏数据]');
{
  const map = markExplored(emptyMapData(16, 32), 16, 32)!;
  const copy = copyMap(map);
  copy.bits = markExplored(copy, 200, 0)!.bits;
  equal('改副本不影响原件', exploredCount(map), 1);
  equal('副本中心一致', copy.originX, 16);

  equal('脏 scale（99）夹到最大', sanitizeMap({ originX: 0, originZ: 0, bits: '', scale: 99 })?.scale, MAP_MAX_SCALE);
  equal('负 scale 夹到 0', sanitizeMap({ originX: 0, originZ: 0, bits: '', scale: -3 })?.scale, 0);
  equal('非数字 scale 回落 0', sanitizeMap({ originX: 0, originZ: 0, bits: '', scale: 'x' })?.scale, 0);
  equal('locked=true 保留', sanitizeMap({ originX: 0, originZ: 0, bits: '', locked: true })?.locked, true);
  equal('locked 非布尔 → false', sanitizeMap({ originX: 0, originZ: 0, bits: '', locked: 'yes' })?.locked, false);
  equal('老存档（没有 scale）→ 0', sanitizeMap({ originX: 0, originZ: 0, bits: '' })?.scale, 0);
}

// ---------------------------------------------------------------- 2. 制图台规则

console.log('\n[规则：四种拒绝]');
{
  const map = filled(emptyMapData(0, 0));
  const paper = { id: Item.PAPER, count: 1 };

  equal('没地图', planCartography(null, paper).ok, false);
  equal(
    '地图格里不是已填好的地图',
    planCartography({ id: Item.MAP, count: 1 }, paper).ok ? '' : reasonText((planCartography({ id: Item.MAP, count: 1 }, paper) as { reason: ReasonRef }).reason),
    '这一格只收已填好的地图',
  );
  equal(
    '没材料',
    planCartography(map, null).ok ? '' : reasonText((planCartography(map, null) as { reason: ReasonRef }).reason),
    '再放纸 / 空地图 / 玻璃板',
  );
  const bad = planCartography(map, { id: Block.STONE, count: 1 });
  equal(
    '不认识的材料',
    bad.ok ? '' : bad.reason.key,
    'station.reason.cartographyMaterialHint',
  );
}

console.log('\n[规则：三种材料]');
{
  const map = filled(markExplored(emptyMapData(0, 0), 0, 0)!);
  const zoom = planCartography(map, { id: Item.PAPER, count: 1 });
  check('纸 → 放大', zoom.ok && zoom.plan.action === 'zoom');
  check('放大消耗地图本身', zoom.ok && zoom.plan.consumesMap);
  equal('放大的产物档位 +1', zoom.ok ? zoom.plan.result.map?.scale : -1, 1);

  const copyPlan = planCartography(map, { id: Item.MAP, count: 1 });
  check('空地图 → 复制', copyPlan.ok && copyPlan.plan.action === 'copy');
  check('复制不消耗原件', copyPlan.ok && !copyPlan.plan.consumesMap);
  equal('复制出来位图一样', copyPlan.ok ? exploredCount(copyPlan.plan.result.map!) : -1, 1);

  const lockPlan = planCartography(map, { id: GLASS_PANE_ID, count: 1 });
  check('玻璃板 → 锁定', lockPlan.ok && lockPlan.plan.action === 'lock');
  equal('锁定产物带锁定位', lockPlan.ok ? lockPlan.plan.result.map?.locked : undefined, true);

  const maxed = filled(zoomOutMap(zoomOutMap(map.map!)!)!);
  const tooFar = planCartography(maxed, { id: Item.PAPER, count: 1 });
  equal('已到最大缩放不能再放大', tooFar.ok ? '' : tooFar.reason.key, 'station.reason.maxZoom');

  const locked = filled(lockMap(map.map!));
  const again = planCartography(locked, { id: GLASS_PANE_ID, count: 1 });
  equal('已锁定不能再锁', again.ok ? '' : again.reason.key, 'station.reason.mapLocked');
}

console.log('\n[制作：扣材料只扣该扣的]');
{
  const table = new CartographyTable();
  table.set(CARTO_MAP, { id: Item.FILLED_MAP, count: 1, map: markExplored(emptyMapData(0, 0), 0, 0)! });
  table.set(CARTO_MATERIAL, { id: Item.PAPER, count: 2 });

  const zoom = table.craft();
  check('放大成功', zoom.ok);
  equal('纸剩 1 张', table.material?.count, 1);
  equal('地图被消耗', table.map, null);
  equal('产物是 1 档', zoom.ok ? zoom.plan.result.map?.scale : -1, 1);

  // 复制：只扣空地图，地图留下
  const copyTable = new CartographyTable();
  copyTable.set(CARTO_MAP, { id: Item.FILLED_MAP, count: 1, map: emptyMapData(0, 0) });
  copyTable.set(CARTO_MATERIAL, { id: Item.MAP, count: 1 });
  const copy = copyTable.craft();
  check('复制成功', copy.ok);
  equal('原件还在', copyTable.map?.id, Item.FILLED_MAP);
  equal('空地图用掉了', copyTable.material, null);

  // 锁定：地图与玻璃板都扣
  const lockTable = new CartographyTable();
  lockTable.set(CARTO_MAP, { id: Item.FILLED_MAP, count: 1, map: emptyMapData(0, 0) });
  lockTable.set(CARTO_MATERIAL, { id: GLASS_PANE_ID, count: 1 });
  const lock = lockTable.craft();
  check('锁定成功', lock.ok);
  equal('地图被消耗', lockTable.map, null);
  equal('玻璃板用掉了', lockTable.material, null);

  // 失败时一格都不动
  const fail = new CartographyTable();
  fail.set(CARTO_MAP, { id: Block.STONE, count: 2 });
  fail.set(CARTO_MATERIAL, { id: Item.PAPER, count: 2 });
  const bad = fail.craft();
  check('失败', !bad.ok);
  equal('石头没动', fail.map?.count, 2);
  equal('纸没动', fail.material?.count, 2);
}

// ---------------------------------------------------------------- 3. 注册与存档

console.log('\n[注册：方块 / 配方 / 容器]');
{
  equal('方块注册名', blockDef(Block.CARTOGRAPHY_TABLE).name, 'minicraft:cartography_table');
  equal('中文名', blockLabel(Block.CARTOGRAPHY_TABLE), '制图台');
  check('实心整格', blockDef(Block.CARTOGRAPHY_TABLE).solid);
  check('活塞推不动名单里有它', CONTAINER_BLOCKS.has(Block.CARTOGRAPHY_TABLE));
  check(
    '有配方（2 纸 + 2 木板）',
    RECIPES.some((recipe) => recipe.result.id === Block.CARTOGRAPHY_TABLE),
  );

  const table = new CartographyTable();
  equal('容器种类', kindOf(table), 'cartography');
  equal('两格', SLOT_COUNTS.cartography, 2);
  equal('可自动输入两格', acceptingSlots(table).length, 2);
  equal('总格数', containerSlotCount(table), 2);

  const data = serializeContainer(
    Object.assign(table, {}),
    'overworld',
    3,
    64,
    4,
  );
  equal('空容器不写', data, null);
}

console.log('\n[存档往返]');
{
  const table = new CartographyTable();
  table.set(CARTO_MAP, { id: Item.FILLED_MAP, count: 1, map: markExplored(emptyMapData(8, 8), 8, 8)! });
  table.set(CARTO_MATERIAL, { id: Item.PAPER, count: 5 });

  const data = serializeContainer(table, 'overworld', 3, 64, 4);
  check('有内容才写', data !== null);

  const store = new BlockEntityStore();
  restoreContainers(store, data ? [data] : []);
  const restored = store.getCartographyTable('overworld', 3, 64, 4);
  check('读档拿得到制图台', restored !== undefined);
  equal('地图还在', restored?.map?.id, Item.FILLED_MAP);
  equal('地图位图还在', restored ? exploredCount(restored.map!.map!) : -1, 1);
  equal('纸还在', restored?.material?.count, 5);
}

console.log('\n[按坐标取同一个实例]');
{
  const store = new BlockEntityStore();
  const first = store.getOrCreateCartographyTable('overworld', 0, 64, 0);
  const second = store.getOrCreateCartographyTable('overworld', 0, 64, 0);
  check('同坐标同一台', first === second);
  check('另一坐标另一台', store.getOrCreateCartographyTable('overworld', 1, 64, 0) !== first);
}

console.log(`\n制图台测试：${passed} 通过 / ${failed} 失败\n`);
if (failed > 0) process.exit(1);
