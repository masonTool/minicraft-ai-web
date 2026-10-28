/**
 * 避雷针与雷电离线测试（批次 83）
 *
 * 这一批补的是**红石元件表里最后一件纯机制件**：避雷针。
 * 它的输出不是玩家开关决定的，而是天气决定的——所以断言分六块：
 *  1. **方块本身**：id 接着鎏金黑石（532）、六向朝向、要镐、进"红石"分类、贴图在册；
 *  2. **几何与杆头**：2/16 见方、从贴着的那一面伸出 6/16（六个朝向逐个数盒子），
 *     杆头坐标（闪电打在那儿）逐向验证；
 *  3. **放置**：六个朝向都能挂、**背后必须是实心**（挂不住就不给放）；
 *  4. **雷电规则**（纯函数）：128 格内有避雷针就打最近那根、否则落在玩家周围 8~32 格、
 *     伤害/半径/脉冲时长的常数、点火判据（空气 + 下面是实心）；
 *  5. **脉冲表与红石接线**：被劈中那 0.4 秒输出 15、到点自动灭，
 *     而且**过期那一刻**要能被调用方重算（不然电路会一直亮着）；
 *  6. **伤害语义**：`'lightning'` 进护甲豁免表（原版雷击无视护甲）。
 *
 * 运行：npm run test:lightning
 */

import { Block, blockDef, blockHardness, blockTiles } from '../web/src/core/registry/blocks.ts';
import {
  ROD_LENGTH,
  ROD_THICKNESS,
  collisionBoxes,
  lightningRodBox,
  type LocalBox,
} from '../web/src/core/registry/blockShapes.ts';
import { sixFacingOf, withSixFacing, type SixFacing } from '../web/src/core/registry/blockState.ts';
import { Item, categoryOf, dropFor, itemDef } from '../web/src/core/registry/items.ts';
import { hasDescription, missingBlockNames } from '../web/src/core/registry/itemNames.ts';
import { canHarvest, harvestRequirement } from '../web/src/core/registry/tools.ts';
import { ARMOR_BYPASS_CAUSES } from '../web/src/core/registry/armor.ts';
import { RedstoneEngine, isRedstoneComponent, wirePowerOf, type RedstoneWorld } from '../web/src/core/redstone/RedstoneEngine.ts';
import { isPowered } from '../web/src/core/registry/blockState.ts';
import { matchRecipe } from '../web/src/core/crafting/Recipes.ts';
import { planPlacement } from '../web/src/core/interaction/Placement.ts';
import {
  LIGHTNING_DAMAGE,
  LIGHTNING_DAMAGE_RADIUS,
  MAX_STRIKE_DISTANCE,
  MIN_STRIKE_DISTANCE,
  ROD_ATTRACT_RANGE,
  ROD_PULSE_SECONDS,
  RodPulses,
  lightningChargesCreeper,
  lightningTransformFor,
  pickStrike,
  rodTipPoint,
  shouldIgnite,
} from '../web/src/core/world/Lightning.ts';
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

function near(label: string, actual: number, expected: number, tol = 1e-9): void {
  check(label, Math.abs(actual - expected) <= tol, `实际 ${actual}，期望约 ${expected}`);
}

const TILES = new Set<string>(TILE_ORDER);
const ROD = Block.LIGHTNING_ROD;

// ---------------------------------------------------------------- 1. 方块

console.log('\n[方块：红石元件表里最后一件]');
{
  equal('id 接着鎏金黑石（531 → 532）', ROD, Block.GILDED_BLACKSTONE + 1);
  equal('形状是 lightning_rod', blockDef(ROD).shape, 'lightning_rod');
  check('六向放置（facesNormal）', blockDef(ROD).facesNormal === true);
  check('不算实心、不挡光（2/16 细杆）', !blockDef(ROD).solid && blockDef(ROD).lightOpacity === 0);
  equal('硬度 3（原版）', blockHardness(ROD), 3);
  check('要镐', harvestRequirement(ROD)?.tool === 'pickaxe');
  check('徒手挖不动', !canHarvest(ROD, null));
  check('掉落自身', dropFor(ROD)?.id === ROD);
  check('有物品', itemDef(ROD)?.block === ROD);
  // ⚠️ 本项目没有单独的"红石"分类：红石元件都在「功能方块」那一页
  // （拉杆/中继器/阳光传感器也一样，所以这里断言的是 `functional` 而不是 `redstone`）
  equal('与其它红石元件同页（功能方块）', categoryOf(ROD), categoryOf(Block.DAYLIGHT_DETECTOR));
  check('有中文名（`missingBlockNames` 里没有它）', !missingBlockNames().includes('lightning_rod'));
  check('有说明', hasDescription(ROD));
  check('贴图在图集名单里', blockTiles(ROD, 0).every((tile) => TILES.has(tile)));
  check('是红石元件（洪泛要能走到它）', isRedstoneComponent(ROD));
}

console.log('\n[几何：从贴着的那一面伸出 6/16]');
{
  const boxes = collisionBoxes('lightning_rod', withSixFacing(0, 'up'));
  equal('有碰撞（原版能站在杆上）', boxes.length, 1);
  const box = boxes[0]!;
  near('杆粗 2/16（x）', box[3] - box[0], ROD_THICKNESS);
  near('杆粗 2/16（z）', box[5] - box[2], ROD_THICKNESS);
  near('杆长 6/16（y）', box[4] - box[1], ROD_LENGTH);

  // 六个朝向：杆分别在格子的哪一侧
  const expectations: readonly (readonly [SixFacing, string])[] = [
    ['up', 'y 0~6/16'],
    ['down', 'y 10/16~1'],
    [1, 'x 10/16~1'],
    [3, 'x 0~6/16'],
    [2, 'z 10/16~1'],
    [0, 'z 0~6/16'],
  ];
  for (const [facing, label] of expectations) {
    const b: LocalBox = lightningRodBox(withSixFacing(0, facing));
    const ok =
      label === 'y 0~6/16'
        ? b[1] === 0 && Math.abs(b[4] - ROD_LENGTH) < 1e-9
        : label === 'y 10/16~1'
          ? Math.abs(b[1] - (1 - ROD_LENGTH)) < 1e-9 && b[4] === 1
          : label === 'x 10/16~1'
            ? Math.abs(b[0] - (1 - ROD_LENGTH)) < 1e-9 && b[3] === 1
            : label === 'x 0~6/16'
              ? b[0] === 0 && Math.abs(b[3] - ROD_LENGTH) < 1e-9
              : label === 'z 10/16~1'
                ? Math.abs(b[2] - (1 - ROD_LENGTH)) < 1e-9 && b[5] === 1
                : b[2] === 0 && Math.abs(b[5] - ROD_LENGTH) < 1e-9;
    check(`${String(facing)}：杆在 ${label}`, ok, JSON.stringify(b));
  }

  // 杆头（闪电的落点）：朝上的在 y+6/16，朝东的在 x+6/16…
  const tipUp = rodTipPoint(10, 64, 20, withSixFacing(0, 'up'));
  near('朝上：杆头 y = 64 + 6/16', tipUp.y, 64 + ROD_LENGTH);
  const tipDown = rodTipPoint(10, 64, 20, withSixFacing(0, 'down'));
  near('朝下：杆头 y = 65 − 6/16', tipDown.y, 65 - ROD_LENGTH);
  const tipEast = rodTipPoint(10, 64, 20, withSixFacing(0, 1));
  near('朝东：杆头 x = 10 + 6/16', tipEast.x, 10 + ROD_LENGTH);
  const tipWest = rodTipPoint(10, 64, 20, withSixFacing(0, 3));
  near('朝西：杆头 x = 11 − 6/16', tipWest.x, 11 - ROD_LENGTH);
  const tipSouth = rodTipPoint(10, 64, 20, withSixFacing(0, 2));
  near('朝南：杆头 z = 20 + 6/16', tipSouth.z, 20 + ROD_LENGTH);
  const tipNorth = rodTipPoint(10, 64, 20, withSixFacing(0, 0));
  near('朝北：杆头 z = 21 − 6/16', tipNorth.z, 21 - ROD_LENGTH);
}

// ---------------------------------------------------------------- 2. 放置

console.log('\n[放置：六向都能挂，但背后要实心]');
{
  /** 造一个"点某个面"的放置输入；`support` 是背后那一格的方块 */
  function place(
    normal: readonly [number, number, number],
    support: number,
    yaw = 0,
  ): ReturnType<typeof planPlacement> {
    const [nx, ny, nz] = normal;
    return planPlacement({
      blockId: ROD,
      normal,
      hitX: 0.5,
      hitY: 64,
      hitZ: 0.5,
      yaw,
      sneaking: false,
      blockAt: (dx, dy, dz) => (dx === -nx && dy === -ny && dz === -nz ? support : Block.AIR),
      hitBlock: support,
      hitState: 0,
    });
  }

  // ⚠️ 朝向是"**沿命中面法线朝外**"，而水平那一支的实现在项目里是"朝放置者"
  // （两者在**真实手势**下等价：你只能看到自己面前那一面，所以玩家总在法线那一侧）。
  // 测试里必须把 yaw 摆成与法线一致，否则就是"背对着墙点它的背面"这种不存在的姿势。
  const cases: readonly (readonly [readonly [number, number, number], SixFacing, number, string])[] = [
    [[0, 1, 0], 'up', 0, '点顶面 → 杆朝上'],
    [[0, -1, 0], 'down', 0, '点底面 → 杆朝下'],
    [[0, 0, 1], 2, 0, '点南面 → 杆朝南（玩家在北侧往南看）'],
    [[0, 0, -1], 0, Math.PI, '点北面 → 杆朝北'],
    // 点东面 → 玩家在东侧、往西看（yaw = +π/2）
    [[1, 0, 0], 1, Math.PI / 2, '点东面 → 杆朝东'],
    [[-1, 0, 0], 3, -Math.PI / 2, '点西面 → 杆朝西'],
  ];
  for (const [normal, expected, yaw, label] of cases) {
    const plan = place(normal, Block.STONE, yaw);
    check(label, plan !== null);
    if (plan) equal(`（${label}）朝向写对了`, sixFacingOf(plan.state), expected);
  }

  check('背后是空气 → 挂不住', place([0, 1, 0], Block.AIR) === null);
  check('背后是水 → 挂不住（水不是实心）', place([0, 1, 0], Block.WATER) === null);
  check('背后是玻璃也算实心（原版如此）', place([0, 1, 0], Block.GLASS) !== null);
  check('贴在天花板上也要求上方实心', place([0, -1, 0], Block.STONE) !== null && place([0, -1, 0], Block.AIR) === null);

  // 对照：同一位置放石头不走这条规则
  const stone = planPlacement({
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
  equal('对照用例：石头的方案没有朝向', stone?.state, 0);
}

// ---------------------------------------------------------------- 3. 雷电规则

console.log('\n[落点：有避雷针就用它]');
{
  const player = { x: 0.5, y: 64, z: 0.5 };
  const far = { x: 200, y: 64, z: 0 };
  const near = { x: 20, y: 64, z: 0 };

  const withFarOnly = pickStrike(() => 0, player, [far]);
  check('128 格外的避雷针不引雷（还是落在玩家附近）', withFarOnly !== null && !withFarOnly.rod);
  const withNear = pickStrike(() => 0, player, [far, near]);
  check('128 格内的避雷针会把雷引走', withNear?.rod === true);
  equal('打的是那一根的位置', `${withNear?.x},${withNear?.z}`, '20,0');
  const two = pickStrike(() => 0, player, [
    { x: 60, y: 64, z: 0 },
    { x: 10, y: 64, z: 0 },
  ]);
  equal('多根时选**最近**的那一根', two?.x, 10);
  equal('范围常量是原版的 128', ROD_ATTRACT_RANGE, 128);

  // 没有避雷针：随机落在玩家周围 8~32 格
  const near0 = pickStrike(() => 0, player, []);
  const d0 = Math.hypot(near0!.x + 0.5 - player.x, near0!.z + 0.5 - player.z);
  check(`随机数 0 → 最近距离（${d0.toFixed(1)} 格）`, d0 >= MIN_STRIKE_DISTANCE - 1.5 && d0 <= MIN_STRIKE_DISTANCE + 1.5);
  const near1 = pickStrike(() => 0.999, player, []);
  const d1 = Math.hypot(near1!.x + 0.5 - player.x, near1!.z + 0.5 - player.z);
  check(`随机数 0.999 → 最远距离（${d1.toFixed(1)} 格）`, d1 >= MAX_STRIKE_DISTANCE - 2 && d1 <= MAX_STRIKE_DISTANCE + 1);
  // 角度也要跟着随机数走（第二个随机数才是距离）
  let seed = 1;
  const seq = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const angles = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const target = pickStrike(seq, player, []);
    angles.add(`${target!.x > player.x ? 'E' : 'W'}`);
  }
  check('东西两侧都会落（角度是随机的）', angles.size === 2, [...angles].join(','));
}

console.log('\n[伤害与点火：常数与判据]');
{
  equal('伤害 10 点（原版 5 颗心）', LIGHTNING_DAMAGE, 10);
  equal('半径 3 格（立方）', LIGHTNING_DAMAGE_RADIUS, 3);
  near('脉冲 0.4 秒（原版 8 tick）', ROD_PULSE_SECONDS, 0.4);
  check('`lightning` 在护甲豁免表里', ARMOR_BYPASS_CAUSES.has('lightning'));

  check('空气 + 下方实心 → 会点火', shouldIgnite(Block.AIR, Block.STONE));
  check('空气 + 下方是空气 → 不点（火立不住）', !shouldIgnite(Block.AIR, Block.AIR));
  check('落点那一格是石头 → 不点', !shouldIgnite(Block.STONE, Block.STONE));
  check('下方是水 → 不点', !shouldIgnite(Block.AIR, Block.WATER));
}

// ---------------------------------------------------------------- 4. 脉冲表与红石

class StubWorld implements RedstoneWorld {
  private readonly blocks = new Map<string, number>();
  private readonly states = new Map<string, number>();
  readonly pulses = new RodPulses();

  private static key(x: number, y: number, z: number): string {
    return `${x},${y},${z}`;
  }

  getBlock(x: number, y: number, z: number): number {
    return this.blocks.get(StubWorld.key(x, y, z)) ?? 0;
  }

  getState(x: number, y: number, z: number): number {
    return this.states.get(StubWorld.key(x, y, z)) ?? 0;
  }

  setBlock(x: number, y: number, z: number, id: number, state: number): boolean {
    this.blocks.set(StubWorld.key(x, y, z), id);
    this.states.set(StubWorld.key(x, y, z), state);
    return true;
  }

  setState(x: number, y: number, z: number, state: number): boolean {
    this.states.set(StubWorld.key(x, y, z), state);
    return true;
  }

  isLoaded(): boolean {
    return true;
  }

  hasEntityAt(): boolean {
    return false;
  }

  /** 避雷针（批次 83）：引擎每轮问一句"这一格现在通不通电" */
  isRodPowered(x: number, y: number, z: number): boolean {
    return this.pulses.isPowered(x, y, z);
  }
}

console.log('\n[脉冲表：被劈中 0.4 秒，到点自动灭]');
{
  const pulses = new RodPulses();
  check('初始没输出', !pulses.isPowered(1, 2, 3));
  pulses.pulse(1, 2, 3);
  check('劈中之后有输出', pulses.isPowered(1, 2, 3));
  equal('在输出的根数 = 1', pulses.activeCount, 1);
  equal('别的格子不受影响', pulses.isPowered(1, 2, 4), false);
  equal('脉冲途中不返回过期项', pulses.tick(0.2).length, 0);
  check('0.2 秒后还有输出', pulses.isPowered(1, 2, 3));
  const expired = pulses.tick(0.25);
  equal('0.45 秒后过期', expired.length, 1);
  equal('过期的是那一格', `${expired[0]?.x},${expired[0]?.y},${expired[0]?.z}`, '1,2,3');
  check('过期之后不再输出', !pulses.isPowered(1, 2, 3));
  equal('在输出的根数归零', pulses.activeCount, 0);
  equal('已经过期了再 tick 不会重复报', pulses.tick(1).length, 0);

  const again = new RodPulses();
  again.pulse(0, 0, 0, 0.5);
  again.pulse(0, 0, 0, 1); // 再劈中一次：续上（取新的时长）
  equal('同一格连劈两次只是续上，不会变成两根', again.activeCount, 1);
  check('续上之后还剩 1 秒', again.tick(0.6).length === 0);
  again.clear();
  equal('clear 之后为空', again.activeCount, 0);
}

console.log('\n[红石接线：通电那 0.4 秒带得动电路]');
{
  const Y = 100;
  const world = new StubWorld();
  const engine = new RedstoneEngine();
  // 避雷针(0) → 粉(1) → 粉(2) → 红石灯(3)
  world.setBlock(0, Y, 0, ROD, withSixFacing(0, 'up'));
  world.setBlock(1, Y, 0, Block.REDSTONE_WIRE, 0);
  world.setBlock(2, Y, 0, Block.REDSTONE_WIRE, 0);
  world.setBlock(3, Y, 0, Block.REDSTONE_LAMP, 0);

  engine.onBlockChanged(world, 0, Y, 0);
  engine.tick(world, 0.05);
  check('没被劈时灯是灭的', !isPowered(world.getState(3, Y, 0)));

  world.pulses.pulse(0, Y, 0);
  engine.onBlockChanged(world, 0, Y, 0);
  engine.tick(world, 0.05);
  const wire1 = wirePowerOf(engine, 1, Y, 0);
  check('劈中之后：粉通电', wire1 > 0, `${wire1}`);
  check('灯被点亮', isPowered(world.getState(3, Y, 0)));
  check('避雷针自己的 powered 位也写上了（调试看得见）', isPowered(world.getState(0, Y, 0)));

  // 脉冲到期 → 主程序喊一次重算（`updateLightning` 里的那条）
  const expired = world.pulses.tick(0.5);
  equal('到期了', expired.length, 1);
  for (const pos of expired) engine.onBlockChanged(world, pos.x, pos.y, pos.z);
  // 红石灯断电后 0.2 秒才灭（批次 250）
  engine.tick(world, 0.05);
  engine.tick(world, 0.3);
  check('到期之后灯熄灭', !isPowered(world.getState(3, Y, 0)));
  equal('粉的强度清零', wirePowerOf(engine, 1, Y, 0), 0);
  check('避雷针的 powered 位也回到 false', !isPowered(world.getState(0, Y, 0)));
}

// ---------------------------------------------------------------- 5. 配方

console.log('\n[配方：3 个铜锭竖排]');
{
  const grid = (rows: readonly string[], legend: Record<string, number>): number[] => {
    const cells = new Array<number>(9).fill(0);
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < rows[r]!.length; c++) {
        const ch = rows[r]![c]!;
        if (ch !== '·') cells[r * 3 + c] = legend[ch] ?? 0;
      }
    }
    return cells;
  };
  const rod = matchRecipe(grid(['C', 'C', 'C'], { C: Item.COPPER_INGOT }), 3);
  equal('3 个铜锭 → 1 根避雷针', rod?.id, ROD);
  equal('产量 1', rod?.count, 1);
  check('只有 2 个铜锭合不出', matchRecipe(grid(['C', 'C', '·'], { C: Item.COPPER_INGOT }), 3)?.id !== ROD);
}

console.log('\n[雷击转换（批次 564）]');
{
  equal('猪会被劈成僵尸猪灵', lightningTransformFor('pig'), 'zombie_piglin');
  equal('村民会被劈成女巫', lightningTransformFor('villager'), 'witch');
  equal('其它生物不转换', lightningTransformFor('cow'), null);
  check('苦力怕会充能', lightningChargesCreeper('creeper'));
  check('猪不会被充能', !lightningChargesCreeper('pig'));
}

console.log(`\n避雷针测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
