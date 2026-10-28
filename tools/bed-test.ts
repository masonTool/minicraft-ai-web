/**
 * 床与睡觉离线测试（批次 79，B13 / I13）
 *
 * 这一批做成的是"**能在家里过夜**"：床（横跨两格的家具）+ 睡觉（跳夜 + 重生点）。
 * 断言分五块：
 *  1. **16 色床**：id 连续、名字与配色表同序、贴图都在图集里、硬度 0.2、徒手可采、
 *     掉落自身、进"羊毛·床·染料"分类、破坏音效归木头；
 *  2. **形状与状态**：9/16 高（走得上去不用跳）、枕头是**几何**且跟着朝向走、
 *     `bedOtherHalf`（两半互逆）、`bedFootPos`、状态读写；
 *  3. **放置**：床脚在落点、**床头朝玩家面朝的方向**（四个朝向各一条）、
 *     床脚要有支撑、床头那一格被占就整张放不下、床头是水可以放；
 *  4. **睡觉规则**（`Sleep.ts`）：白天不能睡、雷暴白天能睡、附近有怪不能睡
 *     （8×5×8 的边界逐个钉住）、死了不能睡、醒来的时刻是黎明；
 *  5. **配方**：16 条、羊毛必须同色、产物数量 1、每条配方的产物都真的存在。
 *
 * 运行：npm run test:bed
 */

import {
  BED_ID_START,
  BED_IDS,
  Block,
  bedColorIndex,
  bedId,
  bedIdOfColor,
  blockDef,
  blockHardness,
  blockTiles,
  isBed,
  woolId,
} from '../web/src/core/registry/blocks.ts';
import { DYE_COLORS } from '../web/src/core/registry/colors.ts';
import {
  BED_PILLOW_HEIGHT,
  BED_PILLOW_LENGTH,
  collisionBoxes,
  isFullBlockShape,
  meshBoxes,
  type LocalBox,
} from '../web/src/core/registry/blockShapes.ts';
import {
  bedFootPos,
  bedOtherHalf,
  describeState,
  facingOf,
  isBedHead,
  withBedHead,
  withFacing,
  type Facing,
} from '../web/src/core/registry/blockState.ts';
import { categoryOf, itemDef } from '../web/src/core/registry/items.ts';
import { hasDescription, itemLabel } from '../web/src/core/registry/itemNames.ts';
import { canHarvest, harvestRequirement } from '../web/src/core/registry/tools.ts';
import { dropFor } from '../web/src/core/registry/items.ts';
import { matchRecipe } from '../web/src/core/crafting/Recipes.ts';
import { planPlacement } from '../web/src/core/interaction/Placement.ts';
import { DAWN_TIME, SLEEP_SECONDS, isNight, monstersNearBed, sleepRefusal } from '../web/src/core/survival/Sleep.ts';
import { breakSoundFor } from '../web/src/core/audio/AudioEngine.ts';
import { TILE_ORDER } from '../web/src/render/atlasLayout.ts';

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

function near(label: string, actual: number, expected: number, tol = 1e-6): void {
  check(label, Math.abs(actual - expected) <= tol, `实际 ${actual}，期望约 ${expected}`);
}

const TILES = new Set<string>(TILE_ORDER);

/** 构造 size×size 的扁平网格，'·' 表示空 */
function grid(size: 2 | 3, rows: readonly string[], legend: Record<string, number>): number[] {
  const cells = new Array<number>(size * size).fill(0);
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]!;
    for (let c = 0; c < row.length; c++) {
      const ch = row[c]!;
      if (ch === '·') continue;
      cells[r * size + c] = legend[ch] ?? 0;
    }
  }
  return cells;
}

// ---------------------------------------------------------------- 1. 16 色床

console.log('\n[16 色床：注册表]');
{
  equal('床有 16 种（与配色表同数量）', BED_IDS.length, DYE_COLORS.length);

  const contiguous = BED_IDS.every((id, index) => id === BED_ID_START + index);
  check('id 连续（颜色顺序就是 id 顺序，存档里存的就是这些数字）', contiguous, BED_IDS.join(','));

  const wrongName = DYE_COLORS.filter(
    (color, index) => blockDef(bedId(index)).name !== `minicraft:${color.name}_bed`,
  ).map((color) => color.name);
  check('名字与配色表逐项对应', wrongName.length === 0, wrongName.join(','));

  const wrongShape = BED_IDS.filter((id) => blockDef(id).shape !== 'bed');
  check('每一个的形状都是 bed', wrongShape.length === 0, wrongShape.join(','));

  // 互逆的三个入口
  const roundTrip = DYE_COLORS.every(
    (_color, index) => bedColorIndex(bedId(index)) === index && bedIdOfColor(DYE_COLORS[index]!.name) === bedId(index),
  );
  check('bedId / bedIdOfColor / bedColorIndex 互逆', roundTrip);
  check('isBed 认得床', BED_IDS.every((id) => isBed(id)));
  check('isBed 不认别的方块（石头/紧邻的 id/木板）', !isBed(Block.STONE) && !isBed(BED_ID_START - 1) && !isBed(Block.OAK_PLANKS));

  const def = blockDef(bedId(0));
  check('不是整格方块（走逐盒通道）', !isFullBlockShape(def.shape, 0));
  check('不遮挡邻居（opaque = false）', !def.opaque);
  equal('不挡光（lightOpacity = 0）', def.lightOpacity, 0);
  equal('没有自发光', def.light, 0);
  check('不是流体', !def.liquid);
}

console.log('\n[16 色床：物品与可达性]');
{
  // 每个有物品的方块都要"挖得到"（批次 62 那条不变量）
  const notHarvestable = BED_IDS.filter((id) => !canHarvest(id, null));
  check('16 张床徒手都能挖掉', notHarvestable.length === 0, notHarvestable.join(','));

  const needsTool = BED_IDS.filter((id) => harvestRequirement(id) !== undefined);
  check('床不要求任何工具（原版硬度 0.2）', needsTool.length === 0, needsTool.join(','));

  const wrongHardness = BED_IDS.filter((id) => blockHardness(id) !== 0.2);
  check('16 张床的硬度都是 0.2（显式登记过，不回退 3）', wrongHardness.length === 0, wrongHardness.join(','));

  const noDrop = BED_IDS.filter((id) => dropFor(id)?.id !== id);
  check('每张床都掉落自己', noDrop.length === 0, noDrop.join(','));

  const unnamed = BED_IDS.filter((id) => itemLabel(id).includes('未知物品'));
  check('每张床都有中文名', unnamed.length === 0, unnamed.join(','));
  const undescribed = BED_IDS.filter((id) => !hasDescription(id));
  check('每张床都有说明（写了怎么睡、怎么设重生点）', undescribed.length === 0, undescribed.join(','));

  const allItems = BED_IDS.every((id) => itemDef(id)?.block === id);
  check('每张床都有对应的方块物品', allItems);

  const wrongCategory = BED_IDS.filter((id) => categoryOf(id) !== 'wool');
  check('16 张床都归"羊毛·床·染料"分类', wrongCategory.length === 0, wrongCategory.join(','));

  // 贴图：顶面 + 侧面各一张，16 色共 32 张，必须在图集名单里
  const missingTiles: string[] = [];
  for (const id of BED_IDS) {
    for (const tile of blockTiles(id, 0)) if (!TILES.has(tile)) missingTiles.push(tile);
  }
  check('16 张床的全部贴图都在图集里', missingTiles.length === 0, missingTiles.join(','));

  const dupTiles = BED_IDS.map((id) => blockTiles(id, 0)[2]);
  equal('16 张床的侧面贴图各不相同', new Set(dupTiles).size, 16);
}

console.log('\n[16 色床：音效]');
{
  equal('床的破坏音效归木头', breakSoundFor('minicraft:white_bed'), 'break_wood');
  equal('红色床也一样', breakSoundFor('minicraft:red_bed'), 'break_wood');
  // ⚠️ `endsWith('_bed')` 而不是 `includes('bed')`：后者会把基岩也算成木头
  equal('基岩仍然是石头音（别被"bed"三个字母带跑）', breakSoundFor('minicraft:bedrock'), 'break_stone');
}

// ---------------------------------------------------------------- 2. 形状与状态

console.log('\n[形状：9/16 高 + 枕头是几何]');
{
  const boxes = collisionBoxes('bed', 0);
  equal('碰撞盒只有一个（床体）', boxes.length, 1);
  near('碰撞盒高度 = 9/16', boxes[0]![4], 0.5625);
  check('9/16 < 0.6（走上去不用跳，与原版手感一致）', boxes[0]![4] < 0.6);

  const foot = meshBoxes('bed', withBedHead(0, false));
  equal('床脚：一个盒子（没有枕头）', foot.length, 1);

  const head = meshBoxes('bed', withBedHead(0, true));
  equal('床头：床体 + 枕头两个盒子', head.length, 2);
  near('枕头高度 = 2/16', head[1]![4] - head[1]![1], BED_PILLOW_HEIGHT);

  // 枕头的位置必须跟着朝向走：枕头贴在**远离床脚**的那一端
  const pillowEnd: readonly (readonly [Facing, LocalBox])[] = [
    [0, [0, 0.5625, 0, 1, 0.6875, BED_PILLOW_LENGTH]], // 朝北 → 枕头在北端
    [1, [1 - BED_PILLOW_LENGTH, 0.5625, 0, 1, 0.6875, 1]], // 朝东 → 枕头在东端
    [2, [0, 0.5625, 1 - BED_PILLOW_LENGTH, 1, 0.6875, 1]], // 朝南 → 枕头在南端
    [3, [0, 0.5625, 0, BED_PILLOW_LENGTH, 0.6875, 1]], // 朝西 → 枕头在西端
  ];
  for (const [facing, expected] of pillowEnd) {
    const box = meshBoxes('bed', withBedHead(withFacing(0, facing), true))[1]!;
    const same = box.every((value, index) => Math.abs(value - expected[index]!) < 1e-6);
    check(`朝${'北东南西'[facing]}的床：枕头在远离床脚那一端`, same, `实际 ${JSON.stringify(box)}`);
    equal(`朝${'北东南西'[facing]}的床脚没有枕头`, meshBoxes('bed', withBedHead(withFacing(0, facing), false)).length, 1);
  }
  // 床体那一块不随朝向变化（只有枕头会动）
  check(
    '床体盒子四个朝向完全一样',
    [0, 1, 2, 3].every((facing) => meshBoxes('bed', withBedHead(withFacing(0, facing as Facing), true))[0]![4] === 0.5625),
  );
}

console.log('\n[状态：两半怎么互相找到]');
{
  equal('bit3 存"是不是床头"', withBedHead(0, true), 0b1000);
  check('读回来是 true', isBedHead(withBedHead(0, true)));
  check('清掉之后是 false', !isBedHead(withBedHead(withBedHead(0, true), false)));
  check('不动朝向那两位', facingOf(withBedHead(withFacing(0, 2), true)) === 2);

  // 两半互逆：从任意一半都能找到另一半（另一半的 head 位是反的），再走一次回到原点
  const states = [0, 1, 2, 3].flatMap((facing) =>
    [false, true].map((head) => withBedHead(withFacing(0, facing as Facing), head)),
  );
  const broken: string[] = [];
  for (const state of states) {
    const other = bedOtherHalf(10, 64, 20, state);
    // ⚠️ `bedOtherHalf` 只回坐标：另一半在世界上读到的是**朝向一样、head 位反过来**的状态，
    // 所以"走回去"要拿翻转后的那份状态（这正是主程序 `breakBedPair` 的做法）
    const flipped = withBedHead(state, !isBedHead(state));
    const back = bedOtherHalf(other[0], other[1], other[2], flipped);
    if (back[0] !== 10 || back[1] !== 64 || back[2] !== 20) broken.push(`state=${state} 走不回原点`);
  }
  check('8 种状态（4 朝向 × 两半）互逆', broken.length === 0, broken.join(', '));

  // 具体位置：朝北的床，床脚在 (0,64,0) 时床头在 (0,64,-1)
  const northFoot = withBedHead(withFacing(0, 0), false);
  const northHead = bedOtherHalf(0, 64, 0, northFoot);
  check('朝北：床头在床脚北边一格', northHead[0] === 0 && northHead[2] === -1, String(northHead));
  const eastFoot = withBedHead(withFacing(0, 1), false);
  const eastHead = bedOtherHalf(0, 64, 0, eastFoot);
  check('朝东：床头在东边一格', eastHead[0] === 1 && eastHead[2] === 0, String(eastHead));

  // bedFootPos：从两半都能得到床脚（床头在 (5,64,-1) → 床脚应当在 (5,64,0)）
  const footAt = bedFootPos(5, 64, 5, northFoot);
  check('站在床脚上 → 床脚就是自己', footAt[0] === 5 && footAt[1] === 64 && footAt[2] === 5, String(footAt));
  const footFromHead = bedFootPos(5, 64, -1, withBedHead(withFacing(0, 0), true));
  check(
    '站在床头上 → 床脚在反方向一格',
    footFromHead[0] === 5 && footFromHead[1] === 64 && footFromHead[2] === 0,
    String(footFromHead),
  );

  check('describeState 认得出床头/床脚与朝向', describeState('bed', withBedHead(withFacing(0, 1), true)).includes('床头'));
  check('床脚的描述里也写着朝向（"床头朝东"）', describeState('bed', withBedHead(withFacing(0, 1), false)).includes('床头朝东'));
}

// ---------------------------------------------------------------- 3. 放置

console.log('\n[放置：床脚在落点、床头朝你面朝的方向]');
{
  /** 造一个放置输入：命中方块顶面，周围按 legend 给方块 */
  function place(
    yaw: number,
    options: { belowFoot?: number; headCell?: number } = {},
  ): ReturnType<typeof planPlacement> {
    const belowFoot = options.belowFoot ?? Block.STONE;
    const headCell = options.headCell ?? Block.AIR;
    // 落点是 (0, 64, 0)，四周：脚下是石头，床头那一格见 options
    return planPlacement({
      blockId: bedId(0),
      normal: [0, 1, 0],
      hitX: 0.5,
      hitY: 64,
      hitZ: 0.5,
      yaw,
      sneaking: false,
      blockAt: (dx, dy, dz) => {
        if (dx === 0 && dy === -1 && dz === 0) return belowFoot;
        if (dy === 0) return headCell;
        return Block.AIR;
      },
      hitBlock: Block.STONE,
      hitState: 0,
    });
  }

  // yaw = 0 → 看向北（-Z）→ 床头在北边；yaw = π/2 → 看向西；-π/2 → 看向东
  const cases: readonly (readonly [string, number, number, number, Facing])[] = [
    ['朝北看 → 床头顶在北边', 0, 0, -1, 0],
    ['朝东看 → 床头顶在东边', -Math.PI / 2, 1, 0, 1],
    ['朝南看 → 床头顶在南边', Math.PI, 0, 1, 2],
    ['朝西看 → 床头顶在西边', Math.PI / 2, -1, 0, 3],
  ];
  for (const [label, yaw, dx, dz, facing] of cases) {
    const plan = place(yaw);
    check(`${label}（放得下）`, plan !== null);
    equal(`${label}·床脚朝向`, facingOf(plan!.state), facing);
    check('床脚那一半不是 head', !isBedHead(plan!.state));
    equal(`床头偏移 dx`, plan!.extra?.dx, dx);
    equal(`床头偏移 dz`, plan!.extra?.dz, dz);
    check('床头那一半是 head', isBedHead(plan!.extra?.state ?? 0));
    equal('两半朝向一致', facingOf(plan!.extra?.state ?? 0), facing);
    equal('两半是同一种床', plan!.extra?.id, bedId(0));
  }

  check('床脚下面没有支撑就放不下', place(0, { belowFoot: Block.AIR }) === null);
  check('床脚下面是水（非实心）也放不下', place(0, { belowFoot: Block.WATER }) === null);
  check('床头那一格被石头占了 → 整张床放不下', place(0, { headCell: Block.STONE }) === null);
  check('床头那一格是水 → 可以放（替换掉水）', place(0, { headCell: Block.WATER }) !== null);

  // 别的方块不受影响：同样位置放石头当然是 state 0、没有 extra
  const stonePlan = planPlacement({
    blockId: Block.STONE,
    normal: [0, 1, 0],
    hitX: 0.5,
    hitY: 64,
    hitZ: 0.5,
    yaw: 0,
    sneaking: false,
    blockAt: () => Block.AIR,
    hitBlock: Block.STONE,
    hitState: 0,
  });
  equal('对照用例：石头的放置方案没有 extra', stonePlan?.extra, undefined);
}

// ---------------------------------------------------------------- 4. 睡觉规则

console.log('\n[睡觉：什么时候能睡]');
{
  check('0.5（日落那一刻）算夜晚', isNight(0.5));
  check('0.75（午夜）算夜晚', isNight(0.75));
  check('0.25（正午）不算夜晚', !isNight(0.25));
  check('0.0（日出）不算夜晚', !isNight(0));
  check('时间取模：-0.25 等价于 0.75（夜晚）', isNight(-0.25));

  const base = { timeOfDay: 0.75, thundering: false, dead: false, monstersNear: false, obstructed: false };
  equal('夜里、床边没怪、床顶空 → 能睡', sleepRefusal(base), null);
  equal(
    '床顶被实心方块挡住 → 不能睡（比怪物更优先）',
    sleepRefusal({ ...base, obstructed: true, monstersNear: true }),
    '床的上方被挡住了，先清出空间',
  );
  equal(
    '白天 → 不能睡',
    sleepRefusal({ ...base, timeOfDay: 0.25 }),
    '你只能在夜晚或雷暴时入睡',
  );
  equal('白天 + 雷暴 → 能睡（原版规则）', sleepRefusal({ ...base, timeOfDay: 0.25, thundering: true }), null);
  equal('死了不能睡', sleepRefusal({ ...base, dead: true }), '你正躺着，先起来再说');
  equal(
    '床边有怪 → 报怪物（比"时候不对"更具体，优先说这句）',
    sleepRefusal({ ...base, timeOfDay: 0.25, monstersNear: true }),
    '你现在无法休息，附近有怪物',
  );
  check('提示里没有英文与占位符', !sleepRefusal({ ...base, timeOfDay: 0.25 })!.includes('%'));

  equal('醒来的时刻是黎明（0）', DAWN_TIME, 0);
  check('睡觉有演出时长（> 0 秒）', SLEEP_SECONDS > 0);
}

console.log('\n[睡觉：附近有没有怪（8×5×8 的边界）]');
{
  const bed = [0, 64, 0] as const;
  const mob = (x: number, y: number, z: number, hostile = true, dead = false) => ({ x, y, z, hostile, dead });

  check('同格的僵尸 → 有怪', monstersNearBed(...bed, [mob(0.5, 64.5, 0.5)]));
  check('水平 8 格整（边界上）→ 有怪', monstersNearBed(...bed, [mob(8.5, 64.5, 0.5)]));
  check('水平 8.1 格 → 够不着', !monstersNearBed(...bed, [mob(8.6, 64.5, 0.5)]));
  check('竖直 5 格整 → 有怪', monstersNearBed(...bed, [mob(0.5, 69.5, 0.5)]));
  check('竖直 5.1 格 → 够不着', !monstersNearBed(...bed, [mob(0.5, 69.6, 0.5)]));
  check('斜对角也算距离（3-4-5）', monstersNearBed(...bed, [mob(3.5, 68.5, 4.5)]));
  check('被动生物不算（牛不打扰睡觉）', !monstersNearBed(...bed, [mob(0.5, 64.5, 0.5, false)]));
  check('死掉的怪物不算', !monstersNearBed(...bed, [mob(0.5, 64.5, 0.5, true, true)]));
  check(
    '一堆怪里只要有一只够近就算',
    monstersNearBed(...bed, [mob(30, 64.5, 30), mob(0.5, 64.5, 2.5)]),
  );
}

// ---------------------------------------------------------------- 5. 配方

console.log('\n[配方：3 同色羊毛 + 3 木板]');
{
  const P = Block.OAK_PLANKS;
  const wrong: string[] = [];
  for (let index = 0; index < DYE_COLORS.length; index++) {
    const cells = grid(3, ['WWW', 'PPP'], { W: woolId(index), P });
    const result = matchRecipe(cells, 3);
    if (result?.id !== bedId(index) || result.count !== 1) {
      wrong.push(`${DYE_COLORS[index]!.name}：拿到 ${String(result?.id)}×${String(result?.count)}`);
    }
  }
  check('16 种颜色各有一条配方（3 同色羊毛 + 3 木板 → 1 张床）', wrong.length === 0, wrong.join(', '));

  // 羊毛必须与床同色：红羊毛合出来的是红床，不是白床
  const redIndex = DYE_COLORS.findIndex((color) => color.name === 'red');
  const redCells = grid(3, ['WWW', 'PPP'], { W: woolId(redIndex), P });
  equal('红羊毛 → 红床', matchRecipe(redCells, 3)?.id, bedId(redIndex));

  // 羊毛混色（两红一白）不该被当成某一种床
  const mixed = grid(3, ['WWW', 'PPP'], { W: woolId(redIndex), P });
  mixed[0] = woolId(0);
  const mixedResult = matchRecipe(mixed, 3);
  check('羊毛混色 → 合不出床', mixedResult === null, `拿到 ${String(mixedResult?.id)}`);

  // 少一块羊毛也不行
  const short = grid(3, ['WW·', 'PPP'], { W: woolId(0), P });
  check('羊毛只有 2 块 → 合不出床', matchRecipe(short, 3) === null);

  // 图案必须是"上三羊毛、下三木板"（上下颠倒不该成立）
  const flipped = grid(3, ['PPP', 'WWW'], { W: woolId(0), P });
  const flippedResult = matchRecipe(flipped, 3);
  check('上下颠倒的图案合不出床', flippedResult === null || flippedResult.id !== bedId(0));

  // 每条床配方的产物都真的存在（"表里指向空气"的历史坑）
  const missing = BED_IDS.filter((id) => itemDef(id) === undefined);
  check('16 条配方的产物都真的有物品', missing.length === 0, missing.join(','));
}

console.log(`\n床与睡觉测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
