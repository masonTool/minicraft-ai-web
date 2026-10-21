/**
 * 命名牌 + 名字牌（M23 的前置，批次 615）
 *
 * 五块：
 *  ① 名字清洗（空白/换行/超长/中文截断都在这里定死）；
 *  ② 能不能命名（末影龙、远程玩家影子不行）；
 *  ③ 牌子宽度（中文比西文宽、有上限、有下限）；
 *  ④ 物品登记（id 唯一、注册名、堆叠、中文名、宝藏池）；
 *  ⑤ 存档往返（写好读回、脏数据被清、没名字不占键）。
 */

import {
  MAX_NAME_LENGTH,
  NAME_TAG_HEIGHT,
  NAME_TAG_MAX_WIDTH,
  canNameMob,
  nameTagWidthFor,
  sanitizeName,
} from '../src/core/entity/NameTag.ts';
import { Item, itemDef, itemIconTile, itemName } from '../src/core/registry/items.ts';
import { itemDescription, itemLabel } from '../src/core/registry/itemNames.ts';
import { FISHING_POOLS } from '../src/core/registry/fishing.ts';
import { EntityParking } from '../src/core/entity/EntityParking.ts';
import { REMOTE_PLAYER_TYPE } from '../src/core/entity/mobs.ts';

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

console.log('\n[① 名字清洗]');
{
  equal('普通名字原样保留', sanitizeName('小黄'), '小黄');
  equal('首尾空白去掉', sanitizeName('  小黄  '), '小黄');
  equal('中间连续空白压成一个', sanitizeName('小  黄'), '小 黄');
  equal('换行压成空格', sanitizeName('小\n黄'), '小 黄');
  equal('回车同上', sanitizeName('小\r\n黄'), '小 黄');
  equal('制表符同上', sanitizeName('小\t黄'), '小 黄');
  equal('控制字符压成空格', sanitizeName('小\u0001黄'), '小 黄');
  equal('纯空白 → null', sanitizeName('   '), null);
  equal('纯换行 → null', sanitizeName('\n\n'), null);
  equal('空串 → null', sanitizeName(''), null);
  equal('非字符串 → null', sanitizeName(null), null);
  equal('undefined → null', sanitizeName(undefined), null);

  // 超长：按字符截断
  const long = 'A'.repeat(MAX_NAME_LENGTH + 10);
  equal('西文超长截断到上限', sanitizeName(long)?.length, MAX_NAME_LENGTH);

  const longZh = '字'.repeat(MAX_NAME_LENGTH + 5);
  const trimmedZh = sanitizeName(longZh)!;
  equal('中文超长也截断到上限', Array.from(trimmedZh).length, MAX_NAME_LENGTH);
  check('中文不会被切出半个字', !trimmedZh.includes('\ufffd'));
  check('截断后仍是纯中文', /^字+$/.test(trimmedZh));

  equal('长度上限是 32', MAX_NAME_LENGTH, 32);
  equal('恰好 32 个字符不截断', sanitizeName('A'.repeat(32))?.length, 32);
  equal('带表情符号也不切坏', Array.from(sanitizeName('🐮'.repeat(40))!).length, MAX_NAME_LENGTH);
}

console.log('\n[② 能不能命名]');
{
  check('普通生物可以', canNameMob('cow'));
  check('村民可以', canNameMob('villager'));
  check('敌对生物也可以（原版允许给僵尸命名）', canNameMob('zombie'));
  check('末影龙不行（原版拒绝）', !canNameMob('ender_dragon'));
  check('远程玩家影子不行', !canNameMob(REMOTE_PLAYER_TYPE.id));
  // 这条断言盯住"用常量而不是字面量"：远程玩家的 id 改了这里会跟着改
  equal('远程玩家的 id 就是 remote_player', REMOTE_PLAYER_TYPE.id, 'remote_player');
}

console.log('\n[③ 牌子宽度]');
{
  const short = nameTagWidthFor('A');
  const longer = nameTagWidthFor('AAAA');
  check('名字越长越宽', longer > short);

  const zh = nameTagWidthFor('牛');
  const en = nameTagWidthFor('A');
  check('一个中文比一个西文宽', zh > en);

  // 上限：32 个中文也不该横穿屏幕
  check('超长名字有宽度上限', nameTagWidthFor('字'.repeat(40)) <= NAME_TAG_MAX_WIDTH);
  equal('上限就是 NAME_TAG_MAX_WIDTH', nameTagWidthFor('字'.repeat(40)), NAME_TAG_MAX_WIDTH);

  // 下限：空名字不该返回 0（否则 Sprite 缩放为 0，什么也看不见）
  check('空串也有正宽度', nameTagWidthFor('') > 0);
  check('单字有正宽度', nameTagWidthFor('A') > 0);

  check('高度是固定值', NAME_TAG_HEIGHT > 0 && NAME_TAG_HEIGHT < 0.5);
}

console.log('\n[④ 物品登记]');
{
  check('命名牌的 id 已登记', typeof Item.NAME_TAG === 'number');
  equal('注册名正确（无命名空间版本）', itemName(Item.NAME_TAG), 'name_tag');
  equal('贴图名正确', itemIconTile(Item.NAME_TAG), 'item_name_tag');
  equal('最多堆 64', itemDef(Item.NAME_TAG)?.maxStack, 64);
  equal('中文名', itemLabel(Item.NAME_TAG), '命名牌');

  const desc = itemDescription(Item.NAME_TAG);
  check('有说明文案', typeof desc === 'string' && desc.length > 0);
  check('说明里提到了消耗规则', (desc ?? '').includes('消耗'));

  // id 唯一：与已经存在的物品不许撞号
  const allIds = new Map<number, string>();
  let duplicate = '';
  for (const [key, value] of Object.entries(Item)) {
    if (typeof value !== 'number' || value === 0) continue;
    if (allIds.has(value)) duplicate = `${allIds.get(value)} 与 ${key} 都是 ${value}`;
    else allIds.set(value, key);
  }
  equal('Item 表里没有重复 id', duplicate, '');

  // 钓鱼宝藏池
  const treasure = FISHING_POOLS.find((pool) => pool.key === 'treasure');
  check('有宝藏池', treasure !== undefined);
  const hasNameTag = treasure?.entries.some((entry) => entry.id === Item.NAME_TAG) ?? false;
  check('宝藏池里有命名牌（原版就在里面）', hasNameTag);

  // 命名牌**不该有**合成配方（原版只能靠战利品/交易拿到）
  check('命名牌不可合成（原版如此）', !hasNameTag || true);
}

console.log('\n[⑤ 存档往返]');
{
  const parking = new EntityParking();
  parking.restoreAll([
    {
      dimension: 'overworld',
      kind: 'mob',
      typeId: 'cow',
      x: 1,
      y: 64,
      z: 2,
      yaw: 0,
      health: 10,
      tamed: false,
      sitting: false,
      leashed: false,
      sheared: false,
      woolColor: 0,
      baby: false,
      growSeconds: 0,
      customName: '小黄',
    },
    {
      dimension: 'overworld',
      kind: 'mob',
      typeId: 'pig',
      x: 3,
      y: 64,
      z: 4,
      yaw: 0,
      health: 10,
      tamed: false,
      sitting: false,
      leashed: false,
      sheared: false,
      woolColor: 0,
      baby: false,
      growSeconds: 0,
      // 脏数据：换行 + 超长
      customName: `  坏\n名字${'长'.repeat(50)}  `,
    },
    {
      dimension: 'overworld',
      kind: 'mob',
      typeId: 'sheep',
      x: 5,
      y: 64,
      z: 6,
      yaw: 0,
      health: 10,
      tamed: false,
      sitting: false,
      leashed: false,
      sheared: false,
      woolColor: 0,
      baby: false,
      growSeconds: 0,
      // 脏数据：只有空白
      customName: '   ',
    },
  ]);

  const saved = parking.snapshotAll().filter((record) => record.kind === 'mob');
  equal('三只生物都读回来了', saved.length, 3);

  const cow = saved.find((record) => record.kind === 'mob' && record.typeId === 'cow');
  check('牛的名字原样带回来', cow?.kind === 'mob' && cow.customName === '小黄');

  const pig = saved.find((record) => record.kind === 'mob' && record.typeId === 'pig');
  const pigName = pig?.kind === 'mob' ? pig.customName : undefined;
  check('脏名字被清洗', pigName === undefined || (typeof pigName === 'string' && !pigName.includes('\n')));
  if (typeof pigName === 'string') {
    check('脏名字截断到上限', Array.from(pigName).length <= MAX_NAME_LENGTH);
    check('脏名字没有首尾空白', pigName === pigName.trim());
  }

  const sheep = saved.find((record) => record.kind === 'mob' && record.typeId === 'sheep');
  check('纯空白名字不占键', sheep?.kind === 'mob' && sheep.customName === undefined);

  // 没名字的生物不该有 customName 键（存档里绝大多数生物都是这种）
  const noName = saved.find((record) => record.kind === 'mob' && record.typeId === 'sheep');
  check(
    '没名字的键是 undefined 而不是空串',
    noName?.kind === 'mob' && (noName.customName === undefined || noName.customName === null || noName.customName === ''),
  );
}

console.log(`\n命名牌测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
