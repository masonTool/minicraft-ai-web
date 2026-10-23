/**
 * 命令帮助（批次 533）：把 `/help` 从"往聊天栏刷几十行"改成"可交互的生成器"。
 *
 * 这里只做**纯逻辑**：把 `COMMANDS` 里的 usage 拆成
 *   - 变体（`/xp add … | /xp set …`）
 *   - 固定关键字（`set` / `give` / `run`）
 *   - 参数（文本 / 数字 / 下拉）
 * 并负责把表单值拼回一条完整命令。DOM 在 `ui/CommandHelpScreen.ts`。
 *
 * usage 的写法很规整，所以不需要给 37 条命令各手写一份表单；
 * 只有"下拉里混了一个自由值"（`<day|noon|night|midnight|数字>`）这种才退化成文本。
 */

import { COMMANDS, commandNames, type CommandSpec } from './Commands.ts';
// 多语言 P1-1b：用法与说明要**按当前语言**取，不能直接抄 spec 里的键
import { commandDescription, commandUsage } from './messages.ts';
// 字段身份表（多语言 P1-3a）：中英两种写法 → 语言无关的 slug，逻辑只认 slug
import { ARG_LABELS, FREE_SLUGS, NUMBER_SLUGS, slugOf } from './commandFields.data.ts';
import { DEFAULT_GAME_RULES, GAME_RULE_LABELS } from '../world/Rules.ts';
import { EFFECT_LABELS } from '../survival/StatusEffects.ts';
import { ENCHANTMENTS } from '../registry/enchantments.ts';
import { MOB_TYPES } from '../entity/mobs.ts';
import { LOOT_TABLES } from '../registry/loot.ts';
import { ADVANCEMENTS } from '../progress/advancements.ts';
import { BLOCKS } from '../registry/blocks.ts';
import { CREATIVE_ITEMS, itemName } from '../registry/items.ts';
import { blockLabel, itemLabel } from '../registry/itemNames.ts';
import { BIOME_LABELS, BIOME_TABLE } from '../gen/Biome.ts';
// `/locate structure` 的结构名下拉（批次 624 / Q22）：零依赖数据表，不拖生成器
import { STRUCTURE_NAMES } from './structureNames.data.ts';

export interface CommandHelpOption {
  readonly value: string;
  readonly label: string;
}

export interface CommandHelpField {
  readonly key: string;
  readonly label: string;
  readonly kind: 'text' | 'number' | 'select' | 'combo';
  readonly optional: boolean;
  readonly placeholder?: string;
  readonly options?: readonly CommandHelpOption[];
  /** combo 的"自定义"输入框占位（如“数字”“进度 id”） */
  readonly customPlaceholder?: string;
  /** 文本输入框要自动联想：物品 / 方块 / 群系 */
  readonly suggest?: 'item' | 'block' | 'biome';
}

export type CommandHelpPart =
  | { readonly kind: 'literal'; readonly value: string }
  | { readonly kind: 'field'; readonly field: CommandHelpField };

export interface CommandHelpVariant {
  readonly label: string;
  readonly parts: readonly CommandHelpPart[];
}

export interface CommandHelpEntry {
  readonly name: string;
  readonly usage: string;
  readonly description: string;
  /** 需要在创造模式下使用（列表与详情里给一个提示） */
  readonly creativeOnly: boolean;
  readonly variants: readonly CommandHelpVariant[];
}

/** 选项值的中文标签（命令本身仍然拼英文值） */
const VALUE_LABELS: Readonly<Record<string, string>> = {
  peaceful: '和平',
  easy: '简单',
  normal: '普通',
  hard: '困难',
  clear: '清除',
  rain: '下雨',
  thunder: '雷暴',
  survival: '生存',
  creative: '创造',
  spectator: '旁观',
  day: '白天',
  noon: '正午',
  night: '夜晚',
  midnight: '午夜',
  masked: '遮罩',
  replace: '替换',
  give: '给予',
  set: '设置',
  add: '添加',
  remove: '移除',
  list: '列表',
  join: '加入',
  leave: '离开',
  modify: '修改',
  merge: '写入',
  get: '查询',
  query: '查询',
  center: '设置中心',
  grant: '授予',
  revoke: '收回',
  entity: '实体',
  block: '方块',
  objectives: '记分项',
  players: '玩家',
  as: '作为',
  at: '在',
  positioned: '定位到',
  if: '如果',
  unless: '除非',
  run: '执行',
  overworld: '主世界',
  nether: '下界',
  end: '末地',
  biome: '群系',
  '*': '全部（*）',
};


export function commandHelpEntries(): CommandHelpEntry[] {
  return COMMANDS
    // `/help` 本身不进列表：它在聊天输入框下面有单独的快捷入口。
    .filter((spec) => spec.name !== 'help')
    // 批次 534（用户）：指令按字母排序，长列表里才找得到。
    .sort((a, b) => a.name.localeCompare(b.name, 'en'))
    .map((spec) => ({
      name: spec.name,
      // ⚠️ 多语言 P1：这里原来直接抄 `spec.usage` / `spec.description`（当时是中文串），
      // 于是**英文模式下帮助面板的用法与说明是中文**——静态审计抓不到（不是硬编码字面量，
      // 是数据流没接线）。现在必须经 `commandUsage()` / `commandDescription()` 走查表。
      usage: commandUsage(spec),
      description: commandDescription(spec),
      creativeOnly: spec.creativeOnly === true,
      variants: parseUsage(spec),
    }));
}

/** 拼出最终命令；必填项没填返回 null（界面据此禁用"填入"按钮） */
export function buildCommand(
  entry: CommandHelpEntry,
  variantIndex: number,
  values: Readonly<Record<string, string>>,
): string | null {
  const variant = entry.variants[variantIndex] ?? entry.variants[0];
  if (!variant) return null;
  const out: string[] = [`/${entry.name}`];
  for (const part of variant.parts) {
    if (part.kind === 'literal') {
      out.push(part.value);
      continue;
    }
    let value = (values[part.field.key] ?? '').trim();
    let allowDefault = true;
    // combo：优先用“自定义”输入框，其次用下拉选项。
    // 选了“自定义…”但还没输入时不能回退到第一项（否则预览会显示一条
    // 玩家没选的命令）。
    if (part.field.kind === 'combo') {
      const custom = (values[`${part.field.key}__custom`] ?? '').trim();
      if (custom.length > 0) {
        value = custom;
        allowDefault = false;
      } else if (value === '__custom__') {
        value = '';
        allowDefault = false;
      }
    }
    // 必填下拉/下拉组合没传值时用第一项（与界面 `resetValues` 同一口径），
    // 这样纯逻辑调用也能生成一条合法命令。
    if (
      allowDefault &&
      value.length === 0 &&
      (part.field.kind === 'select' || part.field.kind === 'combo') &&
      !part.field.optional
    ) {
      value = part.field.options?.[0]?.value ?? '';
    }
    if (value.length === 0) {
      if (part.field.optional) continue;
      return null;
    }
    out.push(value);
  }
  return out.join(' ');
}

/** 变体名（给"操作"下拉用）：把固定词按中文标签翻译 */
export function variantLabel(variant: CommandHelpVariant): string {
  const words = variant.parts
    .filter((part): part is { kind: 'literal'; value: string } => part.kind === 'literal')
    .map((part) => VALUE_LABELS[part.value] ?? part.value);
  // “操作”下拉（`/team add|remove…`、`/scoreboard objectives add|…`）的默认值
  // 也要进变体名，否则两个变体都会显示成“记分项”/“玩家”，分不清。
  // 判据是"有 options 的字段"（= 那个 `a|b|c` 的"操作"下拉），不再比中文字面标签
  const mode = variant.parts.find(
    (part): part is { kind: 'field'; field: CommandHelpField } =>
      part.kind === 'field' && part.field.options !== undefined,
  );
  const first = mode?.field.options?.[0];
  if (first) words.push(first.label);
  return words.length > 0 ? words.join(' ') : '默认';
}

// ---------------------------------------------------------------- usage 解析

function parseUsage(spec: CommandSpec): CommandHelpVariant[] {
  // 解析**已本地化**的用法串：面板里显示的参数名与拼出来的命令必须同一种语言。
  // ⚠️ 代价：翻译必须保留 `<>` `[]` `|` 这些语法符号，否则这里拆不出变体（P4 验收项）。
  const segments = splitVariants(commandUsage(spec), spec.name);
  const variants = segments
    .map((segment, index) => parseVariant(segment, index))
    .filter((variant): variant is CommandHelpVariant => variant !== null);
  return variants.length > 0 ? variants : [{ label: '默认', parts: [] }];
}

/** 按顶层 ` | ` / ` / ` 拆变体；括号里的竖线不算 */
function splitVariants(usage: string, name: string): string[] {
  const segments: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < usage.length; i++) {
    const ch = usage[i];
    if (ch === '<' || ch === '[') depth++;
    else if (ch === '>' || ch === ']') depth = Math.max(0, depth - 1);
    else if (depth === 0 && (usage.startsWith(' | ', i) || usage.startsWith(' / ', i))) {
      segments.push(usage.slice(start, i));
      i += 2;
      start = i + 1;
    }
  }
  segments.push(usage.slice(start));

  return segments
    .map((segment) => stripCommand(segment, name))
    .filter((segment) => segment.length > 0 || segments.length === 1);
}

function stripCommand(segment: string, name: string): string {
  let body = segment.trim();
  if (body.startsWith('/')) {
    body = body.slice(1).trim();
    if (body === name) return '';
    if (body.startsWith(`${name} `)) body = body.slice(name.length).trim();
  }
  return body;
}

function parseVariant(segment: string, index: number): CommandHelpVariant | null {
  const tokens = segment.match(/<[^>]*>|\[[^\]]*\]|\S+/g) ?? [];
  const parts: CommandHelpPart[] = [];
  let fieldIndex = 0;

  for (const token of tokens) {
    if (token === '…' || token === '...') {
      // 不是终点：`/execute … run <命令>` 里的 `run <命令>` 还在后面，
      // 所以这里只插一个自由参数，继续解析剩余 token。
      parts.push({
        kind: 'field',
        field: {
          key: `f${fieldIndex++}`,
          label: '其余参数',
          kind: 'text',
          optional: true,
          placeholder: '按用法补充',
        },
      });
      continue;
    }

    if ((token.startsWith('<') && token.endsWith('>')) || (token.startsWith('[') && token.endsWith(']'))) {
      const optional = token.startsWith('[');
      const inner = token.slice(1, -1).trim();
      parts.push({ kind: 'field', field: fieldFromArg(inner, optional, fieldIndex++) });
      continue;
    }

    // 不带括号的 `a|b|c`：操作模式，做成下拉并把选中的词插回命令
    if (token.includes('|')) {
      const choices = token.split('|').map((choice) => choice.trim()).filter(Boolean);
      if (choices.length > 1) {
        parts.push({
          kind: 'field',
          field: {
            key: `f${fieldIndex++}`,
            label: '操作',
            kind: 'select',
            optional: false,
            options: choices.map((choice) => optionOf(choice)),
          },
        });
        continue;
      }
    }

    parts.push({ kind: 'literal', value: token });
  }

  if (parts.length === 0) return { label: '默认', parts: [] };
  const variant: CommandHelpVariant = { label: '', parts };
  return { ...variant, label: variantLabel({ label: '', parts }) || `操作 ${index + 1}` };
}

function fieldFromArg(inner: string, optional: boolean, index: number): CommandHelpField {
  // `[x y z]` 这种"一整组坐标"不要拆成三个独立输入：
  // 只填一个会生成半条命令，做成一个"坐标"文本框最稳。
  if (/^x\s+y\s+z$/i.test(inner)) {
    return {
      key: `f${index}`,
      label: '坐标',
      kind: 'text',
      optional,
      placeholder: '~ ~ ~',
    };
  }

  // ⚠️ 多语言 P1-3a：下面所有分支都按 **slug** 判，不再比中文字段名——
  // 否则英文模式下 `inner` 是 `entity`/`item`，全部落空（数字框退化成文本框）。
  const slug = slugOf(inner);
  const choices = inner.split('|').map((choice) => choice.trim()).filter(Boolean);

  // 进度 id：100 条进度都有中文标题，直接给下拉（`*` = 全部）
  // 注意判据是"**任一** 选项是进度"：`<进度 id | *>` 的第一个词才是 advancement，
  // 而 `slug` 取的是整个 `<…>` 的文本。原实现用 `inner.includes('进度')`，等价于此。
  if (choices.some((choice) => slugOf(choice) === 'advancement')) {
    return selectField(index, '进度', optional, [
      { value: '*', label: '全部进度（*）' },
      ...ADVANCEMENTS.map((entry) => ({ value: entry.id, label: `${entry.title}（${entry.id}）` })),
    ]);
  }

  if (choices.length > 1) {
    // `<day|noon|night|midnight|数字>`：固定选项做下拉，自由值做“自定义”输入
    const free = choices.filter((choice) => FREE_SLUGS.has(slugOf(choice)));
    if (free.length > 0) {
      const fixed = choices.filter((choice) => !FREE_SLUGS.has(slugOf(choice)));
      if (fixed.length > 0) {
        return {
          key: `f${index}`,
          label: labelForArg(inner),
          kind: 'combo',
          optional,
          options: fixed.map((choice) => optionOf(choice, inner)),
          customPlaceholder: free[0] === '数字' ? '输入数字' : free[0],
        };
      }
      return {
        key: `f${index}`,
        label: labelForArg(inner),
        kind: 'text',
        optional,
        placeholder: choices.join(' / '),
      };
    }
    return {
      key: `f${index}`,
      label: labelForArg(inner),
      kind: 'select',
      optional,
      options: choices.map((choice) => optionOf(choice, inner)),
    };
  }

  const name = inner.trim();
  // 有现成数据源的参数直接给下拉，避免玩家背英文 id
  if (slug === 'entity') {
    // 玩家不需要背英文 id：标签用中文名，命令里仍拼 id。
    return selectField(
      index,
      name,
      optional,
      MOB_TYPES.map((mob) => ({ value: mob.id, label: `${mob.name}（${mob.id}）` })),
    );
  }
  if (slug === 'command') {
    // `/help [命令]` 是"从现有命令里挑一条"；`/execute … run <命令>` 则是
    // 要玩家写一条任意命令，不能把后者也做成命令名下拉。
    if (optional) {
      return selectField(
        index,
        name,
        optional,
        commandNames().map((command) => ({ value: command, label: `/${command}` })),
      );
    }
    return {
      key: `f${index}`,
      label: '命令',
      kind: 'text',
      optional,
      placeholder: '例如 say hi / give @s stone',
    };
  }
  if (slug === 'dimension') {
    return selectField(index, name, optional, [
      { value: 'overworld', label: '主世界' },
      { value: 'nether', label: '下界' },
      { value: 'end', label: '末地' },
    ]);
  }
  if (slug === 'rule') {
    return selectField(
      index,
      name,
      optional,
      (Object.keys(DEFAULT_GAME_RULES) as Array<keyof typeof DEFAULT_GAME_RULES>).map((rule) => ({
        value: rule,
        label: `${GAME_RULE_LABELS[rule]}（${rule}）`,
      })),
    );
  }
  if (slug === 'effect') {
    return selectField(
      index,
      name,
      optional,
      Object.entries(EFFECT_LABELS).map(([id, label]) => ({ value: id, label })),
    );
  }
  if (slug === 'enchantment') {
    return selectField(
      index,
      name,
      optional,
      ENCHANTMENTS.map((entry) => ({ value: entry.id, label: entry.name })),
    );
  }
  if (slug === 'type') {
    return selectField(index, name, optional, [
      { value: 'heart', label: '爱心（heart）' },
      { value: 'crit', label: '暴击（crit）' },
      { value: 'flame', label: '火焰（flame）' },
      { value: 'portal', label: '传送门（portal）' },
      { value: 'explosion', label: '爆炸（explosion）' },
    ]);
  }
  if (slug === 'loot') {
    return selectField(
      index,
      name,
      optional,
      LOOT_TABLES.map((table) => ({ value: table.key, label: `${table.name}（${table.key}）` })),
    );
  }
  if (slug === 'structure') {
    // 23 种结构都有中文名，直接给下拉（批次 624 / Q22）。
    // 标记"还不能定位"的两种也列出来但标清楚——它们是会生成的结构，
    // 藏起来反而让玩家以为"我们没做末地船"。
    return selectField(
      index,
      name,
      optional,
      STRUCTURE_NAMES.map((entry) => ({
        value: entry.key,
        label: entry.locatable
          ? `${entry.label}（${entry.key}）`
          : `${entry.label}（${entry.key}，暂不能定位）`,
      })),
    );
  }
  if (slug === 'value') {
    return {
      key: `f${index}`,
      label: '值',
      kind: 'combo',
      optional,
      options: [
        { value: 'true', label: '开启（true）' },
        { value: 'false', label: '关闭（false）' },
      ],
      customPlaceholder: '数字（如 3）',
    };
  }

  return {
    key: `f${index}`,
    label: labelForArg(name),
    kind: NUMBER_SLUGS.has(slug) ? 'number' : 'text',
    optional,
    placeholder: placeholderFor(name),
    suggest:
      slug === 'item' ? 'item' : slug === 'block' ? 'block' : slug === 'biome' ? 'biome' : undefined,
  };
}

export interface CommandSuggestion {
  /** 填进输入框的值（英文 id，命令直接可用） */
  readonly value: string;
  /** 给玩家看的「中文名（英文 id）」 */
  readonly label: string;
}

const ITEM_SUGGESTIONS: readonly (CommandSuggestion & { readonly search: string })[] = CREATIVE_ITEMS.map(
  (id) => {
    const full = itemName(id);
    const short = full.replace(/^minecraft:/, '');
    return {
      value: short,
      label: `${itemLabel(id)}（${short}）`,
      search: `${itemLabel(id)} ${short} ${full} ${id}`.toLowerCase(),
    };
  },
);

const BLOCK_SUGGESTIONS: readonly (CommandSuggestion & { readonly search: string })[] = BLOCKS.filter(
  (block) => block.id !== 0,
).map((block) => {
  const full = block.name;
  const short = full.replace(/^minecraft:/, '');
  return {
    value: short,
    label: `${blockLabel(block.id)}（${short}）`,
    search: `${blockLabel(block.id)} ${short} ${full} ${block.id}`.toLowerCase(),
  };
});

const BIOME_SUGGESTIONS: readonly (CommandSuggestion & { readonly search: string })[] = BIOME_TABLE.map(
  (biome) => ({
    value: biome.name,
    label: `${BIOME_LABELS[biome.name] ?? biome.name}（${biome.name}）`,
    search: `${BIOME_LABELS[biome.name] ?? ''} ${biome.name}`.toLowerCase(),
  }),
);

/**
 * 物品/方块输入框的自动联想（批次 534）。
 *
 * 按中文名、英文短 id、完整 id 或数字 id 匹配；空输入不返回任何项
 * （避免一打开就是几百条）。
 */
export function suggestCommandValues(
  kind: 'item' | 'block' | 'biome',
  query: string,
  limit = 10,
): CommandSuggestion[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return [];
  const source =
    kind === 'item' ? ITEM_SUGGESTIONS : kind === 'block' ? BLOCK_SUGGESTIONS : BIOME_SUGGESTIONS;
  return source
    .filter((entry) => entry.search.includes(q))
    .slice(0, limit)
    .map(({ value, label }) => ({ value, label }));
}

function selectField(
  index: number,
  arg: string,
  optional: boolean,
  options: readonly CommandHelpOption[],
): CommandHelpField {
  return { key: `f${index}`, label: labelForArg(arg), kind: 'select', optional, options };
}

function optionOf(value: string, context = ''): CommandHelpOption {
  // `clear` 在天气里是“晴天”，在 effect 里是“清除”；不能共用一条标签
  if (value === 'clear' && context.includes('rain')) return { value, label: '晴天' };
  if (value === 'clear' && context.includes('give|clear')) return { value, label: '清除' };
  // execute 的条件词保留英文原词，方便玩家把界面和命令对上
  if (context.includes('as|at|') && VALUE_LABELS[value]) {
    return { value, label: `${VALUE_LABELS[value]}（${value}）` };
  }
  return { value, label: VALUE_LABELS[value] ?? value };
}

function labelForArg(inner: string): string {
  const first = inner.split('|')[0]!.trim();
  if (/^[xyz]\d*$/.test(first) || /^d[xyz]$/.test(first)) return first.toUpperCase();
  if (inner.includes('day') && inner.includes('night')) return '时间';
  if (inner.includes('peaceful')) return '难度';
  if (inner.includes('clear') && inner.includes('rain')) return '天气';
  if (inner.includes('survival')) return '模式';
  if (inner.includes('masked')) return '模式';
  if (inner.includes('as|at|')) return '条件';
  if (inner.includes('give|clear')) return '操作';
  if (slugOf(first) === 'advancement') return '进度';
  if (inner.includes('@s')) return '目标 / 半径';
  return ARG_LABELS[slugOf(first)] ?? first;
}

function placeholderFor(name: string): string {
  if (/^[xyz]\d*$/.test(name) || /^d[xyz]$/.test(name)) return '~ 或数字';
  switch (name) {
    case '物品':
      return '中文名或英文 id，如 石头 / stone';
    case '方块':
      return '中文名或英文 id，如 石头 / stone';
    case '选择器':
      return '@s（自己）/ @p（最近玩家）/ 玩家名';
    case '目标':
      return '@s（自己）/ @p（最近玩家）/ 玩家名';
    case '内容':
      return '要发送的文字';
    case '动作':
      return '例如 跳了一下';
    case '音效':
      return '音效 id，如 block.note_block.harp（音符盒）';
    case '群系名':
      return '英文群系名，如 plains（平原）/ desert（沙漠）';
    case '结构名':
      return '结构名，如 village（村庄）/ bastion_remnant（堡垒遗迹）';
    case '路径':
      return '路径可留空（列全部）；实体的 Health / CustomName，方块的 Slots[i]';
    case '名称':
      return '要写进去的名字';
    case '数值':
    case '规则':
      return '规则名';
    case '命令':
      return '例如 say hi / give @s stone';
    default:
      return '';
  }
}
