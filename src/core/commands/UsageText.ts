/**
 * 命令 "用法" 报错的文案（批次 617 / Q14）。
 *
 * 为什么单独一个文件：`/give` `/tp` `/scoreboard` … 一共 **36 条 `用法：` 报错**，
 * 每条后面都跟着一段用法串（`/give <物品> [数量]`）。这些串里**混着中文参数名**，
 * 直接翻整句等于把 36 句各写一遍、而且以后加一个参数要改两处。
 *
 * 这里的做法是只翻**两部分**：
 *   · 前缀 `用法：` → `Usage: `
 *   · `<>` 里的参数名（`物品` → `item`、`战利品表` → `loot table` …）
 * 命令名与 `[方括号可选]`、`|` 分隔全部原样保留 —— 那些是**语法**，不是文案。
 *
 * 于是双语差异被压成"一张 35 行的词表"，而不是 36 句译文。
 */

import { getLanguage, t } from '../i18n/I18n.ts';

/**
 * 参数名 → 英文。键是 `<>` 里的原文。
 *
 * 只放**会出现在用法串里**的名字。翻不出来的（新加的参数名忘了登记）会原样保留——
 * 那在英文界面上表现为"用法里夹着一个中文词"，一眼能看出来，比整句消失好定位。
 */
export const USAGE_FIELD_NAMES: Readonly<Record<string, string>> = {
  伤害: 'damage',
  内容: 'message',
  分数: 'score',
  动作: 'action',
  名称: 'name',
  命令: 'command',
  战利品表: 'loot table',
  效果: 'effect',
  数值: 'value',
  方块: 'block',
  来源: 'source',
  来源目标名: 'source objective',
  点数: 'points',
  物品: 'item',
  生物: 'entity',
  目标: 'targets',
  目标名: 'objective',
  目标选择器: 'target selector',
  等级: 'level',
  类型: 'type',
  结构名: 'structure',
  群系名: 'biome',
  规则: 'rule',
  边长: 'size',
  运算: 'operation',
  运算符: 'operator',
  '进度 id': 'advancement id',
  选择器: 'selector',
  队伍: 'team',
  附魔: 'enchantment',
  音效: 'sound',
  颜色: 'color',
  数量: 'count',
  秒数: 'seconds',
  准则: 'criteria',
  '进度 id | *': 'advancement id | *',
  显示名: 'display name',
  成员: 'members',
  /** `/team modify <队> prefix|suffix <…>`（批次 1359） */
  前缀: 'prefix',
  后缀: 'suffix',
  可选: 'optional',
  /** `/data`（批次 623）：格号 / 路径 / 数值 / 名称 */
  格号: 'slot',
  路径: 'path',
  /** 这几个是**值列表**，不是参数名，但同样夹着中文 */
  'day|noon|night|midnight|数字': 'day|noon|night|midnight|ticks',
  'survival|creative|adventure|spectator': 'survival|creative|adventure|spectator',
};

/** 把用法串里 `<>` 中的中文参数名换成英文（其余字符原样） */
export function translateUsageFields(usage: string, lang: 'zh' | 'en'): string {
  if (lang === 'zh') return usage;
  // `<必填>` 与 `[可选]` 两种括号都要翻：`/give <物品> [数量]` 里两个都是参数名。
  // 圆括号里的**说明文字**（"（伤害要大于 0）"）不翻——那是一整句，不属于参数名，
  // 硬套词表会拼出半句英文；留在后续批次逐句处理。
  const swap = (whole: string, open: string, inner: string, close: string) => {
    const mapped = USAGE_FIELD_NAMES[inner];
    return mapped === undefined ? whole : `${open}${mapped}${close}`;
  };
  return usage
    .replace(/<([^>]*)>/g, (w, inner: string) => swap(w, '<', inner, '>'))
    .replace(/\[([^\]]*)\]/g, (w, inner: string) => swap(w, '[', inner, ']'));
}

/**
 * 组一句 `用法：…` 报错。
 *
 * 调用方写成 `out.error(usageError('/give <物品> [数量]'))`——
 * 前缀与参数名都由这里处理，命令名与括号保持原样。
 */
export function usageError(usage: string): string {
  // ⚠️ 语言**必须**现取，不能写成默认参数 `lang = 'zh'`：那样英文模式下
  // 前缀会变成 "Usage: "（因为走了 `t()`），而括号里的参数名仍是中文 ——
  // 实测就是 `Usage: /effect <give|clear> <效果> [秒数] [等级]` 这种半截话。
  return `${t('command.usagePrefix')}${translateUsageFields(usage, getLanguage())}`;
}
