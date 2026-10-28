/**
 * 切石配方（H11，批次 44）
 *
 * 切石机是原版里唯一"**一进多出、由玩家挑**"的加工台：放进 1 个石料，
 * 它列出所有能切出来的东西（台阶 2 份、楼梯/墙 1 份、"更细的石料" 1 份），
 * 点哪一项就切哪一项，**每次消耗 1 个输入**。
 *
 * ── 它解决的三个实际问题 ──────────────────────────────────────────────
 *  1. **省料**：合成台里"3 个石头 → 6 个台阶"（即 1 个母方块 → 2 个台阶），
 *     切石机同样是 1 → 2，但不用摆图案、也不用凑 3 个（手里只有 1 个也能用）。
 *  2. **同输入的歧义**：`4 磨制深板岩 → 4 深板岩砖` 与 `→ 4 深板岩瓦` 在原版
 *     输入与图案**完全相同**，本项目的合成匹配是单结果模型（取首个匹配），
 *     于是深板岩瓦在合成台里永远合不出来（批次 42 记录了这条，并把数据留在表里等这一批）。
 *     切石机用"一格多结果 + 玩家挑"天然解决它——**这就是这一批最实的收益**。
 *  3. **石材变体太多**：批次 41/42 一口气加了 53 个石材变体，如果只能靠合成台的
 *     图案配方来拿，玩家得先记住十几种摆法；有了切石机，"母方块进、变体出"就够了。
 *
 * ── 表怎么来的 ────────────────────────────────────────────────────────
 * 绝大部分是**从已有的表推出来**的（`SHAPED_PARENTS` 的 12 个母方块、
 * `STONE_VARIANT_PARENTS` 的 22 个石材家族、铜的四档氧化），只有"石料 → 更细的石料"
 * 这一档需要手写（`CONVERSIONS`）——原版这些转换本来也没有统一的规律：
 * 石头能切石砖、花岗岩只能磨制成磨制花岗岩、深板岩能往下切四级。
 * **手写的那一档全部进断言**（输入输出都在注册表里、产物不重复、没有自己切自己）。
 */

import {
  Block,
  COPPER_STAGES,
  SHAPED_PARENTS,
  STONE_VARIANT_PARENTS,
  copperId,
  slabId,
  stairsId,
  stoneVariantId,
  type StoneVariantKind,
} from '../registry/blocks.ts';

/** 一项可选产物（1 个输入切出来的东西） */
export interface StonecuttingOffer {
  readonly output: number;
  readonly count: number;
}

/** 输入 → 能切出来的东西（保持登记顺序：台阶 / 楼梯 / 墙 / 更细的石料） */
const TABLE = new Map<number, StonecuttingOffer[]>();

function add(input: number, output: number, count: number): void {
  // 自己切自己没有意义（表里有几处会撞上，直接丢掉比在界面上显示"石头 → 石头"好）
  if (input === output) return;
  const list = TABLE.get(input);
  if (!list) {
    TABLE.set(input, [{ output, count }]);
    return;
  }
  // 两条来源可能给出同一条（例如"深板岩砖 → 深板岩砖台阶"既在 `SHAPED_PARENTS` 里、
  // 又在变体表里），去重而不是让界面上出现两个一模一样的按钮
  if (list.some((offer) => offer.output === output)) return;
  list.push({ output, count });
}

/** 台阶 1 → 2 份、楼梯与墙 1 → 1 份（原版的数量，与合成台的产量一致） */
const VARIANT_YIELD: Readonly<Record<StoneVariantKind, number>> = { slab: 2, stairs: 1, wall: 1 };

// ---------------------------------------------------------------- 1. 表驱动

// 12 个"台阶 + 楼梯"母方块里，只有橡木木板是木材——原版没有"切木板"这回事
for (let index = 0; index < SHAPED_PARENTS.length; index++) {
  const [parent, name] = SHAPED_PARENTS[index]!;
  if (name === 'oak_planks') continue;
  add(parent, slabId(index), VARIANT_YIELD.slab);
  add(parent, stairsId(index), VARIANT_YIELD.stairs);
}

// 22 个石材家族的台阶 / 楼梯 / 墙（批次 41 + 42）——加一个家族就自动多几条
for (const [parent, name, kinds] of STONE_VARIANT_PARENTS) {
  for (const kind of kinds) {
    const id = stoneVariantId(name, kind);
    if (id !== undefined) add(parent, id, VARIANT_YIELD[kind]);
  }
}

// 铜的氧化四档：铜块 → 切制铜 / 台阶 / 楼梯；切制铜 → 台阶 / 楼梯（原版两档都给）。
// 这让"切制铜"不必占合成台的 4 个铜块大配方，1 个铜块就能切 1 份。
for (let stage = 0; stage < COPPER_STAGES.length; stage++) {
  add(copperId(stage, 0), copperId(stage, 1), 1);
  add(copperId(stage, 0), copperId(stage, 2), 2);
  add(copperId(stage, 0), copperId(stage, 3), 1);
  add(copperId(stage, 1), copperId(stage, 2), 2);
  add(copperId(stage, 1), copperId(stage, 3), 1);
}

// ---------------------------------------------------------------- 2. 手工补的转换

/**
 * "石料 → 更细的石料"（原版的 stonecutting 里没有规律可循的那一档）。
 *
 * 为什么会没有规律：石头能切石砖、闪长岩只能磨制、深板岩能一路往下切四级
 * （深板岩 → 圆石深板岩 → 磨制深板岩 → 深板岩砖 → 深板岩瓦）。
 * 照抄原版的数据，而不是自己发明一套整齐的规则——整齐的规则会把原版的手感改掉。
 */
const CONVERSIONS: readonly (readonly [number, number])[] = [
  // ---- 石头
  [Block.STONE, Block.STONE_BRICKS],
  [Block.STONE, Block.CHISELED_STONE_BRICKS],
  [Block.STONE_BRICKS, Block.CHISELED_STONE_BRICKS],
  // ---- 砂岩与红砂岩（批次 45 把红砂岩那一对补齐：两个家族在切石机里也同构）
  [Block.SANDSTONE, Block.CUT_SANDSTONE],
  [Block.SANDSTONE, Block.CHISELED_SANDSTONE],
  [Block.RED_SANDSTONE, Block.CUT_RED_SANDSTONE],
  [Block.RED_SANDSTONE, Block.CHISELED_RED_SANDSTONE],
  // ---- 三种石头磨制（原版只有这一条路，不能"石头直接切磨制花岗岩"）
  [Block.GRANITE, Block.POLISHED_GRANITE],
  [Block.DIORITE, Block.POLISHED_DIORITE],
  [Block.ANDESITE, Block.POLISHED_ANDESITE],
  // ---- 深板岩的整条链（原版 1.17 的核心建材）
  [Block.DEEPSLATE, Block.COBBLED_DEEPSLATE],
  [Block.DEEPSLATE, Block.POLISHED_DEEPSLATE],
  [Block.DEEPSLATE, Block.DEEPSLATE_BRICKS],
  [Block.DEEPSLATE, Block.DEEPSLATE_TILES],
  [Block.DEEPSLATE, Block.CHISELED_DEEPSLATE],
  [Block.COBBLED_DEEPSLATE, Block.POLISHED_DEEPSLATE],
  [Block.POLISHED_DEEPSLATE, Block.DEEPSLATE_BRICKS],
  // ⚠️ 这条就是批次 42 记下的"合成台里被挡住的那条"的正门：1 磨制深板岩 → 1 深板岩瓦
  [Block.POLISHED_DEEPSLATE, Block.DEEPSLATE_TILES],
  [Block.POLISHED_DEEPSLATE, Block.CHISELED_DEEPSLATE],
  [Block.DEEPSLATE_BRICKS, Block.DEEPSLATE_TILES],
  [Block.DEEPSLATE_BRICKS, Block.CHISELED_DEEPSLATE],
  // ---- 石英 / 海晶石 / 紫珀
  [Block.QUARTZ_BLOCK, Block.QUARTZ_PILLAR],
  [Block.QUARTZ_BLOCK, Block.CHISELED_QUARTZ_BLOCK],
  [Block.PRISMARINE, Block.PRISMARINE_BRICKS],
  [Block.PRISMARINE, Block.DARK_PRISMARINE],
  [Block.PURPUR_BLOCK, Block.PURPUR_PILLAR],
  // ---- 末地石
  [Block.END_STONE, Block.END_STONE_BRICKS],
];
for (const [input, output] of CONVERSIONS) add(input, output, 1);

// ---------------------------------------------------------------- 3. 查询

/** 这个物品能不能放进切石机（放进去会列出若干可选产物） */
export function isStonecuttingInput(itemId: number): boolean {
  return TABLE.has(itemId);
}

/**
 * 这张表里**所有**能被切出来的产物 id（批次 531）。
 *
 * 配方书要回答"这件东西能不能靠切石机做"，而 `stonecuttingOffers` 是
 * "输入 → 产物"的正向查询。这里在模块加载时反向建一次集合，避免界面上
 * 每画一个红底物品就遍历整张表。
 */
const STONECUTTING_OUTPUTS: ReadonlySet<number> = new Set(
  [...TABLE.values()].flatMap((offers) => offers.map((offer) => offer.output)),
);

/** 这件物品是不是切石机的产物（某一种输入能切出它） */
export function isStonecuttingOutput(itemId: number): boolean {
  return STONECUTTING_OUTPUTS.has(itemId);
}

/**
 * 能切出来的东西（没有则空数组）。
 *
 * 返回的是**副本**：调用方（界面）会把它渲染成一列按钮，
 * 万一有人往数组里 push 了什么，不该污染这张全局表。
 */
export function stonecuttingOffers(inputId: number): readonly StonecuttingOffer[] {
  const list = TABLE.get(inputId);
  return list ? [...list] : [];
}

/** 一次能切出几份（原版：台阶 2、其余 1）；没法切返回 0 */
export function stonecuttingYield(inputId: number, outputId: number): number {
  return TABLE.get(inputId)?.find((offer) => offer.output === outputId)?.count ?? 0;
}

/** 像"合成表规模"那样可被断言的规模数字：输入种数 / 配方条数 */
export function stonecuttingInputCount(): number {
  return TABLE.size;
}

export function stonecuttingRecipeCount(): number {
  let total = 0;
  for (const list of TABLE.values()) total += list.length;
  return total;
}

/** 手工转换那一段的条数（断言用：它是最容易漏改的一段） */
export function stonecuttingConversionCount(): number {
  return CONVERSIONS.length;
}
