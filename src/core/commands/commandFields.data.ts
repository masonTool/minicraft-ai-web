/**
 * 命令帮助面板的**字段身份表**（多语言 P1-3a）。
 *
 * 为什么需要这张表：帮助面板要"看懂"用法串里的 `<…>` 是什么，才能决定这一格做成
 * 数字框 / 下拉 / 文本联想。原来这套判断全按**中文字段名**写（`name === '生物'`），
 * 于是 P1-1b 把解析对象换成**本地化用法串**之后，英文模式下 `name` 变成 `entity`，
 * 所有分支全部落空 —— 数字框退化成文本框、进度下拉直接消失。
 *
 * 做法：给每个字段一个**语言无关的 slug**，中英两种写法都映射到它，逻辑只认 slug。
 * 这张表因此必须同时含中文与英文两种写法 —— 它是"标识词典"，不是界面文案
 * （显示文案在 `locales/<lang>/cmd.ts` 的 `cmd.help.*`）。
 *
 * ⚠️ 维护约定：新增命令字段时，
 *   · 在中英 `cmd.<name>.usage` 里都用**同一个语义**的词（如 `<item>` / `<物品>`）；
 *   · 在这里给两种写法各加一行映射到同一个 slug；
 *   · 数字类加进 `NUMBER_SLUGS`，可自由填写的选项加进 `FREE_SLUGS`。
 * 漏加不会报错，只会让那一格退化成纯文本框（`test:commands` 里有一条"中英字段结构一致"的断言兜着）。
 */

/** 字段/选项的两种写法 → slug（含多选字段里的每个词） */
const FIELD_SLUGS: Readonly<Record<string, string>> = {
  // ---- 通用参数
  物品: 'item',
  item: 'item',
  数量: 'count',
  count: 'count',
  维度: 'dimension',
  dimension: 'dimension',
  规则: 'rule',
  rule: 'rule',
  值: 'value',
  value: 'value',
  效果: 'effect',
  effect: 'effect',
  秒数: 'seconds',
  seconds: 'seconds',
  等级: 'level',
  level: 'level',
  生物: 'entity',
  entity: 'entity',
  半径: 'radius',
  radius: 'radius',
  方块: 'block',
  block: 'block',
  类型: 'type',
  type: 'type',
  内容: 'message',
  message: 'message',
  音效: 'sound',
  sound: 'sound',
  动作: 'action',
  action: 'action',
  附魔: 'enchantment',
  enchantment: 'enchantment',
  点数: 'points',
  points: 'points',
  边长: 'size',
  size: 'size',
  群系名: 'biome',
  biome: 'biome',
  结构名: 'structure',
  structure: 'structure',
  目标: 'targets',
  targets: 'targets',
  伤害: 'damage',
  damage: 'damage',
  战利品表: 'loot',
  'loot table': 'loot',
  路径: 'path',
  path: 'path',
  选择器: 'selector',
  selector: 'selector',
  格号: 'slot',
  slot: 'slot',
  数值: 'number',
  number: 'number',
  名称: 'name',
  name: 'name',
  命令: 'command',
  command: 'command',
  // ---- 坐标（单轴 / 一组）
  x: 'x',
  y: 'y',
  z: 'z',
  x1: 'x1',
  y1: 'y1',
  z1: 'z1',
  x2: 'x2',
  y2: 'y2',
  z2: 'z2',
  dx: 'dx',
  dy: 'dy',
  dz: 'dz',
  'x y z': 'coords',
  // ---- 可自由填写/进度的选项词（`<day|noon|night|midnight|数字>` 里的最后一个）
  数字: 'ticks',
  ticks: 'ticks',
  '进度 id': 'advancement',
  'advancement id': 'advancement',
  进度: 'advancement',
  advancement: 'advancement',
};

/**
 * 字段文本 → slug。
 *
 * 查不到就**原样返回**：新字段没登记时，面板仍能显示（只是那一格退化成文本框），
 * 不会像"返回空 slug"那样把标签也一起吞掉。
 */
export function slugOf(text: string): string {
  const key = text.trim();
  return FIELD_SLUGS[key] ?? key;
}

/** 字段显示标签（slug → 中文短标签）。多语言 P1-3b 会换成 `cmd.help.arg.*` 查表 */
export const ARG_LABELS: Readonly<Record<string, string>> = {
  item: '物品',
  count: '数量',
  dimension: '维度',
  rule: '规则',
  value: '值',
  effect: '效果',
  seconds: '秒数',
  level: '等级',
  entity: '生物',
  radius: '半径',
  block: '方块',
  type: '类型',
  message: '内容',
  sound: '音效',
  enchantment: '附魔',
  action: '动作',
  biome: '群系',
  structure: '结构',
  targets: '目标',
  damage: '伤害',
  loot: '战利品表',
  selector: '选择器',
  size: '边长',
  points: '点数',
  slot: '格号',
  path: '路径',
  number: '数值',
  name: '名称',
};

/** 这些字段做成数字输入框（按 slug 判，与语言无关） */
export const NUMBER_SLUGS: ReadonlySet<string> = new Set([
  'count',
  'seconds',
  'level',
  'damage',
  'points',
  'size',
  'slot',
  'number',
]);

/** 这些**选项词**代表"要玩家自己填"，不能做成下拉（按 slug 判） */
export const FREE_SLUGS: ReadonlySet<string> = new Set(['ticks', 'value', 'message', 'command', 'radius']);
