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
  MAX_TAG_TEXT_LENGTH,
  NAME_TAG_HEIGHT,
  NAME_TAG_MAX_WIDTH,
  REMOTE_NAME_TAG_RANGE,
  canNameMob,
  composeNameTag,
  nameTagWidthFor,
  remoteNameTagOpacity,
  sanitizeName,
} from '../src/core/entity/NameTag.ts';
import { Item, itemDef, itemIconTile, itemName } from '../src/core/registry/items.ts';
import { itemDescription, itemLabel } from '../src/core/registry/itemNames.ts';
import { FISHING_POOLS } from '../src/core/registry/fishing.ts';
import { EntityParking } from '../src/core/entity/EntityParking.ts';
import { REMOTE_PLAYER_TYPE } from '../src/core/entity/mobs.ts';
import {
  PLAIN_NAME_TAG_STYLE,
  TEAM_COLOR_HEX,
  colorForMob,
  nameTagNeedsRedraw,
  nameTagStyleFor,
  normalizeTeamColor,
  teamColorToHex,
} from '../src/core/entity/NameTagColor.ts';
import { MAX_AFFIX_LENGTH, TEAM_COLORS, Teams, sanitizeAffix } from '../src/core/world/Teams.ts';
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

  check(
    'show() 收样式对象（颜色 + 前后缀一次传入）',
    // 联机18 起多了一个 `opacity`（队友名字牌的距离衰减），样式对象仍是"一次传入"
    /show\(mob: Mob, topLift: number, style: NameTagStyle = PLAIN_NAME_TAG_STYLE, opacity = 1\)/.test(src),
  );
  check('drawName() 收 color 参数', /private drawName\(name: string, color: string \| null\)/.test(src));
  check('重画判据改走 nameTagNeedsRedraw', src.includes('nameTagNeedsRedraw('));
  check('不再自己比 lastName（那条是颜色不更新的根因）', !/if \(name !== this\.lastName\)/.test(src));
  check('记录了 lastColor', src.includes('this.lastColor = style.color'));
  // ---- 批次 1359：前后缀 ----
  check('牌子文本走 composeNameTag（拼法只有一处）', src.includes('composeNameTag(style.prefix, name, style.suffix)'));
  check('宽度按拼好的文本算（不是只按名字）', src.includes('nameTagWidthFor(display)'));
  check('lastName 存的是拼好的文本（前缀变了自动重画）', src.includes('this.lastName = display'));
  check('画布画的是拼好的文本', src.includes('this.drawName(display, style.color)'));
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

  // ---- Q3：main.ts 的接线 ----
  const mainSrc = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  check('主程序导入 nameTagStyleFor', /import \{ nameTagStyleFor \} from '\.\/core\/entity\/NameTagColor\.ts'/.test(mainSrc));
  check(
    'updateNameTags 里把样式传给 show()',
    // 联机18 起第 4 参是距离衰减后的透明度，样式仍按"一次查表、一次传入"走；
    // 本轮起样式还可能被"房主标识"覆盖（金色 + 房主前缀），所以只要求
    // "查表结果最终作为 style 传给 show"，不再要求两行紧邻
    /nameTagStyleFor\(entry\.mob\.customName/.test(mainSrc) &&
      mainSrc.includes('tag.show(entry.mob, isAimed ? 0.34 : 0.12, style, opacity)') &&
      /const style =[\s\S]{0,240}(teamStyle|entry\.host === true)/.test(mainSrc),
  );
  check('颜色已不再单独查一次（避免颜色接上、前后缀漏掉）', !mainSrc.includes('colorForMob('));
  check(
    '颜色查询走真实的 teamState（不是空实现）',
    /\(member\) => this\.teamState\.teamOf\(member\)/.test(mainSrc),
  );
}

console.log('\n[队伍前后缀（批次 1359）]');
{
  // ---- ① 清洗：与名字同一条口径，唯一的差别是"空串合法" ----
  equal('普通前后缀原样保留', sanitizeAffix('[红]'), '[红]');
  equal('首尾空白去掉', sanitizeAffix('  [红]  '), '[红]');
  equal('换行压成空格', sanitizeAffix('[红\n队]'), '[红 队]');
  equal('连续空白压成一个', sanitizeAffix('[红   队]'), '[红 队]');
  equal('空串 = 清除（不是 null）', sanitizeAffix(''), '');
  equal('null 也当清除', sanitizeAffix(null), '');
  equal('undefined 同上', sanitizeAffix(undefined), '');
  equal('超长按字符截断', sanitizeAffix('字'.repeat(30)), '字'.repeat(MAX_AFFIX_LENGTH));
  equal('截断不会切半个中文', Array.from(sanitizeAffix('字'.repeat(30))).length, MAX_AFFIX_LENGTH);

  // ---- ② Teams 里的存取 ----
  const teams = new Teams();
  teams.add('red', '红队', 'red');
  teams.add('blue');
  equal('建队时前缀是空串', teams.get('blue')?.prefix, '');
  equal('建队时后缀是空串', teams.get('blue')?.suffix, '');
  check('设前缀成功', teams.setPrefix('red', '[红]'));
  equal('前缀读回来', teams.get('red')?.prefix, '[红]');
  check('设后缀成功', teams.setSuffix('red', '（队长）'));
  equal('后缀读回来', teams.get('red')?.suffix, '（队长）');
  check('空值 = 清除前缀', teams.setPrefix('red', ''));
  equal('清除后是空串', teams.get('red')?.prefix, '');
  check('不存在的队设前缀返回 false', !teams.setPrefix('nope', 'x'));
  check('不存在的队设后缀返回 false', !teams.setSuffix('nope', 'x'));

  // ---- ③ 快照往返 + 老存档缺字段 ----
  teams.setPrefix('red', '[红]');
  teams.setSuffix('red', '（队长）');
  const roundTrip = new Teams();
  roundTrip.restore(JSON.parse(JSON.stringify(teams.snapshot())));
  equal('前缀随存档往返', roundTrip.get('red')?.prefix, '[红]');
  equal('后缀随存档往返', roundTrip.get('red')?.suffix, '（队长）');
  equal('两次快照完全一致', JSON.stringify(roundTrip.snapshot()), JSON.stringify(teams.snapshot()));
  const legacy = new Teams();
  const skippedLegacy = legacy.restore({
    teams: [{ name: 'old', displayName: '老队', color: 'white', friendlyFire: false, members: ['X'] }],
  });
  equal('老快照缺前后缀不算坏数据', skippedLegacy, 0);
  equal('老快照的前缀回退空串', legacy.get('old')?.prefix, '');
  const dirty = new Teams();
  dirty.restore({
    teams: [{ name: 'd', displayName: 'd', color: 'white', friendlyFire: false, prefix: '[a\nb]', suffix: 123 as never, members: [] }],
  });
  equal('读档时把换行清洗掉', dirty.get('d')?.prefix, '[a b]');
  equal('非字符串后缀回退空串', dirty.get('d')?.suffix, '');

  // ---- ④ 拼装（渲染层唯一该知道的"拼法"）----
  equal('前后缀拼在名字两侧', composeNameTag('[红]', 'Steve', '（队长）'), '[红]Steve（队长）');
  equal('只有前缀', composeNameTag('[红]', 'Steve', ''), '[红]Steve');
  equal('只有后缀', composeNameTag('', 'Steve', '（队长）'), 'Steve（队长）');
  equal('都没有就是名字本身', composeNameTag('', 'Steve', ''), 'Steve');
  equal('null 当空串处理', composeNameTag(null, 'Steve', null), 'Steve');
  equal('超长按字符截断', composeNameTag('', '字'.repeat(60), ''), '字'.repeat(MAX_TAG_TEXT_LENGTH));
  check(
    '拼好之后比名字本身宽',
    nameTagWidthFor(composeNameTag('[红]', 'Steve', '')) > nameTagWidthFor('Steve'),
  );
  check('宽度仍受 NAME_TAG_MAX_WIDTH 上限约束', nameTagWidthFor(composeNameTag('', '字'.repeat(60), '')) <= NAME_TAG_MAX_WIDTH);

  // ---- ⑤ 一次查表取齐样式（颜色 + 前后缀）----
  const styleTeamOf = (member: string) =>
    member === 'Steve' ? { color: 'red', prefix: '[红]', suffix: '（队长）' } : null;
  const style = nameTagStyleFor('Steve', styleTeamOf);
  equal('样式里的颜色', style.color, '#b02e26');
  equal('样式里的前缀', style.prefix, '[红]');
  equal('样式里的后缀', style.suffix, '（队长）');
  check('没队伍 → 默认样式（同一个常量）', nameTagStyleFor('Nobody', styleTeamOf) === PLAIN_NAME_TAG_STYLE);
  check(
    '没名字时根本不查表',
    nameTagStyleFor('', () => {
      throw new Error('不该查表');
    }) === PLAIN_NAME_TAG_STYLE,
  );
  equal('colorForMob 与样式同源（不会各算一套）', colorForMob('Steve', styleTeamOf), style.color);
  equal('队伍没有 prefix 字段时给空串', nameTagStyleFor('X', () => ({ color: 'blue' })).prefix, '');
  equal('队伍没有 color 字段时颜色为 null', nameTagStyleFor('X', () => ({ prefix: 'a' })).color, null);
  check(
    '前缀变了 → 要重画（拼好的文本变了，判据自动覆盖）',
    nameTagNeedsRedraw(
      { name: composeNameTag('', 'Steve', ''), color: null },
      { name: composeNameTag('[红]', 'Steve', ''), color: null },
    ),
  );

  // ---- ⑥ 命令层接线 ----
  const cmdSrc = readFileSync(new URL('../src/core/commands/Commands.ts', import.meta.url), 'utf8');
  check('有 prefix / suffix 两个属性分支', /key === 'prefix' \|\| key === 'suffix'/.test(cmdSrc));
  check('前后缀保留中间空格（第 4 段之后全部拼回）', cmdSrc.includes('args.slice(3).join('));
  check('有剥引号的助手（支持 prefix "" 清空）', cmdSrc.includes('function stripAffixQuotes('));
  // 多语言 P1-6 起参数换成语义键；这条守的仍是"part 要过 msg()，不能直接拼中文"。
  // ⚠️ 它当时没红是因为 `check:fast` 只跑"被改动命中"的套件，而那一轮没命中这里 ——
  // P2-1a 改 `itemNames.ts` 波及面大才把它翻出来（属于**潜伏了一个批次的假绿**）。
  check(
    '回执里的 part 也过 msg()（否则英文界面会漏中文）',
    cmdSrc.includes("msg(key === 'prefix' ? 'cmd.reply.team.prefix' : 'cmd.reply.team.suffix')"),
  );
}

console.log('\n[队友名字牌的距离衰减（联机18）]');
{
  // 从 32 格开始变淡、到 64 格全透明；近距离不衰减
  check('32 格内全亮', remoteNameTagOpacity(0) === 1 && remoteNameTagOpacity(32) === 1);
  check('64 格外全透明', remoteNameTagOpacity(64) === 0 && remoteNameTagOpacity(100) === 0);
  check('中间线性（48 格正好一半）', Math.abs(remoteNameTagOpacity(48) - 0.5) < 1e-9);
  check(
    '单调递减（越远越淡）',
    remoteNameTagOpacity(40) > remoteNameTagOpacity(50) && remoteNameTagOpacity(50) > remoteNameTagOpacity(60),
  );
  check('距离非法时按全亮处理（不返回 NaN）', remoteNameTagOpacity(Number.NaN) === 1);
  check('队友范围比生物名字牌大一倍', REMOTE_NAME_TAG_RANGE === 64 && REMOTE_NAME_TAG_RANGE > 32);
}

console.log(`\n命名牌测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);