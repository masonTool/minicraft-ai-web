/**
 * `/locate structure` 的结构名清单（批次 624 / Q22）。
 *
 * 为什么单独一个零依赖的数据文件、而不直接从 `gen/Structures.ts` 搬：
 * 那个文件 import 了方块注册表、群系表、村庄/要塞/府邸三套布局模块 ——
 * 为了在**命令层**列几个名字就把这一大片拖进来，会让命令系统的测试从"纯逻辑"
 * 变成"半个生成器"。所以这里只写"名字 → 中文名 → 哪个维度 → 能不能定位"。
 *
 * ⚠️ **三张真清单仍是权威**（`Structures.ts` 的 `STRUCTURE_KINDS`、
 * `Bastion.ts` 的 `NETHER_STRUCTURE_KINDS`、`EndStructures.ts` 的 `END_STRUCTURE_KINDS`）。
 * 这里漏一行不会让结构消失，只会让 `/locate` 少认一个名字——
 * 所以 `test:commands` 里有一条断言把两边的**数量**对上（漏了就红）。
 *
 * `locatable: false` 的那两项不是遗漏：结构本体已经生成了，但"找最近的"
 * 那条函数还没写（下界化石、末地船）。标出来是为了让报错说
 * "还不支持定位"而不是"附近没有"——后者会让玩家一直往远处走。
 */

import type { DimensionId } from '../gen/Dimension.ts';

export interface StructureNameEntry {
  /** 命令里写的名字（= 生成器内部 kind） */
  readonly key: string;
  /** 中文名（报错与补全用） */
  readonly label: string;
  /**
   * 英文名。
   *
   * 为什么不在命令层按中文名查表：那会造出第二张"中文 → 英文"的表，
   * 两张表迟早漂（一边改了名另一边没改）。名字与它的两种写法放在同一行，
   * 改的时候眼睛就在它旁边。
   */
  readonly labelEn: string;
  /** 它在哪个维度 */
  readonly dimension: DimensionId;
  /** 有没有"找最近一个"的实现；false = 结构会生成，但还不能被 /locate 找到 */
  readonly locatable: boolean;
  /** 同一个东西的别名（原版与本项目各写过一种，两个都收） */
  readonly alias?: readonly string[];
}

export const STRUCTURE_NAMES: readonly StructureNameEntry[] = [
  // ---- 主世界（`Structures.ts` 的 STRUCTURE_DEFS，18 种）----
  { key: 'village', label: '村庄', labelEn: 'Village', dimension: 'overworld', locatable: true },
  { key: 'mineshaft', label: '废弃矿井', labelEn: 'Mineshaft', dimension: 'overworld', locatable: true },
  { key: 'stronghold', label: '要塞', labelEn: 'Stronghold', dimension: 'overworld', locatable: true },
  { key: 'dungeon', label: '地牢', labelEn: 'Dungeon', dimension: 'overworld', locatable: true },
  { key: 'shipwreck', label: '沉船', labelEn: 'Shipwreck', dimension: 'overworld', locatable: true },
  { key: 'ocean_monument', label: '海底神殿', labelEn: 'Ocean Monument', dimension: 'overworld', locatable: true },
  { key: 'woodland_mansion', label: '林地府邸', labelEn: 'Woodland Mansion', dimension: 'overworld', locatable: true },
  { key: 'desert_pyramid', label: '沙漠神殿', labelEn: 'Desert Pyramid', dimension: 'overworld', locatable: true },
  { key: 'jungle_temple', label: '丛林神庙', labelEn: 'Jungle Temple', dimension: 'overworld', locatable: true },
  { key: 'witch_hut', label: '女巫小屋', labelEn: 'Witch Hut', dimension: 'overworld', locatable: true },
  { key: 'pillager_outpost', label: '掠夺者前哨站', labelEn: 'Pillager Outpost', dimension: 'overworld', locatable: true },
  { key: 'ruined_portal', label: '废弃传送门', labelEn: 'Ruined Portal', dimension: 'overworld', locatable: true },
  { key: 'buried_treasure', label: '埋藏的宝藏', labelEn: 'Buried Treasure', dimension: 'overworld', locatable: true },
  { key: 'igloo', label: '雪屋', labelEn: 'Igloo', dimension: 'overworld', locatable: true },
  { key: 'ocean_ruins', label: '海底废墟', labelEn: 'Ocean Ruins', dimension: 'overworld', locatable: true },
  { key: 'fossil', label: '化石', labelEn: 'Fossil', dimension: 'overworld', locatable: true },
  { key: 'amethyst_geode', label: '紫水晶洞', labelEn: 'Amethyst Geode', dimension: 'overworld', locatable: true },
  { key: 'desert_well', label: '沙漠水井', labelEn: 'Desert Well', dimension: 'overworld', locatable: true },
  // ---- 下界（`Bastion.ts` 的 NETHER_STRUCTURE_KINDS，3 种）----
  {
    key: 'bastion_remnant',
    label: '堡垒遗迹',
    labelEn: 'Bastion Remnant',
    dimension: 'nether',
    locatable: true,
    alias: ['bastion'],
  },
  {
    key: 'nether_fortress',
    label: '下界要塞',
    labelEn: 'Nether Fortress',
    dimension: 'nether',
    locatable: true,
    alias: ['fortress'],
  },
  { key: 'nether_fossil', label: '下界化石', labelEn: 'Nether Fossil', dimension: 'nether', locatable: false },
  // ---- 末地（`EndStructures.ts` 的 END_STRUCTURE_KINDS，2 种）----
  { key: 'end_city', label: '末地城', labelEn: 'End City', dimension: 'end', locatable: true },
  { key: 'end_ship', label: '末地船', labelEn: 'End Ship', dimension: 'end', locatable: false },
];

/** 三张真清单的长度和（断言用它跟上面这条数组对齐） */
export const STRUCTURE_NAME_COUNT = STRUCTURE_NAMES.length;

/** 按名字（含别名）找一条；找不到返回 null */
export function findStructureName(raw: string): StructureNameEntry | null {
  const text = raw.trim().toLowerCase();
  if (text.length === 0) return null;
  if (text.startsWith('minecraft:')) return findStructureName(text.slice('minecraft:'.length));
  for (const entry of STRUCTURE_NAMES) {
    if (entry.key === text) return entry;
    if (entry.alias?.includes(text)) return entry;
  }
  return null;
}

/** 这个维度里有哪几种结构（`/help` 的下拉与"这个维度没有"的报错都用它） */
export function structuresIn(dimension: DimensionId): readonly StructureNameEntry[] {
  return STRUCTURE_NAMES.filter((entry) => entry.dimension === dimension);
}

/**
 * 给"名字不认识"的报错拼一句**分维度**的候选清单。
 *
 * 为什么按维度分：主世界 18 种、下界 3 种，全列出来一句报错就两行长了；
 * 而玩家在下界写 `village` 时真正需要知道的是"下界只有这 3 种"。
 */
export function structureNamesIn(dimension: DimensionId): string {
  return structuresIn(dimension)
    .map((entry) => entry.key)
    .join(' / ');
}
