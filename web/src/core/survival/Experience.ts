/**
 * 经验值与等级（I5）
 *
 * 数值全部按原版 1.18：
 *  - **升到下一级所需经验**分三段（这是原版那条著名的分段线性函数）：
 *      0~15 级 → 2L + 7；16~30 级 → 5L - 38；31 级以上 → 9L - 158
 *  - 打怪经验：僵尸/骷髅/苦力怕 5 点，牛/猪/羊/鸡 1~3 点，末影龙 12000 点
 *  - 挖矿经验：煤矿 0~2、红石/青金石/下界石英 2~5、钻石/绿宝石 3~7
 *  - 熔炼经验：配方自带（铁 0.7、金 1.0、熟肉 0.35…），**攒够 1 点才吐一颗经验球**
 *
 * 这个模块只有纯数值与状态，不碰 DOM：等级的进位、消耗、死亡清零都能离线断言。
 *
 * 与原版的已知差异：
 *  - 经验球实体没做：打怪/挖矿是**直接进账**，而不是先掉一地绿球再捡
 *  - 死亡按原版"掉光经验"处理，但不生成经验球（所以也捡不回来）
 *  - 附魔消耗等级时不清空当前级进度（与原版一致，但原版还有个"等级越高越贵"的修正表）
 */

import { Block } from '../registry/blocks.ts';

/** 升到下一级所需经验（原版三段线性函数） */
export function xpToNext(level: number): number {
  if (level <= 15) return 2 * level + 7;
  if (level <= 30) return 5 * level - 38;
  return 9 * level - 158;
}

/** 累计到某个等级所需的**总**经验（调试面板与 `/xp set` 用） */
export function totalXpForLevel(level: number): number {
  let total = 0;
  for (let l = 0; l < level; l++) total += xpToNext(l);
  return total;
}

/**
 * 挖矿经验表：方块 id → [最少, 最多]。
 *
 * 只有"原版会给经验"的矿石进表（石头、圆石、沙子都不给经验）。
 * 深板岩变体的经验值与主世界矿石完全相同，所以用两次登记而不是抄一遍数字。
 */
const BLOCK_XP = new Map<number, readonly [number, number]>();

function oreXp(id: number, deepslateId: number, min: number, max: number): void {
  BLOCK_XP.set(id, [min, max]);
  BLOCK_XP.set(deepslateId, [min, max]);
}

// 原版数值：煤 0~2 · 下界石英 2~5 · 青金石/红石 2~5 · 铜 0 · 铁 0 · 金 0 · 钻石/绿宝石 3~7
oreXp(Block.COAL_ORE, Block.DEEPSLATE_COAL_ORE, 0, 2);
oreXp(Block.REDSTONE_ORE, Block.DEEPSLATE_REDSTONE_ORE, 1, 5);
oreXp(Block.LAPIS_ORE, Block.DEEPSLATE_LAPIS_ORE, 2, 5);
oreXp(Block.DIAMOND_ORE, Block.DEEPSLATE_DIAMOND_ORE, 3, 7);
oreXp(Block.EMERALD_ORE, Block.DEEPSLATE_EMERALD_ORE, 3, 7);
// 铁/铜/金矿在原版不给经验（只有粗矿熔炼时才有），这里如实照做
BLOCK_XP.set(Block.NETHER_QUARTZ_ORE, [2, 5]);
BLOCK_XP.set(Block.ANCIENT_DEBRIS, [2, 5]);

/** 这个方块挖掉给多少经验；不给经验返回 undefined */
export function blockXpRange(blockId: number): readonly [number, number] | undefined {
  return BLOCK_XP.get(blockId);
}

/** 掷一次挖矿经验（`roll` 是 0~1 的随机数，测试里传固定值就能验边界） */
export function rollBlockXp(blockId: number, roll: number): number {
  const range = BLOCK_XP.get(blockId);
  if (!range) return 0;
  const [min, max] = range;
  return min + Math.floor(roll * (max - min + 1));
}

export class Experience {
  /** 等级（0 起） */
  level = 0;
  /** 当前等级内已积累的经验 */
  progress = 0;
  /** 累计获得过的总经验（统计/调试用） */
  total = 0;
  /** 熔炼这类小数经验的余数：攒够 1 点才进账（原版也是一颗颗给） */
  private partial = 0;

  /** 升到下一级还差多少 */
  get toNext(): number {
    return xpToNext(this.level);
  }

  /** 当前级进度 0~1（画经验条用） */
  get ratio(): number {
    return this.progress / this.toNext;
  }

  /**
   * 加经验（允许小数：熔炼经验是 0.7 这样的值）。
   * @returns 实际进账的**整点**经验（0 表示还攒着）
   */
  add(amount: number): number {
    if (!Number.isFinite(amount) || amount <= 0) return 0;
    this.partial += amount;
    // 浮点误差：0.1+0.2 这类累加会差一点点，取整前先抹平
    const whole = Math.floor(this.partial + 1e-9);
    if (whole <= 0) return 0;
    this.partial -= whole;

    this.total += whole;
    this.progress += whole;
    // 一次可能连升好几级（打死末影龙就是），所以是 while 不是 if
    while (this.progress >= this.toNext) {
      this.progress -= this.toNext;
      this.level++;
    }
    return whole;
  }

  /** 直接设置等级（`/xp set`） */
  setLevel(level: number, progress = 0): void {
    this.level = Math.max(0, Math.floor(level));
    this.progress = Math.max(0, Math.min(this.toNext - 1, Math.floor(progress)));
    this.partial = 0;
  }

  /**
   * 扣等级（附魔台用）。
   * @returns 等级不够时返回 false，且**一点都不扣**
   */
  consumeLevels(levels: number): boolean {
    if (levels <= 0) return true;
    if (this.level < levels) return false;
    this.level -= levels;
    // 扣完等级后进度条的"分母"变小了，夹一下免得进度超过一整级
    this.progress = Math.min(this.progress, this.toNext - 1);
    return true;
  }

  /** 死亡：经验掉光（原版会掉一地经验球，这里不生成球，所以捡不回来） */
  reset(): void {
    this.level = 0;
    this.progress = 0;
    this.partial = 0;
    // total 累计值保留：它是"这辈子赚过多少"，不是"现在有多少"
  }

  /** 存档用 */
  serialize(): { level: number; progress: number; total: number; partial: number } {
    return { level: this.level, progress: this.progress, total: this.total, partial: this.partial };
  }

  restore(data: { level?: number; progress?: number; total?: number; partial?: number } | undefined): void {
    this.level = Math.max(0, Math.floor(data?.level ?? 0));
    this.progress = Math.max(0, Math.floor(data?.progress ?? 0));
    this.total = Math.max(0, Math.floor(data?.total ?? 0));
    this.partial = data?.partial ?? 0;
  }
}
