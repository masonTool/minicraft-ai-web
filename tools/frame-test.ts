/**
 * 物品展示框与画的离线测试（批次 86，B14）
 *
 * 这一批做成的是**"墙上挂东西"两件套**：展示框（框里挂着的一整件物品，
 * 与告示牌上的字同一条"按坐标存的运行时数据"）与画（只做原版 1×1 的 7 幅，
 * 变体存在方块状态里）。断言分八块：
 *  1. **画作表**：7 幅、1×1、贴图名都在图集名单里、变体状态位的读写与夹紧；
 *  2. **方块注册**：id 连续、贴图、不挡路不遮光、徒手一拍就掉、进"建筑"分类、
 *     中文名与说明都有、都能作为物品拿到；
 *  3. **几何**：贴墙薄板的四个朝向、"薄的那一维"、展示框与画只差厚度、
 *     框里那件物品的挂点在外侧而且法线与支撑方向相反；
 *  4. **形状**：两者都**没有碰撞盒**（原版能穿过去）、不是整格、渲染盒非空；
 *  5. **放置**：只能贴水平侧面、墙必须实心、朝向按命中面、画随机挑一幅
 *     （随机源注入，所以"挑出来的编号一定合法"能钉住）；
 *  6. **展示框数据表**：存取往返、转 8 次回原位、空框不进表、`get` 返回副本、
 *     附魔/改名/耐久/内容物原样往返、存档往返与脏数据逐条跳过；
 *  7. **贴附面支撑**：墙在就立得住、墙没了就收掉、收的时候回调能拿到坐标与本体、
 *     没有 `getState` 的旧世界桩不会被误伤；
 *  8. **配方**：展示框（8 木棍 + 皮革）与画（8 木棍 + 16 种羊毛各一条）都能合出来。
 *
 * 运行：npm run test:frame
 */

import {
  Block,
  ITEM_FRAME_ID,
  PAINTING_ID,
  blockDef,
  blockHardness,
  blockTiles,
  woolId,
} from '../src/core/registry/blocks.ts';
import {
  ITEM_FRAME_ITEM_SIZE,
  ITEM_FRAME_THICKNESS,
  PAINTING_THICKNESS,
  itemFrameBox,
  itemFrameItemAnchor,
  paintingBox,
  collisionBoxes,
  isFullBlockShape,
  meshBoxes,
  type LocalBox,
} from '../src/core/registry/blockShapes.ts';
import {
  describeState,
  facingOf,
  outwardFacingOf,
  paintingVariantOf,
  wallSupportOffset,
  withFacing,
  withPaintingVariant,
  type Facing,
} from '../src/core/registry/blockState.ts';
import {
  PAINTING_VARIANTS,
  PAINTING_VARIANT_LIMIT,
  VANILLA_PAINTING_COUNT,
  paintingName,
  paintingTile,
  pickPaintingVariant,
} from '../src/core/registry/paintings.ts';
import { Item, categoryOf, dropFor, itemDef } from '../src/core/registry/items.ts';
import { hasDescription, itemLabel } from '../src/core/registry/itemNames.ts';
import { canHarvest } from '../src/core/registry/tools.ts';
import { matchRecipe } from '../src/core/crafting/Recipes.ts';
import { planPlacement } from '../src/core/interaction/Placement.ts';
import {
  supportIsValid,
  supportKindOf,
  sweepHangingsAround,
  type SupportWorld,
} from '../src/core/world/Support.ts';
import {
  FRAME_ROTATIONS,
  ItemFrameStore,
  frameItemAngle,
  frameItemScale,
  frameKey,
  nextFrameRotation,
  normalizeFrameItem,
  restoreFrames,
  serializeFrames,
} from '../src/core/world/ItemFrame.ts';
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

function near(label: string, actual: number, expected: number, tol = 1e-9): void {
  check(label, Math.abs(actual - expected) <= tol, `实际 ${actual}，期望约 ${expected}`);
}

const TILES = new Set<string>(TILE_ORDER);
const FACINGS: readonly Facing[] = [0, 1, 2, 3];

/** 四个朝向的状态（`facing` 指向贴着的那一面墙） */
const frameStates = FACINGS.map((facing) => withFacing(0, facing));
const paintingStates = FACINGS.map((facing, index) => withPaintingVariant(withFacing(0, facing), index));

check('展示框的四个朝向都读得回来', frameStates.every((state, index) => facingOf(state) === index));
check(
  '画：朝向与变体两个字段互不干扰（四朝向 × 四变体）',
  paintingStates.every((state, index) => facingOf(state) === index && paintingVariantOf(state) === index),
);

/** 状态 → 盒子四角（便于逐面比较，不依赖数组结构） */
function boxEdges(box: LocalBox): number[] {
  return [...box];
}

// ---------------------------------------------------------------- 1. 画作表

console.log('\n[画作表：只做 1×1 的 7 幅]');
{
  equal('7 幅（原版 1.18 里 1×1 的那一档）', PAINTING_VARIANTS.length, 7);
  check('远小于原版的 26 幅（多格拼贴还没做）', PAINTING_VARIANTS.length < VANILLA_PAINTING_COUNT);

  const notSingle = PAINTING_VARIANTS.filter((v) => v.width !== 1 || v.height !== 1);
  check('每一幅都是 1×1（本批的口径：跨格占用留给下一批）', notSingle.length === 0, notSingle.map((v) => v.name).join(','));

  const names = new Set(PAINTING_VARIANTS.map((v) => v.name));
  equal('原版名字不重复', names.size, PAINTING_VARIANTS.length);
  const cns = new Set(PAINTING_VARIANTS.map((v) => v.cn));
  equal('中文名不重复', cns.size, PAINTING_VARIANTS.length);

  const badTile = PAINTING_VARIANTS.filter((v) => !TILES.has(v.tile));
  check('每幅的贴图都在图集名单里', badTile.length === 0, badTile.map((v) => v.tile).join(','));
  const badTileName = PAINTING_VARIANTS.filter((v) => v.tile !== `painting_${v.name}`);
  check('贴图名的规律是 `painting_<原版名>`（名字写错会回退成石头贴图）', badTileName.length === 0);

  equal('paintingTile(0) 就是第一幅', paintingTile(0), PAINTING_VARIANTS[0]!.tile);
  equal('paintingTile 越界回退到第一幅（渲染不该整块消失）', paintingTile(99), PAINTING_VARIANTS[0]!.tile);
  equal('paintingName 越界给一个明确的值', paintingName(99), '未知的画');
}

console.log('\n[画作表：变体状态位]');
{
  let ok = true;
  for (let i = 0; i < PAINTING_VARIANTS.length; i++) {
    if (paintingVariantOf(withPaintingVariant(0, i)) !== i) ok = false;
  }
  check('写进去再读出来是同一个编号（7 幅逐个往返）', ok);

  equal('状态 0 默认挂第一幅', paintingVariantOf(0), 0);
  equal('越界（99）夹到上限档', paintingVariantOf(withPaintingVariant(0, 99)), PAINTING_VARIANT_LIMIT - 1);
  equal('负数夹到 0', paintingVariantOf(withPaintingVariant(0, -3)), 0);
  // 变体位不能踩到朝向那两位（bit1-2）
  equal('写变体不影响朝向', facingOf(withPaintingVariant(withFacing(0, 2), 5)), 2);
  equal('写朝向不影响变体', paintingVariantOf(withPaintingVariant(withFacing(0, 3), 6)), 6);

  equal('pickPaintingVariant(0) 是第一幅', pickPaintingVariant(() => 0), 0);
  equal('pickPaintingVariant(0.999) 是最后一幅', pickPaintingVariant(() => 0.999), PAINTING_VARIANTS.length - 1);
  equal('随机值 1（越界）夹到最后一幅', pickPaintingVariant(() => 1), PAINTING_VARIANTS.length - 1);
  equal('随机值 NaN（脏数据）回退第一幅', pickPaintingVariant(() => Number.NaN), 0);
  let inRange = true;
  for (let i = 0; i < 200; i++) {
    const index = pickPaintingVariant(() => i / 200);
    if (!Number.isInteger(index) || index < 0 || index >= PAINTING_VARIANTS.length) inRange = false;
  }
  check('200 次掷点全部落在合法范围', inRange);

  equal('describeState 会说清挂的是哪一幅', describeState('painting', withPaintingVariant(withFacing(0, 0), 4)), '贴北墙·篝火');
}

// ---------------------------------------------------------------- 2. 方块注册

console.log('\n[方块注册：展示框与画]');
{
  equal('展示框 id', ITEM_FRAME_ID, 541);
  equal('画 id', PAINTING_ID, 542);
  equal('Block 常量与 id 对得上', `${Block.ITEM_FRAME}/${Block.PAINTING}`, `${ITEM_FRAME_ID}/${PAINTING_ID}`);
  equal('展示框名字是原版的 minecraft:item_frame', blockDef(ITEM_FRAME_ID).name, 'minecraft:item_frame');
  equal('画名字是原版的 minecraft:painting', blockDef(PAINTING_ID).name, 'minecraft:painting');
  equal('展示框形状', blockDef(ITEM_FRAME_ID).shape, 'item_frame');
  equal('画形状', blockDef(PAINTING_ID).shape, 'painting');

  for (const [label, id] of [
    ['展示框', ITEM_FRAME_ID],
    ['画', PAINTING_ID],
  ] as const) {
    check(`${label}不算实心（不能拿它当支撑面）`, !blockDef(id).solid);
    check(`${label}不遮挡邻居`, !blockDef(id).opaque);
    check(`${label}不挡光`, blockDef(id).lightOpacity === 0);
    equal(`${label}不是整格方块（走逐盒通道）`, isFullBlockShape(blockDef(id).shape, 0), false);
    check(`${label}徒手一拍就掉（硬度 0）`, blockHardness(id) === 0);
    check(`${label}掉落自身`, dropFor(id)?.id === id);
    check(`${label}进"建筑"分类`, categoryOf(id) === 'building');
    check(`${label}能作为物品拿到`, itemDef(id) !== undefined);
    check(`${label}有中文名`, !itemLabel(id).includes('未知物品'), itemLabel(id));
    check(`${label}有说明`, hasDescription(id));
    check(`${label}不需要工具就能收`, canHarvest(id, null));
  }

  const frameTiles = new Set(blockTiles(ITEM_FRAME_ID, 0));
  equal('展示框三面用同一张镂空贴图', frameTiles.size, 1);
  check('展示框贴图在名单里', TILES.has([...frameTiles][0]!));

  const paintingTiles = PAINTING_VARIANTS.map((_v, index) => blockTiles(PAINTING_ID, withPaintingVariant(0, index))[2]);
  check(
    '画的贴图随状态换（7 幅各不相同）',
    new Set(paintingTiles).size === PAINTING_VARIANTS.length &&
      paintingTiles.every((tile) => TILES.has(tile)),
    paintingTiles.join(','),
  );
}

// ---------------------------------------------------------------- 3. 几何

console.log('\n[几何：贴墙薄板与框里的挂点]');
{
  const t = ITEM_FRAME_THICKNESS;
  const expectedFrame: readonly LocalBox[] = [
    [0, 0, 0, 1, 1, t],
    [1 - t, 0, 0, 1, 1, 1],
    [0, 0, 1 - t, 1, 1, 1],
    [0, 0, 0, t, 1, 1],
  ];
  FACINGS.forEach((facing, index) => {
    check(
      `展示框朝 ${facing} 那一面墙贴（盒子贴在那一侧）`,
      boxEdges(itemFrameBox(withFacing(0, facing))).join() === expectedFrame[index]!.join(),
      boxEdges(itemFrameBox(withFacing(0, facing))).join(),
    );
  });

  const p = PAINTING_THICKNESS;
  const expectedPainting: readonly LocalBox[] = [
    [0, 0, 0, 1, 1, p],
    [1 - p, 0, 0, 1, 1, 1],
    [0, 0, 1 - p, 1, 1, 1],
    [0, 0, 0, p, 1, 1],
  ];
  FACINGS.forEach((facing, index) => {
    check(
      `画朝 ${facing} 那一面墙贴`,
      boxEdges(paintingBox(withFacing(0, facing))).join() === expectedPainting[index]!.join(),
    );
  });
  check('画比展示框薄（它就是一层面）', PAINTING_THICKNESS < ITEM_FRAME_THICKNESS);
  check('框里的物品比洞口小（留一道缝）', ITEM_FRAME_ITEM_SIZE < 8 / 16 && ITEM_FRAME_ITEM_SIZE > 6 / 16);

  // 挂点：在框面**外侧**（玩家看得见的那一边），法线朝外
  for (const facing of FACINGS) {
    const state = withFacing(0, facing);
    const anchor = itemFrameItemAnchor(state);
    const [sx, sz] = wallSupportOffset(state);
    check(
      `朝 ${facing}：挂点法线与支撑方向相反（物品朝外、支撑在墙那一侧）`,
      anchor.nx === -sx && anchor.nz === -sz,
      `${anchor.nx},${anchor.nz} vs ${sx},${sz}`,
    );
    // 挂点要落在这一格之内（负数或超过 1 说明法线算反了，物品会飘到隔壁格）
    check(
      `朝 ${facing}：挂点落在本格之内`,
      anchor.x > 0 && anchor.x < 1 && anchor.z > 0 && anchor.z < 1 && anchor.y === 0.5,
      `${anchor.x},${anchor.y},${anchor.z}`,
    );
    // 挂点必须在**整块板之外**：写成"半块板厚"会把物品摆在洞口那一层（嵌进墙里）
    const depth = anchor.nx !== 0 ? Math.abs(anchor.x - 0.5) : Math.abs(anchor.z - 0.5);
    check(
      `朝 ${facing}：挂点在整块板之外（不是"半块板"）`,
      depth > ITEM_FRAME_THICKNESS,
      `${depth} vs ${ITEM_FRAME_THICKNESS}`,
    );
    // 而且不能飘到格子中间去（那会让物品看着离开框面）
    check(`朝 ${facing}：挂点仍然贴着框面（不超过 1/4 格）`, depth < 0.25, String(depth));
  }

  check(
    'outwardFacingOf 与"支撑方向"正好相反（四个朝向）',
    FACINGS.every((facing) => {
      const outward = outwardFacingOf(withFacing(0, facing));
      const [sx, sz] = wallSupportOffset(withFacing(0, facing));
      const [ox, oz] = wallSupportOffset(withFacing(0, outward));
      return ox === -sx && oz === -sz;
    }),
  );
}

console.log('\n[形状：碰撞盒与渲染盒]');
{
  check('展示框没有碰撞盒（原版能走进去）', collisionBoxes('item_frame', 0).length === 0);
  check('画没有碰撞盒（原版能穿过去）', collisionBoxes('painting', 0).length === 0);
  check('展示框有渲染盒', meshBoxes('item_frame', 0).length === 1);
  check('画有渲染盒', meshBoxes('painting', 0).length === 1);
  check('展示框的渲染盒就是那两块几何之一', meshBoxes('item_frame', withFacing(0, 2))[0]!.join() === itemFrameBox(withFacing(0, 2)).join());
  check('画的渲染盒与几何同源', meshBoxes('painting', withFacing(0, 1))[0]!.join() === paintingBox(withFacing(0, 1)).join());
}

// ---------------------------------------------------------------- 4. 放置

console.log('\n[放置规则]');
{
  /** 造一份 planPlacement 的输入：blocks 的键是相对落点那一格的偏移 */
  function plan(
    blockId: number,
    normal: readonly [number, number, number],
    blocks: Record<string, number>,
    random?: () => number,
  ): ReturnType<typeof planPlacement> {
    return planPlacement({
      blockId,
      normal,
      hitX: 10.5,
      hitY: 20.5,
      hitZ: 10.5,
      yaw: 0,
      sneaking: false,
      blockAt: (dx, dy, dz) => blocks[`${dx},${dy},${dz}`] ?? Block.AIR,
      stateAt: () => 0,
      hitBlock: blocks[`${-normal[0]},${-normal[1]},${-normal[2]}`] ?? Block.AIR,
      hitState: 0,
      ...(random ? { random } : {}),
    });
  }

  // 命中面法线朝 +Z（玩家从南边看，墙在北边 → 贴着的那面墙在 -Z）
  const northWall = { '0,0,-1': Block.STONE };
  const framePlan = plan(ITEM_FRAME_ID, [0, 0, 1], northWall);
  check('贴北墙能放', framePlan !== null);
  equal('朝向 = 贴着的那一面（北 → 0）', facingOf(framePlan!.state), 0);
  equal('展示框本身不写变体位（那不是它的字段）', paintingVariantOf(framePlan!.state), 0);

  check('点方块顶面放不了（原版地板挂不了画）', plan(ITEM_FRAME_ID, [0, 1, 0], { '0,-1,0': Block.STONE }) === null);
  check('点方块底面放不了', plan(ITEM_FRAME_ID, [0, -1, 0], { '0,1,0': Block.STONE }) === null);
  check('墙是空气 → 挂不住', plan(ITEM_FRAME_ID, [0, 0, 1], {}) === null);
  check('墙是水（不实心）→ 挂不住', plan(ITEM_FRAME_ID, [0, 0, 1], { '0,0,-1': Block.WATER }) === null);

  const eastWall = { '1,0,0': Block.STONE };
  equal('贴东墙 → 朝向 1', facingOf(plan(ITEM_FRAME_ID, [-1, 0, 0], eastWall)!.state), 1);
  equal('贴西墙 → 朝向 3', facingOf(plan(ITEM_FRAME_ID, [1, 0, 0], { '-1,0,0': Block.STONE })!.state), 3);

  // 画：变体由注入的随机源决定（0 / 0.5 / 0.99 三档逐个钉住）
  const paintingR0 = plan(PAINTING_ID, [0, 0, 1], northWall, () => 0);
  const paintingR5 = plan(PAINTING_ID, [0, 0, 1], northWall, () => 0.5);
  const paintingR9 = plan(PAINTING_ID, [0, 0, 1], northWall, () => 0.99);
  equal('随机 0 → 第 1 幅', paintingVariantOf(paintingR0!.state), 0);
  equal('随机 0.5 → 中间那一幅', paintingVariantOf(paintingR5!.state), 3);
  equal('随机 0.99 → 最后一幅', paintingVariantOf(paintingR9!.state), PAINTING_VARIANTS.length - 1);
  equal('画的朝向与随机无关', facingOf(paintingR9!.state), 0);
  check('画也只能贴墙（顶面不行）', plan(PAINTING_ID, [0, 1, 0], { '0,-1,0': Block.STONE }) === null);
}

// ---------------------------------------------------------------- 5. 展示框数据表

console.log('\n[展示框数据表]');
{
  const store = new ItemFrameStore();
  equal('键的写法与容器/牌子同一套', frameKey('overworld', 3, 64, -7), 'overworld|3,64,-7');
  equal('一开始是空的', store.size, 0);
  check('没写过就是空框', store.get('overworld', 1, 2, 3) === null);
  check('has 也是假', !store.has('overworld', 1, 2, 3));

  check('放一件东西', store.set('overworld', 1, 2, 3, { id: Block.STONE, count: 1 }, 0));
  equal('表里多了一条', store.size, 1);
  equal('读回来是同一件', store.get('overworld', 1, 2, 3)!.item.id, Block.STONE);
  check('键带维度：另一个维度的同一坐标是空的', store.get('nether', 1, 2, 3) === null);

  // 旋转
  equal('第一次转 → 1', store.rotate('overworld', 1, 2, 3), 1);
  let rotation = 1;
  for (let i = 0; i < FRAME_ROTATIONS - 1; i++) rotation = store.rotate('overworld', 1, 2, 3);
  equal('转 8 次回到原位', rotation, 0);
  equal('空框转不了（返回 0）', store.rotate('overworld', 9, 9, 9), 0);
  equal('nextFrameRotation 规整负数', nextFrameRotation(-1), FRAME_ROTATIONS - 1);
  equal('nextFrameRotation 规整超大值', nextFrameRotation(99), 99 % FRAME_ROTATIONS);
  equal('nextFrameRotation 规整小数', nextFrameRotation(2.7), 2);

  // 斜挂要缩小（框的洞口只有 8/16）
  equal('正着挂不缩', frameItemScale(0), 1);
  near('斜 45° 缩到 1/√2', frameItemScale(1), Math.SQRT1_2);
  equal('斜 135° 也缩', frameItemScale(3), Math.SQRT1_2);
  equal('180° 不缩', frameItemScale(4), 1);
  near('frameItemAngle(1) 是 45°', frameItemAngle(1), Math.PI / 4);
  near('frameItemAngle(8) 回到 0（脏数据也被规整）', frameItemAngle(8), 0);

  // get 返回副本：改返回值不该动到表里的那一件
  const copy = store.get('overworld', 1, 2, 3)!;
  copy.item.id = Block.BEDROCK;
  copy.rotation = 7;
  equal('改返回值不影响表里的物品', store.get('overworld', 1, 2, 3)!.item.id, Block.STONE);
  equal('改返回值不影响表里的旋转', store.get('overworld', 1, 2, 3)!.rotation, 0);

  // 空框不进表
  check('set(null) 会删掉条目（空框不进表）', !store.set('overworld', 1, 2, 3, null, 0));
  equal('删完表就空了', store.size, 0);

  // 脏数据：坏 id / 坏数量 / 坏坐标
  equal('id 不在物品表里 → 不进表', normalizeFrameItem({ id: 99999, count: 1 }), null);
  equal('id 是空气 → 不进表', normalizeFrameItem({ id: Block.AIR, count: 1 }), null);
  equal('数量是 0 → 不进表', normalizeFrameItem({ id: Block.STONE, count: 0 }), null);
  equal('不是对象 → 不进表', normalizeFrameItem('stone'), null);
  equal('数量 9999 夹到 64', normalizeFrameItem({ id: Block.STONE, count: 9999 })!.count, 64);
  equal('数量 2.7 取整', normalizeFrameItem({ id: Block.STONE, count: 2.7 })!.count, 2);
}

console.log('\n[展示框数据表：附魔/改名/内容物原样往返]');
{
  const store = new ItemFrameStore();
  store.set(
    'overworld',
    5,
    6,
    7,
    {
      id: 1006, // 钻石
      count: 1,
      damage: 12,
      enchants: { sharpness: 3 },
      name: '挂在墙上那把剑',
      repairCost: 5,
    },
    3,
  );
  const entry = store.get('overworld', 5, 6, 7)!;
  equal('耐久带过来了', entry.item.damage, 12);
  equal('附魔带过来了', entry.item.enchants!.sharpness, 3);
  equal('改名带过来了', entry.item.name, '挂在墙上那把剑');
  equal('累积惩罚带过来了', entry.item.repairCost, 5);
  equal('旋转也带过来了', entry.rotation, 3);

  // 潜影盒的内容物（复核 restoreStack 那一层深拷）
  const box = new ItemFrameStore();
  box.set('overworld', 1, 1, 1, { id: Block.SHULKER_BOX, count: 1, contents: [{ id: Item.DIAMOND, count: 3 }, null] }, 0);
  const boxed = box.get('overworld', 1, 1, 1)!;
  equal('内容物的 id 也在', boxed.item.contents![0]!.id, Item.DIAMOND);

  // 存档往返（含 JSON 往返：IndexedDB 走的也是结构化克隆）
  const raw = JSON.parse(JSON.stringify(serializeFrames(store))) as unknown;
  const restored = new ItemFrameStore();
  equal('读回来一条', restoreFrames(restored, raw), 1);
  const back = restored.get('overworld', 5, 6, 7)!;
  equal('存档往返后附魔还在', back.item.enchants!.sharpness, 3);
  equal('存档往返后名字还在', back.item.name, '挂在墙上那把剑');
  equal('存档往返后旋转还在', back.rotation, 3);
}

console.log('\n[展示框数据表：脏数据逐条跳过]');
{
  const store = new ItemFrameStore();
  const raw = [
    { dimension: 'overworld', x: 1, y: 2, z: 3, item: { id: Block.STONE, count: 1 }, rotation: 0 },
    { dimension: 'moon', x: 1, y: 2, z: 3, item: { id: Block.STONE, count: 1 } }, // 不认识的维度
    { dimension: 'overworld', x: Number.NaN, y: 2, z: 3, item: { id: Block.STONE, count: 1 } }, // 坏坐标
    { dimension: 'overworld', x: 1, y: 2, z: 3, item: { id: 123456, count: 1 } }, // 坏物品
    { dimension: 'overworld', x: 4, y: 5, z: 6, item: { id: Block.DIRT, count: 1 }, rotation: 99 }, // 坏旋转
    null,
    'nonsense',
  ];
  equal('只读进合法的那两条', restoreFrames(store, raw), 2);
  check('坏旋转被规整回合法档位', store.get('overworld', 4, 5, 6)!.rotation === 99 % FRAME_ROTATIONS);
  equal('不认识的维度不进表', store.get('moon', 1, 2, 3), null);
  equal('restoreFrames 收到的不是数组 → 0 条', restoreFrames(store, 'nope'), 0);
}

// ---------------------------------------------------------------- 6. 贴附面支撑

console.log('\n[贴附面支撑：墙没了就掉]');
{
  /** 一块小小的假世界：方块 + 状态两张表 */
  function makeWorld(blocks: Record<string, number>, states: Record<string, number> = {}): {
    world: SupportWorld;
    blocks: Record<string, number>;
  } {
    const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
    const store = { ...blocks };
    const stateStore = { ...states };
    return {
      blocks: store,
      world: {
        getBlock: (x, y, z) => store[key(x, y, z)] ?? Block.AIR,
        setBlock: (x, y, z, id) => {
          store[key(x, y, z)] = id;
        },
        getState: (x, y, z) => stateStore[key(x, y, z)] ?? 0,
      },
    };
  }

  equal('展示框的支撑类型是贴附面', supportKindOf(Block.ITEM_FRAME), 'wall');
  equal('画的支撑类型是贴附面', supportKindOf(Block.PAINTING), 'wall');
  equal('火把还是"不处理"（这一批没扩散到它）', supportKindOf(Block.TORCH), 'none');

  // 展示框贴在 (0,0,0) 的南墙上：facing 2 → 支撑在 (0,0,1)
  const { world } = makeWorld({ '0,0,0': Block.ITEM_FRAME, '0,0,1': Block.STONE }, { '0,0,0': withFacing(0, 2) });
  check('墙在 → 立得住', supportIsValid(world, 0, 0, 0));

  const { world: noWall } = makeWorld({ '0,0,0': Block.ITEM_FRAME }, { '0,0,0': withFacing(0, 2) });
  check('墙没了 → 立不住', !supportIsValid(noWall, 0, 0, 0));

  const { world: weakWall } = makeWorld({ '0,0,0': Block.ITEM_FRAME, '0,0,1': Block.WATER }, { '0,0,0': withFacing(0, 2) });
  check('支撑是水（不实心）→ 立不住', !supportIsValid(weakWall, 0, 0, 0));

  // 没有 getState 的老世界桩：不该被误伤（宁可不收，也别凭空拆东西）
  const legacy: SupportWorld = {
    getBlock: (x, y, z) => (x === 0 && y === 0 && z === 0 ? Block.ITEM_FRAME : Block.AIR),
    setBlock: () => undefined,
  };
  check('拿不到状态的旧桩 → 按立得住处理', supportIsValid(legacy, 0, 0, 0));

  // 拆掉墙：挂在它上面的框跟着掉
  const scene = makeWorld({ '0,0,2': Block.STONE, '1,0,2': Block.ITEM_FRAME }, { '1,0,2': withFacing(0, 3) });
  scene.world.setBlock(0, 0, 2, Block.AIR);
  const removed: string[] = [];
  const count = sweepHangingsAround(scene.world, 0, 0, 2, (x, y, z, id) => removed.push(`${x},${y},${z}=${id}`));
  equal('收掉 1 个挂着的框', count, 1);
  equal('回调拿到了它的坐标与本体（掉落要用）', removed.join(), `1,0,2=${Block.ITEM_FRAME}`);
  equal('那一格变成空气了', scene.world.getBlock(1, 0, 2), Block.AIR);

  // 墙还在时不收
  const stable = makeWorld({ '0,0,2': Block.STONE, '1,0,2': Block.ITEM_FRAME }, { '1,0,2': withFacing(0, 3) });
  equal('墙还在 → 一格都不收', sweepHangingsAround(stable.world, 0, 0, 2), 0);
  equal('框照旧在原处', stable.world.getBlock(1, 0, 2), Block.ITEM_FRAME);

  // 六个面都要看：拆掉框下面的方块不该把它带走（那是"站着"的关系，不是"贴着"）
  const below = makeWorld({ '1,-1,2': Block.STONE, '1,0,2': Block.ITEM_FRAME, '1,0,3': Block.STONE }, { '1,0,2': withFacing(0, 2) });
  below.world.setBlock(1, -1, 2, Block.AIR);
  equal('拆掉它下面的方块：立得住（支撑在侧面，与脚下无关）', sweepHangingsAround(below.world, 1, -1, 2), 0);
}

// ---------------------------------------------------------------- 7. 配方

console.log('\n[配方]');
{
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

  const frameGrid = grid(3, ['SSS', 'SLS', 'SSS'], { S: Item.STICK, L: Item.LEATHER });
  equal('8 木棍 + 皮革 → 展示框', matchRecipe(frameGrid, 3)?.id, Block.ITEM_FRAME);
  equal('产量 1', matchRecipe(frameGrid, 3)?.count, 1);
  equal('中间那格必须是皮革（换成木棍就不是展示框了）', matchRecipe(grid(3, ['SSS', 'SSS', 'SSS'], { S: Item.STICK }), 3)?.id ?? -1, -1);

  // 画：16 种羊毛各一条（原版是"任意羊毛"的标签配方）。
  // ⚠️ 羊毛 id **按配色表取**（`woolId(i)`），不写死数字：
  // 写死一个"看起来像"的起点会让这 16 条全部落空，而断言只会说"0 条"
  let woolOk = 0;
  for (let color = 0; color < 16; color++) {
    const cells = grid(3, ['SSS', 'SWS', 'SSS'], { S: Item.STICK, W: woolId(color) });
    if (matchRecipe(cells, 3)?.id === Block.PAINTING) woolOk++;
  }
  equal('16 种羊毛都能做画（标签配方展开）', woolOk, 16);

  equal('中间换成石头就不是画了', matchRecipe(grid(3, ['SSS', 'SXS', 'SSS'], { S: Item.STICK, X: Block.STONE }), 3)?.id ?? -1, -1);
  equal('画与展示框的产量都是 1', matchRecipe(grid(3, ['SSS', 'SWS', 'SSS'], { S: Item.STICK, W: woolId(0) }), 3)?.count, 1);
}

// ---------------------------------------------------------------- 8. 图集

console.log('\n[图集]');
{
  const expected = ['item_frame', ...PAINTING_VARIANTS.map((v) => v.tile)];
  const missing = expected.filter((tile) => !TILES.has(tile));
  check('8 张新贴图都在名单里', missing.length === 0, missing.join(','));
  check('贴图名不重复（重复会让图集索引错位）', new Set(TILE_ORDER).size === TILE_ORDER.length);
  const order = expected.map((tile) => TILE_ORDER.indexOf(tile as (typeof TILE_ORDER)[number]));
  check('7 幅画在名单里是连着的（顺序与画作表一致）', order.slice(1).every((value, index) => value === order[index]! + 1));
}

// ---------------------------------------------------------------- 收尾

console.log(`\n展示框与画测试：${passed} 通过 / ${failed} 失败\n`);
if (failed > 0) process.exit(1);
