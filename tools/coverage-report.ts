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
import { STRUCTURE_KINDS } from '../src/core/gen/Structures.ts';
import { NETHER_STRUCTURE_KINDS } from '../src/core/gen/Bastion.ts';
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
  biomes: 72,
  structures: 30,
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
    now: BIOMES.length,
    basis: 'TASKS §0「约 72 个」',
    gap: '主世界变体、繁茂洞穴/溶洞',
  },
  {
    label: '结构',
    spec: SPEC.structures,
    // 下界的结构（堡垒遗迹）走自己的放置系统，不在 `STRUCTURE_KINDS` 里——
    // 台账要连它一起数，否则"做了 8 种"这件事在这里永远是 7
    now: STRUCTURE_KINDS.length + NETHER_STRUCTURE_KINDS.length,
    basis: '原版 1.18 主世界+下界+末地可探索结构约 30 种',
    gap: '神殿/哨塔/海底遗迹/化石/冰屋/下界要塞',
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
    gap: '/execute、选择器（@a/@e）、记分板、命令方块',
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
    gap: '音符盒/目标方块/动力·探测·激活铁轨/红石矿石/测重压力板/陷阱箱',
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
    gap: '依赖未实现内容的那些（村民/蜜蜂/信标/鞘翅/要塞/刷怪笼…）',
  },
  {
    label: '界面语言',
    spec: SPEC.locales,
    now: 1,
    basis: '原版 1.18 内置语言数（本项目只做中文启动，但物品名有中英）',
    gap: 'i18n 未做（M8）',
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
