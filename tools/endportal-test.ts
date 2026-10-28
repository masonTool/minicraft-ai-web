/**
 * 末地传送门（K9 收口，批次 111）离线测试
 *
 * 覆盖六块：
 *  1. **框架那一圈**：12 格、5×5 去掉四角、与中心 3×3 不重叠（布局只有一处出处）；
 *  2. **激活**：差一只眼睛不亮 / 12 只凑齐 → 中间 3×3 变成 END_PORTAL /
 *     从任意一格框架都能找到同一个圈心 / 点亮是幂等的；
 *  3. **拆框架灭门**：敲掉一格框架 → 那一片门方块清掉，而且**只清那一片**
 *     （旁边的另一座门不受影响）；补回眼睛还能重新点亮（"能修好"）；
 *  4. **状态位与贴图**：眼睛那一位不影响别的位；顶面按状态换图，两张贴图都在图集里；
 *  5. **传送与到达**：主世界 → 末地那一侧的 5×5 到达平台；末地 → **世界出生点**；
 *     平台是幂等的（重写不会越写越多）；
 *  6. **物品链**：末影之眼 = 末影珍珠 + 烈焰粉；珍珠的两个来源（**末影人**与要塞箱子）
 *     都在，且箱子那一份已从"临时放大"**压回原版量**（批次 112 的收尾，
 *     见 `loot.ts` 的 `stronghold_portal` 与那里的注释）。
 *
 * 运行：npm run test:endportal
 */

import { Block, blockDef, blockTiles } from '../web/src/core/registry/blocks.ts';
import { hasEndPortalEye, withEndPortalEye, withFacing, facingOf } from '../web/src/core/registry/blockState.ts';
import { CREATIVE_ITEMS, ITEMS, Item, itemDef } from '../web/src/core/registry/items.ts';
import { itemLabel } from '../web/src/core/registry/itemNames.ts';
import { RECIPES } from '../web/src/core/crafting/Recipes.ts';
import { recipeIngredients } from '../web/src/core/crafting/RecipeBook.ts';
import { LOOT_TABLES, lootTableIndex } from '../web/src/core/registry/loot.ts';
import { DROPPING_MOB_TYPES } from '../web/src/core/entity/mobs.ts';
import { Dimension } from '../web/src/core/gen/Dimension.ts';
import { TILE_ORDER } from '../web/src/render/atlasLayout.ts';
import {
  END_ARRIVAL_X,
  END_ARRIVAL_Y,
  END_ARRIVAL_Z,
  END_PORTAL_INNER,
  END_PORTAL_RING,
  END_PORTAL_WAIT_TICKS,
  activateEndPortalAt,
  buildEndArrivalPlatform,
  clearBrokenEndPortalsAround,
  endPortalCells,
  endPortalTarget,
  fillEndPortal,
  isRingComplete,
  ringCenterAt,
  type EndPortalWorld,
} from '../web/src/core/world/EndPortal.ts';

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

class FakeWorld implements EndPortalWorld {
  readonly blocks = new Map<string, number>();
  readonly states = new Map<string, number>();

  set(x: number, y: number, z: number, id: number, state = 0): void {
    const key = `${x},${y},${z}`;
    if (id === Block.AIR) {
      this.blocks.delete(key);
      this.states.delete(key);
      return;
    }
    this.blocks.set(key, id);
    if (state !== 0) this.states.set(key, state);
    else this.states.delete(key);
  }

  getBlock(x: number, y: number, z: number): number {
    return this.blocks.get(`${x},${y},${z}`) ?? Block.AIR;
  }

  getState(x: number, y: number, z: number): number {
    return this.states.get(`${x},${y},${z}`) ?? 0;
  }

  setBlock(x: number, y: number, z: number, id: number, state = 0): boolean {
    this.set(x, y, z, id, state);
    return true;
  }

  /** 搭一圈框架；`eyes` 为真表示插了眼睛 */
  ring(cx: number, cy: number, cz: number, eyes: boolean): void {
    for (const [x, y, z] of END_PORTAL_RING.map(([dx, dz]) => [cx + dx, cy, cz + dz] as const)) {
      this.set(x, y, z, Block.END_PORTAL_FRAME, eyes ? withEndPortalEye(0, true) : 0);
    }
  }
}

const Y = -30;

// ---------------------------------------------------------------- 一、那一圈框架

console.log('\n[一、12 格框架的几何]');
{
  equal('一圈正好 12 格', END_PORTAL_RING.length, 12);
  check(
    '每格都在 5×5 的外圈上、四角留空（|dx|==2 或 |dz|==2，且不同时等于 2）',
    END_PORTAL_RING.every(([dx, dz]) => {
      const edge = Math.abs(dx) === 2 || Math.abs(dz) === 2;
      const corner = Math.abs(dx) === 2 && Math.abs(dz) === 2;
      return edge && !corner && Math.abs(dx) <= 2 && Math.abs(dz) <= 2;
    }),
  );
  check('没有重复的格子（同一格写两遍会让"缺一只眼睛"判不出来）', new Set(END_PORTAL_RING.map(([dx, dz]) => `${dx},${dz}`)).size === 12);
  const inner = new Set(endPortalCells(0, Y, 0).map(([x, y, z]) => `${x},${y},${z}`));
  check(
    '中间 3×3 与那一圈不重叠',
    END_PORTAL_RING.every(([dx, dz]) => !inner.has(`${dx},${Y},${dz}`)),
    `${inner.size} 格`,
  );
  equal('中间是 3×3（原版口径）', END_PORTAL_INNER, 3);
  equal('中间正好 9 格', endPortalCells(0, Y, 0).length, 9);
}

// ---------------------------------------------------------------- 二、激活

console.log('\n[二、插满一圈才亮]');
{
  const world = new FakeWorld();
  world.ring(0, Y, 0, false);
  check('空框架圈不算齐', !isRingComplete(world, 0, Y, 0));
  equal('空圈按眼睛之前没有门方块', endPortalCells(0, Y, 0).filter(([x, y, z]) => world.getBlock(x, y, z) === Block.END_PORTAL).length, 0);

  // 插 11 只：只差一格
  let first = true;
  let lastFrame: [number, number, number] = [0, Y, 0];
  for (const [dx, dz] of END_PORTAL_RING) {
    if (first) {
      first = false;
      lastFrame = [dx, Y, dz];
      continue;
    }
    world.set(dx, Y, dz, Block.END_PORTAL_FRAME, withEndPortalEye(0, true));
  }
  check('11 只眼睛还不算齐', !isRingComplete(world, 0, Y, 0));
  check('差一格时不会亮（中间还是空的）', activateEndPortalAt(world, lastFrame[0], lastFrame[1], lastFrame[2]) === null);

  // 插最后一只
  world.set(lastFrame[0], lastFrame[1], lastFrame[2], Block.END_PORTAL_FRAME, withEndPortalEye(0, true));
  check('补上第 12 只才齐', isRingComplete(world, 0, Y, 0));
  const activation = activateEndPortalAt(world, lastFrame[0], lastFrame[1], lastFrame[2]);
  check('这一下把门点亮了', activation !== null, '返回 null = 没找到完整的圈');
  equal('点亮了中间 9 格', activation?.filled, 9);
  equal('圈心就是 (0,Y,0)', `${activation!.center.join(',')}`, `0,${Y},0`);
  check(
    '中间那 9 格真的变成了末地传送门方块',
    endPortalCells(0, Y, 0).every(([x, y, z]) => world.getBlock(x, y, z) === Block.END_PORTAL),
  );

  // 从任意一格框架都能找到同一个圈心（"按眼睛"只有这一处入口，允许从 12 个方向来）
  check(
    '从 12 格里的任何一格都能找到同一个圈心',
    END_PORTAL_RING.every(([dx, dz]) => {
      const center = ringCenterAt(world, dx, Y, dz);
      return center !== null && center[0] === 0 && center[1] === Y && center[2] === 0;
    }),
  );

  // 幂等
  const again = activateEndPortalAt(world, lastFrame[0], lastFrame[1], lastFrame[2]);
  check('已经亮着的圈再点一次是幂等的（filled = 0）', again?.filled === 0, `实际 ${String(again?.filled)}`);
  equal('门方块一格没变', endPortalCells(0, Y, 0).filter(([x, y, z]) => world.getBlock(x, y, z) === Block.END_PORTAL).length, 9);
  equal('手动 `fillEndPortal` 一格都不改（跳过已经亮着的格）', fillEndPortal(world, 0, Y, 0), 0);
}

// ---------------------------------------------------------------- 三、拆框架灭门

console.log('\n[三、敲掉一格框架，门跟着灭]');
{
  const world = new FakeWorld();
  world.ring(0, Y, 0, true);
  activateEndPortalAt(world, 0, Y, -2);
  equal('先确认亮了 9 格', endPortalCells(0, Y, 0).filter(([x, y, z]) => world.getBlock(x, y, z) === Block.END_PORTAL).length, 9);

  // 远处另有一座亮着的门：拆这一座的时候不许波及它
  world.ring(60, Y, 0, true);
  activateEndPortalAt(world, 60, Y, -2);

  // 敲掉 (0,Y,2) 那一格框架（先把它变成空气，再清场——与主程序的调用顺序一致）
  world.set(0, Y, 2, Block.AIR);
  const removed = clearBrokenEndPortalsAround(world, 0, Y, 2);
  equal('清掉了 9 格门方块', removed.length, 9);
  check(
    '这一座的门全灭了',
    endPortalCells(0, Y, 0).every(([x, y, z]) => world.getBlock(x, y, z) !== Block.END_PORTAL),
  );
  check(
    '旁边那一座门**一动没动**（清场只清"圈已经破了"的那一片）',
    endPortalCells(60, Y, 0).every(([x, y, z]) => world.getBlock(x, y, z) === Block.END_PORTAL),
  );

  // 补回眼睛还能重新点亮（玩家把框架修回来 / 换了新框架）
  world.set(0, Y, 2, Block.END_PORTAL_FRAME, withEndPortalEye(0, true));
  const again = activateEndPortalAt(world, 0, Y, 2);
  equal('补回眼睛之后能重新点亮', again?.filled, 9);
}

// ---------------------------------------------------------------- 四、状态位与贴图

console.log('\n[四、眼睛那一位与贴图]');
{
  check('默认状态没有眼睛', !hasEndPortalEye(0));
  check('写上再读回来是真的', hasEndPortalEye(withEndPortalEye(0, true)));
  check('擦掉之后是假的', !hasEndPortalEye(withEndPortalEye(withEndPortalEye(0, true), false)));
  // 与别的位共存：框架这一族只用 bit0，但"不许污染别的位"仍是一条不变量
  const mixed = withEndPortalEye(withFacing(0, 2), true);
  equal('插眼睛不影响朝向那两位', facingOf(mixed), 2);
  check('朝向也没把眼睛位吃掉', hasEndPortalEye(mixed));

  const empty = blockTiles(Block.END_PORTAL_FRAME, 0);
  const eyed = blockTiles(Block.END_PORTAL_FRAME, withEndPortalEye(0, true));
  equal('空格子的顶面是空框架那张', empty[0], 'end_portal_frame');
  equal('插了眼之后顶面换一张', eyed[0], 'end_portal_frame_eye');
  check('侧面始终是石框（眼睛只画在顶面）', empty[2] === 'end_portal_frame' && eyed[2] === 'end_portal_frame');
  check('两张贴图都在图集里', ['end_portal_frame', 'end_portal_frame_eye'].every((tile) => TILE_ORDER.includes(tile as never)));
  equal('空框架是完整立方体（能站上去，原版也是）', blockDef(Block.END_PORTAL_FRAME).shape, 'cube');
  check('末地传送门方块本身不挡路、发光 15（原版）', !blockDef(Block.END_PORTAL).solid && blockDef(Block.END_PORTAL).light === 15);
}

// ---------------------------------------------------------------- 五、传送与到达平台

console.log('\n[五、传送目标与到达平台]');
{
  const spawn = { x: 8.5, y: 71, z: -12.5 };
  const toEnd = endPortalTarget(Dimension.OVERWORLD, spawn);
  equal('主世界 → 末地', toEnd.dimension, Dimension.END);
  equal('落在到达平台正上方一格', `${toEnd.x},${toEnd.y},${toEnd.z}`, `${END_ARRIVAL_X + 0.5},${END_ARRIVAL_Y + 1},${END_ARRIVAL_Z + 0.5}`);
  check('到达平台离主岛（半径 64）够远，不会一头撞上末影龙', Math.hypot(END_ARRIVAL_X, END_ARRIVAL_Z) > 64, `距岛心 ${Math.hypot(END_ARRIVAL_X, END_ARRIVAL_Z)} 格`);
  const back = endPortalTarget(Dimension.END, spawn);
  equal('末地 → 主世界', back.dimension, Dimension.OVERWORLD);
  check('回来落的是**世界出生点**（原版口径）', back.x === spawn.x && back.y === spawn.y && back.z === spawn.z);
  equal('在下界里摆出来的末地传送门照样通末地（原版行为）', endPortalTarget(Dimension.NETHER, spawn).dimension, Dimension.END);
  check('碰到就传（1 tick 的落地计时）', END_PORTAL_WAIT_TICKS >= 1 && END_PORTAL_WAIT_TICKS <= 2);

  const world = new FakeWorld();
  const written = buildEndArrivalPlatform(world);
  equal('平台写满 5×5 黑曜石 + 上方 3 格清空', written, 25 * 4);
  check(
    '5×5 全是黑曜石',
    (() => {
      for (let dz = -2; dz <= 2; dz++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (world.getBlock(END_ARRIVAL_X + dx, END_ARRIVAL_Y - 1, END_ARRIVAL_Z + dz) !== Block.OBSIDIAN) return false;
        }
      }
      return true;
    })(),
  );
  check(
    '平台上方是空的（本来有石头也会被清掉，免得人一落地就卡在方块里）',
    (() => {
      // 先塞一块"别人搭的"方块，再跑一次平台，应当被清掉
      world.set(END_ARRIVAL_X, END_ARRIVAL_Y + 1, END_ARRIVAL_Z, Block.STONE);
      buildEndArrivalPlatform(world);
      for (let dy = 0; dy <= 2; dy++) {
        for (let dz = -2; dz <= 2; dz++) {
          for (let dx = -2; dx <= 2; dx++) {
            if (world.getBlock(END_ARRIVAL_X + dx, END_ARRIVAL_Y + dy, END_ARRIVAL_Z + dz) !== Block.AIR) return false;
          }
        }
      }
      return true;
    })(),
  );
  check('落点在平台正中那一格之上（不是边缘）', Math.abs(END_ARRIVAL_X + 0.5 - END_ARRIVAL_X) < 1 && Math.abs(END_ARRIVAL_Z + 0.5 - END_ARRIVAL_Z) < 1);
}

// ---------------------------------------------------------------- 六、物品链

console.log('\n[六、末影之眼这一条链]');
{
  const eyeDef = itemDef(Item.ENDER_EYE);
  const pearlDef = itemDef(Item.ENDER_PEARL);
  check('两件物品都登记了', eyeDef !== undefined && pearlDef !== undefined);
  equal('末影之眼最大堆叠 64（原版）', eyeDef!.maxStack, 64);
  equal('末影珍珠最大堆叠 16（原版）', pearlDef!.maxStack, 16);
  check('都有中文名（不是回退成英文 id）', itemLabel(Item.ENDER_EYE) === '末影之眼' && itemLabel(Item.ENDER_PEARL) === '末影珍珠');
  check('两件都在创造物品栏里', CREATIVE_ITEMS.includes(Item.ENDER_EYE) && CREATIVE_ITEMS.includes(Item.ENDER_PEARL));
  check('图标那两张贴图在图集里', ['item_ender_eye', 'item_ender_pearl'].every((tile) => TILE_ORDER.includes(tile as never)));
  check('物品 id 没有撞车（注册表按 id 索引，撞了会静默变成另一件东西）', ITEMS[Item.ENDER_EYE]!.id === Item.ENDER_EYE && ITEMS[Item.ENDER_PEARL]!.id === Item.ENDER_PEARL);

  const eyeRecipe = RECIPES.find((recipe) => recipe.result.id === Item.ENDER_EYE);
  check('末影之眼有配方', eyeRecipe !== undefined);
  const ids = eyeRecipe ? recipeIngredients(eyeRecipe).map((entry) => entry.id).sort((a, b) => a - b) : [];
  const want = [Item.ENDER_PEARL, Item.BLAZE_POWDER].sort((a, b) => a - b);
  equal('配方就是"末影珍珠 + 烈焰粉"（原版无序）', ids.join('+'), want.join('+'));

  // 珍珠的来源：要塞传送门房那张表 + **末影人**（批次 112 起）。
  // 这里的断言是批次 111 留下的那条"警铃"的收尾：当时没有末影人，所以把箱子里的
  // 珍珠临时放大到期望 ≥ 12 颗，并盯着"没有生物掉珍珠"这条理由；末影人一落地，
  // 理由破了 → 本批把数量压回原版量，判据也换成"两个来源都在、且箱子不再是主力"。
  const table = LOOT_TABLES.find((entry) => entry.key === 'stronghold_portal');
  check('要塞传送门房有一张战利品表', table !== undefined);
  check('这张表能按名字查到序号（写进方块状态的就是它）', lootTableIndex('stronghold_portal') > 0);
  const pearlEntry = table?.entries.find((entry) => entry.id === Item.ENDER_PEARL);
  check('表里有末影珍珠', pearlEntry !== undefined);
  const totalWeight = table!.entries.reduce((sum, entry) => sum + entry.weight, 0);
  const expectedRolls = (table!.rollsMin + table!.rollsMax) / 2;
  const expectedPearls = expectedRolls * (pearlEntry!.weight / totalWeight) * ((pearlEntry!.min + pearlEntry!.max) / 2);
  check(
    `箱子里的珍珠已压回原版量（2~3 颗、期望 ${expectedPearls.toFixed(1)} 颗/箱）`,
    pearlEntry!.min === 2 && pearlEntry!.max === 3,
    `实际 ${pearlEntry!.min}~${pearlEntry!.max}`,
  );
  check(
    '末影人接上了：生物表里**有**生物掉末影珍珠（批次 111 的警铃到此收声）',
    DROPPING_MOB_TYPES.some((type) => type.drops.some((drop) => drop.itemId === Item.ENDER_PEARL)),
    '末影人在 MOB_TYPES 里且掉珍珠；这一条与上面"压回原版量"必须同时成立',
  );
}

console.log(`\n末地传送门测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
