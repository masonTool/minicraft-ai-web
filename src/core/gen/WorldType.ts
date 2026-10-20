/**
 * 世界类型（新建世界时选）
 *
 * 目前五种：
 *  - `default`：默认的 1.18 密度噪声地形（主世界）
 *  - `flat`：超平坦——一层基岩 + 泥土 + 草方块，其余全是空气（原版"经典"预设的高度）
 *  - `amplified`：放大化——地形的起伏幅度乘一个系数，山更高、峡谷更深
 *
 * ⚠️ 只保留**原版存在的**类型（批次 532）：`caves` / `floating_islands` 是本项目
 * 自己加的非原版预设，已删除；旧存档里的这两个值会在读档时回落成 `default`。
 * 原版的“大型群系 / 单一群系”目前还没做，排在后续批次。
 *
 * 放在独立模块里：生成器、Worker 协议、存档与世界列表都要用，谁都不该反过来依赖谁。
 */

export type WorldType = 'default' | 'flat' | 'large_biomes' | 'amplified' | 'single_biome';

export const WORLD_TYPES: readonly WorldType[] = ['default', 'flat', 'large_biomes', 'amplified', 'single_biome'];

export const WORLD_TYPE_LABELS: Record<WorldType, string> = {
  default: '默认（山地与海洋）',
  flat: '超平坦（一层草地）',
  large_biomes: '大型群系（群系面积 ×4）',
  amplified: '放大化（更高的山）',
  single_biome: '单一群系（全世界同一种群系）',
};

/**
 * 每种类型"到底有什么"（批次 181）。
 *
 * 用户问过"三种世界是不是都能找到所有材料"——答案是**只有默认/放大化是完整世界**：
 * 超平坦在 `TerrainGenerator` 里直接返回三层方块，地物与结构阶段根本不会跑。
 * 这段文案就是让玩家在创建之前就知道，而不是进游戏才发现没有树和矿。
 */
export const WORLD_TYPE_HINTS: Record<WorldType, string> = {
  default: '完整世界：群系、树木、矿石、村庄、要塞… 生存模式推荐',
  amplified: '与默认相同的全部内容，只是陆地起伏更大、山更高',
  flat: '只有三层平地：没有树木、村庄与矿石（适合建筑/创造）',
  large_biomes: '与默认相同的完整世界，只是群系面积大约 ×4（走很久才会换群系）',
  single_biome: '与默认相同的地形，但整个世界只有一种群系（在下面选是哪一种）',
};

/** 超平坦世界的分层（从 y = -64 起，与原版"经典"预设一致） */
export const FLAT_LAYERS = {
  /** 最底下这一层是基岩（防掉出世界） */
  bedrockY: -64,
  /** 泥土层：-63 ~ -62 */
  dirtFrom: -63,
  dirtTo: -62,
  /** 草方块层：-61，也就是超平坦世界的地表 */
  grassY: -61,
} as const;

/** 超平坦世界的地表高度（生物落点、村庄与地物的参照） */
export const FLAT_SURFACE_Y = FLAT_LAYERS.grassY;

/**
 * 各世界类型的"地表基准高度"（批次 238）。
 *
 * 出生点搜索、临时落点、读档落地校正都以它为参照。以前这几处把**海平面 64 写死**，
 * 于是超平坦（地表 y=-61）一个候选都找不到：加载遮罩一直不撤（看起来是"卡死"），
 * 读档后玩家停在 y=80 悬空、落地校正又只往下扫 48 格（够不到 -61）→ 141 格摔死。
 *
 * `default` / `amplified` 用 64 而不是 63：出生点要求**高于海平面**（海边/水下不算），
 * 这是原来的判据，保持不变。
 */
export const WORLD_SURFACE_Y: Record<WorldType, number> = {
  default: 64,
  amplified: 64,
  flat: FLAT_SURFACE_Y,
  large_biomes: 64,
  single_biome: 64,
};

/** 放大化的起伏倍率：山体高度与峡谷深度都按它放大 */
export const AMPLIFIED_RELIEF_SCALE = 2.2;

export function isWorldType(value: unknown): value is WorldType {
  return typeof value === 'string' && (WORLD_TYPES as readonly string[]).includes(value);
}

/** 新世界的随机种子：控制在 32 位正整数内，方便在界面上显示与手输 */
export function randomSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff);
}
