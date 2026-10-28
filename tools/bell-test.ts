/**
 * 钟（批次 490，B19）
 *
 * 四块：
 *  ① 方块（id / 注册名 / 形状 / 无碰撞）；
 *  ② 几何（横梁 + 钟腰 + 钟口三个盒子，上窄下宽）；
 *  ③ 钟声（三个**非整数倍**泛音、长衰减、包络首尾归零）；
 *  ④ 放置（立地，点侧面/天花板都不行）与配方（4 金锭）。
 *
 * 钟声的"非整数倍"是这一批唯一有讲究的地方：220/440/660 听起来像管风琴，
 * 而 1 : 2.76 : 5.4 才是钟体被敲响时那几个不对齐的峰。
 */

import { Block, BELL_ID, blockDef } from '../web/src/core/registry/blocks.ts';
import { collisionBoxes, meshBoxes } from '../web/src/core/registry/blockShapes.ts';
import { planPlacement } from '../web/src/core/interaction/Placement.ts';
import { BELL_BASE_HZ, BELL_RING_SECONDS, bellSoundSpec } from '../web/src/core/audio/BellSound.ts';
import { RECIPES } from '../web/src/core/crafting/Recipes.ts';
import { itemLabel } from '../web/src/core/registry/itemNames.ts';
import { Item } from '../web/src/core/registry/items.ts';

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

console.log('\n[方块]');
{
  equal('钟的 id 是 717', BELL_ID, 717);
  equal('注册名', blockDef(Block.BELL).name, 'minicraft:bell');
  equal('形状是 bell（不是整格）', blockDef(Block.BELL).shape, 'bell');
  equal('中文名', itemLabel(Block.BELL), '钟');
  equal('没有碰撞盒（能从钟边走过去）', collisionBoxes('bell', 0).length, 0);
}

console.log('\n[几何：上窄下宽的钟体]');
{
  const boxes = meshBoxes('bell', 0);
  equal('三个盒子（横梁 / 腰 / 口沿）', boxes.length, 3);
  const [beam, waist, mouth] = boxes as readonly (readonly number[])[];
  const widthOf = (box: readonly number[]): number => box[3]! - box[0]!;
  check('横梁在最上面', beam[4]! > waist[4]!, `横梁顶 ${beam[4]} / 腰顶 ${waist[4]}`);
  check('腰比口沿窄（上窄下宽）', widthOf(waist) < widthOf(mouth), `腰 ${widthOf(waist)} / 口 ${widthOf(mouth)}`);
  check('口沿落在底部（从 2/16 起）', Math.abs(mouth[1]! - 2 / 16) < 1e-6, `${mouth[1]}`);
  check('钟体不高过一格', beam[4]! <= 1 && mouth[4]! <= 1);
}

console.log('\n[钟声：三个非整数倍泛音]');
{
  const spec = bellSoundSpec();
  equal('三层泛音', spec.layers.length, 3);
  check('都是音调层（没有噪声）', spec.layers.every((layer) => layer.t === 'tone'));

  const ratios = spec.layers.map((layer) => (layer.t === 'tone' ? layer.hz / BELL_BASE_HZ : 0));
  check('第一个泛音是基频', Math.abs(ratios[0]! - 1) < 1e-6, `${ratios[0]}`);
  check('第二个是 2.76 倍（钟的嗡鸣）', Math.abs(ratios[1]! - 2.76) < 1e-6, `${ratios[1]}`);
  check('第三个是 5.4 倍', Math.abs(ratios[2]! - 5.4) < 1e-6, `${ratios[2]}`);
  check(
    '泛音**不是**整数倍（否则听起来像管风琴）',
    ratios.slice(1).every((ratio) => Math.abs(ratio - Math.round(ratio)) > 0.05),
    ratios.map((ratio) => ratio.toFixed(2)).join(','),
  );
  check(
    '高次泛音衰减得更快（余韵才不会糊成一片）',
    spec.layers[0]!.dur > spec.layers[1]!.dur && spec.layers[1]!.dur >= spec.layers[2]!.dur,
    spec.layers.map((layer) => layer.dur.toFixed(2)).join(','),
  );
  check(
    '包络首尾归零（敲一下不会"啪"一声）',
    spec.layers.every((layer) => layer.env[0]![1] === 0 && layer.env[layer.env.length - 1]![1] === 0),
  );
  equal('音量比普通音效低一档（长音不能盖住别的）', spec.gain, 0.55);
  equal('不抖动（同一口钟每次一样）', spec.pitchJitter, 0);
  check('整段至少响 3 秒', spec.layers[0]!.dur >= 3 && BELL_RING_SECONDS >= 3, `${spec.layers[0]!.dur}`);
  check('基频在人耳舒适的低声区（150~400Hz）', BELL_BASE_HZ >= 150 && BELL_BASE_HZ <= 400, `${BELL_BASE_HZ}`);
}

console.log('\n[放置：只能立在地上]');
{
  function place(normal: [number, number, number], below: number = Block.STONE): ReturnType<typeof planPlacement> {
    return planPlacement({
      blockId: Block.BELL,
      normal,
      hitX: 0.5,
      hitY: 63,
      hitZ: 0.5,
      yaw: 0,
      sneaking: false,
      blockAt: (dx, dy, dz) => {
        if (dx === 0 && dz === 0 && dy === -1) return below;
        return Block.AIR;
      },
      hitBlock: below,
      hitState: 0,
    });
  }

  const standing = place([0, 1, 0]);
  check('点顶面 → 立地放得下', standing !== null);
  equal('立地的钟没有额外状态', standing?.state, 0);
  equal('下方是空的 → 放不下', place([0, 1, 0], Block.AIR), null);
  equal('点侧面 → 放不下（挂墙没做）', place([0, 0, 1]), null);
  equal('点天花板 → 放不下', place([0, -1, 0]), null);
}

console.log('\n[配方：4 金锭]');
{
  const recipe = RECIPES.find((entry) => entry.result.id === Block.BELL);
  check('有一条产出钟的配方', recipe !== undefined);
  if (recipe && recipe.kind === 'shaped') {
    equal('钟形（上 1 下 3）', recipe.pattern.join('/'), ' G /GGG');
    equal('材料是金锭', recipe.key.G, Item.GOLD_INGOT);
    equal('产出 1 个', recipe.result.count, 1);
  } else {
    check('应该是定形配方', false, recipe?.kind);
  }
}

console.log(`\n钟测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
