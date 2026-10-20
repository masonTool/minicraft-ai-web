/**
 * 镂空贴图的**覆盖率补偿**（批次 425）
 *
 * ## 为什么需要它
 *
 * 草、花、树苗、藤蔓这些方块是"十字薄面 + alphaTest"，背景靠 `discard` 裁掉。
 * 贴图的 alpha 只有 0 / 1 两个值，看着没问题；问题出在 **mipmap**：缩小方向上
 * 每条 mip 的 alpha 是**覆盖率平均**，一片 43% 覆盖率的草到了 mip2（4×4 平均）
 * alpha 就掉到 0.2~0.4，被 0.5 的阈值整块 `discard` —— 剪影随距离被一点点啃掉，
 * 走动时 mip 层级来回跨、洞的位置跟着跳，肉眼就是"颗粒感 + 闪烁"。
 *
 * 各向异性过滤能救一部分（侧看时不再由长轴决定 LOD），但救不了"正视也有 2~3 级
 * mip 的远景"。所以再加一层：**按 LOD 把 alpha 抬回去**，让"这一块曾经有叶子"
 * 这件事在缩略之后仍然过得了阈值。
 *
 * ## 为什么按乘法抬、而不是改阈值
 *
 * 乘法对**完全透明**（alpha = 0）是恒等的 —— 空白区域永远是空白，不会凭空长出一层
 * 半透明的绿雾；只有"曾经有像素"的地方才会被抬起来。实心方块 alpha = 255 也恒等，
 * 所以不需要为它单开一层材质。
 *
 * ## 幅度
 *
 * 每级 LOD 抬 40%（`ALPHA_LIFT_PER_LOD`），最多抬到 LOD 3（×2.2）。取这个数是因为
 * 实测覆盖率约 43%：mip2 的边缘块平均下来约 0.2~0.3，×2 正好跨过 0.5，而中心的
 * 0.43 会到 1.0（不再"半透明"）。再大就会让远景的草"发胖成一团绿"。
 *
 * 着色器里用的是**同一组常量**（`VoxelMaterial` 把它们插进 GLSL），
 * 这个文件里的函数只给离线断言用 —— 两边不会漂。
 */

/** 每级 LOD 的 alpha 增益 */
export const ALPHA_LIFT_PER_LOD = 0.4;
/** 增益封顶的 LOD（再远就没有细节可言了） */
export const ALPHA_LIFT_MAX_LOD = 3;

/**
 * 这一块 alpha 在给定 LOD 下应该抬到多少（0~1）。
 *
 * @param alpha mipmap 采样出来的 alpha（0~1）
 * @param lod   当前采样到的 mip 层级（0 = 原图）
 */
export function coverageAlpha(
  alpha: number,
  lod: number,
  lift: number = ALPHA_LIFT_PER_LOD,
  maxLod: number = ALPHA_LIFT_MAX_LOD,
): number {
  if (!(alpha > 0)) return 0;
  const level = Math.min(Math.max(Number.isFinite(lod) ? lod : 0, 0), maxLod);
  return Math.min(1, alpha * (1 + Math.max(0, lift) * level));
}
