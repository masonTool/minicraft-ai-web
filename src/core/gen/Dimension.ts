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
} as const;

export type DimensionId = (typeof Dimension)[keyof typeof Dimension];

/** 中文显示名（HUD 用） */
export const DIMENSION_LABELS: Readonly<Record<DimensionId, string>> = {
  overworld: '主世界',
  nether: '下界',
};

export function isDimension(value: unknown): value is DimensionId {
  return value === Dimension.OVERWORLD || value === Dimension.NETHER;
}
