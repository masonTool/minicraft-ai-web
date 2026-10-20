/**
 * 刷怪笼里"旋转的迷你生物"（批次 487，E21 的最后一块）
 *
 * 原版刷怪笼中间会飘着一只**缩小并缓慢旋转**的生物模型（纯视觉，不是真实体——
 * 它不掉血、不参与 AI、也不占实体表）。
 *
 * 为什么做成纯函数：真正画它需要 Three.js（渲染层），而"哪些笼子该画什么"
 * 是一道跟渲染无关的判断题——抽出来之后可以离线断言：
 *  - 键解析错了会被抓到（`"1,2,3"` 这种手写格式最容易多一个空格）；
 *  - 笼子被挖掉之后方块变成空气，`defFor` 返回 null → 不画（否则会留下"幽灵模型"）;
 *  - 同一个笼子只出一条。
 */

/** 一个应当画出"旋转迷你生物"的笼子 */
export interface SpawnerDecoration {
  /** 生物种类 id（渲染层用它查样板） */
  readonly mobId: string;
  /** 模型中心（笼子方块的正中，稍高一点） */
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** 方块 id → 刷怪笼定义（null = 不是刷怪笼）；由调用方注入 */
export type SpawnerDefLookup = (blockId: number) => { readonly mobId: string } | null;

/**
 * 收集这一帧要画的装饰。
 *
 * @param keys 已登记的刷怪笼位置（`"x,y,z"`，与 `game/tuning.ts` 的 `spawnerKey` 一致）
 * @param blockAt 读方块（笼子被挖掉之后是空气，要能识别出来）
 */
export function collectSpawnerDecorations(
  keys: Iterable<string>,
  blockAt: (x: number, y: number, z: number) => number,
  defFor: SpawnerDefLookup,
): SpawnerDecoration[] {
  const out: SpawnerDecoration[] = [];
  const seen = new Set<string>();
  for (const key of keys) {
    if (seen.has(key)) continue;
    seen.add(key);
    const [rawX, rawY, rawZ] = key.split(',');
    const x = Number(rawX);
    const y = Number(rawY);
    const z = Number(rawZ);
    // 键是手写格式（`${x},${y},${z}`），任何一个不是整数就跳过——
    // 宁可少画一个，也不要把模型丢到 (NaN, NaN, NaN) 上
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    const def = defFor(blockAt(x, y, z));
    if (!def) continue;
    out.push({ mobId: def.mobId, x: x + 0.5, y: y + 0.6, z: z + 0.5 });
  }
  return out;
}
