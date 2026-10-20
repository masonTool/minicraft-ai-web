/**
 * 漏斗离线测试（批次 58，H14 的第一件容器类功能方块）
 *
 * 这一批是本项目**第一件会自己搬东西**的方块，所以断言分四层，一层都不省：
 *
 *  1. **注册与外观**：方块 id / 注册名 / 三张贴图 / 中文名与说明 / 物品分类 /
 *     "必须用镐"（原版与铁块同档，木质镐就能挖）
 *  2. **五个朝向**：状态位怎么存（第五个方向借用 bit0）、放置时怎么定朝向
 *     （嘴朝着被点的那个方块；潜行时朝玩家面朝的方向）、几何怎么跟着走
 *  3. **搬运规则**：节奏（0.4 秒）、顺序（**先推后拉**）、红石锁定、
 *     "谁能被塞"的策略表（熔炉不能塞产物槽、营火只吃食物、附魔台一概不收）
 *  4. **存档**：空漏斗也必须写进存档（不写的话读档后整条漏斗链静默停摆）
 *
 * 运行：npm run test:hopper
 */

import { readFileSync } from 'node:fs';
import { Block, blockDef, blockHardness } from '../src/core/registry/blocks.ts';
import { describeState, hopperOutputOf, hopperOutputOffset, withHopperLocked, withHopperOutput } from '../src/core/registry/blockState.ts';
import { collisionBoxes, isFullBlockShape, meshBoxes } from '../src/core/registry/blockShapes.ts';
import { planPlacement, type PlacementInput } from '../src/core/interaction/Placement.ts';
import { Item, categoryOf, itemDef, maxStackOf } from '../src/core/registry/items.ts';
import { hasDescription, itemLabel } from '../src/core/registry/itemNames.ts';
import { canHarvest, harvestRequirement, makeToolInfo, toolItemId } from '../src/core/registry/tools.ts';
import { matchRecipe } from '../src/core/crafting/Recipes.ts';
import { HOPPER_SIZE, HOPPER_TRANSFER_SECONDS, Hopper, type HopperEnv } from '../src/core/container/Hopper.ts';
import { acceptingSlots, containerSlotCount, peekTake, takeOne, tryInsertOne } from '../src/core/container/Transfer.ts';
import { Chest } from '../src/core/container/Chest.ts';
import { FURNACE_FUEL, FURNACE_INPUT, FURNACE_OUTPUT, Furnace } from '../src/core/container/Furnace.ts';
import { Campfire } from '../src/core/container/Campfire.ts';
import { EnchantTable } from '../src/core/container/EnchantTable.ts';
import { BlockEntityStore } from '../src/core/world/BlockEntityStore.ts';
import { SLOT_COUNTS, restoreContainers, serializeContainers, type SerializedContainer } from '../src/core/save/ContainerSave.ts';
import { Dimension } from '../src/core/gen/Dimension.ts';
import { isRedstoneComponent } from '../src/core/redstone/RedstoneEngine.ts';
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

const TILES = new Set<string>(TILE_ORDER);
const TUBE = 0.25;

/** 造一个放置输入（默认：对着石头顶面放、玩家朝北、不潜行） */
function placement(overrides: Partial<PlacementInput>): PlacementInput {
  return {
    blockId: Block.HOPPER,
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

/** 一件物品（搬运断言里到处都是"塞一件"） */
function one(id: number): { id: number; count: number } {
  return { id, count: 1 };
}

/** 假搬运环境：三个问题都由测试直接回答 */
function envOf(options: {
  target?: Chest | Furnace | null;
  above?: Chest | Furnace | null;
  suck?: () => { id: number; count: number } | null;
  tryPush?: (stack: { id: number; count: number }) => boolean;
}): HopperEnv {
  return {
    target: () => options.target ?? null,
    above: () => options.above ?? null,
    suck: () => options.suck?.() ?? null,
    ...(options.tryPush ? { tryPush: options.tryPush } : {}),
  };
}

// ---------------------------------------------------------------- 1. 注册与外观

console.log('\n[注册与外观]');
{
  equal('方块 id 是 476（接在 TNT 后面）', Block.HOPPER, 476);
  // ⚠️ 别用 `BLOCKS.length - 1` 判"最后一个"：每加一个方块它都会红
  equal('id 紧接在 TNT 之后（475 → 476）', Block.HOPPER, Block.TNT + 1);
  equal('注册名', blockDef(Block.HOPPER).name, 'minecraft:hopper');
  equal('中文名', itemLabel(Block.HOPPER), '漏斗');
  check('有物品说明', hasDescription(Block.HOPPER));
  equal('形状是 hopper', blockDef(Block.HOPPER).shape, 'hopper');
  equal('不是整格方块', isFullBlockShape('hopper', 0), false);
  equal('不遮挡邻居（否则贴着它的方块会被剔掉一面）', blockDef(Block.HOPPER).opaque, false);

  const missingTiles = blockDef(Block.HOPPER).tiles.filter((tile) => !TILES.has(tile));
  check(`三张贴图都在图集里（顶面 / 管子内壁 / 外壳）`, missingTiles.length === 0, `缺少 ${missingTiles.join(', ')}`);
  equal('顶面用碗口那张', blockDef(Block.HOPPER).tiles[0], 'hopper_top');

  const def = itemDef(Block.HOPPER);
  check('有对应的物品（方块物品是批量注册的）', def !== undefined);
  equal('物品指向这个方块', def?.block, Block.HOPPER);
  equal('可堆叠 64', maxStackOf(Block.HOPPER), 64);
  equal('创造分类是"功能方块"', categoryOf(Block.HOPPER), 'functional');
  equal('图标用外壳那张', itemDef(Block.HOPPER)?.tile, 'hopper_side');

  equal('硬度 3（原版与铁块同档）', blockHardness(Block.HOPPER), 3);
  equal('要求工具是镐 0 级（木质镐就能挖）', harvestRequirement(Block.HOPPER)?.tool, 'pickaxe');
  equal('等级 0', harvestRequirement(Block.HOPPER)?.tier, 0);
  check('徒手挖得动但一无所获（与原版一致）', !canHarvest(Block.HOPPER, null));
  check('木镐能采', canHarvest(Block.HOPPER, makeToolInfo('pickaxe', 'wooden')));

  equal('是红石元件（洪泛要认它，才能把信号送到它身上）', isRedstoneComponent(Block.HOPPER), true);
}

// ---------------------------------------------------------------- 2. 五个朝向

console.log('\n[五个朝向：状态位 + 放置]');
{
  // 往返：五个方向各写一遍再读回来
  const outputs = ['down', 0, 1, 2, 3] as const;
  const roundTrip = outputs.filter((output) => hopperOutputOf(withHopperOutput(0, output)) !== output);
  check('五个方向都能写进状态再读回来', roundTrip.length === 0, `错的是 ${roundTrip.join(', ')}`);

  const down = withHopperOutput(0, 'down');
  const east = withHopperOutput(down, 1);
  equal('"朝下"之后改朝东，读数跟着变', hopperOutputOf(east), 1);
  equal('再改回朝下（不会残留"东"的位）', hopperOutputOf(withHopperOutput(east, 'down')), 'down');

  // 锁定与朝向互不干扰：POWERED 是 bit3，朝向只占 bit0-2
  const lockedEast = withHopperLocked(east, true);
  equal('锁定不影响朝向', hopperOutputOf(lockedEast), 1);
  check('锁定位是独立的（描述里两个都读得出来）', describeState('hopper', lockedEast).includes('朝东') && describeState('hopper', lockedEast).includes('已锁定'));

  // 偏移表：搬运逻辑与几何都靠它
  equal('朝下的偏移是往下', hopperOutputOffset('down').join(','), '0,-1,0');
  equal('朝北的偏移是 -Z', hopperOutputOffset(0).join(','), '0,0,-1');
  equal('朝东的偏移是 +X', hopperOutputOffset(1).join(','), '1,0,0');
  equal('朝南的偏移是 +Z', hopperOutputOffset(2).join(','), '0,0,1');
  equal('朝西的偏移是 -X', hopperOutputOffset(3).join(','), '-1,0,0');

  // 放置：嘴朝着被点的那个方块
  equal('点顶面 → 嘴朝下（倒进被点的方块里）', hopperOutputOf(planPlacement(placement({ normal: [0, 1, 0] }))!.state), 'down');
  equal('点底面 → 没有"朝上"这一档，落回朝下', hopperOutputOf(planPlacement(placement({ normal: [0, -1, 0] }))!.state), 'down');
  equal('点北面（法线朝北）→ 嘴朝南', hopperOutputOf(planPlacement(placement({ normal: [0, 0, -1] }))!.state), 2);
  equal('点南面 → 嘴朝北', hopperOutputOf(planPlacement(placement({ normal: [0, 0, 1] }))!.state), 0);
  equal('点东面 → 嘴朝西', hopperOutputOf(planPlacement(placement({ normal: [1, 0, 0] }))!.state), 3);
  equal('点西面 → 嘴朝东', hopperOutputOf(planPlacement(placement({ normal: [-1, 0, 0] }))!.state), 1);
  equal(
    '潜行 + 面朝北 → 嘴朝北（潜行用来指定朝向）',
    hopperOutputOf(planPlacement(placement({ normal: [0, 1, 0], yaw: 0, sneaking: true }))!.state),
    0,
  );
  equal(
    '潜行 + 点底面 → 还是朝下（朝上没有这一档）',
    hopperOutputOf(planPlacement(placement({ normal: [0, -1, 0], sneaking: true }))!.state),
    'down',
  );
}

// ---------------------------------------------------------------- 3. 几何

console.log('\n[几何：碗口 + 两级收窄 + 管子]');
{
  const down = withHopperOutput(0, 'down');
  const boxes = meshBoxes('hopper', down);
  equal('渲染盒 4 段（碗口 / 收窄两级 / 管子）', boxes.length, 4);
  equal('碗口是整格宽的 6/16 高', boxes[0]!.join(','), '0,0.625,0,1,1,1');
  equal('管子朝下时居中', boxes[3]!.join(','), `${0.5 - TUBE / 2},0,${0.5 - TUBE / 2},${0.5 + TUBE / 2},0.375,${0.5 + TUBE / 2}`);
  equal('朝东时管子贴东侧', meshBoxes('hopper', withHopperOutput(0, 1))[3]!.join(','), `${1 - TUBE},0,${0.5 - TUBE / 2},1,0.375,${0.5 + TUBE / 2}`);
  equal('朝北时管子贴北侧', meshBoxes('hopper', withHopperOutput(0, 0))[3]!.join(','), `${0.5 - TUBE / 2},0,0,${0.5 + TUBE / 2},0.375,${TUBE}`);

  const collision = collisionBoxes('hopper', down);
  equal('碰撞盒只有三段（不含管子）', collision.length, 3);
  const lowest = Math.min(...collision.map((box) => box[1]));
  equal('碰撞最低从 6/16 起（**能从漏斗底下走过去**）', lowest, 0.375);
  equal('最高是整格（碗口顶端）', Math.max(...collision.map((box) => box[4])), 1);
}

// ---------------------------------------------------------------- 4. 搬运

console.log('\n[搬运：节奏、顺序、红石锁定]');
{
  equal('5 格', HOPPER_SIZE, 5);
  equal('格数被 `containerSlotCount` 认出来（倒空容器用）', containerSlotCount(new Hopper()), 5);
  equal('节奏是 0.4 秒（原版 8 游戏刻）', HOPPER_TRANSFER_SECONDS, 0.4);

  // 冷启动：刚放下不动
  const hopper = new Hopper();
  const above = new Chest();
  above.set(0, { id: Block.STONE, count: 3 });
  hopper.tick(0.1, envOf({ above }));
  hopper.tick(0.2, envOf({ above }));
  equal('放下后 0.3 秒内不动（冷启动等满一个周期）', hopper.isEmpty, true);
  hopper.tick(0.2, envOf({ above }));
  equal('满 0.4 秒后从头顶拉进一件', hopper.get(0)?.count, 1);
  equal('头顶箱子少了一件', above.get(0)?.count, 2);

  // 先推后拉：一个周期里两件事都做
  const pusher = new Hopper();
  pusher.set(0, { id: Block.STONE, count: 1 });
  const target = new Chest();
  const source = new Chest();
  source.set(0, { id: Block.DIRT, count: 1 });
  pusher.tick(HOPPER_TRANSFER_SECONDS, envOf({ target, above: source }));
  equal('推出去的那件进了目标容器', target.get(0)?.id, Block.STONE);
  equal('拉进来的那件进了自己（先推后拉）', pusher.get(0)?.id, Block.DIRT);
  equal('自己那格只剩拉进来的那件（推走的没留下）', pusher.get(0)?.count, 1);
  equal('一个周期记一次搬运', pusher.movedCount, 1);

  // 目标满了：推不动，也不该"半途扣掉"
  const stuck = new Hopper();
  stuck.set(0, { id: Block.STONE, count: 1 });
  const full = new Chest();
  for (let i = 0; i < 27; i++) full.set(i, { id: Block.DIRT, count: 64 });
  stuck.tick(HOPPER_TRANSFER_SECONDS, envOf({ target: full }));
  equal('目标收不下时自己那件还在（不会凭空消失）', stuck.get(0)?.count, 1);

  // 红石锁定
  const lockedHopper = new Hopper();
  lockedHopper.locked = true;
  const lockedAbove = new Chest();
  lockedAbove.set(0, { id: Block.STONE, count: 1 });
  const lockedTarget = new Chest();
  lockedHopper.set(0, { id: Block.DIRT, count: 1 });
  const result = lockedHopper.tick(1, envOf({ target: lockedTarget, above: lockedAbove }));
  check('锁定时不搬运（结果里 locked 为真）', result.locked && !result.moved);
  equal('锁定时不推', lockedTarget.isEmpty, true);
  equal('锁定时不拉', lockedAbove.get(0)?.count, 1);
  equal('锁定时冷却保持满值（解锁后要重新数一个周期）', lockedHopper.cooldown, HOPPER_TRANSFER_SECONDS);

  lockedHopper.locked = false;
  lockedHopper.tick(HOPPER_TRANSFER_SECONDS, envOf({ target: lockedTarget, above: lockedAbove }));
  equal('解锁后继续搬运', lockedTarget.get(0)?.id, Block.DIRT);

  // 吸取掉落物
  const sucker = new Hopper();
  let drops = 2;
  const suckEnv = envOf({
    suck: () => (drops-- > 0 ? { id: Block.STONE, count: 1 } : null),
  });
  sucker.tick(HOPPER_TRANSFER_SECONDS, suckEnv);
  equal('吸进一件掉落物', sucker.get(0)?.count, 1);
  sucker.tick(HOPPER_TRANSFER_SECONDS, suckEnv);
  equal('再吸一件时**并进同一格**（原版先合并同类）', sucker.get(0)?.count, 2);
  equal('只用了 1 格', sucker.usedSlots, 1);

  // 5 格满了就不再吸
  const fullHopper = new Hopper();
  for (let i = 0; i < HOPPER_SIZE; i++) fullHopper.set(i, { id: Block.STONE, count: 64 });
  check('5 格都满时 isFull 为真', fullHopper.isFull);
  equal('满的时候塞不进**另一种**东西', fullHopper.insert(one(Item.COAL)), false);
  let sucked = 0;
  fullHopper.tick(HOPPER_TRANSFER_SECONDS, envOf({ suck: () => (sucked++, { id: Item.COAL, count: 1 }) }));
  equal('满的时候连掉落物都不去吸（不白问一次）', sucked, 0);
}

// ---------------------------------------------------------------- 5. "谁能被塞"的策略表

console.log('\n[策略表：熔炉不塞产物槽 / 营火只吃食物 / 附魔台不收]');
{
  const furnace = new Furnace();
  equal('熔炉的可塞格子是"原料 + 燃料"', acceptingSlots(furnace).join(','), `${FURNACE_INPUT},1`);
  check('产物槽不在可塞列表里', !acceptingSlots(furnace).includes(FURNACE_OUTPUT));

  // 原料槽塞满另一种东西时，产物槽里即使有一份同样的东西也不该被追加
  const busy = new Furnace();
  busy.set(FURNACE_INPUT, { id: Block.DIRT, count: 64 });
  busy.set(FURNACE_OUTPUT, { id: Block.STONE, count: 1 });
  equal('原料满 + 产物同种 → 塞不进去（不会偷偷堆到产物槽）', tryInsertOne(busy, one(Block.STONE)), false);
  equal('产物槽没被动', busy.get(FURNACE_OUTPUT)?.count, 1);

  // 燃料槽只吃燃料（原版 `isValid` 就这么判）：不拦的话漏斗会把石头一把把塞进燃料槽
  const fuelOnly = new Furnace();
  fuelOnly.set(FURNACE_INPUT, { id: Block.DIRT, count: 64 });
  check('原料满时燃料槽能接煤', tryInsertOne(fuelOnly, one(Item.COAL)));
  equal('煤进的是燃料槽', fuelOnly.get(FURNACE_FUEL)?.id, Item.COAL);
  equal('石头进不了燃料槽（不是燃料）', tryInsertOne(fuelOnly, one(Block.STONE)), false);

  const pushed = new Furnace();
  check('空熔炉能接一件（进原料槽）', tryInsertOne(pushed, one(Item.COAL)));
  equal('进的是原料槽', pushed.get(FURNACE_INPUT)?.id, Item.COAL);

  // 从炉子里取件：只取产物槽（原版会连原料一起抽走，这里刻意收紧）
  const smelted = new Furnace();
  smelted.set(FURNACE_INPUT, { id: Block.SAND, count: 3 });
  smelted.set(FURNACE_OUTPUT, { id: Block.GLASS, count: 2 });
  const pick = peekTake(smelted);
  equal('先从产物槽取', pick?.slot, FURNACE_OUTPUT);
  equal('取走一件后产物少一个', takeOne(smelted, pick!.slot)?.id, Block.GLASS);
  equal('产物剩 1', smelted.get(FURNACE_OUTPUT)?.count, 1);
  smelted.set(FURNACE_OUTPUT, null);
  equal('产物空了就不再从炉子里取（原料抽不走）', peekTake(smelted), null);
  equal('原料还在', smelted.get(FURNACE_INPUT)?.count, 3);

  // 营火只吃食物（走的是营火自己 tick 用的那张站台表）
  const campfire = new Campfire();
  equal('营火不吃石头', tryInsertOne(campfire, one(Block.STONE)), false);
  check('营火吃生牛肉', tryInsertOne(campfire, one(Item.BEEF)));

  // 附魔台：一概不收（空的策略表）
  const table = new EnchantTable();
  equal('附魔台的可塞格子是空的', acceptingSlots(table).length, 0);
  equal('往附魔台塞东西会失败（不会把东西吃掉）', tryInsertOne(table, one(Item.COAL)), false);
  equal('附魔台里什么都没留下', table.get(0), null);

  // 箱子与漏斗：一整箱都能塞
  equal('箱子的可塞格子是 27 格', acceptingSlots(new Chest()).length, 27);
  equal('漏斗的可塞格子是 5 格', acceptingSlots(new Hopper()).length, 5);
  equal('同类合并到上限为止', maxStackOf(Block.STONE), 64);
}

// ---------------------------------------------------------------- 5.5 附加数据

console.log('\n[附加数据：自动搬运不能把耐久/附魔/名字洗掉]');
{
  // 推：把"改了名的东西"推给目标容器
  const pusher = new Hopper();
  pusher.set(0, { id: Block.STONE, count: 1, name: '地基' });
  const target = new Chest();
  pusher.tick(HOPPER_TRANSFER_SECONDS, envOf({ target }));
  equal('推过去之后名字还在', target.get(0)?.name, '地基');

  // 拉：从上方容器拉一件带附魔、带损耗的工具（最大堆叠 1，走不了合并分支）
  const pick = toolItemId('pickaxe', 'diamond');
  const above = new Chest();
  above.set(0, { id: pick, count: 1, enchants: { efficiency: 3 }, damage: 7 });
  const hopper = new Hopper();
  hopper.tick(HOPPER_TRANSFER_SECONDS, envOf({ above }));
  equal('拉进来之后附魔还在', hopper.get(0)?.enchants?.efficiency, 3);
  equal('耐久损耗一起带过来', hopper.get(0)?.damage, 7);

  // 合并判定要连附加数据一起比：否则"改了名的石头"会并进普通那堆、名字静默丢掉
  const mixer = new Hopper();
  mixer.set(0, { id: Block.STONE, count: 1 });
  check('名字不同的同名物品不会被并进同一格', mixer.insert({ id: Block.STONE, count: 1, name: '地基' }));
  equal('它另占一格', mixer.usedSlots, 2);
  equal('第一格没被改名', mixer.get(0)?.name, undefined);

  const plain = new Hopper();
  check('同种且都没附加数据的仍然合并', plain.insert(one(Block.STONE)) && plain.insert(one(Block.STONE)));
  equal('合并成一格', plain.usedSlots, 1);
  equal('数量是 2', plain.get(0)?.count, 2);
}

// ---------------------------------------------------------------- 6. 存档

console.log('\n[存档：空漏斗也必须写]');
{
  equal('存档里的格数表认识漏斗', SLOT_COUNTS.hopper, HOPPER_SIZE);

  const store = new BlockEntityStore();
  const hopper = store.getOrCreateHopper(Dimension.OVERWORLD, 3, 64, -7);
  hopper.set(0, { id: Block.STONE, count: 5 });
  store.getOrCreateHopper(Dimension.OVERWORLD, 4, 64, -7); // 一个空漏斗

  const data = serializeContainers(store);
  equal('两个漏斗都写进去了（一个装东西、一个空）', data.length, 2);
  const empty = data.find((entry) => entry.x === 4) as SerializedContainer | undefined;
  check('空漏斗也写（不写的话读档后整条漏斗链静默停摆）', empty !== undefined);
  equal('格子数按 5 补齐', empty?.stacks.length, 5);

  const restored = new BlockEntityStore();
  const count = restoreContainers(restored, JSON.parse(JSON.stringify(data)) as SerializedContainer[]);
  equal('两个都还原了', count, 2);
  equal('内容对得上', restored.getHopper(Dimension.OVERWORLD, 3, 64, -7)?.get(0)?.count, 5);
  check('空漏斗读档后仍在容器表里（所以它还会搬东西）', restored.getHopper(Dimension.OVERWORLD, 4, 64, -7) !== undefined);
}

// ---------------------------------------------------------------- 7. 配方与拆解

console.log('\n[配方：5 铁锭 + 箱子]');
{
  const I = Item.IRON_INGOT;
  const C = Block.CHEST;
  // 3×3 网格按行铺开
  const cells = [I, Block.AIR, I, I, C, I, Block.AIR, I, Block.AIR];
  equal('标准图案做出漏斗', matchRecipe(cells, 3)?.id, Block.HOPPER);
  equal('做出 1 个', matchRecipe(cells, 3)?.count, 1);
  equal('少一个铁锭做不出（对照）', matchRecipe([I, Block.AIR, I, Block.AIR, C, I, Block.AIR, I, Block.AIR], 3), null);
  equal('把箱子摆错位置做不出（对照）', matchRecipe([I, Block.AIR, I, I, I, I, Block.AIR, I, Block.AIR], 3), null);
  equal('中心是木板也做不出（必须是箱子）', matchRecipe([I, Block.AIR, I, I, Block.OAK_PLANKS, I, Block.AIR, I, Block.AIR], 3), null);
}

console.log('\n[特殊目标：堆肥桶（批次 555）]');
{
  const hopper = new Hopper();
  hopper.set(0, { id: Item.WHEAT, count: 2 });
  let accepted = 0;
  const moved = hopper.tick(
    0.4,
    envOf({
      tryPush: (stack) => {
        if (stack.id !== Item.WHEAT) return false;
        accepted++;
        return true;
      },
    }),
  );
  check('目标不是容器时也会尝试特殊投放', moved.moved);
  equal('特殊目标吃掉一件后漏斗扣一件', hopper.get(0)?.count, 1);
  equal('只尝试了一次', accepted, 1);

  const rejected = new Hopper();
  rejected.set(0, { id: Item.WHEAT, count: 1 });
  const result = rejected.tick(0.4, envOf({ tryPush: () => false }));
  check('目标不收时不搬（物品留在漏斗里）', !result.moved && rejected.get(0)?.count === 1);

  const mainSrc = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  check('主程序给漏斗接了 tryPush', mainSrc.includes('tryPush: (stack) => this.pushToComposter'));
  check('堆肥桶与玩家右键共用 compostStep', mainSrc.includes('compostStep(level, stack.id, Math.random)'));
}

console.log(`\n漏斗测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
