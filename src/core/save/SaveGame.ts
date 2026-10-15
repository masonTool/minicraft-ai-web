/**
 * 存档（K1）：IndexedDB 持久化
 *
 * 存三样东西：
 *   1. **meta**：世界种子、存档版本、创建时间、最后游玩时间——启动时先读它，
 *      种子不一致就说明"这是一个新世界"，不能把旧存档的改动叠到新地形上
 *   2. **player**：位置、朝向、维度、时间、生命/饥饿/氧气、背包与选中槽
 *   3. **chunks**：**只存玩家改过的格子**（增量，见 `ChunkEdits.ts`），
 *      键是 `维度|cx,cz`，值是两条 Uint32Array 的 buffer（下标 + 打包后的 id/状态）
 *
 * 为什么用 IndexedDB 而不是 localStorage：
 *   localStorage 只能存字符串且容量约 5MB，把二进制转 base64 还会再胖 33%；
 *   IndexedDB 直接存 ArrayBuffer，容量按磁盘配额，也支持异步事务不卡主线程。
 *
 * 该模块不依赖渲染层，浏览器之外（离线测试）可以注入一个假的 indexedDB。
 */

import { ChunkEdits, type SerializedEdits } from './ChunkEdits.ts';
import { LEGACY_WORLD_ID, dbNameFor } from './WorldRegistry.ts';

const DB_VERSION = 1;
const STORE_META = 'meta';
const STORE_PLAYER = 'player';
const STORE_CHUNKS = 'chunks';

/** 存档结构版本：改了字段含义就要 +1，并在加载时做迁移或丢弃 */
export const SAVE_VERSION = 1;

export interface SaveMeta {
  seed: number;
  version: number;
  createdAt: number;
  lastPlayed: number;
  /** 累计游玩秒数（统计用） */
  playTime: number;
  /** 玩家修改过的格子总数（展示用） */
  edits: number;
}

export interface PlayerSave {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  dimension: string;
  flying: boolean;
  timeOfDay: number;
  health: number;
  food: number;
  saturation: number;
  air: number;
  exhaustion: number;
  /** 41 个背包槽（含盔甲与副手）；空槽为 null。`damage` 只有工具/盔甲会带 */
  inventory: Array<{ id: number; count: number; damage?: number } | null>;
  selectedSlot: number;
  /** 末影龙是否已被击败（决定重进末地要不要重新生成 boss） */
  dragonDefeated: boolean;
  /** 难度（I7）；旧存档没有时回退普通 */
  difficulty?: string;
  /** 游戏规则（I11）；旧存档没有时回退默认 */
  gameRules?: Record<string, boolean | number>;
  /** 状态效果（I4）：剩余时长接着走 */
  effects?: Array<{ id: string; amplifier: number; ticks: number; ambient: boolean }>;
}

/** 一个区块的存档记录 */
export interface ChunkSaveRecord {
  dimension: string;
  cx: number;
  cz: number;
  edits: SerializedEdits;
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 请求失败'));
  });
}

export class SaveGame {
  /** 最近一次读到的 meta（没有存档时为 null） */
  meta: SaveMeta | null = null;
  /** 本次会话累计游玩秒数 */
  private sessionSeconds = 0;
  /** 是否已经写过一次（用于决定"新建存档"还是"更新"） */
  private created = false;

  /** 删除某个世界的整个存档库（删世界用） */
  static async deleteWorld(
    worldId: string,
    factory: IDBFactory | undefined = globalThis.indexedDB,
  ): Promise<void> {
    if (!factory) return;
    await new Promise<void>((resolve) => {
      const request = factory.deleteDatabase(dbNameFor(worldId));
      // 删除失败（被其它标签页占用等）不该卡住界面：无论是成功还是出错都继续
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  }

  private constructor(
    private readonly db: IDBDatabase,
    /** 这个存档属于哪个世界 */
    readonly worldId: string = LEGACY_WORLD_ID,
  ) {}

  /**
   * 打开（或创建）某个世界的存档库。
   *
   * **一个世界一个库**（库名见 `dbNameFor`）：删世界就是删库，不会误伤别的世界；
   * 而且从单存档版本升级时，`main` 直接沿用旧库名，一个字节都不用搬。
   *
   * @param worldId 世界 id（默认旧版的单存档库）
   * @returns 失败时返回 null —— 存档不可用不该让游戏打不开（无痕模式、配额满等）
   */
  static async open(
    worldId: string = LEGACY_WORLD_ID,
    factory: IDBFactory | undefined = globalThis.indexedDB,
  ): Promise<SaveGame | null> {
    if (!factory) return null;
    const dbName = dbNameFor(worldId);
    try {
      const request = factory.open(dbName, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META);
        if (!db.objectStoreNames.contains(STORE_PLAYER)) db.createObjectStore(STORE_PLAYER);
        if (!db.objectStoreNames.contains(STORE_CHUNKS)) db.createObjectStore(STORE_CHUNKS);
      };
      const db = await promisify(request);
      const save = new SaveGame(db, worldId);
      save.meta = await save.readMeta();
      // 结构版本不一致：旧存档的字段含义可能已经变了，直接当作没有存档
      if (save.meta && save.meta.version !== SAVE_VERSION) {
        console.warn(`[save] 存档版本 ${save.meta.version} 与当前 ${SAVE_VERSION} 不一致，按新世界处理`);
        save.meta = null;
      }
      return save;
    } catch (error) {
      console.warn('[save] 无法打开存档库，本次游玩不会保存', error);
      return null;
    }
  }

  private async transaction<T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => Promise<T> | T): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const tx = this.db.transaction(store, mode);
      const objectStore = tx.objectStore(store);
      let result: T;
      Promise.resolve(run(objectStore)).then(
        (value) => {
          result = value;
        },
        (error) => {
          reject(error);
          tx.abort();
        },
      );
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 事务失败'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 事务被中止'));
    });
  }

  private readMeta(): Promise<SaveMeta | null> {
    return this.transaction(STORE_META, 'readonly', (store) => promisify(store.get('meta') as IDBRequest<SaveMeta | undefined>)).then(
      (value) => value ?? null,
    );
  }

  /** 该存档是否与给定种子匹配（不匹配就不能叠加旧的区块改动） */
  matchesSeed(seed: number): boolean {
    return this.meta === null || this.meta.seed === seed;
  }

  get hasSave(): boolean {
    return this.meta !== null;
  }

  async loadPlayer(): Promise<PlayerSave | null> {
    const value = await this.transaction(STORE_PLAYER, 'readonly', (store) =>
      promisify(store.get('player') as IDBRequest<PlayerSave | undefined>),
    );
    return value ?? null;
  }

  /** 读某个区块的增量改动 */
  async loadChunkEdits(dimension: string, cx: number, cz: number): Promise<SerializedEdits | null> {
    const key = `${dimension}|${cx},${cz}`;
    const value = await this.transaction(STORE_CHUNKS, 'readonly', (store) =>
      promisify(store.get(key) as IDBRequest<{ indices: ArrayBuffer; packed: ArrayBuffer } | undefined>),
    );
    if (!value) return null;
    return {
      indices: new Uint32Array(value.indices),
      packed: new Uint32Array(value.packed),
    };
  }

  /**
   * 一次性读出存档里的**全部**区块增量。
   *
   * 为什么不做"按区块懒加载"：区块是流式生成的，懒加载意味着生成完一个区块后
   * 还要异步等一次 IndexedDB 才能知道它有没有被改过——这期间玩家会看到"未修改的世界"，
   * 之后的修正还要重新算光照与网格，很容易闪一下。
   * 而增量本身很小（一次玩法通常几十 KB），启动时读完再开始生成最省心。
   */
  async loadAllChunkEdits(): Promise<ChunkSaveRecord[]> {
    const keys = await this.transaction(STORE_CHUNKS, 'readonly', (store) =>
      promisify(store.getAllKeys() as IDBRequest<IDBValidKey[]>),
    );
    if (keys.length === 0) return [];
    const values = await this.transaction(STORE_CHUNKS, 'readonly', (store) =>
      promisify(store.getAll() as IDBRequest<Array<{ indices: ArrayBuffer; packed: ArrayBuffer }>>),
    );

    const records: ChunkSaveRecord[] = [];
    for (let i = 0; i < keys.length; i++) {
      const value = values[i];
      if (!value) continue;
      const { dimension, cx, cz } = ChunkEdits.parseKey(String(keys[i]));
      records.push({
        dimension,
        cx,
        cz,
        edits: { indices: new Uint32Array(value.indices), packed: new Uint32Array(value.packed) },
      });
    }
    return records;
  }

  /** 把玩家改过的所有区块一次性写进存档 */
  async saveChunks(records: ChunkSaveRecord[]): Promise<void> {
    if (records.length === 0) return;
    await this.transaction(STORE_CHUNKS, 'readwrite', (store) => {
      for (const record of records) {
        const key = `${record.dimension}|${record.cx},${record.cz}`;
        store.put(
          {
            // 直接存 buffer：IndexedDB 支持结构化克隆，不需要转 base64
            indices: record.edits.indices.buffer,
            packed: record.edits.packed.buffer,
            savedAt: Date.now(),
          },
          key,
        );
      }
    });
  }

  async savePlayer(player: PlayerSave): Promise<void> {
    await this.transaction(STORE_PLAYER, 'readwrite', (store) => {
      store.put(player, 'player');
    });
  }

  async saveMeta(meta: SaveMeta): Promise<void> {
    this.meta = meta;
    this.created = true;
    await this.transaction(STORE_META, 'readwrite', (store) => {
      store.put(meta, 'meta');
    });
  }

  /** 累加本次会话的游玩时间（保存时一并写入） */
  addPlayTime(seconds: number): void {
    this.sessionSeconds += seconds;
  }

  /**
   * 组装当前的 meta：首次保存时写 createdAt，之后只更新 lastPlayed / playTime / edits。
   */
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

  /** 保存完之后调用：把本次会话时长清零，避免重复累加 */
  resetSessionTime(): void {
    this.sessionSeconds = 0;
  }

  get isNewSave(): boolean {
    return !this.created && this.meta === null;
  }

  /** 删除整个存档（调试接口与"新世界"按钮用） */
  async clear(): Promise<void> {
    await this.transaction(STORE_CHUNKS, 'readwrite', (store) => store.clear());
    await this.transaction(STORE_PLAYER, 'readwrite', (store) => store.clear());
    await this.transaction(STORE_META, 'readwrite', (store) => store.clear());
    this.meta = null;
  }

  close(): void {
    this.db.close();
  }

  /** 调试/验收用：存档占用的大致字节数 */
  async estimateSize(): Promise<number> {
    const stats = await this.transaction(STORE_CHUNKS, 'readonly', (store) =>
      promisify(store.count() as IDBRequest<number>),
    );
    return stats;
  }

  /** 调试/验收用：所有已保存的区块键 */
  async listChunkKeys(): Promise<string[]> {
    return this.transaction(STORE_CHUNKS, 'readonly', (store) =>
      promisify(store.getAllKeys() as IDBRequest<IDBValidKey[]>),
    ).then((keys) => keys.map(String));
  }
}
