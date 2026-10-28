/**
 * 灵魂火把 / 灵魂灯笼离线测试（批次 200，B20）
 *
 * 这两件是"给灵魂沙第二个用途"的最小闭环，所以断言分五块：
 *
 *  1. **方块本身**：id 连续、亮度 10（比火把暗一档）、不实心不遮挡、有中文名与说明；
 *  2. **新形状 `lantern`**：碰撞只有灯身、渲染多一个提环；物品图标是立体的（不是精灵图）；
 *  3. **放置规则**：只能放在实心方块上面（天花板/侧面都不行）；
 *  4. **支撑**：下面被挖空就该掉（`supportKindOf` = solid）；
 *  5. **配方**：灵魂火把 4 条（煤/木炭 × 灵魂沙/灵魂土 → 4 个）、灵魂灯笼 1 条（8 铁粒 + 火把）。
 *
 * 运行：npm run test:soul
 */

import { Block, blockDef, blockHardness, isHardnessRegistered } from '../web/src/core/registry/blocks.ts';
import { collisionBoxes, meshBoxes } from '../web/src/core/registry/blockShapes.ts';
import { describeState } from '../web/src/core/registry/blockState.ts';
import { supportKindOf } from '../web/src/core/world/Support.ts';
import { planPlacement } from '../web/src/core/interaction/Placement.ts';
import { itemLabel, itemDescription, hasDescription } from '../web/src/core/registry/itemNames.ts';
import { isoBoxesForShape } from '../web/src/ui/BlockIcon.ts';
import { TILE_ORDER } from '../web/src/render/atlasLayout.ts';
import { Item } from '../web/src/core/registry/items.ts';
import { RECIPES, matchRecipe } from '../web/src/core/crafting/Recipes.ts';

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

const TILES = new Set<string>(TILE_ORDER);

/** 造一份"脚下是 soulBlock、其余是空气"的放置输入 */
function placeInput(blockId: number, normal: readonly [number, number, number], below: number): Parameters<typeof planPlacement>[0] {
  return {
    blockId,
    normal,
    hitX: 0.5,
    hitY: 64,
    hitZ: 0.5,
    yaw: 0,
    sneaking: false,
    hitBlock: below,
    hitState: 0,
    // 相对偏移：落点在命中面外侧，所以"下方那一格"相对落点是 (0,-1,0)
    blockAt: (dx, dy, dz) => (dx === 0 && dy === -1 && dz === 0 ? below : Block.AIR),
  };
}

console.log('\n[两个方块]');
{
  equal('灵魂火把 id 接在炼药锅之后', Block.SOUL_TORCH, 576);
  equal('灵魂灯笼 id 紧随其后', Block.SOUL_LANTERN, 577);
  equal('灵魂火把的名字', itemLabel(Block.SOUL_TORCH), '灵魂火把');
  equal('灵魂灯笼的名字', itemLabel(Block.SOUL_LANTERN), '灵魂灯笼');

  equal('灵魂火把亮度 10（比火把的 14 暗一档）', blockDef(Block.SOUL_TORCH).light, 10);
  equal('灵魂灯笼亮度 10', blockDef(Block.SOUL_LANTERN).light, 10);
  check('两个都不实心（能走过去 / 能贴着火把站）', !blockDef(Block.SOUL_TORCH).solid && !blockDef(Block.SOUL_LANTERN).solid);
  check('两个都不遮挡邻居（否则贴在旁边的方块会缺一面）', !blockDef(Block.SOUL_TORCH).opaque && !blockDef(Block.SOUL_LANTERN).opaque);
  equal('灵魂火把的形状复用了 torch', blockDef(Block.SOUL_TORCH).shape, 'torch');
  equal('灵魂灯笼用新形状 lantern', blockDef(Block.SOUL_LANTERN).shape, 'lantern');
  check('两个都有说明', hasDescription(Block.SOUL_TORCH) && hasDescription(Block.SOUL_LANTERN));
  check('灵魂火把的说明写了配方原料', itemDescription(Block.SOUL_TORCH).includes('灵魂沙'));
  check('两个的硬度都显式登记过（不是兜底的 3）', isHardnessRegistered(Block.SOUL_TORCH) && isHardnessRegistered(Block.SOUL_LANTERN));
  equal('灵魂灯笼硬度 3.5（与原版一致）', blockHardness(Block.SOUL_LANTERN), 3.5);
  check('贴图都在图集里', TILES.has(blockDef(Block.SOUL_TORCH).tiles[0]!) && TILES.has(blockDef(Block.SOUL_LANTERN).tiles[0]!));
}

console.log('\n[新形状 lantern]');
{
  const collision = collisionBoxes('lantern', 0);
  equal('碰撞只有灯身一个盒子', collision.length, 1);
  const mesh = meshBoxes('lantern', 0, {});
  equal('渲染是灯身 + 提环两个盒子', mesh.length, 2);
  check('碰撞盒就是渲染的第一个盒子（看着小、撞着也小）', collision[0] === mesh[0]);
  check('灯身比方块小（6/16 见方）', mesh[0]![0] === 0.3125 && mesh[0]![3] === 0.6875);
  check('提环在灯身之上', mesh[1]![1] >= mesh[0]![4]);
  equal('状态描述', describeState('lantern', 0), '落地');
  check('物品图标做成 3D 盒子（不是平面精灵图）', isoBoxesForShape('lantern') !== null);
}

console.log('\n[放置与支撑]');
{
  const onGround = planPlacement(placeInput(Block.SOUL_LANTERN, [0, 1, 0], Block.SOUL_SAND));
  check('放在灵魂沙上面 → 允许', onGround !== null);
  equal('落地状态是 0', onGround?.state, 0);

  equal('挂在方块底下 → 不允许', placeInput(Block.SOUL_LANTERN, [0, -1, 0], Block.STONE) && planPlacement(placeInput(Block.SOUL_LANTERN, [0, -1, 0], Block.STONE)), null);
  equal('贴在侧面 → 不允许', planPlacement(placeInput(Block.SOUL_LANTERN, [1, 0, 0], Block.STONE)), null);
  equal('下面不是实心 → 不允许', planPlacement(placeInput(Block.SOUL_LANTERN, [0, 1, 0], Block.AIR)), null);

  equal('灯笼要"下方实心"这一档支撑', supportKindOf(Block.SOUL_LANTERN), 'solid');
  equal('（对照）火把仍是暂不处理', supportKindOf(Block.TORCH), 'none');
}

console.log('\n[配方]');
{
  const soulTorches = RECIPES.filter((recipe) => recipe.result.id === Block.SOUL_TORCH);
  equal('灵魂火把 4 条（煤/木炭 × 灵魂沙/灵魂土）', soulTorches.length, 4);
  check('四条都产 4 个', soulTorches.every((recipe) => recipe.result.count === 4));
  check('四条都是无序配方', soulTorches.every((recipe) => recipe.kind === 'shapeless'));

  equal('煤 + 木棍 + 灵魂沙 → 4 个灵魂火把', matchRecipe([Item.COAL, Item.STICK, Block.SOUL_SAND, 0], 2)?.id, Block.SOUL_TORCH);
  equal('木炭 + 木棍 + 灵魂土 也行', matchRecipe([Item.CHARCOAL, Item.STICK, Block.SOUL_SOIL, 0], 2)?.id, Block.SOUL_TORCH);
  equal('普通沙子不行', matchRecipe([Item.COAL, Item.STICK, Block.SAND, 0], 2)?.id ?? -1, -1);
  equal('少了木棍也不行', matchRecipe([Item.COAL, Block.SOUL_SAND, 0, 0], 2)?.id ?? -1, -1);

  const lantern = RECIPES.find((recipe) => recipe.result.id === Block.SOUL_LANTERN);
  check('有灵魂灯笼配方', lantern !== undefined);
  equal('产 1 个', lantern?.result.count, 1);
  const cells = [
    Item.IRON_NUGGET, Item.IRON_NUGGET, Item.IRON_NUGGET,
    Item.IRON_NUGGET, Block.SOUL_TORCH, Item.IRON_NUGGET,
    Item.IRON_NUGGET, Item.IRON_NUGGET, Item.IRON_NUGGET,
  ];
  equal('8 铁粒 + 1 灵魂火把 → 灵魂灯笼', matchRecipe(cells, 3)?.id, Block.SOUL_LANTERN);
  equal('中间换成普通火把 → 合不出来（两种火把是不同 id）',
    matchRecipe([...cells.slice(0, 4), Block.TORCH, ...cells.slice(5)], 3)?.id ?? -1,
    -1);
  equal('少一个铁粒就合不出来', matchRecipe([...cells.slice(0, 8), 0], 3), null);
}

console.log(`\n灵魂光源测试：${passed} 通过 / ${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
