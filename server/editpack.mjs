/**
 * 进房首包的方块增量压缩格式 —— **服务端那份（只编码）**。
 *
 * 与 `src/core/net/EditPack.ts` 是同一份契约：TS 那份客户端解码用，这份服务端编码用。
 * 纯 JS 项目里不能 import TS，所以公式各写一遍；一致性由 `tests/edit-pack.test.ts`
 * 交叉验证（这里编码 → TS 解码 → 必须还原本来的三元组）。
 *
 * 布局：
 *   { v: 1, d: 'overworld', c: [[cx, cz, [idx, id, state, ...]], ...] }
 *   idx = ((y - (-64)) * 16 + (z & 15)) * 16 + (x & 15)
 */

export const EDIT_PACK_VERSION = 1;

const WORLD_MIN_Y = -64;

export function packIndex(x, y, z) {
  return ((y - WORLD_MIN_Y) * 16 + (z & 15)) * 16 + (x & 15);
}

/**
 * 把"这个玩家附近"的增量编码成压缩包。
 *
 * @param {Array<{x:number,y:number,z:number,id:number,state:number,dimension:string}>} list
 * @param {string} dimension 只编码这个维度的（快照本来就按玩家维度筛过）
 */
export function encodeEditsPack(list, dimension) {
  /* @type {Map<string, [number, number, number[]]>} */
  const buckets = new Map();
  for (const edit of list) {
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

const WORLD_MIN_Y_DECODE = -64;
const CHUNK_XZ = 16 * 16;

/**
 * 解码（**给测试与调试用**；正式解码在客户端 `src/core/net/EditPack.ts`）。
 *
 * 放这里是为了让 `tools/net-test.mjs`（纯 node，不能 import TS）也能断言
 * `welcome.editsPack` 的内容——服务端自己解一遍，与客户端的实现互相印证。
 *
 * @param {{v:number,d:string,c:Array<[number,number,number[]]>}} pack
 * @returns {Array<[number,number,number,number,number,string]>|null}
 */
export function decodeEditsPack(pack) {
  if (typeof pack !== 'object' || pack === null) return null;
  if (pack.v !== EDIT_PACK_VERSION) return null;
  if (typeof pack.d !== 'string' || pack.d.length === 0) return null;
  if (!Array.isArray(pack.c)) return null;
  const out = [];
  for (const bucket of pack.c) {
    if (!Array.isArray(bucket) || bucket.length < 3) return null;
    const [cx, cz, list] = bucket;
    if (!Number.isInteger(cx) || !Number.isInteger(cz) || !Array.isArray(list) || list.length % 3 !== 0) return null;
    for (let i = 0; i < list.length; i += 3) {
      const index = list[i];
      const y = Math.floor(index / CHUNK_XZ) + WORLD_MIN_Y_DECODE;
      const rest = index % CHUNK_XZ;
      out.push([cx * 16 + (rest % 16), y, cz * 16 + Math.floor(rest / 16), list[i + 1], list[i + 2], pack.d]);
    }
  }
  return out;
}
