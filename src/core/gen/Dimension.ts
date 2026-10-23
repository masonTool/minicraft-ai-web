// 多语言 P2-5：标签表走 `label.*`
import { t } from '../i18n/I18n.ts';

/**
 * 维度
 *
 * 同一份世界种子在不同维度下生成完全不同的地形：主世界走噪声路由器，
 * 下界走"岩浆海 + 洞窟 + 菌岩/灵魂沙/玄武岩群系"。两者的方块数据都放在同一套
 * 区块存储里（16×384×16），所以维度之间只需要换一个生成器。
 *
 * 维度用字符串标识（而不是数字）：Worker 消息、调试信息、HUD 都能直接读懂，
 * 序列化到存档时也不会因为加维度而错位。
 */

export const Dimension = {
  OVERWORLD: 'overworld',
  NETHER: 'nether',
  END: 'end',
} as const;

export type DimensionId = (typeof Dimension)[keyof typeof Dimension];

/**
 * 维度的显示名（多语言 P2-5）：HUD 与调试信息用。
 *
 * ⚠️ 命令域另有一套 `cmd.label.dimension.*` —— 那套是**嵌在句子里**用的
 * （英文要 `the Nether` 这种带冠词的形式），两者语义不同，不要合并。
 */
export function dimensionLabel(id: DimensionId): string {
  const key = `label.dimension.${id}`;
  // ⚠️ 必须写成模板字面量直接进 `t()`：`t(key)` 会让 `audit:i18n` 收不到前缀，
  // 整族键都会被报成孤儿（这个坑在 P2-2 已经踩过一次）
  const text = t(`label.dimension.${id}`);
  return text === key ? id : text;
}

/** 维度循环顺序（N 键依次切过去） */
export const DIMENSION_CYCLE: readonly DimensionId[] = [Dimension.OVERWORLD, Dimension.NETHER, Dimension.END];

/** 该维度有没有天光（下界与末地都没有：整片空间只有方块光） */
export function hasSkyLight(dimension: DimensionId): boolean {
  return dimension === Dimension.OVERWORLD;
}

export function isDimension(value: unknown): value is DimensionId {
  return value === Dimension.OVERWORLD || value === Dimension.NETHER || value === Dimension.END;
}
