/**
 * 音符盒离线测试（批次 173，TASKS G9）
 *
 * 它能离线钉住的东西比想象的多：**音高**是一个纯数值（方块状态低 5 位），
 * **频率**是一条纯公式，**配方**是一张表，**贴图**在图集名单里。
 * 真正要靠耳朵的只有"好不好听"，而那是最后一层。
 *
 * 运行：npm run test:note
 */

import { Block, blockDef } from '../src/core/registry/blocks.ts';
import {
  NOTE_BLOCK_MAX_PITCH,
  nextNotePitch,
  noteFrequency,
  notePitchOf,
  withNotePitch,
} from '../src/core/registry/blockState.ts';
import { Item } from '../src/core/registry/items.ts';
import { RECIPES, matchRecipe } from '../src/core/crafting/Recipes.ts';
import { TILE_ORDER } from '../src/render/atlasLayout.ts';
import { hasDescription, itemLabel } from '../src/core/registry/itemNames.ts';
import { AudioEngine } from '../src/core/audio/AudioEngine.ts';

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

/** 3×3 合成网格（按行摆，图例把字母映射成物品 id） */
function grid3(rows: readonly string[], legend: Record<string, number>): number[] {
  const cells: number[] = [];
  for (const row of rows) {
    for (const char of row) cells.push(char === ' ' ? 0 : (legend[char] ?? 0));
  }
  return cells;
}

// ---------------------------------------------------------------- 1. 方块本身

console.log('\n[方块：注册 / 形状 / 贴图]');
{
  const def = blockDef(Block.NOTE_BLOCK);
  check('音符盒已注册', def !== undefined && def.name === 'minecraft:note_block');
  equal('是完整立方体（碰撞与网格都用同一份几何）', def.shape, 'cube');
  check(
    '三面贴图都在图集名单里（漏一张就是一个紫黑方块）',
    def.tiles.every((tile) => (TILE_ORDER as readonly string[]).includes(tile)),
    def.tiles.join(','),
  );
  equal('中文名', itemLabel(Block.NOTE_BLOCK), '音符盒');
  check('有说明（写明右击演奏、潜行右击换音高）', hasDescription(Block.NOTE_BLOCK));
}

// ---------------------------------------------------------------- 2. 音高与频率

console.log('\n[音高：0~24 存在状态位里]');
{
  equal('音高占 25 档', NOTE_BLOCK_MAX_PITCH + 1, 25);
  equal('空状态的音高是 0', notePitchOf(0), 0);

  // 往返：写入 p 再读回 p（每一个音高都试一遍，避免"只有前几个能存"）
  let roundTripOk = true;
  for (let pitch = 0; pitch <= NOTE_BLOCK_MAX_PITCH; pitch++) {
    if (notePitchOf(withNotePitch(0b11100000, pitch)) !== pitch) roundTripOk = false;
  }
  check('25 个音高都能存进去再读回来（高位不受影响）', roundTripOk);
  equal('高位原样保留（这里只占低 5 位）', withNotePitch(0b11100000, 7) & 0b11100000, 0b11100000);

  // 夹取：非法值不能写进状态
  equal('超过最高音被夹到 24', notePitchOf(withNotePitch(0, 99)), NOTE_BLOCK_MAX_PITCH);
  equal('负数被夹到 0', notePitchOf(withNotePitch(0, -3)), 0);

  // 换音高：24 之后回到 0（循环，不是卡在最高音）
  equal('0 → 1', nextNotePitch(withNotePitch(0, 0)), 1);
  equal('24 → 0（循环）', nextNotePitch(withNotePitch(0, NOTE_BLOCK_MAX_PITCH)), 0);
}

console.log('\n[频率：原版那条半音公式]');
{
  check('最低音 ≈ 185Hz（原版 F#3）', Math.abs(noteFrequency(0) - 185) < 0.5, String(noteFrequency(0)));
  check(
    '高一个八度（12 档）正好翻倍',
    Math.abs(noteFrequency(12) - 370) < 1,
    String(noteFrequency(12)),
  );
  let monotonic = true;
  for (let pitch = 1; pitch <= NOTE_BLOCK_MAX_PITCH; pitch++) {
    if (noteFrequency(pitch) <= noteFrequency(pitch - 1)) monotonic = false;
  }
  check('25 档严格递增（不会有两个音一样高）', monotonic);
  check('越界也不会算出离谱的频率（夹在可听范围内）', noteFrequency(999) < 2000 && noteFrequency(-5) >= 185);
}

// ---------------------------------------------------------------- 3. 配方

console.log('\n[配方：8 木板围一圈 + 正中 1 颗红石]');
{
  const shape = grid3(['PPP', 'PRP', 'PPP'], { P: Block.OAK_PLANKS, R: Item.REDSTONE });
  equal('摆对了能做出音符盒', matchRecipe(shape, 3)?.id, Block.NOTE_BLOCK);
  // 少一块木板就不成立（防止"其实只要 1 颗红石"这种松弛实现）
  const missing = grid3(['PPP', 'PR P', 'PPP'], { P: Block.OAK_PLANKS, R: Item.REDSTONE });
  equal('少一块木板 → 什么也做不出来', matchRecipe(missing, 3), null);
  // 红石换成别的（原版只有红石能触发它）
  const wrong = grid3(['PPP', 'PDP', 'PPP'], { P: Block.OAK_PLANKS, D: Item.DIAMOND });
  equal('正中放钻石 → 什么也做不出来', matchRecipe(wrong, 3), null);
  check(
    '表里只有一条音符盒配方（多一条会让配方书里出现两个同样的产物）',
    RECIPES.filter((recipe) => recipe.result.id === Block.NOTE_BLOCK).length === 1,
  );
}

// ---------------------------------------------------------------- 4. 音频

console.log('\n[音频：按频率播放]');
{
  const audio = new AudioEngine();
  check('引擎有按频率播放的入口（不是塞进 SoundKind 表）', typeof audio.playNote === 'function');
  let safe = true;
  try {
    // Node 里没有 AudioContext：必须安静地什么都不做，而不是抛
    audio.playNote(noteFrequency(10), { x: 0, y: 0, z: 0 });
    audio.playNote(Number.NaN);
  } catch {
    safe = false;
  }
  check('没有音频上下文时 playNote 不抛', safe);
}

console.log(`\n音符盒测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
