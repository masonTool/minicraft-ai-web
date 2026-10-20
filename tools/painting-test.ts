/**
 * 多格拼贴的画（批次 494，B51 的 ②）
 *
 * 这一批只做**数据与贴图**（放置与渲染是下一批）：
 *  ① 三幅多格画的尺寸表（名字/尺寸照原版）；
 *  ② 子图命名与图集登记（漏一张不会报错，只会静默回退成别的图——所以要逐条查）；
 *  ③ 占位格子（`paintingCells`）与"从大到小找一幅放得下的"；
 *  ④ 画表（每格一条、拆任意一格带走整幅、存读档往返、坏条目跳过）。
 */

import {
  MULTI_PAINTINGS,
  MULTI_PAINTINGS_LARGE_FIRST,
  multiPaintingByName,
  paintingSubTile,
  paintingSubTileCount,
} from '../src/core/registry/paintings.ts';
import {
  PaintingStore,
  paintingCellKey,
  paintingCells,
  pickPaintingThatFits,
  restorePaintings,
  serializePaintings,
} from '../src/core/world/Paintings.ts';
import { TILE_ORDER } from '../src/render/atlasLayout.ts';

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

const kong = multiPaintingByName('donkey_kong')!;
const skeleton = multiPaintingByName('skeleton')!;
const match = multiPaintingByName('match')!;

console.log('\n[三幅多格画的尺寸（照原版）]');
{
  equal('一共三幅', MULTI_PAINTINGS.length, 3);
  equal('大金刚 4×4', `${kong.width}×${kong.height}`, '4×4');
  equal('骷髅 4×3', `${skeleton.width}×${skeleton.height}`, '4×3');
  equal('火柴 2×2', `${match.width}×${match.height}`, '2×2');
  equal('名字唯一', new Set(MULTI_PAINTINGS.map((painting) => painting.name)).size, 3);
  check('都有中文名', MULTI_PAINTINGS.every((painting) => painting.cn.length > 0));
  equal('按面积从大到小排好', MULTI_PAINTINGS_LARGE_FIRST.map((painting) => painting.name).join(','), 'donkey_kong,skeleton,match');
  equal('不认识的画名返回 undefined', multiPaintingByName('nope'), undefined);
}

console.log('\n[子图：每格一张，且都在图集名单里]');
{
  equal('4×4 有 16 张子图', paintingSubTileCount(kong), 16);
  equal('子图名带行列', paintingSubTile(kong, 2, 3), 'painting_donkey_kong_2_3');

  const missing: string[] = [];
  for (const painting of MULTI_PAINTINGS) {
    for (let row = 0; row < painting.height; row++) {
      for (let col = 0; col < painting.width; col++) {
        const tile = paintingSubTile(painting, col, row);
        if (!TILE_ORDER.includes(tile)) missing.push(tile);
      }
    }
  }
  equal('29 张子图全部登记进图集（漏一张会静默回退成别的画）', missing.length, 0);
  check('（缺的是）', missing.length === 0, missing.slice(0, 4).join(' '));
}

console.log('\n[占位格子与"从大到小找一幅放得下的"]');
{
  const cells = paintingCells({ x: 10, y: 64, z: 10 }, match, 1, 0);
  equal('2×2 占 4 格', cells.length, 4);
  equal('锚点就是第一格', `${cells[0]!.x},${cells[0]!.y},${cells[0]!.z}`, '10,64,10');
  equal('第二格向右 +x', `${cells[1]!.x},${cells[1]!.y},${cells[1]!.z}`, '11,64,10');
  equal('第三格向下 -y', `${cells[2]!.x},${cells[2]!.y},${cells[2]!.z}`, '10,63,10');
  const leftward = paintingCells({ x: 10, y: 64, z: 10 }, match, -1, 0);
  equal('朝另一边时向右是 -x', `${leftward[1]!.x},${leftward[1]!.z}`, '9,10');
  const alongZ = paintingCells({ x: 10, y: 64, z: 10 }, match, 0, -1);
  equal('贴南北墙时向右是 -z', `${alongZ[1]!.x},${alongZ[1]!.z}`, '10,9');

  // 从大到小：4×4 放得下就选它
  equal('都放得下时选最大的', pickPaintingThatFits(MULTI_PAINTINGS_LARGE_FIRST, () => true)?.name, 'donkey_kong');
  equal('只有 2×2 放得下', pickPaintingThatFits(MULTI_PAINTINGS_LARGE_FIRST, (painting) => painting.width <= 2)?.name, 'match');
  equal('一幅都放不下', pickPaintingThatFits(MULTI_PAINTINGS_LARGE_FIRST, () => false), null);
}

console.log('\n[画表：拆任意一格带走整幅]');
{
  const store = new PaintingStore();
  const written = store.place('overworld', { x: 0, y: 64, z: 0 }, kong, 1, 0);
  equal('4×4 写了 16 格', written.length, 16);
  equal('表里 16 条', store.size, 16);
  equal('锚点去重后只有 1 幅', store.anchors().length, 1);
  equal('每一格都记着自己的行列', store.get('overworld', 2, 62, 0)?.col, 2);
  equal('行也从 0 起（向下）', store.get('overworld', 0, 61, 0)?.row, 3);
  equal('维度写进去了', store.get('overworld', 0, 64, 0)?.dimension, 'overworld');
  equal('别的维度查不到', store.get('nether', 0, 64, 0), null);

  // 拆中间那一格：整幅 16 格全没了
  const removed = store.removeAt('overworld', 2, 62, 0);
  check('拆中间一格能删掉整幅', removed !== null);
  equal('删掉了 16 格', removed!.cells.length, 16);
  equal('表空了', store.size, 0);
  equal('锚点信息带回来了（掉落用）', removed!.anchor.name, 'donkey_kong');
  equal('拆空格子返回 null', store.removeAt('overworld', 5, 64, 5), null);

  // 两幅画互不干扰
  const two = new PaintingStore();
  two.place('overworld', { x: 0, y: 64, z: 0 }, match, 1, 0);
  two.place('overworld', { x: 10, y: 64, z: 0 }, match, 1, 0);
  equal('两幅共 8 格', two.size, 8);
  two.removeAt('overworld', 10, 64, 0);
  equal('拆一幅只影响那一幅', two.size, 4);
}

console.log('\n[存读档]');
{
  const store = new PaintingStore();
  store.place('overworld', { x: 3, y: 70, z: -4 }, skeleton, 0, -1);
  store.place('nether', { x: 1, y: 40, z: 1 }, match, 1, 0);

  const saved = serializePaintings(store);
  equal('只存锚点（两幅两条）', saved.length, 2);
  equal('锚点带名字', saved.find((entry) => entry.dimension === 'overworld')?.name, 'skeleton');

  const restored = new PaintingStore();
  equal('读回两幅', restorePaintings(restored, JSON.parse(JSON.stringify(saved))), 2);
  equal('格数对得上（4×3 + 2×2 = 12 + 4）', restored.size, 16);
  equal('沿 -z 铺的那幅也回来了', restored.get('overworld', 3, 70, -5)?.col, 1);
  equal('两次序列化一致', JSON.stringify(serializePaintings(restored)), JSON.stringify(saved));

  // 坏条目
  const broken = [
    { dimension: 'overworld', x: 0, y: 64, z: 0, name: 'match', rightX: 1, rightZ: 0 },
    { dimension: 'moon', x: 0, y: 64, z: 0, name: 'match', rightX: 1, rightZ: 0 },
    { dimension: 'overworld', x: 0, y: 64, z: 0, name: 'nope', rightX: 1, rightZ: 0 },
    { dimension: 'overworld', x: 'x', y: 64, z: 0, name: 'match', rightX: 1, rightZ: 0 },
    'nope',
  ];
  const salvage = new PaintingStore();
  equal('只有第一条活下来', restorePaintings(salvage, broken), 1);
  equal('表里 4 格（2×2）', salvage.size, 4);
  equal('不是数组也不崩', restorePaintings(salvage, 'oops'), 0);
  equal('null 也不崩', restorePaintings(salvage, null), 0);
}

console.log('\n[键的写法]');
{
  equal('带维度前缀', paintingCellKey('overworld', 1, 2, 3), 'overworld|1,2,3');
  check('不同维度的同名坐标是两个键', paintingCellKey('overworld', 1, 2, 3) !== paintingCellKey('nether', 1, 2, 3));
}

console.log(`\n多格画测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
