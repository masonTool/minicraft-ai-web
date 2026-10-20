/**
 * `/clone` 的区域复制（K11，批次 431）—— 纯逻辑，读写用注入的两个函数。
 *
 * 为什么单独一个模块：`/clone` 的**坑全在读写顺序与边界**上，而这两件事不需要真世界
 * 就能验：给它一张 Map 当世界，复制出来的结果逐格比对即可。
 *
 * 三条决定（都是踩过的类型）：
 *  1. **先把源区域整块读出来，再往目标写**。不这样做的话，"源与目标重叠"就会出现
 *     "前面几格已经被新内容覆盖、后面又从被覆盖的格子里读"——复制结果取决于遍历顺序，
 *     这种 bug 在真机上表现为"某些方向复制出来是对的、换个方向就错"。
 *  2. **`masked` 只覆盖空气**（原版语义）：目标位置不是空气就跳过，并计入 `skipped`。
 *     没有这一步就没法"把一座房子贴到地形上而不铲平它"。
 *  3. **体积上限由调用方管**（`LIMIT`），这里只报 `volume` 让它判断——
 *     纯函数里写死上限会让测试没法验"刚好等于上限"的边界。
 */

/** 源区域（闭区间，已归一化成 x1 ≤ x2 之类） */
export interface CloneBox {
  x1: number;
  y1: number;
  z1: number;
  x2: number;
  y2: number;
  z2: number;
}

/** 方块读写口（命令层用 `ctx.getBlock` / `ctx.setBlock` 实现） */
export interface CloneIo {
  read(x: number, y: number, z: number): number;
  write(x: number, y: number, z: number, id: number): void;
}

export type CloneMode = 'replace' | 'masked';

/** 空气的方块 id（本项目里就是 0；写成常量免得各处魔法数） */
export const CLONE_AIR = 0;

/** `/clone` 的单次体积上限（与原版一致：32768 格） */
export const CLONE_LIMIT = 32768;

export interface CloneResult {
  /** 真正写下去的格数 */
  copied: number;
  /** `masked` 模式下因为目标不是空气而跳过的格数 */
  skipped: number;
  /** 源区域体积 */
  volume: number;
}

/** 把两个对角点归一化成 min/max */
export function normalizeCloneBox(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): CloneBox {
  return {
    x1: Math.min(a.x, b.x),
    y1: Math.min(a.y, b.y),
    z1: Math.min(a.z, b.z),
    x2: Math.max(a.x, b.x),
    y2: Math.max(a.y, b.y),
    z2: Math.max(a.z, b.z),
  };
}

export function cloneVolume(box: CloneBox): number {
  return (box.x2 - box.x1 + 1) * (box.y2 - box.y1 + 1) * (box.z2 - box.z1 + 1);
}

/**
 * 把 `box` 复制到"以 (dx, dy, dz) 为位移"的位置。
 *
 * @param offset 目标位置 = 源位置 + offset（闭区间逐格平移）
 */
export function cloneRegion(io: CloneIo, box: CloneBox, offset: { x: number; y: number; z: number }, mode: CloneMode): CloneResult {
  const volume = cloneVolume(box);
  const width = box.x2 - box.x1 + 1;
  const height = box.y2 - box.y1 + 1;
  const depth = box.z2 - box.z1 + 1;

  // ① 先整块读出来（理由见文件头第 1 条）
  const snapshot = new Array<number>(volume);
  for (let y = 0; y < height; y++) {
    for (let z = 0; z < depth; z++) {
      for (let x = 0; x < width; x++) {
        snapshot[(y * depth + z) * width + x] = io.read(box.x1 + x, box.y1 + y, box.z1 + z);
      }
    }
  }

  // ② 再往目标写
  let copied = 0;
  let skipped = 0;
  for (let y = 0; y < height; y++) {
    for (let z = 0; z < depth; z++) {
      for (let x = 0; x < width; x++) {
        const id = snapshot[(y * depth + z) * width + x]!;
        const tx = box.x1 + x + offset.x;
        const ty = box.y1 + y + offset.y;
        const tz = box.z1 + z + offset.z;
        if (mode === 'masked' && io.read(tx, ty, tz) !== CLONE_AIR) {
          skipped++;
          continue;
        }
        io.write(tx, ty, tz, id);
        copied++;
      }
    }
  }
  return { copied, skipped, volume };
}
