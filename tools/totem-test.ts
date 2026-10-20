/**
 * 不死图腾（批次 498，B18）
 *
 * 五块：
 *  ① 触发判据（**致死才救**——半血挨打不能白烧一个）；
 *  ② 救完的数值（留 1 滴血 + 40 秒生命恢复 II）；
 *  ③ 音效（三个上行音、包络首尾归零）；
 *  ④ 物品（id / 不能叠 / 中文名 / 贴图在图集里）；
 *  ⑤ 与世界的接线（唤魔者掉它、`applyIncomingDamage` 里先确认再回血）。
 */

import {
  TOTEM_REGENERATION,
  TOTEM_RESCUE_HEALTH,
  shouldRescueWithTotem,
  totemSoundSpec,
} from '../src/core/items/Totem.ts';
import { Item, itemDef } from '../src/core/registry/items.ts';
import { itemLabel } from '../src/core/registry/itemNames.ts';
import { TILE_ORDER } from '../src/render/atlasLayout.ts';
import { MOB_TYPES } from '../src/core/entity/mobs.ts';
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

console.log('\n[触发判据：致死才救]');
{
  equal('致命伤 + 有图腾 → 救', shouldRescueWithTotem(0, true, 'generic'), true);
  equal('致命伤 + 没图腾 → 不救（死亡照常）', shouldRescueWithTotem(0, false, 'generic'), false);
  equal('半血 + 有图腾 → 不救（不能白烧）', shouldRescueWithTotem(8, true, 'generic'), false);
  equal('刚好多 1 滴血 + 有图腾 → 不救', shouldRescueWithTotem(1, true, 'fall'), false);
  equal('负数血量（溢出伤害）也算致命', shouldRescueWithTotem(-5, true, 'explosion'), true);

  // 每种死因都能救（原版也是）
  const causes = [
    'generic',
    'fall',
    'fire',
    'drown',
    'starve',
    'explosion',
    'poison',
    'wither',
    'lightning',
    'void',
    'lava',
    'cactus',
    'suffocate',
    'projectile',
  ] as const;
  let rescued = 0;
  for (const cause of causes) {
    if (shouldRescueWithTotem(0, true, cause)) rescued++;
  }
  equal('十四种死因都能救', rescued, causes.length);
}

console.log('\n[救完的数值]');
{
  equal('留 1 滴血', TOTEM_RESCUE_HEALTH, 1);
  equal('生命恢复 40 秒', TOTEM_REGENERATION.seconds, 40);
  equal('生命恢复 II 级（amplifier 1）', TOTEM_REGENERATION.amplifier, 1);
}

console.log('\n[音效：三个上行音]');
{
  const spec = totemSoundSpec();
  equal('三层', spec.layers.length, 3);
  check('都是音调层', spec.layers.every((layer) => layer.t === 'tone'));
  const hz = spec.layers.map((layer) => (layer.t === 'tone' ? layer.hz : 0));
  check('频率逐层上行', hz[0]! < hz[1]! && hz[1]! < hz[2]!, hz.map((value) => value.toFixed(0)).join(','));
  check(
    '包络首尾归零（不会"啪"一声）',
    spec.layers.every((layer) => layer.env[0]![1] === 0 && layer.env[layer.env.length - 1]![1] === 0),
  );
  check('三层错开（不是同时响）', spec.layers[1]!.at > spec.layers[0]!.at, `${spec.layers[0]!.at} → ${spec.layers[1]!.at}`);
  equal('不抖动', spec.pitchJitter, 0);
}

console.log('\n[物品]');
{
  equal('id 是 1548', Item.TOTEM_OF_UNDYING, 1548);
  equal('注册名', itemDef(Item.TOTEM_OF_UNDYING)?.name, 'minecraft:totem_of_undying');
  equal('不能叠（原版也是）', itemDef(Item.TOTEM_OF_UNDYING)?.maxStack, 1);
  equal('中文名', itemLabel(Item.TOTEM_OF_UNDYING), '不死图腾');
  check('贴图在图集里', TILE_ORDER.includes('item_totem_of_undying'));
}

console.log('\n[与世界的接线]');
{
  const evoker = MOB_TYPES.find((type) => type.id === 'evoker');
  check('唤魔者存在', evoker !== undefined);
  const drops = evoker?.drops ?? [];
  check(
    '唤魔者必掉 1 个不死图腾',
    drops.some((drop) => drop.itemId === Item.TOTEM_OF_UNDYING && drop.min === 1 && drop.max === 1),
    JSON.stringify(drops),
  );
  check('原来的绿宝石掉落还在', drops.some((drop) => drop.itemId === Item.EMERALD));

  const mainSrc = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  check(
    '扣血入口里判了"死了才救"',
    /this\.stats\.dead\) this\.tryRescueWithTotem\(cause\)/.test(mainSrc),
  );
  check(
    '先确认背包里真有、再回血（否则会出现"没图腾却回了血"）',
    /if \(!this\.inventory\.consume\(Item\.TOTEM_OF_UNDYING, 1\)\) return false;[\s\S]{0,120}this\.stats\.heal\(/.test(mainSrc),
  );
  check('救完会清掉负面效果', /this\.effects\.clear\(\)/.test(mainSrc));
}

console.log(`\n不死图腾测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
