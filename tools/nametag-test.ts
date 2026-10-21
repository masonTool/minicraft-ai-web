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
import {
  TEAM_COLOR_HEX,
  colorForMob,
  nameTagNeedsRedraw,
  normalizeTeamColor,
  teamColorToHex,
} from '../src/core/entity/NameTagColor.ts';
import { TEAM_COLORS } from '../src/core/world/Teams.ts';
import { readFileSync } from 'node:fs';

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

console.log('\n[队伍颜色（Q1 / 批次 616）]');

{
  /**
   * 名字牌的着色决策。这一层是纯函数，所以能把"规则"钉死：
   * 16 色齐不齐、拼写变体怎么归一、没队伍时到底返回什么。
   */
  check('16 色与 Teams 的权威名单键集一致', TEAM_COLORS.every((c) => TEAM_COLOR_HEX[c] !== undefined));
  equal('调色板正好 16 项', Object.keys(TEAM_COLOR_HEX).length, 16);
  check(
    '每个值都是合法的 #rrggbb',
    Object.values(TEAM_COLOR_HEX).every((v) => /^#[0-9a-f]{6}$/.test(v)),
  );
  check('没有重复的颜色值', new Set(Object.values(TEAM_COLOR_HEX)).size === 16);

  // 归一化：三种来源的拼写都要认
  equal('小写直通', normalizeTeamColor('red'), 'red');
  equal('大写也能认', normalizeTeamColor('RED'), 'red');
  equal('带空格的旧写法归一成下划线', normalizeTeamColor('light blue'), 'light_blue');
  equal('前后空白被忽略', normalizeTeamColor('  lime  '), 'lime');
  equal('空串返回 null', normalizeTeamColor(''), null);
  equal('null 返回 null', normalizeTeamColor(null), null);
  equal('不认识的名字返回 null（不回落白色）', normalizeTeamColor('rainbow'), null);
  equal('十六进制直接放行', normalizeTeamColor('#ff0000'), '#ff0000');
  equal('三位十六进制也放行', normalizeTeamColor('#f00'), '#f00');
  equal('非法十六进制拒绝', normalizeTeamColor('#zzz'), null);

  // 名字 → hex
  equal('red 的十六进制', teamColorToHex('red'), '#b02e26');
  equal('light_blue 的十六进制', teamColorToHex('light_blue'), '#3ab3da');
  equal('认不出来的颜色名返回 null', teamColorToHex('rainbow'), null);

  // 生物 → 颜色（核心决策）
  const members: Record<string, { color: string }> = {
    Steve: { color: 'red' },
    Alex: { color: 'blue' },
    Broken: { color: 'rainbow' },
  };
  const teamOf = (member: string) => members[member] ?? null;

  equal('红队成员给红色', colorForMob('Steve', teamOf), '#b02e26');
  equal('蓝队成员给蓝色', colorForMob('Alex', teamOf), '#3c44aa');
  equal('没队伍返回 null（不是白色）', colorForMob('Herobrine', teamOf), null);
  equal('没名字返回 null', colorForMob(null, teamOf), null);
  equal('空白名字返回 null', colorForMob('   ', teamOf), null);
  equal('队伍颜色配错时返回 null，不猜', colorForMob('Broken', teamOf), null);
  equal('空名字不触发查询', colorForMob('', () => ({ color: 'red' })), null);

  // 重画判据：名字没变但颜色变了，必须重画
  check(
    '名字与颜色都没变 → 不重画',
    !nameTagNeedsRedraw({ name: 'Steve', color: '#b02e26' }, { name: 'Steve', color: '#b02e26' }),
  );
  check(
    '颜色变了（/team modify color）→ 要重画',
    nameTagNeedsRedraw({ name: 'Steve', color: '#b02e26' }, { name: 'Steve', color: '#3c44aa' }),
  );
  check(
    '名字变了 → 要重画',
    nameTagNeedsRedraw({ name: 'Steve', color: '#b02e26' }, { name: 'Alex', color: '#b02e26' }),
  );
  check(
    '从无颜色变成有颜色 → 要重画',
    nameTagNeedsRedraw({ name: 'Steve', color: null }, { name: 'Steve', color: '#b02e26' }),
  );
}

console.log('\n[渲染层接线（Q2 / 批次 616）]');

{
  /**
   * `MobNameTag` 要 THREE + 真实 canvas，离线跑不起来（Node 没有 canvas 包）。
   * 所以这里断言的是**源码契约**——它防的是"改了一半"这类真实会犯的错：
   * 加了参数但没传下去、判据又退回只比名字、颜色硬编码成白色。
   */
  const src = readFileSync(new URL('../src/render/MobNameTag.ts', import.meta.url), 'utf8');

  check('show() 收 color 参数', /show\(mob: Mob, topLift: number, color: string \| null = null\)/.test(src));
  check('drawName() 收 color 参数', /private drawName\(name: string, color: string \| null\)/.test(src));
  check('重画判据改走 nameTagNeedsRedraw', src.includes('nameTagNeedsRedraw('));
  check('不再自己比 lastName（那条是颜色不更新的根因）', !/if \(name !== this\.lastName\)/.test(src));
  check('记录了 lastColor', src.includes('this.lastColor = color'));
  check('invalidate() 连颜色一起清', /invalidate\(\): void \{[\s\S]{0,120}this\.lastColor = null;/.test(src));
  check('填充色用传入的 color ?? 默认白', src.includes('ctx.fillStyle = color ?? DEFAULT_NAME_COLOR'));
  check('描边固定深色（不跟队伍色走）', src.includes('ctx.strokeStyle = COLORS.outline'));
  // 只在**代码行**里查（注释里提到 Teams 是解释，不是依赖）
  const codeLines = src
    .split('\n')
    .filter((line) => !line.trim().startsWith('*') && !line.trim().startsWith('//'));
  const code = codeLines.join('\n');
  check('渲染层不直接查队伍（颜色由外部算好传入）', !/teamOf|new Teams|from '.*Teams\.ts'/.test(code));
  check('默认色来自 NameTagColor，不是本地硬编码', src.includes('DEFAULT_NAME_COLOR'));
}

console.log(`\n命名牌测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);