/**
 * 资源包加载（K4）
 *
 * 支持 `.mcpack` / `.zip`：里面的 `textures/blocks/<名字>.png` 会按**文件名**匹配到图集里的
 * tile（名字与 `atlasLayout.ts` 的 `TILE_ORDER` 一致），匹配上的直接重画到图集画布上，
 * 然后 `texture.needsUpdate = true` —— 下一次渲染就是新贴图，不需要重载页面。
 *
 * 为什么自己解析 zip 而不引库：浏览器已经提供了 `DecompressionStream('deflate-raw')`，
 * zip 的格式（EOCD + 中央目录 + 本地头）也不复杂，为这点需求引一个解压库不划算。
 * 解析时**只解压需要的条目**：一个资源包里绝大多数是模型/语言文件，没必要全部读出来。
 *
 * ⚠️ 当前只支持替换**方块贴图**（图集里已有的 tile 名）。资源包里的音效、
 * 新方块、模型与 GUI 贴图都还不支持——已经在 TASKS.md 里记明。
 */

import { ATLAS_COLUMNS, TILE_ORDER, TILE_SIZE } from '../../render/atlasLayout.ts';
import type { TextureAtlas } from '../../render/TextureAtlas.ts';

/** zip 里解出来的一项 */
export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

export interface ResourcePackResult {
  /** 资源包里的方块贴图总数 */
  found: number;
  /** 成功替换的 tile 名 */
  replaced: string[];
  /** 认识但没替换的（名字对不上图集，或者解压失败） */
  skipped: string[];
  /** 直接忽略的（不是方块贴图，例如模型与语言文件） */
  ignored: number;
}

/** 把 subarray 视图复制成独立的 ArrayBuffer（Blob/DecompressionStream 要求明确的所有权） */
function toArrayBuffer(view: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(view.byteLength);
  new Uint8Array(copy).set(view);
  return copy;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

/**
 * 解析 zip（只解压 `accept` 认可的条目）。
 *
 * 处理顺序：先在文件尾部找到中央目录（EOCD），再按中央目录里的偏移逐个定位本地头——
 * 这是 zip 的标准读法（本地头里的长度字段在有 data descriptor 时可能为 0，
 * 以中央目录为准才可靠）。
 */
export async function readZipEntries(buffer: ArrayBuffer, accept: (name: string) => boolean): Promise<ZipEntry[]> {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  // ---- 1. 从尾部往前找 EOCD（注释最长 65535 字节，所以最多回退这么远）
  let eocd = -1;
  const searchStart = Math.max(0, bytes.length - 65557);
  for (let i = bytes.length - 22; i >= searchStart; i--) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('不是有效的 zip/mcpack：找不到中央目录');

  const entryCount = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);

  const results: ZipEntry[] = [];
  const decoder = new TextDecoder();

  for (let i = 0; i < entryCount; i++) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== CENTRAL_SIGNATURE) break;
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));

    offset += 46 + nameLength + extraLength + commentLength;

    if (!accept(name)) continue;
    if (view.getUint32(localOffset, true) !== LOCAL_SIGNATURE) continue;

    // ---- 2. 本地头里的名字/扩展字段长度可能与中央目录不同，必须重新读一遍
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = bytes.subarray(dataStart, dataStart + compressedSize);

    if (method === 0) {
      results.push({ name, data: raw });
      continue;
    }
    if (method !== 8) continue; // 只支持 stored 与 deflate（zip 里 99% 是这两种）
    try {
      const stream = new Blob([toArrayBuffer(raw)]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      const inflated = new Uint8Array(await new Response(stream).arrayBuffer());
      results.push({ name, data: inflated });
    } catch {
      // 解压失败（损坏的包）：跳过这一项，不影响其它贴图
    }
  }

  return results;
}

/** 从 zip 条目名里取出 tile 名：`textures/blocks/stone.png` → `stone` */
export function tileNameOf(entryName: string): string | null {
  const match = /(?:^|\/)blocks\/([^/]+)\.png$/i.exec(entryName);
  if (match) return match[1]!.toLowerCase();
  // 有些资源包把方块贴图直接放在 textures/ 下
  const flat = /(?:^|\/)textures\/([^/]+)\.png$/i.exec(entryName);
  return flat ? flat[1]!.toLowerCase() : null;
}

/**
 * 把资源包应用到图集。返回替换统计。
 *
 * 贴图尺寸不要求是 16×16：`drawImage` 会缩放到图集里那一格，
 * 因此 32×32 的高清包也能用（会被降采样到 16×16，与图集规格一致）。
 */
export async function applyResourcePack(file: File, atlas: TextureAtlas, packName = file.name): Promise<ResourcePackResult> {
  const buffer = await file.arrayBuffer();

  const entries = await readZipEntries(buffer, (name) => {
    const tile = tileNameOf(name);
    return tile !== null;
  });

  const ctx = atlas.canvas.getContext('2d');
  if (!ctx) throw new Error('无法取得图集画布上下文，资源包未应用');

  const result: ResourcePackResult = { found: entries.length, replaced: [], skipped: [], ignored: 0 };

  for (const entry of entries) {
    const tile = tileNameOf(entry.name);
    if (!tile) {
      result.ignored++;
      continue;
    }
    const index = (TILE_ORDER as readonly string[]).indexOf(tile);
    if (index < 0) {
      result.skipped.push(tile);
      continue;
    }

    try {
      // PNG → ImageBitmap：浏览器自带解码，不需要自己写 PNG 解析
      const blob = new Blob([toArrayBuffer(entry.data)], { type: 'image/png' });
      const bitmap = await createImageBitmap(blob);
      const column = index % ATLAS_COLUMNS;
      const row = Math.floor(index / ATLAS_COLUMNS);
      ctx.clearRect(column * TILE_SIZE, row * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      ctx.drawImage(bitmap, column * TILE_SIZE, row * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      bitmap.close?.();
      result.replaced.push(tile);
    } catch {
      result.skipped.push(tile);
    }
  }

  // 让 three 重新上传纹理：下一帧就是新贴图，不需要重建材质或重载页面
  if (result.replaced.length > 0) atlas.texture.needsUpdate = true;

  console.info(
    `[pack] ${packName}：替换 ${result.replaced.length} 张贴图` +
      (result.skipped.length > 0 ? `，${result.skipped.length} 张名字对不上图集` : ''),
  );
  return result;
}

/** 从文件名推断资源包名（`我的材质.mcpack` → `我的材质`） */
export function packNameFromFile(fileName: string): string {
  return fileName.replace(/\.(mcpack|zip)$/i, '');
}
