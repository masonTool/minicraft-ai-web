/**
 * 水浸（批次 469）
 *
 * 四条判据：
 *  ① **状态位**：bit7 单独存"含水"，不与台阶的双层（bit6）、朝向（bit1-2）、门的
 *     六个位打架；
 *  ② **谁可以含水**：只有非整格形状族（台阶/楼梯/栅栏/墙/活板门/玻璃板/门/栅栏门/告示牌）；
 *     整格方块、水、雪层都不行；
 *  ③ **放置**：落点原本是水 → 打标记；不是水 → 原样；
 *  ④ **破坏**：含水方块挖掉变回水，其余变空气。
 *
 * 运行：npm run test:waterlogged
 */

import {
  Block,
  blockAfterBreak,
  canBeWaterlogged,
  slabId,
  stairsId,
  waterloggedPlacementState,
} from '../src/core/registry/blocks.ts';
import { GLASS_PANE_ID } from '../src/core/registry/blocks.ts';
import {
  isSlabDouble,
  isWaterlogged,
  withFacing,
  withSlabDouble,
  withWaterlogged,
} from '../src/core/registry/blockState.ts';
import {
  canFillWaterlogged,
  fluidTick,
  isWaterAt,
  wakeFluidAt,
  WATER,
} from '../src/core/world/Fluids.ts';

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

// 石头台阶 / 石头楼梯：形状分别是 slab / stairs，足够验证"非整格可以含水"
const slab = slabId(0);
const stairs = stairsId(0);

console.log('\n[状态位：bit7 单独存水浸]');
{
  equal('默认不是含水', isWaterlogged(0), false);
  equal('打上标记', isWaterlogged(withWaterlogged(0, true)), true);
  equal('去掉标记', isWaterlogged(withWaterlogged(withWaterlogged(0, true), false)), false);

  // 台阶：朝向（bit1-2）+ 双层（bit6）+ 水浸（bit7）三者共存
  const stairsState = withWaterlogged(withSlabDouble(withFacing(0, 2), true), true);
  equal('朝向还在', (stairsState & 0b110) >> 1, 2);
  equal('双层还在', isSlabDouble(stairsState), true);
  equal('水浸还在', isWaterlogged(stairsState), true);
  // 反过来：清掉水浸之后，另两位仍原样
  const cleared = withWaterlogged(stairsState, false);
  equal('清掉水浸后朝向还在', (cleared & 0b110) >> 1, 2);
  equal('清掉水浸后双层还在', isSlabDouble(cleared), true);

  // 老存档（bit7 = 0）读出来就是"不含水"
  equal('老存档的 state 读作不含水', isWaterlogged(0b0111_1111), false);
}

console.log('\n[谁可以含水]');
{
  check('台阶可以', canBeWaterlogged(slab));
  check('楼梯可以', canBeWaterlogged(stairs));
  check('栅栏可以', canBeWaterlogged(Block.OAK_FENCE));
  check('栅栏门可以', canBeWaterlogged(Block.OAK_FENCE_GATE));
  check('玻璃板可以', canBeWaterlogged(GLASS_PANE_ID));
  check('活板门可以', canBeWaterlogged(Block.OAK_TRAPDOOR));
  check('门可以', canBeWaterlogged(Block.OAK_DOOR));
  check('告示牌可以', canBeWaterlogged(Block.OAK_SIGN));

  check('石头不行（整格）', !canBeWaterlogged(Block.STONE));
  check('木板不行（整格）', !canBeWaterlogged(Block.OAK_PLANKS));
  check('水自己不行', !canBeWaterlogged(Block.WATER));
  // 雪层的 bits5-7 全被层数占了，这一位不能借给它
  check('雪层不行（它的高位被层数占了）', !canBeWaterlogged(Block.SNOW));
}

console.log('\n[放置与破坏]');
{
  // 放置：水里放台阶 → 打标记；空气里放 → 不打
  equal('水里放台阶会打上水浸标记', isWaterlogged(waterloggedPlacementState(slab, 0, Block.WATER)), true);
  equal('空气里放台阶不打标记', isWaterlogged(waterloggedPlacementState(slab, 0, Block.AIR)), false);
  equal('水里放石头不打标记（整格不能含水）', waterloggedPlacementState(Block.STONE, 0, Block.WATER), 0);
  equal('水里放台阶保留原本的朝向', waterloggedPlacementState(slab, withFacing(0, 3), Block.WATER) & 0b110, withFacing(0, 3) & 0b110);

  // 破坏：含水 → 水；干 → 空气
  equal('挖掉含水台阶 → 变回水', blockAfterBreak(slab, withWaterlogged(0, true)), Block.WATER);
  equal('挖掉干台阶 → 空气', blockAfterBreak(slab, 0), Block.AIR);
  equal('挖掉含水台阶的**双层**形态也变回水', blockAfterBreak(slab, withWaterlogged(withSlabDouble(0, true), true)), Block.WATER);
  equal('挖掉石头 → 空气（与含水无关）', blockAfterBreak(Block.STONE, 0), Block.AIR);
  // 负对照：整格方块即使被人为打上 bit7，也不该变成水
  equal('整格方块上的脏 bit7 不会让破坏变成水', blockAfterBreak(Block.STONE, withWaterlogged(0, true)), Block.AIR);
}

// ---------------------------------------------------------------- 流体引擎认含水（批次 621 / Q18）

/**
 * 一个**只够用**的流体世界：一个 Map 存"坐标 → id + 状态"，外加计划刻队列。
 *
 * 刻意不引真实的 `World`：那要区块、要生成器，测一个"水能不能漫过台阶"不该付这个代价
 * （`Fluids.ts` 的文件头也写明了它只要求这两个读写）。
 */
function makeWorld(): {
  world: {
    getBlock(x: number, y: number, z: number): number;
    getState(x: number, y: number, z: number): number;
    setFluid(x: number, y: number, z: number, id: number, state: number): boolean;
    schedule(x: number, y: number, z: number, delayTicks: number): void;
  };
  put(x: number, y: number, z: number, id: number, state?: number): void;
  at(x: number, y: number, z: number): { id: number; state: number };
  scheduled(): number;
} {
  const cells = new Map<string, { id: number; state: number }>();
  let scheduled = 0;
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  const get = (x: number, y: number, z: number) => cells.get(key(x, y, z)) ?? { id: Block.AIR, state: 0 };
  return {
    world: {
      getBlock: (x, y, z) => get(x, y, z).id,
      getState: (x, y, z) => get(x, y, z).state,
      setFluid: (x, y, z, id, state) => {
        cells.set(key(x, y, z), { id, state });
        return true;
      },
      schedule: () => {
        scheduled++;
      },
    },
    put: (x, y, z, id, state = 0) => {
      cells.set(key(x, y, z), { id, state });
    },
    at: (x, y, z) => get(x, y, z),
    scheduled: () => scheduled,
  };
}

console.log('\n[流体引擎认含水（Q18）]');
{
  // ---- 判据一：什么是"水的一员" ----
  {
    const w = makeWorld();
    w.put(0, 0, 0, WATER, 0);
    w.put(1, 0, 0, slab, withWaterlogged(0, true));
    w.put(2, 0, 0, slab, 0);
    w.put(3, 0, 0, Block.STONE, 0);
    w.put(4, 0, 0, Block.STONE, withWaterlogged(0, true));

    equal('真的水算水', isWaterAt(w.world, 0, 0, 0), true);
    equal('含水台阶算水', isWaterAt(w.world, 1, 0, 0), true);
    equal('干台阶不算水', isWaterAt(w.world, 2, 0, 0), false);
    equal('石头不算水', isWaterAt(w.world, 3, 0, 0), false);
    // 负对照：整格方块被脏 bit7 污染时不能算水（bit7 是族内复用的）
    equal('石头上的脏 bit7 不算水', isWaterAt(w.world, 4, 0, 0), false);
  }

  // ---- 判据二：什么能被灌成含水 ----
  {
    const w = makeWorld();
    w.put(0, 0, 0, slab, 0);
    w.put(1, 0, 0, slab, withWaterlogged(0, true));
    w.put(2, 0, 0, Block.STONE, 0);

    equal('干台阶可以被水灌满', canFillWaterlogged(w.world, 0, 0, 0, WATER), true);
    equal('已经含水的台阶不用再灌', canFillWaterlogged(w.world, 1, 0, 0, WATER), false);
    equal('整格方块不能灌（不能含水）', canFillWaterlogged(w.world, 2, 0, 0, WATER), false);
    equal('岩浆不能把台阶灌成含水', canFillWaterlogged(w.world, 0, 0, 0, Block.LAVA), false);
  }

  // ---- 判据三：水从台阶上方漫下来，会把台阶灌满而不是流走 ----
  {
    const w = makeWorld();
    // 一格水源在上，正下方是干台阶，底下是空气
    w.put(0, 2, 0, WATER, 0);
    w.put(0, 1, 0, slab, 0);
    w.put(0, 0, 0, Block.AIR, 0);

    const changed = fluidTick(w.world, 0, 2, 0);
    equal('水源往下走时会先灌满台阶', changed, true);
    equal('台阶**还是台阶**（没被水覆盖掉）', w.at(0, 1, 0).id, slab);
    equal('台阶现在含水了', isWaterlogged(w.at(0, 1, 0).state), true);
  }

  // ---- 判据四：横向灌满（水在台阶旁边，不从上往下）----
  {
    const w = makeWorld();
    w.put(0, 0, 0, WATER, 0);
    w.put(1, 0, 0, slab, 0);
    // 台阶正下方是空气，但水优先"向下"，所以先堵住下行，逼它横向
    w.put(0, -1, 0, Block.STONE, 0);

    fluidTick(w.world, 0, 0, 0);
    equal('水会横向灌满旁边的台阶', isWaterlogged(w.at(1, 0, 0).state), true);
    equal('横向灌满也保留台阶', w.at(1, 0, 0).id, slab);
  }

  // ---- 判据五：含水台阶是水源，旁边的坑会被它填上 ----
  {
    const w = makeWorld();
    // 一个含水台阶，右边是空气坑（下方实心，水不会先漏下去）
    w.put(0, 0, 0, slab, withWaterlogged(0, true));
    w.put(0, -1, 0, Block.STONE, 0);
    w.put(1, 0, 0, Block.AIR, 0);
    w.put(1, -1, 0, Block.STONE, 0);

    // 用"水从哪来"那条路：把含水台阶当成一个已经在那里的水格跑一次 tick
    // （真实世界里它是被水灌满之后自己排进计划刻的）
    const changed = fluidTick(w.world, 0, 0, 0);
    equal('含水台阶不会自己消失（它算水源）', w.at(0, 0, 0).id, slab);
    equal('含水台阶仍然是含水', isWaterlogged(w.at(0, 0, 0).state), true);
    equal('它把旁边的坑灌成了水', w.at(1, 0, 0).id, WATER);
    equal('（上面那条确实改动了世界）', changed, true);
  }

  // ---- 判据六：与流体互不影响 / 不越界 ----
  {
    const w = makeWorld();
    // 岩浆旁边的含水台阶：岩浆不该被它"灌成含水"
    w.put(0, 0, 0, Block.LAVA, 0);
    w.put(1, 0, 0, slab, 0);
    w.put(0, -1, 0, Block.STONE, 0);
    w.put(1, -1, 0, Block.STONE, 0);
    fluidTick(w.world, 0, 0, 0);
    equal('岩浆不会把台阶灌成含水', isWaterlogged(w.at(1, 0, 0).state), false);

    // 唤醒：含水方块本身不是流体，不该被排进计划刻（否则每 tick 都在空转）
    const w2 = makeWorld();
    w2.put(0, 0, 0, slab, withWaterlogged(0, true));
    const n = wakeFluidAt(w2.world, 0, 0, 0);
    equal('唤醒时含水方块不算流体（不排计划刻）', n, 0);

    // ⚠️ 关键负对照（批次 621）：含水方块跑 tick 时**不能被毁掉**。
    // 它被当成 WATER 跑下去，如果照水源那条路重算，会把状态覆盖成 0 级水、
    // 或者判成"断源"直接写空气——两种都会让台阶凭空消失。
    const w4 = makeWorld();
    w4.put(0, 0, 0, slab, withWaterlogged(0, true));
    w4.put(0, -1, 0, Block.STONE, 0);
    w4.put(1, 0, 0, Block.STONE, 0); // 四周堵死，没有可流的空位
    fluidTick(w4.world, 0, 0, 0);
    equal('四周堵死时含水台阶不会被判断源', w4.at(0, 0, 0).id, slab);
    equal('状态也没被改成 0 级水', w4.at(0, 0, 0).state, withWaterlogged(0, true));

    // 楼梯同理（不同形状族，但同一套判据）
    const w5 = makeWorld();
    w5.put(0, 0, 0, stairs, withWaterlogged(withFacing(0, 2), true));
    w5.put(0, -1, 0, Block.STONE, 0);
    w5.put(1, 0, 0, Block.STONE, 0);
    fluidTick(w5.world, 0, 0, 0);
    equal('含水的楼梯也不会被毁（保留朝向）', w5.at(0, 0, 0).id, stairs);
    equal('朝向位没被动过', w5.at(0, 0, 0).state & 0b110, withFacing(0, 2) & 0b110);

    // 已经含水的台阶再 run 一次：不该反复"重新灌"（无变化）
    const w3 = makeWorld();
    w3.put(0, 0, 0, WATER, 0);
    w3.put(1, 0, 0, slab, withWaterlogged(0, true));
    w3.put(0, -1, 0, Block.STONE, 0);
    w3.put(1, -1, 0, Block.STONE, 0);
    fluidTick(w3.world, 0, 0, 0);
    equal('已含水的台阶不会被重复灌（保持含水）', isWaterlogged(w3.at(1, 0, 0).state), true);
  }
}

console.log(`\n水浸测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
