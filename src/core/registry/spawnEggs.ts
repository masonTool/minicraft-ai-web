/**
 * 刷怪蛋（批次 174，TASKS J17）
 *
 * 由来：手机上想摆一只生物，现在只能打开聊天敲 `/summon zombie` —— 在触屏上打字这件事
 * 本身就很别扭，而**刷怪蛋是"点两下就有"**。它同时也让"看一眼这只生物长什么样"变成
 * 创造模式里的一个动作，而不是一次命令。
 *
 * 三处刻意的取舍：
 *  1. **只给"物种"做蛋，不给尺寸变体做**：史莱姆有 大/中/小 三种 `MobType`，岩浆怪同理，
 *     而原版只有一枚史莱姆蛋（生出来是中号）。所以这里 25 种 `MobType` 收敛成 **21 枚蛋**
 *     （去掉 3 个史莱姆/岩浆怪变体中的两个 + `remote_player`）。
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
];

/** 刷怪蛋的贴图名（与物品名同源：`spawn_egg_zombie`） */
export function spawnEggTile(mobId: string): string {
  return `spawn_egg_${mobId}`;
}

/** 第 index 枚刷怪蛋的物品 id */
export function spawnEggItemId(index: number): number {
  return SPAWN_EGG_ID_START + index;
}

/** 这枚蛋生成哪种生物（不是蛋就返回 undefined） */
export function spawnEggMobOf(itemId: number): string | undefined {
  const index = itemId - SPAWN_EGG_ID_START;
  return index >= 0 && index < SPAWN_EGG_SPECS.length ? SPAWN_EGG_SPECS[index]!.mobId : undefined;
}
