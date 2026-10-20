/**
 * 文件版存档（WX-016）
 *
 * 与 `core/save/SaveGame.ts`（IndexedDB）并存：
 *   - Web 版继续用 IndexedDB；
 *   - 微信小游戏没有 IndexedDB，用 `FileStore`（wx FileSystemManager）落盘。
 *
 * 目录布局（每个世界一个目录）：
 *   save/<worldId>/meta.json
 *   save/<worldId>/player.json
 *   save/<worldId>/containers.json
 *   save/<worldId>/signs.json
 *   save/<worldId>/frames.json
 *   save/<worldId>/advancements.json
 *   save/<worldId>/chunks/<dimension>|<cx>,<cz>.bin
 *
 * 区块文件是“头部 8 字节 + indices + packed”的紧凑二进制，避免 JSON/base64 膨胀。
 * `FileStore.write` 本身是原子的（临时文件 + rename）；`meta.json` 最后写，
 * 被杀进程时最多丢掉本次保存，不会把“已完成”的 meta 写坏。
 */

import { ChunkEdits, type SerializedEdits } from '../core/save/ChunkEdits.ts';
import type {
  ChunkSaveRecord,
  PlayerSave,
  SaveMeta,
} from '../core/save/SaveGame.ts';
import { SAVE_VERSION } from '../core/save/SaveGame.ts';
import { migratePlayer } from '../core/save/SaveMigrations.ts';
import type { SerializedContainer } from '../core/save/ContainerSave.ts';
import type { SerializedSign } from '../core/world/SignText.ts';
import type { SerializedFrame } from '../core/world/ItemFrame.ts';
import type { SerializedAdvancements } from '../core/progress/AdvancementTracker.ts';
import type { FileStore } from './types.ts';

const SAVE_ROOT = 'save';
const META_FILE = 'meta.json';
const PLAYER_FILE = 'player.json';
const CONTAINERS_FILE = 'containers.json';
const SIGNS_FILE = 'signs.json';
const FRAMES_FILE = 'frames.json';
const ADVANCEMENTS_FILE = 'advancements.json';
const CHUNK_DIR = 'chunks';

function safeWorldId(worldId: string): string {
  return worldId.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function parseJson<T>(buffer: ArrayBuffer): T | null {
  try {
    return JSON.parse(new TextDecoder().decode(buffer)) as T;
  } catch {
    return null;
  }
}

function encodeJson(value: unknown): string {
  return JSON.stringify(value);
}

/** 区块记录 → 紧凑二进制 */
export function encodeChunkEdits(edits: SerializedEdits): ArrayBuffer {
  const indicesBytes = edits.indices.byteLength;
  const packedBytes = edits.packed.byteLength;
  const buffer = new ArrayBuffer(8 + indicesBytes + packedBytes);
  const view = new DataView(buffer);
  view.setUint32(0, indicesBytes, true);
  view.setUint32(4, packedBytes, true);
  new Uint8Array(buffer, 8, indicesBytes).set(
    new Uint8Array(edits.indices.buffer, edits.indices.byteOffset, indicesBytes),
  );
  new Uint8Array(buffer, 8 + indicesBytes, packedBytes).set(
    new Uint8Array(edits.packed.buffer, edits.packed.byteOffset, packedBytes),
  );
  return buffer;
}

/** 紧凑二进制 → 区块记录；格式不对时返回 null */
export function decodeChunkEdits(buffer: ArrayBuffer): SerializedEdits | null {
  if (buffer.byteLength < 8) return null;
  const view = new DataView(buffer);
  const indicesBytes = view.getUint32(0, true);
  const packedBytes = view.getUint32(4, true);
  if (8 + indicesBytes + packedBytes > buffer.byteLength) return null;
  return {
    indices: new Uint32Array(buffer.slice(8, 8 + indicesBytes)),
    packed: new Uint32Array(buffer.slice(8 + indicesBytes, 8 + indicesBytes + packedBytes)),
  };
}

export class FileSaveGame {
  meta: SaveMeta | null = null;
  /** 本次会话累计游玩秒数 */
  private sessionSeconds = 0;
  private created = false;
  private readonly worldDir: string;
  private readonly chunkDir: string;

  private constructor(
    readonly worldId: string,
    private readonly files: FileStore,
  ) {
    this.worldDir = `${SAVE_ROOT}/${safeWorldId(worldId)}`;
    this.chunkDir = `${this.worldDir}/${CHUNK_DIR}`;
  }

  /** 打开（或创建）某个世界的文件存档；读 meta 失败时也返回对象（按新世界处理） */
  static async open(worldId: string, files: FileStore): Promise<FileSaveGame> {
    const save = new FileSaveGame(worldId, files);
    const meta = await save.readJson<SaveMeta>(META_FILE);
    if (meta && meta.version > SAVE_VERSION) {
      console.warn(
        `[save] 文件存档版本 ${meta.version} 比当前程序（${SAVE_VERSION}）新，按新世界处理`,
      );
      save.meta = null;
    } else {
      save.meta = meta;
    }
    return save;
  }

  /** 删除某个世界的整个目录（删世界用；先清 chunks，再清顶层文件） */
  static async deleteWorld(worldId: string, files: FileStore): Promise<void> {
    const worldDir = `${SAVE_ROOT}/${safeWorldId(worldId)}`;
    const chunkDir = `${worldDir}/${CHUNK_DIR}`;
    for (const path of await files.list(chunkDir)) await files.remove(path);
    for (const path of await files.list(worldDir)) {
      if (path === chunkDir || path.startsWith(`${chunkDir}/`)) continue;
      await files.remove(path);
    }
  }

  get hasSave(): boolean {
    return this.meta !== null;
  }

  get isNewSave(): boolean {
    return !this.created && this.meta === null;
  }

  matchesSeed(seed: number): boolean {
    return this.meta === null || this.meta.seed === seed;
  }

  async loadPlayer(): Promise<PlayerSave | null> {
    const value = await this.readJson<PlayerSave>(PLAYER_FILE);
    if (!value) return null;
    const fromVersion = this.meta?.version ?? SAVE_VERSION;
    const migrated = migratePlayer(value, fromVersion);
    if (!migrated) {
      console.warn(
        `[save] 文件存档 v${fromVersion} 无法迁移到 v${SAVE_VERSION}，按没有玩家数据处理`,
      );
      return null;
    }
    if (migrated.applied.length > 0) {
      console.info(`[save] 文件存档已升级：${migrated.applied.join('；')}`);
      if (this.meta) this.meta.version = SAVE_VERSION;
    }
    return migrated.player as unknown as PlayerSave;
  }

  async savePlayer(player: PlayerSave): Promise<void> {
    await this.writeJson(PLAYER_FILE, player);
  }

  async loadChunkEdits(dimension: string, cx: number, cz: number): Promise<SerializedEdits | null> {
    const path = this.chunkPath(dimension, cx, cz);
    if (!(await this.files.exists(path))) return null;
    return decodeChunkEdits(await this.files.read(path));
  }

  async loadAllChunkEdits(): Promise<ChunkSaveRecord[]> {
    const paths = await this.files.list(this.chunkDir);
    const records: ChunkSaveRecord[] = [];
    for (const path of paths) {
      if (!path.endsWith('.bin')) continue;
      const name = path.slice(path.lastIndexOf('/') + 1, -4);
      const { dimension, cx, cz } = ChunkEdits.parseKey(name);
      const edits = decodeChunkEdits(await this.files.read(path));
      if (!edits) continue;
      records.push({ dimension, cx, cz, edits });
    }
    return records;
  }

  async saveChunks(records: ChunkSaveRecord[]): Promise<void> {
    if (records.length === 0) return;
    await this.files.mkdir(this.chunkDir);
    for (const record of records) {
      await this.files.write(
        this.chunkPath(record.dimension, record.cx, record.cz),
        encodeChunkEdits(record.edits),
      );
    }
  }

  async loadContainers(): Promise<SerializedContainer[]> {
    return (await this.readJson<SerializedContainer[]>(CONTAINERS_FILE)) ?? [];
  }

  async saveContainers(containers: SerializedContainer[]): Promise<void> {
    await this.writeJson(CONTAINERS_FILE, containers);
  }

  async loadSigns(): Promise<SerializedSign[]> {
    return (await this.readJson<SerializedSign[]>(SIGNS_FILE)) ?? [];
  }

  async saveSigns(signs: SerializedSign[]): Promise<void> {
    await this.writeJson(SIGNS_FILE, signs);
  }

  async loadFrames(): Promise<SerializedFrame[]> {
    return (await this.readJson<SerializedFrame[]>(FRAMES_FILE)) ?? [];
  }

  async saveFrames(frames: SerializedFrame[]): Promise<void> {
    await this.writeJson(FRAMES_FILE, frames);
  }

  async loadAdvancements(): Promise<SerializedAdvancements | null> {
    return this.readJson<SerializedAdvancements>(ADVANCEMENTS_FILE);
  }

  async saveAdvancements(progress: SerializedAdvancements): Promise<void> {
    await this.writeJson(ADVANCEMENTS_FILE, progress);
  }

  async saveMeta(meta: SaveMeta): Promise<void> {
    this.meta = meta;
    this.created = true;
    // meta 最后写：被杀进程时最多丢掉本次保存，不会出现“meta 说保存了但数据没写完”
    await this.writeJson(META_FILE, meta);
  }

  addPlayTime(seconds: number): void {
    this.sessionSeconds += seconds;
  }

  buildMeta(seed: number, edits: number): SaveMeta {
    const now = Date.now();
    return {
      seed,
      version: SAVE_VERSION,
      createdAt: this.meta?.createdAt ?? now,
      lastPlayed: now,
      playTime: (this.meta?.playTime ?? 0) + this.sessionSeconds,
      edits,
    };
  }

  resetSessionTime(): void {
    this.sessionSeconds = 0;
  }

  async clear(): Promise<void> {
    for (const path of await this.files.list(this.chunkDir)) await this.files.remove(path);
    for (const path of await this.files.list(this.worldDir)) {
      if (path === this.chunkDir || path.startsWith(`${this.chunkDir}/`)) continue;
      await this.files.remove(path);
    }
    this.meta = null;
  }

  close(): void {
    /* 文件存储无需关闭 */
  }

  /** 调试/验收用：已保存的区块数（与 IndexedDB 版 estimateSize 的口径一致） */
  async estimateSize(): Promise<number> {
    return (await this.files.list(this.chunkDir)).filter((path) => path.endsWith('.bin')).length;
  }

  /** 调试/验收用：所有已保存的区块键（`dimension|cx,cz`） */
  async listChunkKeys(): Promise<string[]> {
    return (await this.files.list(this.chunkDir))
      .filter((path) => path.endsWith('.bin'))
      .map((path) => path.slice(path.lastIndexOf('/') + 1, -4));
  }

  private chunkPath(dimension: string, cx: number, cz: number): string {
    return `${this.chunkDir}/${dimension}|${cx},${cz}.bin`;
  }

  private async readJson<T>(name: string): Promise<T | null> {
    const path = `${this.worldDir}/${name}`;
    if (!(await this.files.exists(path))) return null;
    return parseJson<T>(await this.files.read(path));
  }

  private async writeJson(name: string, value: unknown): Promise<void> {
    await this.files.mkdir(this.worldDir);
    await this.files.write(`${this.worldDir}/${name}`, encodeJson(value));
  }
}
