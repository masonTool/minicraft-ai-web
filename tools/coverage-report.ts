/**
 * 能力覆盖度台账（对着 1.18 规格量出来的）
 *
 * 为什么要有这个脚本：README / HANDOFF / TASKS 里一直写着"方块 288 / 规格 700+"
 * 这类数字，但它们是**人抄的** —— 项目已经因为手写派生数字漂过三次
 * （提交总数、路线图状态、方块总数）。这里改成：
 *
 *   1. **分子从注册表量**（`BLOCKS.length` / `CREATIVE_ITEMS.length` / `MOB_TYPES.length` …），
 *      一个数字都不手写；
 *   2. **分母写在下面的 SPEC 表里**（它是"原版规格"，属于外部事实，本来就该手写），
 *      每一行的依据都写进 `basis` 字段，方便以后有人质疑"这个 700 是哪来的"；
 *   3. 结果**自动写回 TASKS.md 的 §1 覆盖度台账**（标记块之间），
 *      手抄过一次之后它就不可能再漂。
 *
 * 用法：`npm run audit:coverage`（也可以用 `npm run audit:coverage -- --print` 只看结果）
 */

import { readFileSync, writeFileSync } from 'node:fs';

import { BLOCKS, Block, blockDef } from '../src/core/registry/blocks.ts';
import { CREATIVE_ITEMS } from '../src/core/registry/items.ts';
import { MOB_TYPES } from '../src/core/entity/mobs.ts';
import { BIOMES } from '../src/core/gen/Biome.ts';
import { NETHER_BIOME_NAMES } from '../src/core/gen/NetherGenerator.ts';
import { STRUCTURE_KINDS } from '../src/core/gen/Structures.ts';
import { NETHER_STRUCTURE_KINDS } from '../src/core/gen/Bastion.ts';
import { END_STRUCTURE_KINDS } from '../src/core/gen/EndStructures.ts';
import { ENCHANTMENTS } from '../src/core/registry/enchantments.ts';
import { EFFECTS } from '../src/core/survival/StatusEffects.ts';
import { DRINKABLE } from '../src/core/registry/potions.ts';
import { RECIPES } from '../src/core/crafting/Recipes.ts';
import { SMELTING_RECIPES } from '../src/core/crafting/Smelting.ts';
import { COMMANDS } from '../src/core/commands/Commands.ts';
import { DEFAULT_GAME_RULES } from '../src/core/world/Rules.ts';
import { DIMENSION_CYCLE } from '../src/core/gen/Dimension.ts';
import { ORE_BLOCKS } from '../src/core/gen/OreGenerator.ts';
import { TREE_KINDS } from '../src/core/gen/Features.ts';
import { isRedstoneComponent } from '../src/core/redstone/RedstoneEngine.ts';
import { ADVANCEMENTS } from '../src/core/progress/advancements.ts';

const TASKS_FILE = new URL('../TASKS.md', import.meta.url);
const START_MARK = '<!-- coverage:start -->';
const END_MARK = '<!-- coverage:end -->';

/** 一行台账：分母是原版规格（人写的），分子是量出来的 */
interface Row {
  /** 维度名 */
  readonly label: string;
  /** 1.18 规格（分母） */
  readonly spec: number;
  /** 现在的真实条数（分子） */
  readonly now: number;
  /** 规格的出处，免得以后有人不知道这个数是怎么来的 */
  readonly basis: string;
  /** 主要缺口 */
  readonly gap: string;
}

/** 规格依据统一收在一处（TASKS §0 基准规格 + 原版公开数据） */
const SPEC = {
  blocks: 700,
  items: 1100,
  mobs: 70,
  biomes: 61,
  structures: 23,
  trees: 11,
  enchantments: 38,
  effects: 30,
  potions: 28,
  recipes: 1000,
  commands: 40,
  rules: 30,
  /**
   * 红石元件的**种类**数（批次 55 修正：原来是估的 20，做完绊线/绊线钩之后
   * 我们的实现数是 21 —— 一个"规格"比实际还小，说明当初那个数是拍的）。
   *
   * 按统一的计数规则重数了一遍原版 1.18，**35 种**：
   * 红石粉 / 火把 / 红石块 / 拉杆 / 石按钮 / 木按钮 / 石压力板 / 木压力板 /
   * 轻质测重压力板 / 重质测重压力板 / 中继器 / 比较器 / 红石灯 / 活塞 / 粘性活塞 /
   * 侦测器 / 阳光传感器 / 绊线钩 / 绊线 / 音符盒 / 目标方块 / 发射器 / 投掷器 / 漏斗 /
   * 铁轨 / 动力铁轨 / 探测铁轨 / 激活铁轨 / TNT / 红石矿石 / 避雷针 /
   * 门 / 活板门 / 栅栏门 / 陷阱箱。
   * 规则：**同族木材只算一种**（6 种木按钮 = 1 种）、活塞头等技术方块不计。
   */
  redstone: 35,
  dimensions: 3,
  fluids: 2,
  ores: 9,
  advancements: 100,
  locales: 2,
} as const;

/**
 * 红石"元件种类"。
 *
 * ⚠️ 不能直接数 `isRedstoneComponent` 命中的**方块 id**：门 / 活板门 / 栅栏门是按形状判定的，
 * 6 种木材的同一种门会被数成 18 种元件（加一种木材就 +3），覆盖率会凭空涨到 100%——
 * 那是"分母不动、分子注水"，比手抄一个错数字更糟。所以这三类按**形状**各算 1 种，
 * 其余元件按 id 数（它们没有"颜色变体"）。
 */
const openableShapes = new Set<string>();
let redstoneKinds = 0;
for (let id = 0; id < BLOCKS.length; id++) {
  if (!isRedstoneComponent(id)) continue;
  // 活塞头是**技术方块**（活塞伸出时才出现，没有物品），按上面那条计数规则不计
  if (id === Block.PISTON_HEAD) continue;
  const shape = blockDef(id).shape;
  if (shape === 'door' || shape === 'trapdoor' || shape === 'fence_gate') openableShapes.add(shape);
  else redstoneKinds++;
}
// +1 = 普通铁轨（批次 245）。它**故意不进** `isRedstoneComponent`：
// 我们还没做充能/动力轨，进了那张表只会让红石引擎去扫一个永远不会响应的方块。
const redstoneElements = redstoneKinds + openableShapes.size + 1;
const implementedEnchants = ENCHANTMENTS.filter((def) => def.implemented === true).length;
/**
 * "可见方块"：排除空气与两种流体。
 *
 * 不排除的话这个数会虚高 3 —— 而"空气也算一种方块"这种事只有数的人自己知道，
 * 文档读者是不知道的（原版规格里的 700+ 也是指看得见的方块）。
 */
const visibleBlocks = BLOCKS.filter((def, id) => id !== Block.AIR && def.shape !== 'fluid').length;
/**
 * 矿石：主世界那 8 种走 `ORES` 表（`ORE_BLOCKS` 是普通 + 深板岩成对登记的），
 * 下界石英与远古残骸在下界生成器里单独写（`Block.NETHER_QUARTZ_ORE` / `Block.ANCIENT_DEBRIS`）。
 */
const oreKinds = ORE_BLOCKS.size / 2 + 2;

const rows: readonly Row[] = [
  {
    label: '方块（可见方块种类）',
    spec: SPEC.blocks,
    now: visibleBlocks,
    basis: 'TASKS §0「约 700+ 种」',
    gap: '方块族（地毯/雪层/告示牌/床…）与 1.17 内容整块',
  },
  {
    label: '物品（含方块物品）',
    spec: SPEC.items,
    now: CREATIVE_ITEMS.length,
    basis: 'TASKS §0「约 1100+ 种」',
    gap: '装备/食物/1.17 内容',
  },
  {
    label: '生物',
    spec: SPEC.mobs,
    now: MOB_TYPES.length,
    basis: 'TASKS §0「约 70 种」',
    gap: '下界系、海洋系、村庄系（驯养系：批次 242 已补狼/猫/豹猫/狐狸）',
  },
  {
    label: '生物群系',
    spec: SPEC.biomes,
    // ⚠️ 分母曾经写 72（"主世界 ~61 + 下界 5 + 末地 6"）——那是把 **1.18 全部群系的
    // 61** 当成了"主世界"的数量，两边重复计数。批次 401 对着清单逐条核过：
    // 主世界正好 **50** 个（本项目全部实现），`the_void` 1 个，下界 5 个（另一张表），
    // 末地 5 个（末端是单一地形，没建群系表）。所以分子要把下界那张表加进来数。
    now: BIOMES.length + NETHER_BIOME_NAMES.length,
    basis: '原版 1.18 共 61 个：主世界 50 + the_void + 下界 5 + 末地 5',
    gap: '末地 5 个 + the_void：都是"只影响雾色/刷怪表"的标注型群系，本项目的末端是单一地形',
  },
  {
    label: '结构',
    spec: SPEC.structures,
    // 三个维度各一张清单：下界（堡垒遗迹/下界要塞）与末地（末地城/末地船）
    // 都不在 `STRUCTURE_KINDS` 里。以前只加了下界那一张，**末地一个都没数**——
    // 于是"结构 63%"这个数把已经实现的末地城与末地船漏在外面，看起来像最弱的一项。
    now: STRUCTURE_KINDS.length + NETHER_STRUCTURE_KINDS.length + END_STRUCTURE_KINDS.length,
    // 分母不再写"约 30"（那是拍的）：这里是逐条列出来的 23 种——
    // 主世界 18（村庄/矿井/要塞/地牢/沉船/海底神殿/林地府邸/沙漠神殿/丛林神庙/
    // 沼泽小屋/掠夺者前哨/废弃传送门/埋藏的宝藏/冰屋/海底废墟/化石/紫晶洞/沙漠水井）、
    // 下界 3（堡垒遗迹/下界要塞/下界化石）、末地 2（末地城/末地船）
    basis: '原版 1.18 结构 23 种（主世界 18 + 下界 3 + 末地 2，逐条列在注释里）',
    gap: '下界化石（nether_fossil）',
  },
  {
    label: '树种（地物）',
    spec: SPEC.trees,
    now: TREE_KINDS.length,
    basis: '原版 1.18 的树木种类（含巨型变体与竹）',
    gap: '—',
  },
  {
    label: '附魔（登记）',
    spec: SPEC.enchantments,
    now: ENCHANTMENTS.length,
    basis: '原版 1.18 共 38 条',
    gap: '—',
  },
  {
    label: '附魔（效果已接线）',
    spec: SPEC.enchantments,
    now: implementedEnchants,
    basis: '同上：分母按 38 条算，"能附"不等于"有效果"',
    gap: '位移类（深海探索者/冰霜行者/灵魂疾行）、荆棘、横扫，以及三叉戟/弩那一族（批次 243 已补摔落/水下/击退/火焰附加/消失诅咒）',
  },
  {
    label: '状态效果',
    spec: SPEC.effects,
    now: EFFECTS.length,
    basis: '原版 1.18 的全部状态效果',
    gap: '—',
  },
  {
    label: '药水（饮用型，按效果×档位）',
    spec: SPEC.potions,
    now: DRINKABLE.length,
    basis: '原版 1.18 可酿造出的饮用型药水种类',
    gap: '—',
  },
  {
    label: '合成配方（含熔炼）',
    spec: SPEC.recipes,
    now: RECIPES.length + SMELTING_RECIPES.length,
    basis: '原版 1.18 配方总数（约 1000+，含全部方块族）',
    gap: '随方块族一起补',
  },
  {
    label: '命令',
    spec: SPEC.commands,
    now: COMMANDS.length,
    basis: '原版 1.18 单人可用命令（不含权限类）',
    gap: '记分板（M23）、命令方块，以及 /clone /data /locate 一族（批次 399 已补 /execute + 选择器）',
  },
  {
    label: '游戏规则',
    spec: SPEC.rules,
    now: Object.keys(DEFAULT_GAME_RULES).length,
    basis: '原版 1.18 `/gamerule` 条目数',
    gap: '天气/生物/方块类规则',
  },
  {
    label: '红石元件（含门类负载）',
    spec: SPEC.redstone,
    now: redstoneElements,
    basis: '原版 1.18 参与充能/传导/负载的元件（同族木材只算一种）',
    gap: '—（剩下只有"红石灯延迟熄灭"这一条行为，不是元件）',
  },
  {
    label: '维度',
    spec: SPEC.dimensions,
    now: DIMENSION_CYCLE.length,
    basis: '原版 1.18 三个维度',
    gap: '—',
  },
  {
    label: '流体',
    spec: SPEC.fluids,
    now: 2,
    basis: '原版 1.18 两种流体（水/岩浆）',
    gap: '—（waterlogged 状态位未做）',
  },
  {
    label: '矿石',
    spec: SPEC.ores,
    now: oreKinds,
    basis: 'TASKS §0「9 种（含下界石英）」',
    gap: '—（另做了远古残骸）',
  },
  {
    label: '成就 / 进度',
    spec: SPEC.advancements,
    // ⚠️ 数的是**条目本身的条数**，不是"能不能拿到"：原版那张表里
    // 有一大半挂在未实现的内容上（村民交易、蜜蜂、信标、鞘翅…），
    // 本项目按"能用现有事件判定"的条目一条条补（M7 的差异记录里有清单）
    now: ADVANCEMENTS.length,
    basis: '原版 1.18 进度条目量级（约 100+）',
    gap: '100 条已全部落地',
  },
  {
    label: '界面语言',
    spec: SPEC.locales,
    // 批次 403 起有了 zh/en 两张表与语言设置，但**英文只覆盖暂停菜单 + 设置分组那 13 条**，
    // 界面其余部分仍是中文。所以这里还是数 1——"登记了"不等于"翻完了"，
    // 与附魔那两行同一个口径（能选≠生效）。
    now: 1,
    basis: '原版 1.18 内置语言数（本项目中文为主，英文自批次 403 起有框架与 13 条文案）',
    gap: '英文表只覆盖暂停菜单与设置分组；界面其余部分还是中文（M8 剩余部分）',
  },
];

function percent(now: number, spec: number): string {
  if (spec <= 0) return '—';
  // 超过规格（例如矿石多做了远古残骸）时封顶在 100%：这是一种"达标"，不是 111%
  return `${Math.min(100, Math.round((now / spec) * 100))}%`;
}

/** 生成台账的 markdown 表格（TASKS 与终端共用同一份输出） */
function renderTable(): string {
  const lines: string[] = [];
  lines.push('| 维度 | 1.18 规格 | 现在 | 覆盖度 | 规格出处 | 主要缺口 |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const row of rows) {
    lines.push(
      `| ${row.label} | ${row.spec} | ${row.now} | ${percent(row.now, row.spec)} | ${row.basis} | ${row.gap} |`,
    );
  }
  return lines.join('\n');
}

/** 终端里的对齐打印（宽表格在终端里折行读不动，所以分成两块） */
function printTable(): void {
  console.log('维度'.padEnd(24) + '规格'.padStart(8) + '现在'.padStart(8) + '覆盖度'.padStart(10));
  for (const row of rows) {
    console.log(
      row.label.padEnd(24) +
        String(row.spec).padStart(8) +
        String(row.now).padStart(8) +
        percent(row.now, row.spec).padStart(10),
    );
  }
}

const tasks = readFileSync(TASKS_FILE, 'utf8');
const start = tasks.indexOf(START_MARK);
const end = tasks.indexOf(END_MARK);
const printOnly = process.argv.includes('--print');

printTable();

if (start < 0 || end < 0 || end < start) {
  console.error(`\n✗ TASKS.md 里找不到覆盖度台账标记块（${START_MARK} … ${END_MARK}）`);
  process.exit(1);
}

const table = renderTable();
const current = tasks.slice(start + START_MARK.length, end).trim();
const next = `${START_MARK}\n\n${table}\n\n${END_MARK}`;

if (current === table) {
  console.log('\n✓ TASKS.md 的覆盖度台账与本表一致');
} else if (printOnly) {
  console.log('\n· TASKS.md 的覆盖度台账过期（--print 模式不写回）');
  process.exit(1);
} else {
  writeFileSync(TASKS_FILE, tasks.slice(0, start) + next + tasks.slice(end + END_MARK.length));
  console.log('\n✗ TASKS.md 的覆盖度台账已按注册表自动重写，请重新暂存后提交');
  process.exit(1);
}
