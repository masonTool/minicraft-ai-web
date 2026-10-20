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

import {
  COMMANDS,
  commandNames,
  mobNames,
  type CommandSpec,
} from './Commands.ts';
import { DEFAULT_GAME_RULES } from '../world/Rules.ts';
import { EFFECT_LABELS } from '../survival/StatusEffects.ts';
import { ENCHANTMENTS } from '../registry/enchantments.ts';

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
  '*': '全部（*）',
};

/** 参数名 → 中文标签（同一条 usage 里出现多次的 x/y/z 另算） */
const ARG_LABELS: Readonly<Record<string, string>> = {
  物品: '物品',
  数量: '数量',
  维度: '维度',
  规则: '规则',
  值: '值',
  效果: '效果',
  秒数: '秒数',
  等级: '等级',
  生物: '生物',
  半径: '半径',
  方块: '方块',
  类型: '类型',
  内容: '内容',
  音效: '音效',
  附魔: '附魔',
  动作: '动作',
  群系名: '群系',
  目标: '目标',
  伤害: '伤害',
  战利品表: '战利品表',
  选择器: '选择器',
  边长: '边长',
  点数: '点数',
};

/** 这些"选项"其实是要玩家自己填的值，不能做成下拉 */
const FREE_VALUE_CHOICES = new Set(['数字', '值', '内容', '命令', '半径', '进度 id', '…', '...']);

const NUMBER_ARGS = new Set(['数量', '秒数', '等级', '伤害', '点数', '边长']);

export function commandHelpEntries(): CommandHelpEntry[] {
  return COMMANDS.map((spec) => ({
    name: spec.name,
    usage: spec.usage,
    description: spec.description,
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
  const mode = variant.parts.find(
    (part): part is { kind: 'field'; field: CommandHelpField } =>
      part.kind === 'field' && part.field.label === '操作' && part.field.options !== undefined,
  );
  const first = mode?.field.options?.[0];
  if (first) words.push(first.label);
  return words.length > 0 ? words.join(' ') : '默认';
}

// ---------------------------------------------------------------- usage 解析

function parseUsage(spec: CommandSpec): CommandHelpVariant[] {
  const segments = splitVariants(spec.usage, spec.name);
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

  const choices = inner.split('|').map((choice) => choice.trim()).filter(Boolean);

  if (choices.length > 1) {
    // `<day|noon|night|midnight|数字>`：固定选项做下拉，自由值做“自定义”输入
    const free = choices.filter((choice) => FREE_VALUE_CHOICES.has(choice));
    if (free.length > 0) {
      const fixed = choices.filter((choice) => !FREE_VALUE_CHOICES.has(choice));
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
  if (name === '生物') {
    return selectField(index, name, optional, mobNames().map((mob) => ({ value: mob, label: mob })));
  }
  if (name === '命令') {
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
  if (name === '维度') {
    return selectField(index, name, optional, [
      { value: 'overworld', label: '主世界' },
      { value: 'nether', label: '下界' },
      { value: 'end', label: '末地' },
    ]);
  }
  if (name === '规则') {
    return selectField(
      index,
      name,
      optional,
      Object.keys(DEFAULT_GAME_RULES).map((rule) => ({ value: rule, label: rule })),
    );
  }
  if (name === '效果') {
    return selectField(
      index,
      name,
      optional,
      Object.entries(EFFECT_LABELS).map(([id, label]) => ({ value: id, label })),
    );
  }
  if (name === '附魔') {
    return selectField(
      index,
      name,
      optional,
      ENCHANTMENTS.map((entry) => ({ value: entry.id, label: entry.name })),
    );
  }

  return {
    key: `f${index}`,
    label: labelForArg(name),
    kind: NUMBER_ARGS.has(name) ? 'number' : 'text',
    optional,
    placeholder: placeholderFor(name),
  };
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
  if (inner.includes('进度')) return '进度';
  if (inner.includes('@s')) return '目标 / 半径';
  return ARG_LABELS[first] ?? first;
}

function placeholderFor(name: string): string {
  if (/^[xyz]\d*$/.test(name) || /^d[xyz]$/.test(name)) return '~ 或数字';
  switch (name) {
    case '物品':
      return '例如 stone / diamond_pickaxe';
    case '方块':
      return '例如 stone / oak_planks';
    case '选择器':
      return '@s / @p / 玩家名';
    case '目标':
      return '@s / @p / 玩家名';
    case '内容':
      return '要发送的文字';
    case '动作':
      return '例如 跳了一下';
    case '音效':
      return '例如 minecraft:block.note_block.harp';
    case '类型':
      return '例如 flame / smoke';
    case '群系名':
      return '例如 plains / desert';
    case '战利品表':
      return '例如 minecraft:chests/simple_dungeon';
    case '规则':
      return '规则名';
    case '命令':
      return '例如 say hi / give @s stone';
    default:
      return '';
  }
}
