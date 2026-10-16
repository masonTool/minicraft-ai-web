/**
 * 发射器的**发射行为表**（批次 60，H14）。
 *
 * 投掷器与发射器的容器、触发、界面**完全一样**——唯一的差别就是这一张表：
 * 投掷器闭着眼把东西**吐出去**，发射器会先看"手里是什么"，是表里认得的东西就
 * **用它**（射箭、甩药水、点 TNT、打火石点火、剪羊毛…），表里没有的才当掉落物吐出去。
 *
 * 这一批只登记**本项目已经有能力做**的那些行为。原版的表更长，缺的几项连同
 * "为什么做不了"一起记在 TASKS B34（水桶/岩浆桶：本项目**没有桶装液体这两件物品**；
 * 火焰弹/烟花/船/矿车/潜影盒/盔甲架：对应功能都还没做）。
 * ✅ 骨粉原本也在这张"缺的"名单里（没有这件物品），**批次 69 已经补上**
 * （物品 + 配方 + `fertilize` 那一档，见 B42）。
 *
 * 为什么是**纯数据 + 一个查表函数**：行为的"执行"要在主程序里做（它才有世界与实体），
 * 而"哪件物品算什么"是个纯粹的表——拆开之后，表这部分能离线断言
 * （`tools/dispenser-test.ts` 会逐条对着注册表查），不必为了测一张表去搭一个世界。
 */

import { Block } from './blocks.ts';
import { Item } from './items.ts';
import { LINGERING_POTIONS, SPLASH_POTIONS, TIPPED_ARROWS } from './potions.ts';

/**
 * 行为种类。**一格动作 = 主程序里的一条 case**。
 */
export type DispenseAction =
  /** 射出投射物（箭有自己的类，走 `spawnArrow`） */
  | 'shoot-arrow'
  /** 扔出投掷物（雪球 / 鸡蛋 / 药水，与玩家投掷同一条实现） */
  | 'throw-projectile'
  /** 点燃凸口正对的那一格 TNT（**不是**吐出去） */
  | 'prime-tnt'
  /** 在凸口正对的那一格点火（打火石：用一次、耗 1 点耐久，但**不吐出去**） */
  | 'ignite-fire'
  /** 剪凸口正对那一格里的一只羊（剪刀：用一次、耗 1 点耐久） */
  | 'shear-entity'
  /** 给凸口正对那一格里的作物施肥（骨粉：催长 2~5 个阶段；不是作物就失败） */
  | 'fertilize';

/**
 * 投掷物的种类（与 `entity/Throwable.ts` 的 `ThrowableKind` **逐字一致**）。
 *
 * 这里刻意不 import 那个类型：`registry/` 不该反向依赖 `entity/`
 * （entity 是要吃 registry 的）。两边靠**结构相同**对上，主程序赋值时 TS 会替我们对齐。
 */
export type DispenseProjectile = 'snowball' | 'egg' | 'splash_potion' | 'lingering_potion';

export interface DispenseBehavior {
  action: DispenseAction;
  /** 给玩家看的一句话（物品提示框与发射器界面都用它，不手抄第二份） */
  cn: string;
  /** 投掷类才有：扔出来的是哪一种 */
  projectile?: DispenseProjectile;
  /**
   * 用一次消耗多少**耐久**（而不是整件消失）。
   * 只有"工具类"的行为才有：打火石与剪刀（原版这两样在发射器里也会磨损）。
   */
  wear?: number;
}

/** 物品 id → 行为 */
const BEHAVIORS = new Map<number, DispenseBehavior>();

function register(id: number, behavior: DispenseBehavior): void {
  BEHAVIORS.set(id, behavior);
}

// ---- 投射物：这三样都是"射出去"（原版初速 1.1 格/刻 ≈ 22 格/秒）
register(Item.ARROW, { action: 'shoot-arrow', cn: '把箭射出去' });
// 药水箭（28 支）也走"射箭"这一档：命中时按 1/8 时长挂效果（`Arrow` 的 `potionId` 负责）
for (const arrow of TIPPED_ARROWS) {
  register(arrow.id, { action: 'shoot-arrow', cn: '把药水箭射出去' });
}
register(Item.SNOWBALL, { action: 'throw-projectile', projectile: 'snowball', cn: '把雪球扔出去' });
register(Item.EGG, { action: 'throw-projectile', projectile: 'egg', cn: '把鸡蛋扔出去' });

// ---- 药水：喷溅与滞留都是"砸出去"（56 瓶，id 由药水表展开，不手抄）
for (const potion of SPLASH_POTIONS) {
  register(potion.id, { action: 'throw-projectile', projectile: 'splash_potion', cn: '把喷溅药水砸出去' });
}
for (const potion of LINGERING_POTIONS) {
  register(potion.id, { action: 'throw-projectile', projectile: 'lingering_potion', cn: '把滞留药水砸出去' });
}

// ---- TNT：点火**凸口对面那一格**（原版行为）。对面不是 TNT 就什么都不做（物品留着）
// ⚠️ TNT 是**方块**（它的物品 id 就是方块 id），所以这里用 `Block.TNT` 而不是 `Item.TNT`
register(Block.TNT, { action: 'prime-tnt', cn: '点燃凸口对着的那一格 TNT' });

// ---- 打火石：在凸口那一格点火，用一次耗 1 点耐久
// 骨粉（批次 69）：给凸口那一格的作物催长 2~5 个阶段；不是作物/已成熟时**失败**（不消耗）
register(Item.BONE_MEAL, { action: 'fertilize', cn: '给凸口那一格的作物施肥（催长 2~5 个阶段）' });
register(Item.FLINT_AND_STEEL, { action: 'ignite-fire', cn: '在凸口那一格点火（耗 1 点耐久）', wear: 1 });

// ---- 剪刀：剪凸口那一格里的羊，用一次耗 1 点耐久
register(Item.SHEARS, { action: 'shear-entity', cn: '剪凸口那一格里的羊（耗 1 点耐久）', wear: 1 });

/** 这件东西有专门的行为吗（没有就与投掷器一样吐出去） */
export function dispenseBehaviorFor(itemId: number): DispenseBehavior | undefined {
  return BEHAVIORS.get(itemId);
}

/** 表里一共几条（覆盖度台账与断言用：这是个"量得出来"的数） */
export function dispenseBehaviorCount(): number {
  return BEHAVIORS.size;
}

/** 表里所有条目（断言要逐条对着注册表查） */
export function dispenseBehaviors(): readonly { id: number; behavior: DispenseBehavior }[] {
  return [...BEHAVIORS].map(([id, behavior]) => ({ id, behavior }));
}

/** 表里没有的东西怎么办（界面提示要用这句话） */
export const DEFAULT_DISPENSE_CN = '当掉落物吐出去（与投掷器一样）';
