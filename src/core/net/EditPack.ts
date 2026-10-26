/**
 * 进房首包的**方块增量压缩格式**（用户 2026-10-26 批准的第 ② 条）。
 *
 * 为什么需要：`welcome.edits` 原来是 `[x,y,z,id,state,"overworld"]` 一条一数组的 JSON，
 * 一条约 30~40 字节；跑久了的房间几千上万条就是几百 KB，手机进房要卡一下。
 *
 * 压缩思路全是"已知信息不重复写"：
 *  · 快照**只含玩家当前维度**的改动（服务端已按维度筛过）→ 维度提到顶层写一次；
 *  · 按**区块分组** → `cx,cz` 每块只写一次，条目里只放区块内下标（3~5 位）；
 *  · 一条只剩 `idx,id,state` 三个小整数 → 约 10~12 字符，**比原来小 3 倍左右**。
 *
 * 为什么不用二进制/varint：收益只多一点点（再小 1.2 倍），代价是一套要两端逐字节对齐的
 * 编码 + base64 膨胀；JSON 分组能被 `grep`、能被日志原样打出来，出问题好查。
 *
 * ⚠️ 网线契约：服务端有一份**只负责编码**的等价实现（`server/editpack.mjs`，纯 JS 不能
 * import TS）。两边一致性由 `tests/edit-pack.test.ts` 交叉验证（服务器编码 → 客户端解码）。
 */

/** 格式版本：字段或下标算法一变就要 +1，客户端据此拒收（宁可少几格，也别解出错位地形） */
export const EDIT_PACK_VERSION = 1;

/** 打包后的形状（服务端写、客户端读） */
export interface EditsPack {
  v: number;
  /** 维度名（整包同一个维度） */
  d: string;
  /** `[cx, cz, [idx, id, state, ...]]`：每块一条，条目按三连展开 */
  c: Array<[number, number, number[]]>;
}

/** 解码出来的形状 = 旧的 `edits` 数组，调用方（`onWelcome`）不用改 */
export type PackedEdit = [number, number, number, number, number, string];

/**
 * 区块内下标 ↔ 世界坐标（与 `Chunk.index` / `Chunk.coordsAt` 同一套算术）。
 *
 * 为什么不直接 import `Chunk`：那是 1.7 万行的重型模块，而这里只要两个公式；
 * 服务端那份也要用同样的公式，两边都写死反而不容易"一处改了另一处忘了"——
 * 由 `tests/edit-pack.test.ts` 拿真实的 `Chunk.index` 交叉校验。
 */
const CHUNK_XZ = 16 * 16;
const WORLD_MIN_Y = -64;

export function packIndex(x: number, y: number, z: number): number {
  return ((y - WORLD_MIN_Y) * 16 + (z & 15)) * 16 + (x & 15);
}

export function unpackIndex(index: number): { x: number; y: number; z: number } {
  const y = Math.floor(index / CHUNK_XZ) + WORLD_MIN_Y;
  const rest = index % CHUNK_XZ;
  return { x: rest % 16, y, z: Math.floor(rest / 16) };
}

/** 编码（服务端与测试用）。输入必须已经是"这个玩家附近、同一个维度"的增量 */
export function encodeEditsPack(
  edits: ReadonlyArray<{ x: number; y: number; z: number; id: number; state: number; dimension: string }>,
  dimension: string,
): EditsPack {
  const buckets = new Map<string, [number, number, number[]]>();
  for (const edit of edits) {
    if (edit.dimension !== dimension) continue;
    const cx = edit.x >> 4;
    const cz = edit.z >> 4;
    const key = `${cx}|${cz}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = [cx, cz, []];
      buckets.set(key, bucket);
    }
    bucket[2].push(packIndex(edit.x, edit.y, edit.z), edit.id, edit.state);
  }
  return { v: EDIT_PACK_VERSION, d: dimension, c: [...buckets.values()] };
}

/**
 * 解码。任何异常（版本不对/结构不对）返回 `null`，调用方退回 `message.edits`。
 *
 * 这里是"不可信输入"的入口：服务端可能跑着别的版本。**宁可不画那几格**，
 * 也不能把错位的地形写进世界——错位比缺失难查得多。
 */
export function decodeEditsPack(pack: unknown): PackedEdit[] | null {
  if (typeof pack !== 'object' || pack === null) return null;
  const { v, d, c } = pack as Partial<EditsPack>;
  if (v !== EDIT_PACK_VERSION) return null;
  if (typeof d !== 'string' || d.length === 0) return null;
  if (!Array.isArray(c)) return null;
  const out: PackedEdit[] = [];
  for (const bucket of c) {
    if (!Array.isArray(bucket) || bucket.length < 3) return null;
    const [cx, cz, list] = bucket as [unknown, unknown, unknown];
    if (!Number.isInteger(cx) || !Number.isInteger(cz)) return null;
    if (!Array.isArray(list) || list.length % 3 !== 0) return null;
    for (let i = 0; i < list.length; i += 3) {
      const index = Number(list[i]);
      const id = Number(list[i + 1]);
      const state = Number(list[i + 2]);
      if (!Number.isInteger(index) || !Number.isInteger(id) || !Number.isInteger(state)) return null;
      const at = unpackIndex(index);
      out.push([(cx as number) * 16 + at.x, at.y, (cz as number) * 16 + at.z, id, state, d]);
    }
  }
  return out;
}
