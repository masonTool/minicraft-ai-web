/**
 * 织布机离线测试（J25，批次 503）
 *
 * 织布机把"图案"从方块状态搬到**物品数据**之后，规则只剩三件事：
 *  ① 什么能印（旗帜 + 染料 + 没印过的图案）；
 *  ② 扣材料时**只扣一件**（不能一面染料染整叠 64 面旗）；
 *  ③ 成品能不能带走（它是算出来的格子：拆机器不许倒出来）。
 *
 * 运行：npm run test:loom
 */

import { Block } from '../src/core/registry/blocks.ts';
import { DYE_ITEM_START } from '../src/core/registry/items.ts';
import {
  LOOM_BANNER,
  LOOM_DYE,
  LOOM_PATTERNS,
  Loom,
  isDyeItem,
  loomBlocker,
} from '../src/core/container/Loom.ts';
import { restoreStack } from '../src/core/container/Inventory.ts';
import { CONTAINER_BLOCKS, BlockEntityStore } from '../src/core/world/BlockEntityStore.ts';
import { SLOT_COUNTS, kindOf, restoreContainers, serializeContainer } from '../src/core/save/ContainerSave.ts';

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

const RED_DYE = DYE_ITEM_START + 14; // 配色表里红色排在最后一位
const WHITE_DYE = DYE_ITEM_START;

// ---------------------------------------------------------------- 1. 染料与图案表

console.log('\n[染料与图案表]');
{
  check('第一件染料是染料', isDyeItem(WHITE_DYE));
  check('最后一件染料（红）是染料', isDyeItem(RED_DYE));
  check('染料区之后不是染料', !isDyeItem(DYE_ITEM_START + 16));
  check('染料区之前不是染料', !isDyeItem(DYE_ITEM_START - 1));
  check('石头不是染料', !isDyeItem(Block.STONE));

  equal('图案列表有 4 种', LOOM_PATTERNS.length, 4);
  check('图案从 1 开始、到 4 结束（0 是光板，不在列表里）', LOOM_PATTERNS[0] === 1 && LOOM_PATTERNS[3] === 4);
}

// ---------------------------------------------------------------- 2. 印不印得了

console.log('\n[印不印得了：六种拒绝]');
{
  const banner = { id: Block.RED_BANNER, count: 1 };
  const dye = { id: RED_DYE, count: 1 };

  equal('没旗帜', loomBlocker(null, dye, 1, null), '先放一面旗帜');
  equal('旗帜格里不是旗帜', loomBlocker({ id: Block.STONE, count: 1 }, dye, 1, null), '这一格只收旗帜');
  equal('图案 0 不在列表里', loomBlocker(banner, dye, 0, null), '没有这种图案');
  equal('越界图案', loomBlocker(banner, dye, 5, null), '没有这种图案');
  equal('小数图案', loomBlocker(banner, dye, 1.5, null), '没有这种图案');
  equal('已经就是这个图案', loomBlocker({ ...banner, bannerPattern: 3 }, dye, 3, null), '这面旗帜已经是这个图案了');
  equal('没染料', loomBlocker(banner, null, 1, null), '还需要 1 个染料');
  equal('染料格里不是染料', loomBlocker(banner, { id: Block.STONE, count: 1 }, 1, null), '染料格里得放染料');
  equal(
    '成品格里是另一种颜色的旗',
    loomBlocker(banner, dye, 1, { id: Block.BLUE_BANNER, count: 1, bannerPattern: 1 }),
    '先把成品格里的东西拿走',
  );
  equal(
    '成品格里是另一种图案',
    loomBlocker(banner, dye, 1, { id: Block.RED_BANNER, count: 1, bannerPattern: 2 }),
    '成品格里是另一种图案',
  );
  equal(
    '成品格满了',
    loomBlocker(banner, dye, 1, { id: Block.RED_BANNER, count: 64, bannerPattern: 1 }),
    '成品格已经满了',
  );
  equal('都对就放行', loomBlocker(banner, dye, 1, { id: Block.RED_BANNER, count: 2, bannerPattern: 1 }), null);
}

// ---------------------------------------------------------------- 3. 印一件

console.log('\n[印一件：扣一面旗 + 一个染料]');
{
  const loom = new Loom();
  loom.set(LOOM_BANNER, { id: Block.RED_BANNER, count: 5 });
  loom.set(LOOM_DYE, { id: RED_DYE, count: 2 });

  const result = loom.applyPattern(2);
  check('第一件印成功', result.ok);
  equal('旗帜剩 4 面', loom.banner?.count, 4);
  equal('染料剩 1 个', loom.dye?.count, 1);
  equal('成品是 1 面', loom.output?.count, 1);
  equal('成品的图案对', loom.output?.bannerPattern, 2);
  equal('成品颜色跟旗帜走', loom.output?.id, Block.RED_BANNER);
  check('整叠旗本身没被改图案（只有成品那一件有）', loom.banner?.bannerPattern === undefined);
  check('成品是新对象（不是把槽里那份交出去）', result.ok && result.output !== loom.banner);

  const second = loom.applyPattern(2);
  check('再印一件成功', second.ok);
  equal('成品堆到 2 面', loom.output?.count, 2);
  equal('旗帜剩 3 面', loom.banner?.count, 3);
  equal('染料用完就清空格子', loom.dye, null);
  equal('染料格清空后成品不受影响', loom.output?.count, 2);

  const third = loom.applyPattern(2);
  check('没染料了印不了', !third.ok);
  equal('拒绝原因', third.ok ? '' : third.reason, '还需要 1 个染料');
  equal('拒绝时旗帜不动', loom.banner?.count, 3);
  equal('拒绝时成品不动', loom.output?.count, 2);
}

console.log('\n[印一件：拒绝时一格都不动]');
{
  const loom = new Loom();
  loom.set(LOOM_BANNER, { id: Block.STONE, count: 3 });
  loom.set(LOOM_DYE, { id: RED_DYE, count: 3 });
  const result = loom.applyPattern(1);
  check('石头印不了', !result.ok);
  equal('石头数量不变', loom.banner?.count, 3);
  equal('染料数量不变', loom.dye?.count, 3);
  equal('没有成品', loom.output, null);

  const same = new Loom();
  same.set(LOOM_BANNER, { id: Block.RED_BANNER, count: 1, bannerPattern: 3 });
  same.set(LOOM_DYE, { id: RED_DYE, count: 1 });
  check('已经是这个图案时拒绝', !same.applyPattern(3).ok);
  equal('拒绝时不扣染料', same.dye?.count, 1);
}

// ---------------------------------------------------------------- 4. 存档与注册

console.log('\n[存档与注册]');
{
  const loom = new Loom();
  loom.set(LOOM_BANNER, { id: Block.RED_BANNER, count: 4 });
  loom.set(LOOM_DYE, { id: WHITE_DYE, count: 1 });
  loom.applyPattern(1);

  equal('容器种类', kindOf(loom), 'loom');
  equal('三格', SLOT_COUNTS.loom, 3);
  check('织布机在"活塞推不动"的名单里', CONTAINER_BLOCKS.has(Block.LOOM));

  const data = serializeContainer(loom, 'overworld', 1, 64, 2);
  check('有内容才写存档', data !== null);
  equal('存的是 loom', data?.kind, 'loom');
  equal('三格都写进去', data?.stacks.length, 3);

  const store = new BlockEntityStore();
  restoreContainers(store, data ? [data] : []);
  const restored = store.getLoom('overworld', 1, 64, 2);
  check('读档后拿得到织布机', restored !== undefined);
  equal('旗帜数量还在', restored?.banner?.count, 3);
  equal('成品图案还在', restored?.output?.bannerPattern, 1);
  equal('染料格清空了', restored?.dye, null);
}

console.log('\n[按坐标取同一个实例]');
{
  const store = new BlockEntityStore();
  const first = store.getOrCreateLoom('overworld', 0, 64, 0);
  const second = store.getOrCreateLoom('overworld', 0, 64, 0);
  check('同一个坐标拿到同一台', first === second);
  check('不同坐标是另一台', store.getOrCreateLoom('overworld', 1, 64, 0) !== first);
}

console.log('\n[成品可以带图案回到背包]');
{
  const loom = new Loom();
  loom.set(LOOM_BANNER, { id: Block.RED_BANNER, count: 1 });
  loom.set(LOOM_DYE, { id: RED_DYE, count: 1 });
  loom.applyPattern(4);
  const output = loom.output!;
  // 背包/掉落物都走 restoreStack；图案必须过得了白名单
  const back = restoreStack({ ...output });
  equal('restoreStack 保住图案', back?.bannerPattern, 4);
  equal('restoreStack 保住颜色', back?.id, Block.RED_BANNER);
}

console.log(`\n织布机测试：${passed} 通过 / ${failed} 失败\n`);
if (failed > 0) process.exit(1);
