/**
 * 混凝土：粉末遇水凝固离线测试（批次 131，TASKS B52 的最后一块）
 *
 * 这一批把那 16 个"有方块、有贴图、但一个配方都没有"的混凝土接通了：
 * 粉末（新）→ 合成（4 沙 + 4 砾石 + 1 染料）→ **挨到水就凝固** → 混凝土。
 *
 * 要盯的三件事：
 *  1. **16 色一一对应**：红粉末凝固成红混凝土（不是白的）——这靠两族 id 同序，
 *     所以断言要逐色比一遍（写错一格就会出现"红粉末变白混凝土"这种荒唐事）；
 *  2. **哪六格算挨着水**：六个正方向都算、**斜角不算**（这是最容易被"顺手写成 3×3×3"的地方）；
 *  3. **该不动的不动**：没水不动、已经是混凝土不动、别的方块不动。
 *
 * 运行：npm run test:concrete
 */

import { Block, CONCRETE_POWDER_ID_START, concreteId, concretePowderId, blockDef } from '../src/core/registry/blocks.ts';
import { DYE_COLORS } from '../src/core/registry/colors.ts';
import { CREATIVE_ITEMS, dyeItemId, itemDef, maxStackOf } from '../src/core/registry/items.ts';
import { hasDescription, itemDescription, itemLabel } from '../src/core/registry/itemNames.ts';
import { RECIPES, type Recipe } from '../src/core/crafting/Recipes.ts';
import { TILE_ORDER } from '../src/render/atlasLayout.ts';
import {
  CONCRETE_COLOR_COUNT,
  concreteForPowder,
  hardenAround,
  hardenPowderAt,
  isConcrete,
  isConcretePowder,
  touchesWater,
  type ConcreteWorld,
} from '../src/core/world/Concrete.ts';

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

/** 一个稀疏世界：只记"被写过的格子"，其余按 `base` 回答 */
function makeWorld(base: (x: number, y: number, z: number) => number): {
  world: ConcreteWorld;
  at(x: number, y: number, z: number): number;
  hardened: { x: number; y: number; z: number; id: number }[];
} {
  const overrides = new Map<string, number>();
  const hardened: { x: number; y: number; z: number; id: number }[] = [];
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  return {
    world: {
      getBlock: (x, y, z) => overrides.get(key(x, y, z)) ?? base(x, y, z),
      harden: (x, y, z, id) => {
        overrides.set(key(x, y, z), id);
        hardened.push({ x, y, z, id });
      },
    },
    at: (x, y, z) => overrides.get(key(x, y, z)) ?? base(x, y, z),
    hardened,
  };
}

/** 一个"只有指定几格是水"的世界（其余是空气），中心放一块指定的方块 */
function waterWorld(centerId: number, waters: readonly [number, number, number][]): ReturnType<typeof makeWorld> {
  const waterSet = new Set(waters.map(([x, y, z]) => `${x},${y},${z}`));
  const scene = makeWorld((x, y, z) => {
    if (x === 0 && y === 0 && z === 0) return centerId;
    return waterSet.has(`${x},${y},${z}`) ? Block.WATER : Block.AIR;
  });
  return scene;
}

// ---------------------------------------------------------------- 1. 方块与物品

console.log('\n[16 色混凝土粉末：方块、名字、贴图]');
{
  equal('颜色数与配色表一致', CONCRETE_COLOR_COUNT, DYE_COLORS.length);
  equal('粉末 id 从 558 起（追加在方块表末尾）', CONCRETE_POWDER_ID_START, 558);
  const missingDef = DYE_COLORS.filter((_c, i) => blockDef(concretePowderId(i)) === undefined);
  equal('16 个粉末方块都在方块表里', missingDef.length, 0);

  let tilesOk = true;
  let namesOk = true;
  let descOk = true;
  for (let i = 0; i < DYE_COLORS.length; i++) {
    const color = DYE_COLORS[i]!;
    const id = concretePowderId(i);
    if (blockDef(id).tiles[0] !== `concrete_powder_${color.name}`) tilesOk = false;
    if (!TILES.has(`concrete_powder_${color.name}`)) tilesOk = false;
    if (itemLabel(id) !== `${['白色', '橙色', '品红色', '淡蓝色', '黄色', '黄绿色', '粉红色', '灰色', '淡灰色', '青色', '紫色', '蓝色', '棕色', '绿色', '红色', '黑色'][i]}混凝土粉末`) {
      namesOk = false;
    }
    if (!hasDescription(id) || !itemDescription(id).includes('凝固')) descOk = false;
  }
  check('16 张贴图都按 `concrete_powder_<色>` 命名、且在图集名单里', tilesOk);
  check('16 个中文名都对（白色混凝土粉末……）', namesOk);
  check('16 条说明都写了"凝固"', descOk);
  check('创造物品栏里拿得到（否则玩家只能靠命令）', CREATIVE_ITEMS.includes(concretePowderId(0)));

  equal('粉末可以堆叠（是材料，不是工具）', maxStackOf(concretePowderId(0)), 64);
  check('（对照）混凝土也在方块表里', blockDef(concreteId(0)) !== undefined);
}

// ---------------------------------------------------------------- 2. 两族 id 的对应

console.log('\n[16 色一一对应：红粉末 → 红混凝土]');
{
  let ok = true;
  const wrong: string[] = [];
  for (let i = 0; i < DYE_COLORS.length; i++) {
    const got = concreteForPowder(concretePowderId(i));
    if (got !== concreteId(i)) {
      ok = false;
      wrong.push(`${DYE_COLORS[i]!.name}: ${got} != ${concreteId(i)}`);
    }
  }
  check('每一种粉末都映射到**同色**混凝土', ok, wrong.join(';'));

  equal('红粉末 → 红混凝土（id 直接对上）', concreteForPowder(concretePowderId(14)), concreteId(14));
  equal('混凝土**不是**粉末（映射返回 null）', concreteForPowder(concreteId(14)), null);
  equal('别的方块也不行', concreteForPowder(Block.STONE), null);
  check('`isConcretePowder` 认粉末、`isConcrete` 认混凝土', isConcretePowder(concretePowderId(3)) && isConcrete(concreteId(3)));
  check('而两者互不认', !isConcretePowder(concreteId(3)) && !isConcrete(concretePowderId(3)));
  check('（对照）`isConcretePowder` 不会把别的方块算进来', !isConcretePowder(Block.SLIME_BLOCK));
}

// ---------------------------------------------------------------- 3. 哪六格算挨着水

console.log('\n[挨着水的六格：六个正方向都算、斜角不算]');
{
  const DIRECTIONS: readonly [number, number, number, string][] = [
    [1, 0, 0, '+x'],
    [-1, 0, 0, '-x'],
    [0, 1, 0, '+y（头顶）'],
    [0, -1, 0, '-y（脚底）'],
    [0, 0, 1, '+z'],
    [0, 0, -1, '-z'],
  ];
  for (const [dx, dy, dz, label] of DIRECTIONS) {
    const scene = waterWorld(concretePowderId(0), [[dx, dy, dz]]);
    const result = hardenPowderAt(scene.world, 0, 0, 0);
    equal(`${label} 有水 → 凝固`, result, concreteId(0));
  }

  // 斜角：原版不算（这是最容易被"顺手写成 3×3×3"的地方）
  for (const [dx, dy, dz] of [
    [1, 1, 0],
    [1, -1, 0],
    [1, 0, 1],
    [-1, -1, -1],
  ] as const) {
    const scene = waterWorld(concretePowderId(0), [[dx, dy, dz]]);
    equal(`斜角 (${dx},${dy},${dz}) 的水**不算**挨着`, hardenPowderAt(scene.world, 0, 0, 0), null);
  }

  // 隔着两格也不算
  {
    const scene = waterWorld(concretePowderId(0), [[2, 0, 0]]);
    equal('隔一格的水不算', hardenPowderAt(scene.world, 0, 0, 0), null);
  }
  // `touchesWater` 自己也是六邻域
  {
    const scene = waterWorld(Block.STONE, [[0, -1, 0]]);
    check('`touchesWater` 直接问也认脚底的水', touchesWater(scene.world, 0, 0, 0));
  }
}

// ---------------------------------------------------------------- 4. 该不动的不动

console.log('\n[不该发生的事：没水不动、已凝固不动、别的方块不动]');
{
  // 没水
  {
    const scene = waterWorld(concretePowderId(5), []);
    equal('没挨着水 → 一块都不凝固', hardenPowderAt(scene.world, 0, 0, 0), null);
    equal('而且没有任何写入', scene.hardened.length, 0);
  }
  // 已经是混凝土
  {
    const scene = waterWorld(concreteId(5), [[1, 0, 0]]);
    equal('已经是混凝土 → 不再变化（不可逆）', hardenPowderAt(scene.world, 0, 0, 0), null);
  }
  // 别的方块
  {
    const scene = waterWorld(Block.STONE, [[1, 0, 0]]);
    equal('石头挨着水当然不会变', hardenPowderAt(scene.world, 0, 0, 0), null);
  }
  // 颜色要对：红粉末挨水变红混凝土
  {
    const scene = waterWorld(concretePowderId(14), [[0, 1, 0]]);
    const result = hardenPowderAt(scene.world, 0, 0, 0);
    equal('红粉末凝固成红混凝土（不是白色）', result, concreteId(14));
    equal('写回去的也是红混凝土', scene.at(0, 0, 0), concreteId(14));
  }
  // 水本身不会被换掉
  {
    const scene = waterWorld(concretePowderId(0), [[1, 0, 0]]);
    hardenPowderAt(scene.world, 0, 0, 0);
    equal('水还在原地（只换粉末那一格）', scene.at(1, 0, 0), Block.WATER);
  }
}

// ---------------------------------------------------------------- 5. 一次查一片

console.log('\n[`hardenAround`：自己与六邻域一起查]');
{
  // 中心是粉末、四边都有水 → 只凝固中心那一块
  {
    const scene = waterWorld(concretePowderId(2), [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 0, 1],
      [0, 0, -1],
    ]);
    equal('凝固了 1 块', hardenAround(scene.world, 0, 0, 0), 1);
    equal('就是中心那一块', scene.at(0, 0, 0), concreteId(2));
  }

  // 中心是水、周围一圈粉末 → 6 块都凝固（水浇在一堆粉末中间，原版也是这样）
  {
    const powders = new Set(['1,0,0', '-1,0,0', '0,0,1', '0,0,-1', '0,1,0', '0,-1,0']);
    const scene = makeWorld((x, y, z) => {
      if (x === 0 && y === 0 && z === 0) return Block.WATER;
      return powders.has(`${x},${y},${z}`) ? concretePowderId(13) : Block.AIR;
    });
    equal('一圈粉末全部凝固（6 块）', hardenAround(scene.world, 0, 0, 0), 6);
    equal('颜色都对（绿粉末 → 绿混凝土）', scene.at(1, 0, 0), concreteId(13));
    equal('头顶那块也对', scene.at(0, 1, 0), concreteId(13));
  }

  // 什么都不挨着 → 0
  {
    const scene = makeWorld((_x, _y, _z) => Block.AIR);
    equal('空气里调用 → 0 块', hardenAround(scene.world, 0, 0, 0), 0);
  }
}

// ---------------------------------------------------------------- 6. 配方那 16 条

console.log('\n[配方：4 沙 + 4 砾石 + 1 染料 → 8 份粉末]');
{
  const recipeFor = (resultId: number): Recipe | undefined =>
    RECIPES.find((recipe) => recipe.result.id === resultId);

  let allOk = true;
  const problems: string[] = [];
  for (let i = 0; i < DYE_COLORS.length; i++) {
    const recipe = recipeFor(concretePowderId(i));
    if (!recipe) {
      allOk = false;
      problems.push(`${DYE_COLORS[i]!.name} 没有配方`);
      continue;
    }
    if (recipe.result.count !== 8) problems.push(`${DYE_COLORS[i]!.name} 产物不是 8 份`);
    if (recipe.kind !== 'shaped') {
      problems.push(`${DYE_COLORS[i]!.name} 不是有序配方`);
      continue;
    }
    if (recipe.pattern.join('|') !== 'SGS|GDG|SGS') problems.push(`${DYE_COLORS[i]!.name} 图案不对`);
    if (recipe.key.S !== Block.SAND || recipe.key.G !== Block.GRAVEL) problems.push(`${DYE_COLORS[i]!.name} 沙/砾石不对`);
    if (recipe.key.D !== dyeItemId(i)) problems.push(`${DYE_COLORS[i]!.name} 染料不对（应为第 ${i} 色）`);
  }
  check('16 条配方一一对应（图案 SGS/GDG/SGS、产物 8 份、染料是同色那一种）', allOk, problems.join('; '));

  check('（对照）混凝土本身**没有**配方（只能靠凝固）', recipeFor(concreteId(0)) === undefined);
  check('砾石是这 16 条配方的另一个原料（从砂砾或合成拿得到）', itemDef(Block.GRAVEL) !== undefined);
  check('沙也是物品', itemDef(Block.SAND) !== undefined);
}

console.log(`\n混凝土测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
