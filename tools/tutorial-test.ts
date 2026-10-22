/**
 * 新手引导的离线测试（引导1）
 *
 * 运行：npm run test:tutorial
 *
 * 只测纯逻辑：步骤表是否自洽、事实如何推进、越级/重复如何表现、
 * 存档序列化能不能来回，以及脏数据会不会把进度推乱。
 * 界面（卡片）与接线（主程序事件点）不在这里。
 */

import { BED_IDS, Block, woolId } from '../src/core/registry/blocks.ts';
import { toolItemId } from '../src/core/registry/tools.ts';
import { TUTORIAL_STEPS, familyOfItem, stepsOf } from '../src/tutorial/steps.ts';
import { MAX_TRACKED_KINDS, TutorialTracker } from '../src/tutorial/TutorialTracker.ts';

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

// ------------------------------------------------------------------ 步骤表

console.log('\n步骤表');
{
  equal('共 12 步', TUTORIAL_STEPS.length, 12);
  equal('生存 8 步', stepsOf('survival').length, 8);
  equal('创造 4 步', stepsOf('creative').length, 4);

  const ids = new Set(TUTORIAL_STEPS.map((step) => step.id));
  equal('id 不重复', ids.size, TUTORIAL_STEPS.length);
  check(
    '每条都有标题与说明的文案键',
    TUTORIAL_STEPS.every((step) => step.titleKey.includes('.') && step.descKey.includes('.')),
  );
  check(
    '每条都有图标物品',
    TUTORIAL_STEPS.every((step) => Number.isInteger(step.icon) && step.icon > 0),
  );
  check(
    'id 前缀与路径一致（生存 survival/、创造 creative/）',
    TUTORIAL_STEPS.every((step) => step.id.startsWith(`${step.track}/`)),
  );
}

// ------------------------------------------------------------------ 家族判定

console.log('\n家族判定（不手抄 id 表）');
{
  equal('橡木原木算原木', familyOfItem(Block.OAK_LOG), 'log');
  equal('剥皮原木也算原木', familyOfItem(Block.STRIPPED_OAK_LOG), 'log');
  equal('石头不是原木', familyOfItem(Block.STONE), null);
  equal('白色床算床', familyOfItem(BED_IDS[0]!), 'bed');
  equal('橡木门算门', familyOfItem(Block.OAK_DOOR), 'door');
  equal('活板门也算门', familyOfItem(Block.OAK_TRAPDOOR), 'door');
  equal('铁镐什么家族都不算', familyOfItem(toolItemId('pickaxe', 'iron')), null);
}

// ------------------------------------------------------------------ 生存路径

console.log('\n生存 8 步按顺序推进');
{
  const tracker = new TutorialTracker('survival');
  equal('第一步是撸木头', tracker.current?.id, 'survival/log');

  // 放方块不会让"获得原木"成立，但会记进放置计数
  equal('放方块不会推进第 1 步', tracker.handle({ kind: 'place', block: Block.DIRT, y: 64 }).length, 0);
  equal('第 1 步还在', tracker.current?.id, 'survival/log');

  const first = tracker.handle({ kind: 'obtain', item: Block.OAK_LOG });
  equal('拿到原木推进 1 步', first.length, 1);
  equal('下一步是工作台', tracker.current?.id, 'survival/table');

  tracker.handle({ kind: 'obtain', item: Block.CRAFTING_TABLE });
  equal('工作台之后是木镐', tracker.current?.id, 'survival/wood_pickaxe');
  tracker.handle({ kind: 'obtain', item: toolItemId('pickaxe', 'wooden') });
  tracker.handle({ kind: 'obtain', item: toolItemId('pickaxe', 'stone') });
  tracker.handle({ kind: 'obtain', item: Block.FURNACE });
  tracker.handle({ kind: 'obtain', item: toolItemId('pickaxe', 'iron') });
  equal('铁镐之后是床', tracker.current?.id, 'survival/bed');
  tracker.handle({ kind: 'obtain', item: BED_IDS[3]! });
  equal('床之后只剩盖房', tracker.current?.id, 'survival/house');
  equal('前面顺手放的 1 块已经计数', tracker.serialize().counters.placed, 1);

  for (let i = 0; i < 18; i++) tracker.handle({ kind: 'place', block: Block.OAK_PLANKS, y: 64 });
  equal('19 块还不够（要求 20）', tracker.finished, false);
  const last = tracker.handle({ kind: 'place', block: Block.OAK_PLANKS, y: 64 });
  equal('第 20 块完成最后一步', last.length, 1);
  equal('生存走完', tracker.finished, true);
  equal('走完后没有当前步骤', tracker.current, null);
}

// ------------------------------------------------------------------ 幂等与越级

console.log('\n重复上报与越级');
{
  const tracker = new TutorialTracker('survival');
  tracker.handle({ kind: 'obtain', item: Block.OAK_LOG });
  const again = tracker.handle({ kind: 'obtain', item: Block.OAK_LOG });
  equal('同一件物品再报一次不推进', again.length, 0);
  equal('仍停在工作台这一步', tracker.current?.id, 'survival/table');

  // 严格顺序：已经有铁镐也不会跳掉前面的教学步
  const jumped = new TutorialTracker('survival');
  const result = jumped.handle({ kind: 'obtain', item: toolItemId('pickaxe', 'iron') });
  equal('越级物品不会跳过第 1 步', result.length, 0);
  equal('仍然要求先撸木头', jumped.current?.id, 'survival/log');
}

// ------------------------------------------------------------------ 创造路径

console.log('\n创造 4 步（放 10 → 搭高 → 换颜色 → 盖门）');
{
  const tracker = new TutorialTracker('creative');
  equal('第一步是放 10 块', tracker.current?.id, 'creative/place10');

  for (let i = 0; i < 9; i++) tracker.handle({ kind: 'place', block: Block.GRASS_BLOCK, y: 64 });
  equal('9 块还不够', tracker.current?.id, 'creative/place10');

  const tenth = tracker.handle({ kind: 'place', block: Block.GRASS_BLOCK, y: 64 });
  equal('第 10 块只推进到搭高（都在同一层）', tenth.length, 1);
  equal('下一步是搭起来', tracker.current?.id, 'creative/layers');

  tracker.handle({ kind: 'place', block: Block.GRASS_BLOCK, y: 65 });
  const span = tracker.handle({ kind: 'place', block: Block.GRASS_BLOCK, y: 66 });
  equal('3 个高度层推进到换颜色', span.length, 1);
  equal('下一步是换颜色', tracker.current?.id, 'creative/colors');

  tracker.handle({ kind: 'place', block: Block.STONE, y: 64 });
  const colors = tracker.handle({ kind: 'place', block: woolId(14), y: 64 });
  equal('第 3 种方块推进到盖门', colors.length, 1);
  equal('下一步是盖门', tracker.current?.id, 'creative/door');

  const door = tracker.handle({ kind: 'place', block: Block.OAK_DOOR, y: 64 });
  equal('放一扇门完成', door.length, 1);
  equal('创造走完', tracker.finished, true);
}

console.log('\n搭高的判定边界');
{
  const noY = new TutorialTracker('creative');
  for (let i = 0; i < 10; i++) noY.handle({ kind: 'place', block: Block.STONE });
  equal('事件不带 y 时不算搭起来', noY.current?.id, 'creative/layers');

  const gaps = new TutorialTracker('creative');
  for (let i = 0; i < 10; i++) gaps.handle({ kind: 'place', block: Block.STONE, y: 64 });
  gaps.handle({ kind: 'place', block: Block.STONE, y: 66 });
  equal('y 跨度到 3 层即算（不要求连续堆叠）', gaps.current?.id, 'creative/colors');
}

// ------------------------------------------------------------------ 存档

console.log('\n序列化与恢复');
{
  const mid = new TutorialTracker('creative');
  for (let i = 0; i < 10; i++) mid.handle({ kind: 'place', block: Block.STONE, y: 64 });
  const save = mid.serialize();
  equal('存档记下已完成 1 步', save.completed.length, 1);
  equal('计数也存了', save.counters.placed, 10);

  const back = new TutorialTracker('survival');
  const restored = back.restore(save);
  equal('恢复 1 步', restored, 1);
  equal('路径恢复成创造', back.trackId, 'creative');
  equal('停在搭高这一步', back.current?.id, 'creative/layers');
  equal('计数接着数（不是从 0 开始）', back.serialize().counters.placed, 10);
}

console.log('\n脏数据逐项跳过');
{
  equal('restore(null) 当没存档', new TutorialTracker('creative').restore(null), 0);
  equal(
    '版本不对当没存档',
    new TutorialTracker('creative').restore({ version: 2, track: 'creative', completed: ['creative/place10'] }),
    0,
  );

  const tracker = new TutorialTracker();
  const accepted = tracker.restore({
    version: 1,
    track: 'creative',
    // 未知 id / 非字符串 / 合法项混在一起：只认连续前缀里的合法项
    completed: ['creative/place10', '不存在', 42, 'creative/layers'],
    counters: {
      placed: Number.NaN,
      kinds: [-1, 3.5, 'x', 70000, 5, 5],
      minY: 70,
      maxY: 64,
    },
  });
  equal('连续前缀认了 2 步', accepted, 2);
  equal('随时停在第 3 步', tracker.current?.id, 'creative/colors');
  equal('NaN 计数被丢掉', tracker.serialize().counters.placed, 0);
  equal('非法方块 id 被过滤（只剩一个 5）', tracker.serialize().counters.kinds.length, 1);
  equal('minY > maxY 时高度当没放过', tracker.serialize().counters.minY, null);
  equal('高度上限也一并回落', tracker.serialize().counters.maxY, null);

  // 不连续的完成记录不能把人推到第 3 步
  const gap = new TutorialTracker();
  const gapAccepted = gap.restore({
    version: 1,
    track: 'survival',
    completed: ['survival/log', 'survival/furnace'],
    counters: { placed: 0, kinds: [], minY: null, maxY: null },
  });
  equal('跳步的完成记录只认前缀 1 步', gapAccepted, 1);
  equal('停在第二步（工作台）', gap.current?.id, 'survival/table');
}

console.log('\n计数上限');
{
  const many = new TutorialTracker('creative');
  for (let i = 0; i < 10; i++) many.handle({ kind: 'place', block: Block.STONE, y: 64 });
  for (let i = 0; i < MAX_TRACKED_KINDS + 40; i++) many.handle({ kind: 'place', block: i + 1, y: 64 });
  check(
    '放过的方块种类不超过上限（脏事件撑不爆）',
    many.serialize().counters.kinds.length <= MAX_TRACKED_KINDS,
    `实际 ${many.serialize().counters.kinds.length}`,
  );
}

console.log(`\n结果：通过 ${passed}，失败 ${failed}\n`);
process.exit(failed === 0 ? 0 : 1);
