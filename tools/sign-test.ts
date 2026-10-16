/**
 * 告示牌与牌子上的字离线测试（批次 80，B12）
 *
 * 这一批做成的是**世界上第一份"玩家自己写的、随存档走的数据"**（容器是物品栏，不是文字）。
 * 断言分五块：
 *  1. **6 种木材的牌子**：id 连续、贴图复用该木材木板（一张新贴图都没画）、
 *     徒手可采 / 斧头更快 / 掉落自身 / 进"建筑"分类 / 可燃 / 木头声；
 *  2. **形状与几何**：没有碰撞盒（原版能从牌子里走过去）、落地牌 = 立柱 + 牌面、
 *     挂墙牌 = 只有牌面；四个朝向的"薄的那一维"逐个钉住；
 *  3. **文字贴在哪**（`signTextAnchor`）：8 种状态（4 朝向 × 落地/挂墙）都在牌面外侧一点点，
 *     而且法线朝外——渲染层照着它摆平面，所以这条错了字就会"浮在牌子外面"；
 *  4. **放置**：点顶面 → 落地牌（字朝你）；点侧面 → 挂墙牌（字朝外、墙要实心）；
 *     下方没支撑、挂在天花板上都放不下；
 *  5. **文字表**（`SignText`）：四行 15 字的规整、空牌子不进表、**键带维度**、
 *     存档往返（含 JSON 往返）与**脏数据逐条跳过**。
 *
 * 运行：npm run test:sign
 */

import {
  Block,
  SIGN_ID_START,
  SIGN_IDS,
  Wood,
  blockDef,
  blockHardness,
  blockTiles,
  isSign,
  signId,
  woolId,
} from '../src/core/registry/blocks.ts';
import { WOOD_TYPES } from '../src/core/registry/colors.ts';
import {
  SIGN_BOARD_THICKNESS,
  SIGN_TEXT_OFFSET,
  collisionBoxes,
  isFullBlockShape,
  meshBoxes,
  signBoardBox,
  signTextAnchor,
  type LocalBox,
} from '../src/core/registry/blockShapes.ts';
import {
  describeState,
  facingOf,
  isWallMounted,
  withFacing,
  withWallMounted,
  type Facing,
} from '../src/core/registry/blockState.ts';
import { Item, categoryOf, dropFor, itemDef } from '../src/core/registry/items.ts';
import { hasDescription, itemLabel } from '../src/core/registry/itemNames.ts';
import { canHarvest, efficientToolType, harvestRequirement } from '../src/core/registry/tools.ts';
import { isFlammable } from '../src/core/world/Fire.ts';
import { matchRecipe } from '../src/core/crafting/Recipes.ts';
import { planPlacement } from '../src/core/interaction/Placement.ts';
import { breakSoundFor } from '../src/core/audio/AudioEngine.ts';
import {
  SIGN_LINES,
  SIGN_LINE_LENGTH,
  SignTextStore,
  normalizeSignLines,
  restoreSigns,
  serializeSigns,
} from '../src/core/world/SignText.ts';
import { TILE_ORDER } from '../src/render/atlasLayout.ts';

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
const SIGNS = SIGN_IDS;

const FACINGS: readonly Facing[] = [0, 1, 2, 3];

/**
 * 落地牌 / 挂墙牌的状态。
 *
 * ⚠️ 朝向写在**位编码**里（bit1-2），所以状态一律用 `withFacing` 造：
 * 把朝向数字直接当 state 传（`signBoardBox(2)`）算出来是"朝东"而不是"朝南"。
 */
const standingState = (facing: Facing): number => withFacing(0, facing);
const wallState = (facing: Facing): number => withWallMounted(withFacing(0, facing), true);
/** 落地牌 / 挂墙牌的牌面盒子（按朝向） */
const standingBoard = (facing: Facing): LocalBox => signBoardBox(standingState(facing));
const wallBoardOf = (facing: Facing): LocalBox => signBoardBox(wallState(facing));

const standingStates = FACINGS.map(standingState);
const wallStates = FACINGS.map(wallState);

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

// ---------------------------------------------------------------- 1. 6 种木材的牌子

console.log('\n[6 种木材的牌子：注册表]');
{
  equal('牌子有 6 种（与木材表同数量）', SIGNS.length, WOOD_TYPES.length);
  const contiguous = SIGNS.every((id, index) => id === SIGN_ID_START + index);
  check('id 连续（木材顺序就是 id 顺序，存档里存的就是这些数字）', contiguous, SIGNS.join(','));

  const wrongName = WOOD_TYPES.filter((wood, index) => blockDef(SIGNS[index]!).name !== `minecraft:${wood.name}_sign`);
  check('名字与木材表逐项对应', wrongName.length === 0, wrongName.map((w) => w.name).join(','));

  const wrongShape = SIGNS.filter((id) => blockDef(id).shape !== 'sign');
  check('每一个的形状都是 sign（落地/挂墙同一个 id）', wrongShape.length === 0, wrongShape.join(','));

  const roundTrip = WOOD_TYPES.every((wood, index) => signId(wood.name) === SIGNS[index]!);
  check('signId 与 SIGN_IDS 同序', roundTrip);
  check('isSign 认得牌子', SIGNS.every((id) => isSign(id)));
  check('isSign 不认别的方块（石头 / 紧邻 id / 木板）', !isSign(Block.STONE) && !isSign(SIGN_ID_START - 1) && !isSign(Block.OAK_PLANKS));

  const solid = SIGNS.filter((id) => blockDef(id).solid);
  check('牌子不算实心（不能拿它当支撑面）', solid.length === 0, solid.join(','));
  check('不遮挡邻居', SIGNS.every((id) => !blockDef(id).opaque));
  check('不挡光', SIGNS.every((id) => blockDef(id).lightOpacity === 0));
  check('不是整格方块（走逐盒通道）', !isFullBlockShape('sign', 0) && !isFullBlockShape('sign', withWallMounted(0, true)));
}

console.log('\n[6 种木材的牌子：贴图与物品]');
{
  // 贴图复用该木材的木板：这一批**一张新贴图都没画**
  const wrongTile = WOOD_TYPES.filter((wood, index) => blockTiles(SIGNS[index]!, 0)[0] !== `${wood.name}_planks`);
  check('牌面/立柱都用该木材的木板贴图（不新画贴图）', wrongTile.length === 0, wrongTile.map((w) => w.name).join(','));

  const missing: string[] = [];
  for (const id of SIGNS) for (const tile of blockTiles(id, 0)) if (!TILES.has(tile)) missing.push(tile);
  check('贴图都在图集名单里', missing.length === 0, missing.join(','));

  const unnamed = SIGNS.filter((id) => itemLabel(id).includes('未知物品'));
  check('每种牌子都有中文名', unnamed.length === 0, unnamed.join(','));
  const undescribed = SIGNS.filter((id) => !hasDescription(id));
  check('每种牌子都有说明（写了怎么落/怎么挂、能写几行）', undescribed.length === 0, undescribed.join(','));
  check('每块牌子都有对应的物品', SIGNS.every((id) => itemDef(id)?.block === id));
  check('每块牌子都掉落自己', SIGNS.every((id) => dropFor(id)?.id === id));

  const noHardness = SIGNS.filter((id) => blockHardness(id) !== 1);
  check('硬度都是 1（显式登记过，不回退 3）', noHardness.length === 0, noHardness.join(','));
  check('徒手都能拆', SIGNS.every((id) => canHarvest(id, null)));
  check('不要求工具（原版牌子徒手就能采）', SIGNS.every((id) => harvestRequirement(id) === undefined));
  check('斧头更快（原版 mineable/axe）', SIGNS.every((id) => efficientToolType(id) === 'axe'));
  check('都归"建筑"分类', SIGNS.every((id) => categoryOf(id) === 'building'));
  check('木板做的，都可燃', SIGNS.every((id) => isFlammable(id)));
  equal('破坏音效归木头', breakSoundFor('minecraft:spruce_sign'), 'break_wood');
  equal('（基岩仍然是石头声）', breakSoundFor('minecraft:bedrock'), 'break_stone');
}

// ---------------------------------------------------------------- 2. 形状与几何

console.log('\n[形状：没有碰撞、立柱 + 牌面]');
{
  check('落地牌没有碰撞盒（原版能从牌子里走过去）', collisionBoxes('sign', 0).length === 0);
  check('挂墙牌也没有碰撞盒', collisionBoxes('sign', withWallMounted(0, true)).length === 0);

  const standing = meshBoxes('sign', 0);
  equal('落地牌：立柱 + 牌面两个盒子', standing.length, 2);
  const post: LocalBox = standing[0]!;
  near('立柱 2/16 见方（x）', post[3] - post[0], 2 / 16);
  near('立柱 2/16 见方（z）', post[5] - post[2], 2 / 16);
  near('立柱 8/16 高', post[4] - post[1], 8 / 16);
  equal('挂墙牌：只有牌面一个盒子', meshBoxes('sign', withWallMounted(0, true)).length, 1);

  const foot = standingBoard(0);
  near('落地牌面厚 2/16', foot[5] - foot[2], SIGN_BOARD_THICKNESS);
  equal('落地牌面顶到方块顶部（y=1）', foot[4], 1);
  near('落地牌面 8/16 高', foot[4] - foot[1], 8 / 16);

  const onWall = wallBoardOf(0);
  near('挂墙牌面厚 2/16', onWall[5] - onWall[2], SIGN_BOARD_THICKNESS);
  near('挂墙牌面下沿 4/16', onWall[1], 4 / 16);

  // "薄的那一维"跟着朝向走：朝北/朝南 → z 薄；朝东/朝西 → x 薄。
  // ⚠️ 状态是**位编码**（朝向在 bit1-2），所以一律用 `withFacing` 造状态，
  // 别把朝向数字直接当 state 传（写 `signBoardBox(2)` 其实是"朝东"，不是"朝南"）
  const thinAxis = (box: LocalBox): 'x' | 'z' => (box[3] - box[0] < box[5] - box[2] ? 'x' : 'z');
  check('落地牌朝北/朝南：薄的那一维是 z（板子横在 x 方向）', thinAxis(standingBoard(0)) === 'z' && thinAxis(standingBoard(2)) === 'z');
  check('落地牌朝东/朝西：薄的那一维是 x', thinAxis(standingBoard(1)) === 'x' && thinAxis(standingBoard(3)) === 'x');
  check('挂墙牌朝北：牌面贴在靠南（背对字的那一侧）', wallBoardOf(0)[2] > 0.5);
  check('挂墙牌朝南：牌面贴在靠北', wallBoardOf(2)[5] < 0.5);
  check('挂墙牌朝东：牌面贴在靠西', wallBoardOf(1)[0] > 0.5);
  check('挂墙牌朝西：牌面贴在靠东', wallBoardOf(3)[3] < 0.5);

  check('describeState 认得出落地/挂墙与朝向', describeState('sign', 0).includes('落地'));
  check('挂墙牌描述里有"挂墙"', describeState('sign', withWallMounted(0, true)).includes('挂墙'));
}

console.log('\n[文字贴在哪：8 种状态都在牌面外侧]');
{
  const outward: readonly (readonly [Facing, number, number])[] = [
    [0, 0, -1],
    [1, 1, 0],
    [2, 0, 1],
    [3, -1, 0],
  ];
  for (const state of [...standingStates, ...wallStates]) {
    const label = `${describeState('sign', state)}`;
    const anchor = signTextAnchor(state);
    const box = signBoardBox(state);
    const facing = facingOf(state);
    const [, nx, nz] = outward.find((entry) => entry[0] === facing)!;
    equal(`${label}：法线朝外`, `${anchor.nx},${anchor.nz}`, `${nx},${nz}`);

    // 锚点必须落在牌面盒子的中心 + 沿法线外移半个厚度 + 一点点
    const cx = (box[0] + box[3]) / 2;
    const cz = (box[2] + box[5]) / 2;
    const half = nx !== 0 ? (box[3] - box[0]) / 2 : (box[5] - box[2]) / 2;
    near(`${label}：锚点在牌面中心（x）`, anchor.x, cx + nx * (half + SIGN_TEXT_OFFSET));
    near(`${label}：锚点在牌面中心（z）`, anchor.z, cz + nz * (half + SIGN_TEXT_OFFSET));
    near(`${label}：锚点在牌面竖直中心`, anchor.y, (box[1] + box[4]) / 2);
    // 它必须在盒子的**外侧**（否则文字会被牌面盖住）
    const outside = nx !== 0 ? (nx > 0 ? anchor.x > box[3] : anchor.x < box[0]) : nz > 0 ? anchor.z > box[5] : anchor.z < box[2];
    check(`${label}：锚点在牌面外侧（字不会被盖子挡住）`, outside);
  }
}

// ---------------------------------------------------------------- 3. 放置

console.log('\n[放置：顶面 → 落地牌，侧面 → 挂墙牌]');
{
  function place(
    normal: readonly [number, number, number],
    yaw: number,
    options: { below?: number; wall?: number } = {},
  ): ReturnType<typeof planPlacement> {
    return planPlacement({
      blockId: SIGNS[0]!,
      normal,
      hitX: 0.5,
      hitY: 64,
      hitZ: 0.5,
      yaw,
      sneaking: false,
      blockAt: (_dx, dy, _dz) => {
        if (dy === -1) return options.below ?? Block.STONE;
        if (dy === 0) return options.wall ?? Block.STONE;
        return Block.AIR;
      },
      hitBlock: Block.STONE,
      hitState: 0,
    });
  }

  // 点顶面：落地牌，字朝放置者（facingFromYaw 给的是"朝向玩家"那个方向）
  const yaws: readonly (readonly [string, number, Facing])[] = [
    ['朝北看', 0, 2],
    ['朝东看', -Math.PI / 2, 3],
    ['朝南看', Math.PI, 0],
    ['朝西看', Math.PI / 2, 1],
  ];
  for (const [label, yaw, expected] of yaws) {
    const plan = place([0, 1, 0], yaw);
    check(`${label} → 落地牌`, plan !== null && !isWallMounted(plan.state));
    equal(`${label}：字朝放置者`, facingOf(plan!.state), expected);
  }

  check('下方是空气 → 放不下', place([0, 1, 0], 0, { below: Block.AIR }) === null);
  check('下方是水 → 放不下', place([0, 1, 0], 0, { below: Block.WATER }) === null);

  // 点侧面：挂墙牌，字朝外（法线正方向），墙必须在那一侧且实心
  const sides: readonly (readonly [string, readonly [number, number, number], Facing])[] = [
    ['点北面', [0, 0, -1], 0],
    ['点东面', [1, 0, 0], 1],
    ['点南面', [0, 0, 1], 2],
    ['点西面', [-1, 0, 0], 3],
  ];
  for (const [label, normal, expected] of sides) {
    const plan = place(normal, 0);
    check(`${label} → 挂墙牌`, plan !== null && isWallMounted(plan.state));
    equal(`${label}：字朝外`, facingOf(plan!.state), expected);
  }
  check('墙那一侧不是实心 → 挂不上', place([0, 0, -1], 0, { wall: Block.AIR }) === null);
  check('墙那一侧是水 → 挂不上', place([0, 0, -1], 0, { wall: Block.WATER }) === null);
  check('天花板不允许挂（原版没有倒挂的牌子）', place([0, -1, 0], 0) === null);

  // 对照：同一位置放石头仍然是整格方块、没有朝向
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
  equal('对照用例：石头没有朝向', stonePlan?.state, 0);
}

// ---------------------------------------------------------------- 4. 文字表

console.log('\n[文字表：四行 15 字]');
{
  equal('四行', SIGN_LINES, 4);
  equal('每行 15 字（1.18 base）', SIGN_LINE_LENGTH, 15);

  const ok = normalizeSignLines(['一块牌子', '第二行', '', '']);
  check('正常内容保留', ok !== null && ok[0] === '一块牌子' && ok[1] === '第二行');
  equal('补足四行', ok?.length, SIGN_LINES);

  const tooLong = normalizeSignLines(['一二三四五六七八九十一二三四五六七八']);
  equal('超长截到 15 字', tooLong?.[0]?.length, SIGN_LINE_LENGTH);
  const trailing = normalizeSignLines(['带空格   ']);
  equal('行尾空白去掉', trailing?.[0], '带空格');
  equal('四行全空 → null（这张牌子没内容）', normalizeSignLines(['', '', '', '']), null);
  equal('全是空格 → null', normalizeSignLines(['   ', '']), null);
  equal('不是数组 → null', normalizeSignLines('hello'), null);
  equal('非字符串项当空行（这一条里只有第一行是有效文字）', normalizeSignLines([123, '有字'])?.[0], '');
  equal('只有非字符串项 → 整张牌子算没内容', normalizeSignLines([123, null]), null);

  const store = new SignTextStore();
  equal('初始为空', store.size, 0);
  equal('没写过读出来是 null', store.get('overworld', 1, 2, 3), null);
  check('写入成功', store.set('overworld', 1, 2, 3, ['你好', '世界']));
  equal('读回来第一行', store.get('overworld', 1, 2, 3)?.[0], '你好');
  equal('条目数 +1', store.size, 1);
  check('has 认得出', store.has('overworld', 1, 2, 3));

  // ⚠️ 键必须带维度：三个维度共用一套区块存储，坐标会重叠
  equal('同一坐标的另一个维度互不影响', store.get('nether', 1, 2, 3), null);
  check('给下界同一坐标写另一份字', store.set('nether', 1, 2, 3, ['下界']));
  equal('主世界那一份没被顶掉', store.get('overworld', 1, 2, 3)?.[0], '你好');
  equal('下界那一份是自己的', store.get('nether', 1, 2, 3)?.[0], '下界');
  equal('两条各自独立', store.size, 2);

  check('写空白 = 擦掉（返回 false）', store.set('overworld', 1, 2, 3, ['', '']) === false);
  equal('擦掉之后读不到', store.get('overworld', 1, 2, 3), null);
  equal('条目数 -1', store.size, 1);

  const visited: string[] = [];
  store.forEach((entry) => visited.push(`${entry.dimension}:${entry.lines[0]}`));
  check('forEach 能拿到剩下的那一条', visited.includes('nether:下界'), visited.join(','));
  check('remove 报告是否真的删掉了', store.remove('nether', 1, 2, 3) && !store.remove('nether', 1, 2, 3));
  equal('清空之后为空', (store.clear(), store.size), 0);
}

console.log('\n[文字表：存档往返与脏数据]');
{
  const store = new SignTextStore();
  store.set('overworld', 10, 64, 20, ['矿洞入口', '→ 直走']);
  store.set('nether', -5, 40, 7, ['回家路']);
  store.set('end', 0, 80, 0, ['末地']);

  // ⚠️ 经 **JSON 往返**再读：结构化克隆允许 undefined 与类实例混进来，
  // JSON 会当场把它们暴露出来（本项目的老规矩）
  const raw = JSON.parse(JSON.stringify(serializeSigns(store))) as unknown;
  const restored = new SignTextStore();
  equal('还原了 3 条', restoreSigns(restored, raw), 3);
  equal('内容一致（主世界）', restored.get('overworld', 10, 64, 20)?.[1], '→ 直走');
  equal('维度也跟着走（下界）', restored.get('nether', -5, 40, 7)?.[0], '回家路');
  equal('末地那一份也在', restored.get('end', 0, 80, 0)?.[0], '末地');
  equal('没有多余的条目', restored.size, 3);

  // 脏数据：任何一条都不该让整份读不出来
  const dirty = [
    { dimension: 'moon', x: 1, y: 2, z: 3, lines: ['假维度'] },
    { dimension: 'overworld', x: Number.NaN, y: 2, z: 3, lines: ['坐标是 NaN'] },
    { dimension: 'overworld', x: '1', y: 2, z: 3, lines: ['坐标是字符串'] },
    { dimension: 'overworld', x: 4, y: 5, z: 6, lines: ['', '', '', ''] },
    { dimension: 'overworld', x: 7, y: 8, z: 9 },
    null,
    'hello',
    { dimension: 'overworld', x: 11, y: 12, z: 13, lines: ['这条是好的'] },
  ];
  const into = new SignTextStore();
  equal('脏数据里只有 1 条能救回来', restoreSigns(into, dirty), 1);
  equal('救回来的是那一条好的', into.list()[0]?.lines[0], '这条是好的');
  equal('坏条目一条都没进表', into.size, 1);
  equal('整个不是数组 → 0', restoreSigns(new SignTextStore(), 'nope'), 0);
}

// ---------------------------------------------------------------- 5. 配方

console.log('\n[配方：6 同种木板 + 1 木棍 → 3 个]');
{
  // ⚠️ 木板 id 一律**从表里取**（橡木是基础方块，不在 `Wood` 表里；其余 5 种在）。
  // 手写 `103 + i*5` 这种算出来的 id 迟早会漂（项目里为这条栽过好几次）
  const planksOf = (woodName: string): number =>
    woodName === 'oak' ? Block.OAK_PLANKS : Wood[woodName]!.planks;

  const wrong: string[] = [];
  for (let index = 0; index < WOOD_TYPES.length; index++) {
    const wood = WOOD_TYPES[index]!;
    const cells = grid(3, ['PPP', 'PPP', ' S '], { P: planksOf(wood.name), S: Item.STICK });
    const result = matchRecipe(cells, 3);
    if (result?.id !== SIGNS[index] || result.count !== 3) {
      wrong.push(`${wood.name}：拿到 ${String(result?.id)}×${String(result?.count)}`);
    }
  }
  check('6 种木材各有一条配方，产物 3 个', wrong.length === 0, wrong.join(', '));

  // 木材不能串：云杉木板合出来的是云杉牌子
  const spruceIndex = WOOD_TYPES.findIndex((wood) => wood.name === 'spruce');
  const spruceCells = grid(3, ['PPP', 'PPP', ' S '], { P: planksOf('spruce'), S: Item.STICK });
  equal('云杉木板 → 云杉牌子', matchRecipe(spruceCells, 3)?.id, SIGNS[spruceIndex]);
  check('云杉木板做不出橡木牌子', matchRecipe(spruceCells, 3)?.id !== SIGNS[0]);

  const short = grid(3, ['PPP', 'PP·', ' S '], { P: planksOf('spruce'), S: Item.STICK });
  check('木板只有 5 块 → 合不出牌子', matchRecipe(short, 3) === null);
  // 木棍换成别的（羊毛）：合出来的**不能是牌子**。
  // ⚠️ 不写成 `=== null`：只有 6 块木板时本来就可能匹配到别的配方（门那一条），
  // 这里要钉的是"少了木棍就做不成牌子"
  const noStick = grid(3, ['PPP', 'PPP', ' W '], { P: planksOf('spruce'), W: woolId(0) });
  check('木棍位置放别的东西 → 合不出牌子', matchRecipe(noStick, 3)?.id !== SIGNS[spruceIndex]);
  check('每块牌子的产物都真的有物品', SIGNS.every((id) => itemDef(id) !== undefined));
}

console.log(`\n告示牌测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
