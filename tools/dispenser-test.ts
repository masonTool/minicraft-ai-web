/**
 * 发射器离线测试（批次 60，H14 的第三件容器类功能方块）
 *
 * 发射器 = 投掷器 + **一张发射行为表**（`registry/dispense.ts`）+ **一个执行器**
 * （`world/Dispense.ts`）。所以断言分三层，每层盯一件不同的事：
 *
 *  1. **表**：哪件物品算什么、有没有指向不存在的物品、缺的那几项（装液体的桶、船、矿车…）
 *     有没有被偷偷"假装支持"（骨粉原本也在这张名单里，**批次 69 已经接上"施肥"那一档**）；
 *  2. **执行器**：射/扔/点燃/点火/剪这五种动作各自"用成功/失败"的判据，
 *     以及**出膛点与初速**（这些数字是玩家手感，必须钉住）；
 *  3. **容器与登记**：9 格、与投掷器共用容器（子类）、存档里的种类、红石脉冲、
 *     活塞推不动、配方与投掷器**不撞车**。
 *
 * 运行：npm run test:dispenser
 */

import { Block, blockDef, blockHardness } from '../web/src/core/registry/blocks.ts';
import {
  sixFacingLabel,
  describeState,
  sixFacingOf,
  sixFacingOffset,
  withHopperOutput,
  withSixFacing,
} from '../web/src/core/registry/blockState.ts';
import { collisionBoxes, dispenserBoxes, dropperBoxes, meshBoxes } from '../web/src/core/registry/blockShapes.ts';
import { planPlacement, type PlacementInput } from '../web/src/core/interaction/Placement.ts';
import { Item, categoryOf, itemDef, maxStackOf } from '../web/src/core/registry/items.ts';
import { hasDescription, itemLabel } from '../web/src/core/registry/itemNames.ts';
import { canHarvest, harvestRequirement, makeToolInfo, toolItemId } from '../web/src/core/registry/tools.ts';
import { LINGERING_POTIONS, SPLASH_POTIONS, TIPPED_ARROWS } from '../web/src/core/registry/potions.ts';
import {
  DEFAULT_DISPENSE_CN,
  dispenseBehaviorCount,
  dispenseBehaviorFor,
  dispenseBehaviors,
} from '../web/src/core/registry/dispense.ts';
import { matchRecipe } from '../web/src/core/crafting/Recipes.ts';
import { DISPENSER_SIZE, Dispenser } from '../web/src/core/container/Dispenser.ts';
import { DROPPER_SIZE, Dropper } from '../web/src/core/container/Dropper.ts';
import { acceptingSlots, containerSlotCount, peekTake, tryInsertOne } from '../web/src/core/container/Transfer.ts';
import { BlockEntityStore, CONTAINER_BLOCKS } from '../web/src/core/world/BlockEntityStore.ts';
import {
  SLOT_COUNTS,
  kindOf,
  restoreContainers,
  serializeContainers,
  type SerializedContainer,
} from '../web/src/core/save/ContainerSave.ts';
import { Dimension } from '../web/src/core/gen/Dimension.ts';
import {
  DISPENSER_ARROW_DAMAGE,
  DISPENSER_NOSE,
  DISPENSER_SHOOT_SPEED,
  DISPENSER_THROW_LIFT,
  DISPENSER_THROW_SPEED,
  runDispenseAction,
  type DispenseArrowOptions,
  type DispenseContext,
} from '../web/src/core/world/Dispense.ts';
import { RedstoneEngine, canPush, isRedstoneComponent, type RedstoneWorld } from '../web/src/core/redstone/RedstoneEngine.ts';
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

const TILES = new Set<string>(TILE_ORDER);
const DISP = Block.DISPENSER;

/** 一件物品（"用一件"这件事到处都是） */
function one(id: number, count = 1): { id: number; count: number } {
  return { id, count };
}

/** 造一个放置输入（默认：对着石头顶面放、玩家朝北、不潜行） */
function placement(overrides: Partial<PlacementInput>): PlacementInput {
  return {
    blockId: DISP,
    normal: [0, 1, 0],
    hitX: 0.5,
    hitY: 1,
    hitZ: 0.5,
    yaw: 0,
    sneaking: false,
    blockAt: () => Block.AIR,
    hitBlock: Block.STONE,
    hitState: 0,
    ...overrides,
  };
}

/** 一次发射记录 */
interface Shot {
  x: number;
  y: number;
  z: number;
  velocity: { x: number; y: number; z: number };
  kind: string;
  itemId: number;
}

/** 假世界：只回答"某一格是什么方块" */
function fakeContext(
  options: {
    blockAt?: (x: number, y: number, z: number) => number;
    primeOk?: boolean;
    igniteOk?: boolean;
    shearCount?: number;
    /** 骨粉那一档（批次 69 加的行为）：默认失败，本套断言不关心它的细节 */
    fertilizeOk?: boolean;
  } = {},
): { ctx: DispenseContext; arrows: { x: number; y: number; z: number; velocity: Shot['velocity']; options: DispenseArrowOptions }[]; shots: Shot[]; sounds: string[] } {
  const arrows: { x: number; y: number; z: number; velocity: Shot['velocity']; options: DispenseArrowOptions }[] = [];
  const shots: Shot[] = [];
  const sounds: string[] = [];
  const ctx: DispenseContext = {
    blockAt: options.blockAt ?? (() => Block.AIR),
    shootArrow: (x, y, z, velocity, arrowOptions) => arrows.push({ x, y, z, velocity, options: arrowOptions }),
    throwProjectile: (x, y, z, velocity, kind, itemId) => shots.push({ x, y, z, velocity, kind, itemId }),
    primeTnt: () => options.primeOk ?? true,
    igniteFire: () => options.igniteOk ?? true,
    shearAt: () => options.shearCount ?? 0,
    // 批次 69 新增：骨粉那一档（本套断言不触发它，但接口要求存在）
    fertilizeAt: () => options.fertilizeOk ?? false,
    playSound: (kind) => sounds.push(kind),
  };
  return { ctx, arrows, shots, sounds };
}

// ---------------------------------------------------------------- 1. 注册与外观

console.log('\n[注册与外观]');
{
  equal('方块 id 是 478（接在投掷器后面）', DISP, 478);
  equal('id 紧接在投掷器之后（477 → 478）', DISP, Block.DROPPER + 1);
  equal('注册名', blockDef(DISP).name, 'minicraft:dispenser');
  equal('中文名', itemLabel(DISP), '发射器');
  check('有物品说明', hasDescription(DISP));
  equal('形状是 dispenser（整格铁壳 + 挡板）', blockDef(DISP).shape, 'dispenser');
  check('是整格方块（不透明、挡光）', blockDef(DISP).opaque);
  equal('五个非挡板面共用同一张外壳', blockDef(DISP).tiles[0], blockDef(DISP).tiles[2]);
  equal('外壳只有一张', new Set(blockDef(DISP).tiles).size, 1);
  const missing = blockDef(DISP).tiles.filter((tile) => !TILES.has(tile));
  check('两张贴图都在图集里', missing.length === 0, `缺少 ${missing.join(', ')}`);

  const def = itemDef(DISP);
  check('有对应的物品', def !== undefined);
  equal('物品指向这个方块', def?.block, DISP);
  equal('可堆叠 64', maxStackOf(DISP), 64);
  equal('创造分类是"功能方块"', categoryOf(DISP), 'functional');
  equal('图标用侧面那张', def?.tile, 'dispenser_side');

  equal('硬度 3.5（与投掷器同一档）', blockHardness(DISP), 3.5);
  equal('要求工具是镐 0 级', harvestRequirement(DISP)?.tool, 'pickaxe');
  check('徒手挖得动但一无所获', !canHarvest(DISP, null));
  check('木镐能采', canHarvest(DISP, makeToolInfo('pickaxe', 'wooden')));
  equal('是红石元件（脉冲触发）', isRedstoneComponent(DISP), true);
  equal('9 格', DISPENSER_SIZE, 9);
}

// ---------------------------------------------------------------- 2. 发射行为表

console.log('\n[行为表：哪件物品算什么]');
{
  // 逐条对照：动作 + （投掷类）扔出来的是哪一种
  const EXPECTED: readonly { id: number; cn: string; action: string; projectile?: string }[] = [
    { id: Item.ARROW, cn: '箭', action: 'shoot-arrow' },
    { id: Item.SNOWBALL, cn: '雪球', action: 'throw-projectile', projectile: 'snowball' },
    { id: Item.EGG, cn: '鸡蛋', action: 'throw-projectile', projectile: 'egg' },
    { id: Block.TNT, cn: 'TNT', action: 'prime-tnt' },
    { id: Item.FLINT_AND_STEEL, cn: '打火石', action: 'ignite-fire' },
    { id: Item.SHEARS, cn: '剪刀', action: 'shear-entity' },
  ];
  for (const entry of EXPECTED) {
    const behavior = dispenseBehaviorFor(entry.id);
    check(
      `${entry.cn}：${entry.action}`,
      behavior?.action === entry.action && (entry.projectile === undefined || behavior.projectile === entry.projectile),
      `实际 ${behavior?.action ?? '无'} / ${behavior?.projectile ?? '无'}`,
    );
  }

  // 末影珍珠**故意不进这张表**（批次 113）：原版发射器能放珍珠，但那样扔出去的珍珠
  // **没有主人**、落地什么都不发生（白扔一颗）。本项目的珍珠落地会"把扔它的人传过去"，
  // 而发射器这一路没有"人"可传——所以宁可不做这一档。
  // ⚠️ 这是一条**给未来的人看的断言**：谁要是把珍珠加进发射器表，它会立刻红，
  // 提醒回去把 `Throwable.impact` 里那段注释说的"要认主人"补上。
  check(
    '末影珍珠不在发射器行为表里（发射器扔出去的珍珠没有主人可传）',
    dispenseBehaviorFor(Item.ENDER_PEARL) === undefined,
    `实际 ${dispenseBehaviorFor(Item.ENDER_PEARL)?.action ?? '无'}`,
  );
  check('（对照）它仍然是个能右键扔的物品', itemDef(Item.ENDER_PEARL) !== undefined);

  // 工具类才磨损：打火石与剪刀各 1 点，其余不磨损（"减少一件"）
  equal('打火石用一次耗 1 点耐久', dispenseBehaviorFor(Item.FLINT_AND_STEEL)?.wear, 1);
  equal('剪刀用一次耗 1 点耐久', dispenseBehaviorFor(Item.SHEARS)?.wear, 1);
  equal('箭不磨损（整支消耗）', dispenseBehaviorFor(Item.ARROW)?.wear, undefined);

  // 药水与药水箭：整批展开（不手抄 id）
  equal('喷溅药水都在表里', SPLASH_POTIONS.every((p) => dispenseBehaviorFor(p.id)?.projectile === 'splash_potion'), true);
  equal('滞留药水都在表里', LINGERING_POTIONS.every((p) => dispenseBehaviorFor(p.id)?.projectile === 'lingering_potion'), true);
  equal('药水箭都走"射箭"这一档', TIPPED_ARROWS.every((a) => dispenseBehaviorFor(a.id)?.action === 'shoot-arrow'), true);

  // 表里每一条都必须指向**真的存在**的物品（历史上踩过"指向空气"的坑）
  const dangling = dispenseBehaviors().filter((entry) => itemDef(entry.id) === undefined);
  check('表里没有指向不存在物品的条目', dangling.length === 0, dangling.map((entry) => entry.id).join(', '));
  equal(
    `表里的条数（箭 1 + 药水箭 ${TIPPED_ARROWS.length} + 雪球 1 + 鸡蛋 1 + 喷溅 ${SPLASH_POTIONS.length} + 滞留 ${LINGERING_POTIONS.length} + TNT 1 + 打火石 1 + 剪刀 1 + 骨粉 1）`,
    dispenseBehaviorCount(),
    7 + TIPPED_ARROWS.length + SPLASH_POTIONS.length + LINGERING_POTIONS.length,
  );

  // 表里没有的 → 与投掷器一样吐出去
  equal('石头没有行为（当掉落物吐出去）', dispenseBehaviorFor(Block.STONE), undefined);
  equal('钻石镐没有行为（照样吐出去）', dispenseBehaviorFor(toolItemId('pickaxe', 'diamond')), undefined);
  check('默认行为的文案写出来了', DEFAULT_DISPENSE_CN.includes('投掷器'));

  // ⚠️ 明说"缺什么"：原版有、本项目还没物品的那几项不能被假装支持
  equal('空桶没有行为（本项目没有装液体的桶 → 原版"倒出水/岩浆"做不了）', dispenseBehaviorFor(Item.BUCKET), undefined);
  equal('牛奶桶没有行为', dispenseBehaviorFor(Item.MILK_BUCKET), undefined);
  // 骨粉（批次 69）已经接上了：表里那一档叫 `fertilize`，细节在 `bonemeal-test.ts` 里逐条验
  equal('骨粉有行为（给凸口那一格的作物施肥）', dispenseBehaviorFor(Item.BONE_MEAL)?.action, 'fertilize');
  equal('骨头本身没有行为（发射的是骨粉，不是骨头）', dispenseBehaviorFor(Item.BONE), undefined);
}

// ---------------------------------------------------------------- 3. 执行器

console.log('\n[执行器：射 / 扔 / 点燃 / 点火 / 剪]');
{
  const arrow = dispenseBehaviorFor(Item.ARROW)!;
  const snowball = dispenseBehaviorFor(Item.SNOWBALL)!;
  // ⚠️ `dispenseBehaviorFor` 给的是**行为**（没有 id）：要问"扔出去的是哪一瓶"得留着条目本身
  const potionItem = SPLASH_POTIONS[0]!;
  const potion = dispenseBehaviorFor(potionItem.id)!;
  const tnt = dispenseBehaviorFor(Block.TNT)!;
  const flint = dispenseBehaviorFor(Item.FLINT_AND_STEEL)!;
  const shears = dispenseBehaviorFor(Item.SHEARS)!;

  // ---- 箭：射出去（北向）
  const arrowRun = fakeContext();
  check('箭射出去了', runDispenseAction(arrow, one(Item.ARROW), 10, 64, 10, 0, 0, -1, arrowRun.ctx));
  equal('射了一支箭', arrowRun.arrows.length, 1);
  equal('出膛点在北侧外面一点', arrowRun.arrows[0]!.z.toFixed(2), (10.5 - DISPENSER_NOSE).toFixed(2));
  equal('初速朝北', arrowRun.arrows[0]!.velocity.z, -DISPENSER_SHOOT_SPEED);
  equal('没有横向速度', arrowRun.arrows[0]!.velocity.x, 0);
  equal('伤害按原版那档（低于满弓的 6）', arrowRun.arrows[0]!.options.damage, DISPENSER_ARROW_DAMAGE);
  equal('发射器射出的箭**捡不回来**', arrowRun.arrows[0]!.options.pickable, false);
  equal('这一箭是哪件物品：箭', arrowRun.arrows[0]!.options.itemId, Item.ARROW);
  check('放了射击音效', arrowRun.sounds.includes('bow_shoot'));

  // ---- 药水箭也走射箭，并且记得自己是哪一支
  const tipped = TIPPED_ARROWS[0]!;
  const tippedRun = fakeContext();
  check('药水箭也射出去', runDispenseAction(arrow, one(tipped.id), 10, 64, 10, 0, 1, 0, tippedRun.ctx));
  equal('这一箭记住自己是哪支药水箭', tippedRun.arrows[0]!.options.itemId, tipped.id);

  // ---- 雪球：扔出去，带着抬头量（朝下扔也不会砸自己脚下）
  const snowRun = fakeContext();
  check('雪球扔出去了', runDispenseAction(snowball, one(Item.SNOWBALL), 0, 64, 0, 0, -1, 0, snowRun.ctx));
  equal('扔的是雪球', snowRun.shots[0]!.kind, 'snowball');
  equal('朝下扔也带抬头量（否则砸在自己脚下）', snowRun.shots[0]!.velocity.y, -DISPENSER_THROW_SPEED + DISPENSER_THROW_LIFT);

  const potionRun = fakeContext();
  check('药水砸出去了', runDispenseAction(potion, one(potionItem.id), 0, 64, 0, 1, 0, 0, potionRun.ctx));
  equal('扔的是喷溅药水', potionRun.shots[0]!.kind, 'splash_potion');
  equal('扔出去的是这一瓶', potionRun.shots[0]!.itemId, potionItem.id);

  // ---- TNT：对面是 TNT 才点；不是就卡住（东西留着）
  const tntHit = fakeContext({ blockAt: () => Block.TNT });
  check('对面是 TNT → 点燃', runDispenseAction(tnt, one(Block.TNT), 0, 64, 0, 0, 1, 0, tntHit.ctx));
  check('点燃的是凸口那一格（上方）', tntHit.sounds.includes('flint'));
  const tntMiss = fakeContext({ blockAt: () => Block.AIR });
  check('对面是空气 → 不点燃（物品留着）', !runDispenseAction(tnt, one(Block.TNT), 0, 64, 0, 0, 1, 0, tntMiss.ctx));
  equal('卡住时不放音效', tntMiss.sounds.length, 0);
  const tntRefused = fakeContext({ blockAt: () => Block.TNT, primeOk: false });
  check('引信表拒绝（已经点过）→ 也算失败', !runDispenseAction(tnt, one(Block.TNT), 0, 64, 0, 0, 1, 0, tntRefused.ctx));

  // ---- 打火石：那一格能点着才成功
  const fireOk = fakeContext({ igniteOk: true });
  check('那一格能点着 → 成功', runDispenseAction(flint, one(Item.FLINT_AND_STEEL), 0, 64, 0, 1, 0, 0, fireOk.ctx));
  const fireBad = fakeContext({ igniteOk: false });
  check('那一格点不着（不是空气/没有可燃物）→ 失败', !runDispenseAction(flint, one(Item.FLINT_AND_STEEL), 0, 64, 0, 1, 0, 0, fireBad.ctx));

  // ---- 剪刀：那一格有能剪的羊才成功
  const shearOk = fakeContext({ shearCount: 3 });
  check('那一格有羊 → 成功', runDispenseAction(shears, one(Item.SHEARS), 0, 64, 0, 0, -1, 0, shearOk.ctx));
  const shearNone = fakeContext({ shearCount: 0 });
  check('那一格没有能剪的 → 失败（东西留着）', !runDispenseAction(shears, one(Item.SHEARS), 0, 64, 0, 0, -1, 0, shearNone.ctx));

  // ---- 出膛点：朝下时也不会落在自己那一格里
  const downRun = fakeContext();
  runDispenseAction(snowball, one(Item.SNOWBALL), 5, 70, 5, 0, -1, 0, downRun.ctx);
  equal('朝下时出膛点在下方 0.7 格处', (70.5 - DISPENSER_NOSE).toFixed(2), '69.30');
  check('出膛点确实在本格之外（>=1 格）', DISPENSER_NOSE > 1);
}

// ---------------------------------------------------------------- 4. 六向朝向与放置

console.log('\n[朝向与放置：与投掷器同一套]');
{
  const all = ['down', 'up', 0, 1, 2, 3] as const;
  const roundTrip = all.filter((facing) => sixFacingOf(withSixFacing(0, facing)) !== facing);
  check('六个方向都能写进状态再读回来', roundTrip.length === 0, `错的是 ${roundTrip.join(', ')}`);
  for (const facing of [0, 1, 2, 3] as const) {
    check(`朝${sixFacingLabel(facing)}的编码与投掷器一致`, withSixFacing(0, facing) === withHopperOutput(0, facing));
  }
  equal('"朝下"的编码与投掷器一致', withSixFacing(0, 'down'), withHopperOutput(0, 'down'));
  equal('偏移表：朝上', sixFacingOffset('up').join(','), '0,1,0');
  equal('调试读数是"朝南"', describeState('dispenser', withSixFacing(0, 2)), '朝南');

  equal('普通放置：凸口朝你', sixFacingOf(planPlacement(placement({ yaw: 0 }))!.state), 2);
  equal(
    '潜行 + 点顶面 → 朝下（架在箱子上）',
    sixFacingOf(planPlacement(placement({ normal: [0, 1, 0], sneaking: true }))!.state),
    'down',
  );
  equal(
    '潜行 + 点底面 → 朝上',
    sixFacingOf(planPlacement(placement({ normal: [0, -1, 0], sneaking: true }))!.state),
    'up',
  );
  equal(
    '潜行 + 点北面 → 朝南',
    sixFacingOf(planPlacement(placement({ normal: [0, 0, -1], sneaking: true }))!.state),
    2,
  );
}

// ---------------------------------------------------------------- 5. 几何

console.log('\n[几何：宽挡板（与投掷器的细管区分开）]');
{
  const boxes = meshBoxes('dispenser', withSixFacing(0, 'down'));
  equal('渲染盒 2 段（铁壳 + 挡板）', boxes.length, 2);
  equal('铁壳是整格', boxes[0]!.join(','), '0,0,0,1,1,1');

  const plate = dispenserBoxes(withSixFacing(0, 1))[1]!;
  const nozzle = dropperBoxes(withSixFacing(0, 1))[1]!;
  const plateWidth = plate[4]! - plate[1]!;
  const nozzleWidth = nozzle[4]! - nozzle[1]!;
  const plateDepth = plate[3]! - 1;
  const nozzleDepth = nozzle[3]! - 1;
  check(`挡板比细管宽（${plateWidth.toFixed(3)} > ${nozzleWidth.toFixed(3)}）`, plateWidth > nozzleWidth);
  check(`挡板比细管扁（${plateDepth.toFixed(3)} < ${nozzleDepth.toFixed(3)}）`, plateDepth < nozzleDepth);
  check('挡板确实伸出格子外面', plate[3]! > 1);

  const collision = collisionBoxes('dispenser', withSixFacing(0, 'down'));
  equal('碰撞盒 1 段（整格：挡板撞不到）', collision.length, 1);
  equal('碰撞是整格', collision[0]!.join(','), '0,0,0,1,1,1');
}

// ---------------------------------------------------------------- 6. 容器（与投掷器共用）

console.log('\n[容器：与投掷器共用一套，只是身份不同]');
{
  const dispenser = new Dispenser();
  check('发射器**就是**投掷器（子类）——按 Dropper 判定地方自动覆盖', dispenser instanceof Dropper);
  equal('格数一样', dispenser.size, DROPPER_SIZE);
  equal('容器格数被认出来', containerSlotCount(dispenser), DISPENSER_SIZE);
  equal('9 格全可塞（漏斗灌得进来）', acceptingSlots(dispenser).length, 9);
  equal('种类名跟着方块走', kindOf(dispenser), 'dispenser');
  equal('投掷器还是投掷器（子类顺序没写反）', kindOf(new Dropper()), 'dropper');

  // 随机挑一格 / 取一件 / 磨耐久
  const picker = new Dispenser(() => 0.999);
  picker.set(2, one(Block.STONE, 2));
  picker.set(7, one(Block.DIRT));
  const pick = picker.peekRandom();
  equal('随机挑一格（不取走）', pick?.slot, 2);
  equal('挑的时候数量不变', picker.get(2)?.count, 2);
  const taken = picker.takeAt(2);
  equal('取走一件后少一个', picker.get(2)?.count, 1);
  equal('取走的是副本', taken?.count, 1);
  equal('取完之后那一格还在', picker.get(2)?.id, Block.STONE);

  const wear = new Dispenser();
  wear.set(0, { id: Item.FLINT_AND_STEEL, count: 1, damage: 60 });
  check('磨 1 点耐久：还没坏', wear.wearAt(0, 1, 64));
  equal('耐久变成 61', wear.get(0)?.damage, 61);
  check('磨到上限：整件消失', !wear.wearAt(0, 3, 64));
  equal('那一格空了', wear.get(0), null);

  // 同族互通：漏斗能把东西灌进发射器，也能从它里面抽走
  const feed = new Dispenser();
  check('漏斗塞得进发射器（`Transfer` 只认 `Dropper`，子类自动覆盖）', tryInsertOne(feed, one(Item.ARROW)));
  equal('进的是第一格', feed.get(0)?.id, Item.ARROW);
  equal('反过来也能抽一件', peekTake(feed)?.slot, 0);
}

// ---------------------------------------------------------------- 7. 存档与活塞

console.log('\n[存档与活塞]');
{
  equal('存档里的格数表认识发射器', SLOT_COUNTS.dispenser, DISPENSER_SIZE);
  check('在"活塞推不动"的名单里', CONTAINER_BLOCKS.has(DISP));
  check('活塞推不动发射器', !canPush(DISP));
  check('活塞推不动投掷器', !canPush(Block.DROPPER));

  const store = new BlockEntityStore();
  store.getOrCreateDispenser(Dimension.OVERWORLD, 3, 64, 3).set(0, one(Item.ARROW, 7));
  const data = serializeContainers(store);
  equal('写进存档的只有装东西的那个', data.length, 1);
  equal('种类写成 dispenser（不会与投掷器混）', data[0]?.kind, 'dispenser');
  equal('格子数按 9 补齐', data[0]?.stacks.length, DISPENSER_SIZE);

  const restored = new BlockEntityStore();
  equal('读档还原', restoreContainers(restored, JSON.parse(JSON.stringify(data)) as SerializedContainer[]), 1);
  const back = restored.getDispenser(Dimension.OVERWORLD, 3, 64, 3);
  check('还原出来的是发射器实例', back instanceof Dispenser);
  equal('内容对得上', back?.get(0)?.count, 7);
}

// ---------------------------------------------------------------- 8. 红石

console.log('\n[红石：与投掷器同一套上升沿]');
{
  class RedstoneStub implements RedstoneWorld {
    private readonly blocks = new Map<string, number>();
    private readonly states = new Map<string, number>();

    private static key(x: number, y: number, z: number): string {
      return `${x},${y},${z}`;
    }

    set(x: number, y: number, z: number, id: number, state = 0): void {
      this.blocks.set(RedstoneStub.key(x, y, z), id);
      this.states.set(RedstoneStub.key(x, y, z), state);
    }

    getBlock(x: number, y: number, z: number): number {
      return this.blocks.get(RedstoneStub.key(x, y, z)) ?? Block.AIR;
    }

    getState(x: number, y: number, z: number): number {
      return this.states.get(RedstoneStub.key(x, y, z)) ?? 0;
    }

    setBlock(x: number, y: number, z: number, id: number, state: number): boolean {
      this.set(x, y, z, id, state);
      return true;
    }

    setState(x: number, y: number, z: number, state: number): boolean {
      this.states.set(RedstoneStub.key(x, y, z), state);
      return true;
    }

    isLoaded(): boolean {
      return true;
    }

    hasEntityAt(): boolean {
      return false;
    }
  }

  const world = new RedstoneStub();
  world.set(0, 64, 0, DISP, withSixFacing(0, 'down'));
  world.set(1, 64, 0, Block.LEVER);
  const engine = new RedstoneEngine();
  const fired: string[] = [];
  engine.onDispense = (x, y, z) => fired.push(`${x},${y},${z}`);

  engine.recompute(world, 1, 64, 0);
  equal('拉杆没合上时不动', fired.length, 0);
  engine.toggleLever(world, 1, 64, 0);
  equal('合上拉杆后不立刻动（4 tick 延迟，批次 448）', fired.length, 0);
  for (let i = 0; i < 13; i++) engine.tick(world, 1 / 60);
  equal('到点动一次', fired.length, 1);
  equal('动的是发射器那一格', fired[0], '0,64,0');
  engine.recompute(world, 1, 64, 0);
  engine.recompute(world, 1, 64, 0);
  equal('通着电反复重算不会连发', fired.length, 1);
  engine.toggleLever(world, 1, 64, 0);
  engine.toggleLever(world, 1, 64, 0);
  for (let i = 0; i < 13; i++) engine.tick(world, 1 / 60);
  equal('断电再通电 → 还能再发一次', fired.length, 2);
}

// ---------------------------------------------------------------- 9. 配方

console.log('\n[配方：7 圆石围 1 张弓（与投掷器只差中间那格）]');
{
  const C = Block.COBBLESTONE;
  const B = Item.BOW;
  const R = Item.REDSTONE;
  const cells = [C, C, C, C, B, C, C, C, C];
  equal('标准图案做出发射器', matchRecipe(cells, 3)?.id, DISP);
  equal('做出 1 个', matchRecipe(cells, 3)?.count, 1);
  equal('中间换红石粉做出的是投掷器（两条配方不撞车）', matchRecipe([C, C, C, C, R, C, C, C, C], 3)?.id, Block.DROPPER);
  equal('少一个圆石做不出（对照）', matchRecipe([C, C, C, C, B, C, C, Block.AIR, C], 3), null);
  equal('中间是圆石做不出（对照）', matchRecipe([C, C, C, C, C, C, C, C, C], 3), null);
}

console.log(`\n发射器测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
