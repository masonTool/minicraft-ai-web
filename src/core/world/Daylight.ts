/**
 * 亡灵在白天被晒（批次 124，尸壳那一批）
 *
 * 原版这条规则很出名：**僵尸、骷髅、溺尸在露天晒太阳会烧起来**（掉进水里、淋雨、
 * 躲进阴影里就没事），而**尸壳不会**——那正是"尸壳是沙漠专属"的原因
 * （沙漠白天没有阴影、没有树，别的亡灵活不下来）。
 *
 * 在这个项目里，这条机制一直没做（TASKS 里记着"本项目还没有'亡灵白天着火'"）——
 * 于是**尸壳做出来也没有意义**：一只不会烧的僵尸与一只普通的僵尸没有区别。
 * 所以这一批先把它补上，尸壳才有它的招牌。
 *
 * 归在 `core/world/` 而不是实体层：它是**一条世界规则**（判据全是环境量：见不见天、
 * 白天还是夜里、下不下雨），实体层只提供"这一种生物会不会烧"这一位数据
 * （`MobType.burnsInDaylight`）。
 */

/**
 * "露天"的判据：头顶那一格的天光是 **15**。
 *
 * ⚠️ 本项目的天光**不随昼夜变化**（地表恒为 15，夜晚靠 `skyBrightness` 折算——
 * 见刷怪那一段的注记），所以"是不是白天"必须**另外判**，不能拿天光当昼夜。
 * 这也是这个函数要同时收 `isDay` 与 `skyLight` 两个量的原因。
 */
export const FULL_SKY_LIGHT = 15;

/** 原版点燃时长：8 秒（点燃之后走既有的着火机制，每秒 1 点、水能浇灭） */
export const DAYLIGHT_BURN_SECONDS = 8;

export interface DaylightEnv {
  /** 头顶那一格的天光（本项目的天光不随昼夜变化，见上面那条注记） */
  skyLight: number;
  /** 现在是不是白天（`!isNight(timeOfDay)`） */
  isDay: boolean;
  /** 正在下雨/下雪（原版：淋雨会熄灭、也不会被晒着） */
  raining: boolean;
}

/**
 * 这一帧它会不会被晒着（纯函数，好断言）。
 *
 * 三条判据：
 *  1. 这一种生物**写了自己会在白天烧**（`burnsInDaylight`，尸壳不写）；
 *  2. **露天**（头顶天光 15——躲在方块底下、洞里、水里都不是 15）；
 *  3. **白天**且**没下雨**。
 *
 * 返回 8 秒的点燃时长由调用方决定（这里只回答"会不会"）。
 */
export function sunBurns(burnsInDaylight: boolean | undefined, env: DaylightEnv): boolean {
  if (burnsInDaylight !== true) return false;
  if (env.skyLight < FULL_SKY_LIGHT) return false;
  if (!env.isDay || env.raining) return false;
  return true;
}
