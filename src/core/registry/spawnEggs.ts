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
  /** 中文名的主体（"僵尸" → "僵尸刷怪蛋"） */
  readonly label: string;
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
  { mobId: 'zombie', label: '僵尸' },
  { mobId: 'skeleton', label: '骷髅' },
  { mobId: 'creeper', label: '苦力怕' },
  { mobId: 'spider', label: '蜘蛛' },
  { mobId: 'cave_spider', label: '洞穴蜘蛛' },
  { mobId: 'enderman', label: '末影人' },
  { mobId: 'drowned', label: '溺尸' },
  { mobId: 'husk', label: '尸壳' },
  { mobId: 'stray', label: '流浪者' },
  { mobId: 'phantom', label: '幻翼' },
  { mobId: 'slime', label: '史莱姆' },
  { mobId: 'magma_cube', label: '岩浆怪' },
  { mobId: 'blaze', label: '烈焰人' },
  { mobId: 'ghast', label: '恶魂' },
  { mobId: 'wither_skeleton', label: '凋灵骷髅' },
  { mobId: 'zombie_piglin', label: '僵尸猪灵' },
  { mobId: 'cow', label: '牛' },
  { mobId: 'pig', label: '猪' },
  { mobId: 'sheep', label: '羊' },
  { mobId: 'chicken', label: '鸡' },
  { mobId: 'villager', label: '村民' },
  // 鱿鱼（批次 189）：生物表里多了一种，蛋也必须跟上（`test:spawn` 一一对应那条断言）。
  // ⚠️ 显式 id：顺序区间 1451~1471 之后紧挨着水桶（1472）与岩浆桶（1473）
  { mobId: 'squid', label: '鱿鱼', id: 1498 },
  // 驯养系（批次 242）：狼 / 猫 / 豹猫 / 狐狸。
  // ⚠️ 显式 id：1474~1487 是水桶之后、地图（1488）之前的一段空号
  { mobId: 'wolf', label: '狼', id: 1474 },
  { mobId: 'cat', label: '猫', id: 1475 },
  { mobId: 'ocelot', label: '豹猫', id: 1476 },
  { mobId: 'fox', label: '狐狸', id: 1477 },
  // 骑乘系（批次 253）：马/驴/骡/羊驼（刷怪蛋 id 1476/1475 之后顺延到 1482~1485）
  { mobId: 'horse', label: '马', id: 1482 },
  { mobId: 'donkey', label: '驴', id: 1483 },
  { mobId: 'mule', label: '骡', id: 1484 },
  { mobId: 'llama', label: '羊驼', id: 1485 },
  // 被动生物第二批（批次 259）：兔子 / 山羊 / 鳕鱼 / 鲑鱼 / 海豚。
  // ⚠️ 1500 之后：`MAX_ITEM_ID` 为此从 1500 扩到 1510
  { mobId: 'rabbit', label: '兔子', id: 1500 },
  { mobId: 'goat', label: '山羊', id: 1501 },
  { mobId: 'cod', label: '鳕鱼', id: 1502 },
  { mobId: 'salmon', label: '鲑鱼', id: 1503 },
  { mobId: 'dolphin', label: '海豚', id: 1504 },
  // 被动生物第三批（批次 260）：熊猫 / 北极熊 / 海龟 / 美西螈
  { mobId: 'panda', label: '熊猫', id: 1505 },
  { mobId: 'polar_bear', label: '北极熊', id: 1506 },
  { mobId: 'turtle', label: '海龟', id: 1507 },
  { mobId: 'axolotl', label: '美西螈', id: 1508 },
  { mobId: 'bat', label: '蝙蝠', id: 1509 },
  // 下界生态（批次 344）：猪灵 / 疣猪兽（1511/1512，仍在 MAX_ITEM_ID 1520 之内）
  { mobId: 'piglin', label: '猪灵', id: 1511 },
  { mobId: 'hoglin', label: '疣猪兽', id: 1512 },
  { mobId: 'piglin_brute', label: '猪灵蛮兵', id: 1513 },
  { mobId: 'silverfish', label: '蠹虫', id: 1514 },
  { mobId: 'strider', label: '炽足兽', id: 1515 },
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
