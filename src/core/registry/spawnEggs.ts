/**
 * 刷怪蛋（批次 174，TASKS J17）
 *
 * 由来：手机上想摆一只生物，现在只能打开聊天敲 `/summon zombie` —— 在触屏上打字这件事
 * 本身就很别扭，而**刷怪蛋是"点两下就有"**。它同时也让"看一眼这只生物长什么样"变成
 * 创造模式里的一个动作，而不是一次命令。
 *
 * 三处刻意的取舍：
 *  1. **只给"物种"做蛋，不给尺寸变体做**：史莱姆有 大/中/小 三种 `MobType`，岩浆怪同理，
 *     而原版只有一枚史莱姆蛋（生出来是中号）。所以这里 29 种 `MobType` 收敛成 **26 枚蛋**
 *     （去掉 3 个史莱姆/岩浆怪变体中的两个 + `remote_player`；批次 242 加了狼/猫/豹猫/狐狸）。
 *  2. **两个 boss 没有蛋**（原版也没有）：末影龙与凋灵只能按自己的仪式/维度进场。
 *  3. **它们是创造专属**：原版刷怪蛋就没有生存来源。所以这件事不能走"白名单写个理由"，
 *     而是在 `ItemDef.spawnEgg` 上标出来，由可达性审计**显式排除**（见 `tools/reachability-test.ts`
 *     里那段：被排除的每一枚都必须真的在创造物品栏里、且真的没有任何配方/掉落）。
 *
 * ⚠️ 这张表必须与 `MOB_TYPES` **一一对应**（`test:spawn` 有一条断言盯着）：
 * 少一行就是"这只生物没有蛋"，多一行就是"蛋生不出东西"——两种都不会报错，只会让玩家困惑。
 */

/** 刷怪蛋的 id 起点（紧接在现有的 1450 后面；`MAX_ITEM_ID` 是 1500，够放） */
export const SPAWN_EGG_ID_START = 1451;

export interface SpawnEggSpec {
  /** 生成哪种生物（`MobType.id`） */
  readonly mobId: string;
  /**
   * 显式物品 id（不填就按表内序号从 `SPAWN_EGG_ID_START` 往下排）。
   *
   * ⚠️ 只在"顺序区间的末尾撞上别的物品"时才用（批次 189 的鱿鱼就是这种情况：
   * 前 21 枚占满 1451~1471，1472 与 1473 已被水桶/岩浆桶占了）。
   * 同一种"撞位"要往后放一整段，改之前先看清楚后面还有哪些 id。
   */
  readonly id?: number;
}

/**
 * 明确**不做蛋**的生物 id（理由见文件头）：
 * 史莱姆与岩浆怪的尺寸变体（原版只有一枚中号蛋）、远程玩家（联机用的影子实体）。
 */
export const SPAWN_EGG_EXCLUDED: readonly string[] = [
  'slime_big',
  'slime_small',
  'magma_cube_big',
  'magma_cube_small',
  'remote_player',
];

export const SPAWN_EGG_SPECS: readonly SpawnEggSpec[] = [
  { mobId: 'zombie' },
  { mobId: 'skeleton' },
  { mobId: 'creeper' },
  { mobId: 'spider' },
  { mobId: 'cave_spider' },
  { mobId: 'enderman' },
  { mobId: 'drowned' },
  { mobId: 'husk' },
  { mobId: 'stray' },
  { mobId: 'phantom' },
  { mobId: 'slime' },
  { mobId: 'magma_cube' },
  { mobId: 'blaze' },
  { mobId: 'ghast' },
  { mobId: 'wither_skeleton' },
  { mobId: 'zombie_piglin' },
  { mobId: 'cow' },
  { mobId: 'pig' },
  { mobId: 'sheep' },
  { mobId: 'chicken' },
  { mobId: 'villager' },
  // 鱿鱼（批次 189）：生物表里多了一种，蛋也必须跟上（`test:spawn` 一一对应那条断言）。
  // ⚠️ 显式 id：顺序区间 1451~1471 之后紧挨着水桶（1472）与岩浆桶（1473）
  { mobId: 'squid', id: 1498 },
  // 驯养系（批次 242）：狼 / 猫 / 豹猫 / 狐狸。
  // ⚠️ 显式 id：1474~1487 是水桶之后、地图（1488）之前的一段空号
  { mobId: 'wolf', id: 1474 },
  { mobId: 'cat', id: 1475 },
  { mobId: 'ocelot', id: 1476 },
  { mobId: 'fox', id: 1477 },
  // 骑乘系（批次 253）：马/驴/骡/羊驼（刷怪蛋 id 1476/1475 之后顺延到 1482~1485）
  { mobId: 'horse', id: 1482 },
  { mobId: 'donkey', id: 1483 },
  { mobId: 'mule', id: 1484 },
  { mobId: 'llama', id: 1485 },
  // 被动生物第二批（批次 259）：兔子 / 山羊 / 鳕鱼 / 鲑鱼 / 海豚。
  // ⚠️ 1500 之后：`MAX_ITEM_ID` 为此从 1500 扩到 1510
  { mobId: 'rabbit', id: 1500 },
  { mobId: 'goat', id: 1501 },
  { mobId: 'cod', id: 1502 },
  { mobId: 'salmon', id: 1503 },
  { mobId: 'dolphin', id: 1504 },
  // 被动生物第三批（批次 260）：熊猫 / 北极熊 / 海龟 / 美西螈
  { mobId: 'panda', id: 1505 },
  { mobId: 'polar_bear', id: 1506 },
  { mobId: 'turtle', id: 1507 },
  { mobId: 'axolotl', id: 1508 },
  { mobId: 'bat', id: 1509 },
  // 下界生态（批次 344）：猪灵 / 疣猪兽（1511/1512，仍在 MAX_ITEM_ID 1520 之内）
  { mobId: 'piglin', id: 1511 },
  { mobId: 'hoglin', id: 1512 },
  { mobId: 'piglin_brute', id: 1513 },
  { mobId: 'silverfish', id: 1514 },
  { mobId: 'strider', id: 1515 },
  { mobId: 'shulker', id: 1516 },
  { mobId: 'iron_golem', id: 1517 },
  { mobId: 'pillager', id: 1518 },
  { mobId: 'guardian', id: 1519 },
  { mobId: 'elder_guardian', id: 1520 },
  // 蜜蜂（批次 374）：1521~1525 是物品 id，蛋从 1526 起
  { mobId: 'bee', id: 1526 },
  { mobId: 'parrot', id: 1527 },
  { mobId: 'mooshroom', id: 1528 },
  { mobId: 'endermite', id: 1529 },
  { mobId: 'vindicator', id: 1530 },
  { mobId: 'evoker', id: 1531 },
  { mobId: 'witch', id: 1532 },
  { mobId: 'ravager', id: 1533 },
  { mobId: 'vex', id: 1534 },
  { mobId: 'illusioner', id: 1535 },
  { mobId: 'wandering_trader', id: 1536 },
  { mobId: 'trader_llama', id: 1537 },
  { mobId: 'zombie_villager', id: 1538 },
  { mobId: 'tropical_fish', id: 1545 },
  { mobId: 'pufferfish', id: 1546 },
  { mobId: 'glow_squid', id: 1547 },
  { mobId: 'snow_golem', id: 1549 },
];

/** 刷怪蛋的贴图名（与物品名同源：`spawn_egg_zombie`） */
export function spawnEggTile(mobId: string): string {
  return `spawn_egg_${mobId}`;
}

/** 第 index 枚刷怪蛋的物品 id（`spec.id` 写了就用它，见那边的注记） */
export function spawnEggItemId(index: number): number {
  const spec = SPAWN_EGG_SPECS[index];
  if (!spec) return -1;
  return spec.id ?? SPAWN_EGG_ID_START + index;
}

/** 物品 id → 生物 id（不是蛋就查不到）。按 id 建表，因为 id 不再严格等于"起点 + 序号" */
const EGG_BY_ITEM_ID = new Map<number, string>(
  SPAWN_EGG_SPECS.map((spec, index) => [spawnEggItemId(index), spec.mobId]),
);

/** 这枚蛋生成哪种生物（不是蛋就返回 undefined） */
export function spawnEggMobOf(itemId: number): string | undefined {
  return EGG_BY_ITEM_ID.get(itemId);
}
