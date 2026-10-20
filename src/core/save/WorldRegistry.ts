/**
 * 世界列表（多存档）
 *
 * 原版是"一个世界一个存档槽"，这里把**存档数据**与**世界清单**分开：
 *
 *  - 存档数据仍然在 IndexedDB 里，但**一个世界一个库**（`dbNameFor`），
 *    删世界就是删库，不会误伤别的世界；
 *  - 清单（名字、种子、世界类型、游玩时长…）只有几百字节，放 localStorage 最省事，
 *    主菜单要同步读它来画列表，IndexedDB 是异步的，用它反而要多一层加载态。
 *
 * 清单与存档可能不一致（例如清了浏览器数据只留下一半）：
 *  - 清单里有、库里没有 → 仍然列出来，进去就是新世界（种子照清单里的用）；
 *  - 库里有、清单里没有 → 启动时用 `adopt` 认领（尤其是从单存档版本升级上来的那次）。
 *
 * 该模块不依赖渲染层，Node 里可以直接测（不传 storage 就退化成内存清单）。
 */

import { isWorldType, randomSeed, type WorldType } from '../gen/WorldType.ts';
import { normalizeDifficulty, type Difficulty } from '../world/Rules.ts';
import { normalizeGameMode, type GameMode } from '../world/GameMode.ts';
import { biomeByName } from '../gen/Biome.ts';

export interface WorldSummary {
  id: string;
  name: string;
  seed: number;
  worldType: WorldType;
  /** 创建时间（毫秒时间戳） */
  createdAt: number;
  /** 上次游玩时间（毫秒时间戳） */
  lastPlayed: number;
  /** 累计游玩秒数 */
  playTime: number;
  /** 玩家改过的方块数（展示用） */
  edits: number;
  /** 难度（I7）：新建时可选，之后在游戏里改也会回写到这里 */
  difficulty: Difficulty;
  /**
   * 游戏模式（批次 181）：新建时可选，暂停菜单里改了也会回写。
   * 老清单没有这个字段 → 生存。
   */
  gameMode: GameMode;
  /**
   * 极限模式（批次 550）：难度锁定困难、死亡后只能旁观。
   * 老清单没有这个字段 → 普通世界。
   */
  hardcore?: boolean;
  /** 单一群系世界的群系注册名（其它类型为 undefined） */
  singleBiome?: string;
}

const STORAGE_KEY = 'bedrock-worlds';

/**
 * 单存档版本用的库名与 id。
 * 升级到多世界时**直接把这个库当成第一个世界**，不做数据搬运（搬 20MB 的增量改动很容易出事）。
 */
export const LEGACY_WORLD_ID = 'main';
const LEGACY_DB_NAME = 'bedrock-118-web';

/** 世界 id → IndexedDB 库名 */
export function dbNameFor(worldId: string): string {
  return worldId === LEGACY_WORLD_ID ? LEGACY_DB_NAME : `${LEGACY_DB_NAME}:${worldId}`;
}

export interface CreateWorldOptions {
  name?: string;
  seed?: number;
  worldType?: WorldType;
  difficulty?: Difficulty;
  gameMode?: GameMode;
  /** 极限模式：强制困难难度 + 生存模式 */
  hardcore?: boolean;
  /** 单一群系世界的群系注册名 */
  singleBiome?: string;
  /** 指定 id（认领旧存档时用） */
  id?: string;
}

export class WorldRegistry {
  private worlds: WorldSummary[] = [];
  private storage: Storage | null;

  constructor(storage: Storage | null = safeStorage()) {
    this.storage = storage;
    this.worlds = this.read();
  }

  /** 按最近游玩倒序排列的世界列表（主菜单直接用） */
  list(): readonly WorldSummary[] {
    return [...this.worlds].sort((a, b) => b.lastPlayed - a.lastPlayed);
  }

  get count(): number {
    return this.worlds.length;
  }

  get(id: string): WorldSummary | undefined {
    return this.worlds.find((world) => world.id === id);
  }

  /** 新建一个世界（默认随机种子 + 默认地形），返回它的清单项 */
  create(options: CreateWorldOptions = {}): WorldSummary {
    const now = Date.now();
    const hardcore = options.hardcore === true;
    const world: WorldSummary = {
      id: options.id ?? uniqueId(this.worlds, now),
      name: options.name?.trim() || defaultName(this.worlds, options.worldType ?? 'default'),
      seed: options.seed ?? randomSeed(),
      // 批次 529：三种创建参数一律在这里收口，非 UI 调用传脏值也不会写进清单
      worldType: isWorldType(options.worldType) ? options.worldType : 'default',
      // 批次 529：与 gameMode 同口径——非法值落到普通，而不是先写进清单等读盘才修
      // 批次 550：极限模式强制困难 + 生存（原版极限模式也不能选难度/创造）
      difficulty: hardcore ? 'hard' : normalizeDifficulty(options.difficulty),
      gameMode: hardcore ? 'survival' : normalizeGameMode(options.gameMode),
      ...(hardcore ? { hardcore: true } : {}),
      // 单一群系：只在这个类型下保留，且必须是注册表里存在的群系名
      ...(options.worldType === 'single_biome' && biomeByName(options.singleBiome ?? '')
        ? { singleBiome: options.singleBiome }
        : {}),
      createdAt: now,
      lastPlayed: now,
      playTime: 0,
      edits: 0,
    };
    this.worlds.push(world);
    this.persist();
    return world;
  }

  /**
   * 认领一个"清单里没有但库里存在"的存档。
   * 用在两处：从单存档版本升级（库名就是旧库），以及清单被清掉之后的自愈。
   */
  adopt(
    id: string,
    seed: number,
    options: {
      name?: string;
      worldType?: WorldType;
      edits?: number;
      difficulty?: Difficulty;
      gameMode?: GameMode;
      singleBiome?: string;
    } = {},
  ): WorldSummary {
    const existing = this.get(id);
    if (existing) return existing;
    return this.create({
      id,
      name: options.name,
      seed,
      // 批次 529：三种创建参数一律在这里收口，非 UI 调用传脏值也不会写进清单
      worldType: isWorldType(options.worldType) ? options.worldType : 'default',
      difficulty: options.difficulty,
      gameMode: options.gameMode,
      singleBiome: options.singleBiome,
      // 认领时不重置游玩时长：存档里已经有 meta 了，后面 update 会同步回来
    });
  }

  /** 用存档里的 meta 回写清单（保存、退出、进入时都调一次） */
  update(id: string, patch: Partial<Omit<WorldSummary, 'id'>>): void {
    const world = this.get(id);
    if (!world) return;
    Object.assign(world, patch);
    this.persist();
  }

  remove(id: string): void {
    const index = this.worlds.findIndex((world) => world.id === id);
    if (index < 0) return;
    this.worlds.splice(index, 1);
    this.persist();
  }

  /** 重命名 */
  rename(id: string, name: string): void {
    this.update(id, { name: name.trim() || '未命名世界' });
  }

  private read(): WorldSummary[] {
    if (!this.storage) return [];
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.map(normalizeWorld).filter((world): world is WorldSummary => world !== null);
    } catch {
      // 清单损坏就当没有：宁可让玩家新建一个世界，也不要因为读不出 JSON 打不开游戏
      return [];
    }
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(this.worlds));
    } catch {
      // 无痕模式写不进去：清单只在本次会话有效，游戏照常可玩
    }
  }
}

/** 逐字段校验：清单是玩家可改的字符串，任何一个字段坏了都不该让整个列表崩掉 */
function normalizeWorld(value: unknown): WorldSummary | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Partial<WorldSummary>;
  if (typeof raw.id !== 'string' || raw.id.length === 0) return null;
  const createdAt = typeof raw.createdAt === 'number' ? raw.createdAt : Date.now();
  const hardcore = raw.hardcore === true;
  return {
    id: raw.id,
    name: typeof raw.name === 'string' && raw.name.length > 0 ? raw.name : '未命名世界',
    seed: typeof raw.seed === 'number' && Number.isFinite(raw.seed) ? Math.floor(raw.seed) : randomSeed(),
    // 极限模式（批次 550）：老清单/脏数据里如果困难或创造被改过，这里一律拉回困难 + 生存
    difficulty: hardcore ? 'hard' : normalizeDifficulty((raw as { difficulty?: unknown }).difficulty),
    gameMode: hardcore ? 'survival' : normalizeGameMode((raw as { gameMode?: unknown }).gameMode),
    ...(hardcore ? { hardcore: true } : {}),
    worldType: isWorldType(raw.worldType) ? raw.worldType : 'default',
    ...(isWorldType(raw.worldType) &&
    raw.worldType === 'single_biome' &&
    typeof (raw as { singleBiome?: unknown }).singleBiome === 'string' &&
    biomeByName((raw as { singleBiome: string }).singleBiome)
      ? { singleBiome: (raw as { singleBiome: string }).singleBiome }
      : {}),
    createdAt,
    lastPlayed: typeof raw.lastPlayed === 'number' ? raw.lastPlayed : createdAt,
    playTime: typeof raw.playTime === 'number' && raw.playTime >= 0 ? raw.playTime : 0,
    edits: typeof raw.edits === 'number' && raw.edits >= 0 ? raw.edits : 0,
  };
}

function uniqueId(worlds: readonly WorldSummary[], now: number): string {
  // 时间戳 36 进制 + 冲突时加后缀：可读、稳定、不依赖随机数
  const base = `w${now.toString(36)}`;
  let id = base;
  let index = 1;
  while (worlds.some((world) => world.id === id)) id = `${base}-${index++}`;
  return id;
}

/** 新世界的默认名字：按世界类型起名并编号（"新的世界 1""超平坦世界 2"） */
function defaultName(worlds: readonly WorldSummary[], worldType: WorldType): string {
  const prefix: Record<WorldType, string> = {
    default: '新的世界',
    flat: '超平坦世界',
    large_biomes: '大型群系世界',
    amplified: '放大化世界',
    single_biome: '单一群系世界',
  };
  const same = worlds.filter((world) => world.worldType === worldType).length + 1;
  return `${prefix[worldType]} ${same}`;
}

/** localStorage 在无痕模式/被禁用时会直接抛错，探测一次即可 */
function safeStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    localStorage.getItem(STORAGE_KEY);
    return localStorage;
  } catch {
    return null;
  }
}
