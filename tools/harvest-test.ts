/**
 * 采集可达性与硬度登记（批次 62，收掉 TASKS O9）离线测试
 *
 * 这一批修的是**一整类**缺陷，而不是某一件东西：
 * `canHarvest` 的兜底原来查一张**手写**的"徒手表"，于是"既不在需求表、又没写进徒手表"的
 * 方块**拿什么挖都不掉**——探针扫出 20 个（红石粉/拉杆/按钮/压力板/中继器/比较器/
 * 酿造台/海晶灯/龙蛋/末地传送门框…）。而创造模式不产生掉落，所以**一直没被发现**。
 * 同一张表还带来第二个症状：`blockHardness` 的兜底是 3，于是"没登记"与"登记成 3"
 * 从外面看一模一样——成熟作物徒手要 **4.5 秒**、红石粉要 **15 秒**。
 *
 * 修法（两条都是"把兜底关掉"）：
 *  1. **徒手可采 = 没有要求工具**（由 `REQUIRED_TOOL` **派生**，那张手写表整段删掉）；
 *  2. 把"落回默认值"的方块按原版**逐族补上硬度**，并留一条断言盯着"以后加方块要登记"。
 *
 * 断言分四块：掉落可达性 / 硬度登记 / 修正后的原版数值 / 倍率语义。
 *
 * 运行：npm run test:harvest
 */

import {
  BLOCKS,
  Block,
  blockDef,
  blockHardness,
  isHardnessRegistered,
  stairsId,
  slabId,
  stoneVariantId,
  woodShaped,
  WoodShaped,
  copperId,
  CROP_STAGES,
  CORAL_ID_START,
  SHAPED_PARENTS,
} from '../src/core/registry/blocks.ts';
import {
  breakSeconds,
  canHarvest,
  harvestRequirement,
  isHandHarvestable,
  makeToolInfo,
} from '../src/core/registry/tools.ts';
import { itemDef } from '../src/core/registry/items.ts';

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

/** 浮点比较（硬度有 0.1/0.4/4.5 这类值） */
function near(label: string, actual: number, expected: number): void {
  check(label, Math.abs(actual - expected) < 1e-9, `实际 ${actual}，期望 ${expected}`);
}

const WOOD_PICK = makeToolInfo('pickaxe', 'wooden');

/** 全表：有物品、非流体、非空气的方块（"玩家挖得到、也应该掉点什么"的那一批） */
const HARVESTABLE_BLOCKS: number[] = [];
for (let id = 1; id < BLOCKS.length; id++) {
  const def = blockDef(id);
  if (def.liquid) continue;
  if (!itemDef(id)) continue; // 没有物品的方块（火/传送门/活塞头…）本来就没有"掉落"这回事
  HARVESTABLE_BLOCKS.push(id);
}

// ---------------------------------------------------------------- 1. 掉落可达性

console.log('\n[掉落可达性：没有"拿什么挖都不掉"的方块]');
{
  const dropless = HARVESTABLE_BLOCKS.filter((id) => !harvestRequirement(id) && !canHarvest(id, null));
  check(
    `每个有物品的方块都挖得到（共 ${HARVESTABLE_BLOCKS.length} 个）`,
    dropless.length === 0,
    dropless.map((id) => blockDef(id).name).join(', '),
  );
  // 拿工具也不能采（更严重）——同一批漏登记，两种工具形式都不该有
  const axe = makeToolInfo('axe', 'iron');
  const shovel = makeToolInfo('shovel', 'iron');
  const stillDropless = HARVESTABLE_BLOCKS.filter(
    (id) => !harvestRequirement(id) && !canHarvest(id, axe) && !canHarvest(id, shovel),
  );
  check('拿工具也一样采得到', stillDropless.length === 0, stillDropless.map((id) => blockDef(id).name).join(', '));

  // 点名：批次 61 探针扫出来的那 20 个，现在都得掉东西
  const NAMED: readonly [string, number][] = [
    ['红石粉', Block.REDSTONE_WIRE],
    ['红石火把', Block.REDSTONE_TORCH],
    ['红石块', Block.REDSTONE_BLOCK],
    ['拉杆', Block.LEVER],
    ['石按钮', Block.STONE_BUTTON],
    ['橡木按钮', Block.OAK_BUTTON],
    ['石压力板', Block.STONE_PRESSURE_PLATE],
    ['橡木压力板', Block.OAK_PRESSURE_PLATE],
    ['中继器', Block.REPEATER],
    ['比较器', Block.COMPARATOR],
    ['酿造台', Block.BREWING_STAND],
    ['海晶灯', Block.SEA_LANTERN],
    ['末地烛', Block.END_ROD],
    ['紫颂植物', Block.CHORUS_PLANT],
    ['龙蛋', Block.DRAGON_EGG],
  ];
  const brokenNamed = NAMED.filter(([, id]) => !canHarvest(id, null));
  check(`点名的那 ${NAMED.length} 个现在都挖得到`, brokenNamed.length === 0, brokenNamed.map(([n]) => n).join(', '));
  // 活塞/粘性活塞/侦测器/红石灯**本来就登记了"必须用镐"**，所以它们不在上面那批里——
  // 这一条是给未来的自己看的：别把"采不到"和"要工具"混为一谈
  check(
    '活塞一族与红石灯本来就要镐（不在漏登记那批里）',
    [Block.PISTON, Block.STICKY_PISTON, Block.OBSERVER, Block.REDSTONE_LAMP].every(
      (id) => harvestRequirement(id)?.tool === 'pickaxe' && canHarvest(id, WOOD_PICK),
    ),
  );

  // 反向：该"必须用工具"的还要必须用（别把兜底放开之后把手感也放掉了）
  check('石头仍然要镐（挖得动但一无所获）', !canHarvest(Block.STONE, null) && harvestRequirement(Block.STONE) !== undefined);
  check('钻石矿仍然要镐且等级够', !canHarvest(Block.DIAMOND_ORE, WOOD_PICK) && canHarvest(Block.DIAMOND_ORE, makeToolInfo('pickaxe', 'iron')));
  check('锁链仍然要镐', !canHarvest(Block.CHAIN, null) && canHarvest(Block.CHAIN, WOOD_PICK));
  check('附魔台仍然要镐', !canHarvest(Block.ENCHANTING_TABLE, null));
  check('海晶石仍然要镐', !isHandHarvestable(Block.PRISMARINE));
  // 珊瑚块徒手可采（原版不要求工具）；"徒手挖下来什么都不掉、要精准采集"是**掉落表**的事
  check('珊瑚块徒手可采（掉落另算：只有精准采集才掉）', isHandHarvestable(CORAL_ID_START));
}

// ---------------------------------------------------------------- 2. "徒手可采"只剩一个事实来源

console.log('\n[徒手可采 = 没有要求工具（唯一事实来源）]');
{
  const mismatched = HARVESTABLE_BLOCKS.filter((id) => isHandHarvestable(id) !== !harvestRequirement(id));
  check('两者处处一致（那张手写清单已经删掉了）', mismatched.length === 0, `${mismatched.length} 处不一致`);
  check('草方块徒手可采', isHandHarvestable(Block.GRASS_BLOCK));
  check('木桶徒手可采', isHandHarvestable(Block.BARREL));
  check('小麦徒手可采', isHandHarvestable(Block.WHEAT_STAGE3));
  check('切石机不是徒手可采（要镐）', !isHandHarvestable(Block.STONECUTTER));
}

// ---------------------------------------------------------------- 3. 硬度登记

console.log('\n[硬度：每个有物品的方块都显式登记过]');
{
  const unregistered = HARVESTABLE_BLOCKS.filter((id) => !isHardnessRegistered(id));
  check(
    `没有"落回默认值 3"的方块（共 ${HARVESTABLE_BLOCKS.length} 个）`,
    unregistered.length === 0,
    unregistered.map((id) => `${blockDef(id).name}=${blockHardness(id)}`).join(', '),
  );
}

// ---------------------------------------------------------------- 4. 修正后的原版数值

console.log('\n[原版数值：作物一碰就掉 / 红石元件不再 15 秒]');
{
  // ---- 作物：硬度 0 → 徒手 0 秒（原版"一碰就能收"）
  const cropMisses: string[] = [];
  for (const [name, stages] of Object.entries(CROP_STAGES)) {
    for (const id of stages) {
      if (blockHardness(id) !== 0 || breakSeconds(id, null) !== 0) cropMisses.push(`${name}@${id}`);
    }
  }
  check('四种作物（含四个生长阶段）徒手 0 秒', cropMisses.length === 0, cropMisses.join(', '));

  // ---- 红石元件：原版 0 / 0.5 / 0.3 / 1.5 / 5
  for (const [name, id] of [
    ['红石粉', Block.REDSTONE_WIRE],
    ['红石火把', Block.REDSTONE_TORCH],
    ['中继器', Block.REPEATER],
    ['比较器', Block.COMPARATOR],
  ] as const) {
    equal(`${name}的硬度是 0（一碰就掉）`, blockHardness(id), 0);
  }
  for (const [name, id] of [
    ['拉杆', Block.LEVER],
    ['石按钮', Block.STONE_BUTTON],
    ['橡木按钮', Block.OAK_BUTTON],
    ['石压力板', Block.STONE_PRESSURE_PLATE],
    ['橡木压力板', Block.OAK_PRESSURE_PLATE],
  ] as const) {
    equal(`${name}的硬度是 0.5`, blockHardness(id), 0.5);
  }
  near('红石灯 0.3', blockHardness(Block.REDSTONE_LAMP), 0.3);
  near('活塞 1.5', blockHardness(Block.PISTON), 1.5);
  near('粘性活塞 1.5', blockHardness(Block.STICKY_PISTON), 1.5);
  equal('红石块 5', blockHardness(Block.REDSTONE_BLOCK), 5);
  equal('侦测器 3', blockHardness(Block.OBSERVER), 3);

  // ---- 徒手耗时（倍率从"5 倍"回到原版的 1.5 倍）
  equal('拉杆徒手 0.75 秒', breakSeconds(Block.LEVER, null), 0.75);
  equal('红石块徒手 7.5 秒', breakSeconds(Block.REDSTONE_BLOCK, null), 7.5);

  // ---- 末地一族
  near('末地烛 0.1', blockHardness(Block.END_ROD), 0.1);
  near('紫颂植物 0.4', blockHardness(Block.CHORUS_PLANT), 0.4);
  near('紫颂花 0.4', blockHardness(Block.CHORUS_FLOWER), 0.4);
  equal('龙蛋 3', blockHardness(Block.DRAGON_EGG), 3);
  equal('末地石 3', blockHardness(Block.END_STONE), 3);
  equal('末地石砖 3', blockHardness(Block.END_STONE_BRICKS), 3);
  equal(
    '末地石砖的台阶/楼梯/墙跟随母方块',
    ['slab', 'stairs', 'wall'].every(
      (kind) => blockHardness(stoneVariantId('end_stone_bricks', kind as 'slab' | 'stairs' | 'wall')!) === 3,
    ),
    true,
  );
  check(
    '末地传送门与门框挖不动（原版不可破坏）',
    !Number.isFinite(breakSeconds(Block.END_PORTAL_FRAME, null)) &&
      !Number.isFinite(breakSeconds(Block.END_PORTAL, null)),
  );

  // ---- 地下：深板岩 3 / 深板岩矿 4.5 / 普通矿 3
  equal('深板岩 3', blockHardness(Block.DEEPSLATE), 3);
  equal('普通煤矿 3', blockHardness(Block.COAL_ORE), 3);
  near('深板岩煤矿 4.5（原版深板岩矿更硬）', blockHardness(Block.DEEPSLATE_COAL_ORE), 4.5);

  // ---- 门与活板门：木制一律 3（含橡木与后加的 5 种木材）
  const badWoodDoors: string[] = [];
  for (const [name, ids] of Object.entries(WoodShaped)) {
    if (blockHardness(ids.door) !== 3 || blockHardness(ids.trapdoor) !== 3) badWoodDoors.push(name);
  }
  check(`6 种木材的门/活板门都是 3（${Object.keys(WoodShaped).length} 种）`, badWoodDoors.length === 0, badWoodDoors.join(', '));
  equal('橡木门在表里', woodShaped('oak')?.door !== undefined, true);

  // ---- 铜：4 档氧化 × 4 种形状
  const badCopper: string[] = [];
  for (let stage = 0; stage < 4; stage++) {
    for (const kind of [0, 1, 2, 3] as const) {
      if (blockHardness(copperId(stage, kind)) !== 3) badCopper.push(`${stage}/${kind}`);
    }
  }
  check('16 个铜方块都是 3', badCopper.length === 0, badCopper.join(', '));

  // ---- 顺手补上的两个
  equal('漏斗 3（批次 58 补登记）', blockHardness(Block.HOPPER), 3);
  near('木桶 2.5（批次 61）', blockHardness(Block.BARREL), 2.5);
  equal('海晶灯 0.3', blockHardness(Block.SEA_LANTERN), 0.3);
  equal('酿造台 0.5', blockHardness(Block.BREWING_STAND), 0.5);
}

// ---------------------------------------------------------------- 5. 倍率语义

console.log('\n[倍率：没要求工具 = 1.5 倍（原版），拿错工具才 5 倍]');
{
  // 木板：硬度 2、无要求工具 → 徒手 2 × 1.5 = 3 秒（原来也是 3，因为它在旧表里）
  equal('木板徒手 3 秒', breakSeconds(Block.OAK_PLANKS, null), 3);
  // 石头：硬度 1.5、**要求镐** → 徒手 1.5 × 5 = 7.5 秒（这条不能变）
  equal('石头徒手 7.5 秒（要镐，5 倍）', breakSeconds(Block.STONE, null), 7.5);
  // 木镐速度 2：1.5（硬度）× 1.5（倍率）÷ 2 = 1.125 秒（原版石头的木镐耗时）
  near('石头用木镐 1.125 秒（把工具速度算进去）', breakSeconds(Block.STONE, WOOD_PICK), 1.125);
  // 新修的那批：徒手从 5 倍回到 1.5 倍
  // 拉杆不在加速表里 → 拿斧头也不会更快：0.5 × 1.5 ÷ 1 = 0.75 秒
  equal('拉杆拿斧头也是 0.75 秒（它不在加速表里）', breakSeconds(Block.LEVER, makeToolInfo('axe', 'iron')), 0.75);
  equal('龙蛋徒手 4.5 秒（3 × 1.5，原版）', breakSeconds(Block.DRAGON_EGG, null), 4.5);

  // 台阶/楼梯的母方块硬度仍然生效（这条是"改动没波及别处"的对照）
  const OAK_SLAB = SHAPED_PARENTS.findIndex(([, name]) => name === 'oak_planks');
  equal('橡木台阶硬度 2（跟随母方块）', blockHardness(slabId(OAK_SLAB)), 2);
  check('橡木楼梯与台阶同硬度', blockHardness(stairsId(OAK_SLAB)) === blockHardness(slabId(OAK_SLAB)));
}

console.log(`\n采集可达性测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
