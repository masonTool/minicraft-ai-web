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
  /**
   * 读状态字节（批次 622 / Q20：含方块状态）。
   *
   * **可选**：早先的测试与调用方只关心 id，不给这两条也能跑（此时状态一律按 0 处理）。
   * 但真机上必须给 —— 否则复制楼梯会全变成"朝北的下半砖"，
   * 复制告示牌会丢掉朝向，复制台阶会丢掉双层标记。
   */
  readState?(x: number, y: number, z: number): number;
  writeState?(x: number, y: number, z: number, id: number, state: number): void;
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

/** 平移一个区域 */
export function shiftCloneBox(box: CloneBox, offset: { x: number; y: number; z: number }): CloneBox {
  return {
    x1: box.x1 + offset.x,
    y1: box.y1 + offset.y,
    z1: box.z1 + offset.z,
    x2: box.x2 + offset.x,
    y2: box.y2 + offset.y,
    z2: box.z2 + offset.z,
  };
}

/**
 * 两个区域是否**有交集**（闭区间）。
 *
 * `/clone` 要拒绝"目标压到源上"（批次 622 / Q20 补的判据，原版同）：
 * 虽然本模块已经把整块读完了、重叠也不会读到自己写的内容，
 * 但**原版拒绝**这件事本身就是玩家依赖的行为 —— 允许之后，
 * "把房子往东挪 2 格"这种写法会得到一个半新半旧的结果，玩家会以为指令坏了。
 */
export function cloneBoxesOverlap(a: CloneBox, b: CloneBox): boolean {
  return (
    a.x1 <= b.x2 && b.x1 <= a.x2 &&
    a.y1 <= b.y2 && b.y1 <= a.y2 &&
    a.z1 <= b.z2 && b.z1 <= a.z2
  );
}

/**
 * 目标区域是否在世界竖直范围内。
 *
 * 只查 Y：水平方向本项目没有硬边界（`/tp` 也只是夹取），而 Y 有明确的地板与天花板
 * （区块是 384 高）。越界的写会被 `World.setBlock` 静默丢弃，
 * 那样 `/clone` 会回一句"已复制 N 格"却什么都没发生 —— 比直接报错难查得多。
 */
export function cloneBoxInWorld(box: CloneBox, minY: number, maxY: number): boolean {
  return box.y1 >= minY && box.y2 <= maxY;
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
  //
  // 状态字节一起存（批次 622 / Q20）：只存 id 的话，复制出来的楼梯全朝一个方向。
  // 用两条平行数组而不是对象数组：体积上限 32768，对象数组在手机上要多分配一倍内存。
  const snapshot = new Array<number>(volume);
  const states = new Array<number>(volume);
  for (let y = 0; y < height; y++) {
    for (let z = 0; z < depth; z++) {
      for (let x = 0; x < width; x++) {
        const wx = box.x1 + x;
        const wy = box.y1 + y;
        const wz = box.z1 + z;
        const index = (y * depth + z) * width + x;
        snapshot[index] = io.read(wx, wy, wz);
        states[index] = io.readState ? io.readState(wx, wy, wz) : 0;
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
        if (io.writeState) io.writeState(tx, ty, tz, id, states[(y * depth + z) * width + x]!);
        else io.write(tx, ty, tz, id);
        copied++;
      }
    }
  }
  return { copied, skipped, volume };
}
