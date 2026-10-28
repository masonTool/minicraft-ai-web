/**
 * 存档导出 / 导入（L2，批次 591）
 *
 * 目标：把一个世界的 IndexedDB 内容 + 世界清单项打成一个 JSON 文件，
 * 在另一台设备/另一个浏览器里导入成**新世界**（不覆盖已有世界）。
 *
 * 为什么不是直接 `JSON.stringify(stores)`：
 *  - 区块增量里存的是 **ArrayBuffer**（`SaveGame.saveChunks` 直接 put 结构化克隆），
 *    而 `JSON.stringify(new ArrayBuffer(3))` 得到 `{}` —— 直接序列化会**静默丢地形改动**；
 *  - 所以这里先把 ArrayBuffer / TypedArray 编成带标记的 base64，导入时再还原。
 *
 * 这一层只做"编码 + 形状校验"，不碰 IndexedDB；真正的读写由 `SaveGame` 的
 * `exportStores` / `importStores` 完成，因此可以离线断言。
 */

import { isWorldType, type WorldType } from '../gen/WorldType.ts';
import { normalizeDifficulty, type Difficulty } from '../world/Rules.ts';
import { normalizeGameMode, type GameMode } from '../world/GameMode.ts';
import type { WorldSummary } from './WorldRegistry.ts';

export const SAVE_TRANSFER_FORMAT = 'bedrock-118-save';
export const SAVE_TRANSFER_VERSION = 1;
/** 导入文件上限：正常存档几十 KB~几 MB，64MB 已经非常宽松 */
export const MAX_TRANSFER_BYTES = 64 * 1024 * 1024;

/**
 * 存档包后缀（2026-10-28，用户：导入与导出用同一个后缀）。
 *
 * 里面仍是**标准 zip**（`world.json` + `thumbnail.jpg`），所以改后缀不影响
 * "拿解压工具就能打开抢救"这条性质。旧版导出的 `.mc` 仍然能被导入。
 */
export const SAVE_FILE_EXTENSION = '.world';
/** 导入时仍接受旧后缀，避免玩家手上的旧包变成"打不开的文件" */
export const LEGACY_SAVE_FILE_EXTENSION = '.mc';

export interface StoreEntry {
  key: string | number;
  value: unknown;
}

/** 与 `SaveGame` 的 object store 一一对应；键是 store 名 */
export type StoreDump = Record<string, StoreEntry[]>;

export interface TransferWorld {
  name: string;
  seed: number;
  worldType: WorldType;
  gameMode: GameMode;
  difficulty: Difficulty;
  hardcore?: boolean;
  singleBiome?: string;
}

export interface SaveTransferFile {
  format: typeof SAVE_TRANSFER_FORMAT;
  version: number;
  exportedAt: number;
  world: TransferWorld;
  stores: StoreDump;
}

interface EncodedBuffer {
  __buffer: string;
}

function encodeBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  // 分块拼，避免 `String.fromCharCode(...bytes)` 在大数组上爆栈
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function decodeBase64(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** JSON 不能直接表达 ArrayBuffer / TypedArray，递归换成带标记的对象 */
export function encodeStoresForJson(value: unknown): unknown {
  if (value instanceof ArrayBuffer) {
    return { __buffer: encodeBase64(value) } satisfies EncodedBuffer;
  }
  if (ArrayBuffer.isView(value)) {
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    // `slice()` 复制一份并返回 ArrayBuffer，避免把 SharedArrayBuffer 带进 encodeBase64
    return { __buffer: encodeBase64(bytes.slice().buffer as ArrayBuffer) };
  }
  if (Array.isArray(value)) return value.map((entry) => encodeStoresForJson(entry));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) out[key] = encodeStoresForJson(entry);
    return out;
  }
  return value;
}

/** 与 `encodeStoresForJson` 对称；坏 base64 保留原样，交给后续清洗 */
export function decodeStoresFromJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => decodeStoresFromJson(entry));
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.__buffer === 'string') {
      try {
        return decodeBase64(record.__buffer);
      } catch {
        return value;
      }
    }
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(record)) out[key] = decodeStoresFromJson(entry);
    return out;
  }
  return value;
}

/** 文件名里剔除路径分隔符与控制字符，避免各平台另存为失败 */
/**
 * 包名：`世界名.world`（2026-10-28，用户：导入导出统一用同一个后缀）。
 *
 * 规则：**空格换成中划线**（`我的 世界` → `我的-世界.world`），导入时再换回来。
 * 文件系统不允许的字符（`/ \ : * ? " < > |`）仍然替换成 `_`，否则下载会被浏览器拒绝。
 *
 * ⚠️ 转换是**有损**的：世界名里原本就有中划线时会被还原成空格。所以导入时
 * **优先用包内 `world.json` 里的真实名字**，文件名只是兜底——这样既满足"以世界名命名"，
 * 又不会因为文件名规则把玩家的世界名改掉。
 */
export function transferFileName(name: string): string {
  const safe = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    // **先 trim 再换中划线**：反过来会让"全是空格的名字"变成 `-`，trim 已经无从下手
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 40)
    .trim();
  return `${safe || 'world'}${SAVE_FILE_EXTENSION}`;
}

/**
 * 从包名还原世界名（导入时的兜底路径）：中划线换回空格。
 * 正常情况用不到——包里就有真实名字。
 */
export function worldNameFromFile(fileName: string): string {
  const base = fileName.replace(/\.[^.]*$/, '');
  return base.replace(/-/g, ' ').trim() || '导入的世界';
}

/** 导出前把清单项裁成传输需要的字段（id/时间戳不带走，导入时重新生成） */
export function transferWorldOf(world: WorldSummary): TransferWorld {
  return {
    name: world.name,
    seed: world.seed,
    worldType: world.worldType,
    gameMode: world.gameMode,
    difficulty: world.difficulty,
    ...(world.hardcore ? { hardcore: true } : {}),
    ...(world.singleBiome ? { singleBiome: world.singleBiome } : {}),
  };
}

/** 组装导出文件；`exportedAt` 可注入，测试不必跟时钟赛跑 */
export function buildSaveTransfer(
  world: WorldSummary,
  stores: StoreDump,
  exportedAt = Date.now(),
): SaveTransferFile {
  return {
    format: SAVE_TRANSFER_FORMAT,
    version: SAVE_TRANSFER_VERSION,
    exportedAt,
    world: transferWorldOf(world),
    stores: encodeStoresForJson(stores) as StoreDump,
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * 解析一个导入文件。
 *
 * 校验刻意"轻但硬"：格式不对、版本比程序新、seed 不是有限数、stores 不是对象
 * 一律返回 null；单个坏条目留给 `importStores` 的 IndexedDB 事务去拒绝，
 * 不让手改文件把整个导入流程卡死。
 */
export function parseSaveTransfer(text: string): SaveTransferFile | null {
  if (text.length > MAX_TRANSFER_BYTES) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const file = raw as Partial<SaveTransferFile>;
  if (file.format !== SAVE_TRANSFER_FORMAT) return null;
  if (!isFiniteNumber(file.version) || file.version > SAVE_TRANSFER_VERSION) return null;
  if (!file.world || typeof file.world !== 'object') return null;
  const world = file.world as Partial<TransferWorld>;
  if (!isFiniteNumber(world.seed)) return null;
  if (!isWorldType(world.worldType)) return null;
  if (typeof world.name !== 'string' || world.name.trim().length === 0) return null;
  if (!file.stores || typeof file.stores !== 'object' || Array.isArray(file.stores)) return null;

  const stores: StoreDump = {};
  for (const [store, entries] of Object.entries(file.stores as Record<string, unknown>)) {
    if (!Array.isArray(entries)) continue;
    const cleaned: StoreEntry[] = [];
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') continue;
      const record = entry as Partial<StoreEntry>;
      if (typeof record.key !== 'string' && !isFiniteNumber(record.key)) continue;
      cleaned.push({ key: record.key, value: decodeStoresFromJson(record.value) });
    }
    stores[store] = cleaned;
  }

  return {
    format: SAVE_TRANSFER_FORMAT,
    version: file.version,
    exportedAt: isFiniteNumber(file.exportedAt) ? file.exportedAt : 0,
    world: {
      name: world.name.trim().slice(0, 40),
      seed: world.seed,
      worldType: world.worldType,
      gameMode: normalizeGameMode(world.gameMode),
      difficulty: normalizeDifficulty(world.difficulty),
      ...(world.hardcore === true ? { hardcore: true } : {}),
      ...(typeof world.singleBiome === 'string' && world.singleBiome.length > 0
        ? { singleBiome: world.singleBiome }
        : {}),
    },
    stores,
  };
}
