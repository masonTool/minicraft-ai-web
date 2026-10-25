/**
 * 方块表**增量**（批次 20261025-1032）
 *
 * 为什么要这个东西：方块表被固化进 APK 之后，改一条属性、加一个方块都要重新发版——
 * 这跟"工程要能持续迭代"直接冲突。增量让**绝大多数方块改动不需要发版**：
 *
 *   APK 里    core.bin        打包当时的**全量快照**（不公开）
 *   线上      core-delta.json 只有变化的部分（几条 / 几百字节）
 *   启动时    装快照 → 应用增量 → 得到最新表
 *
 * 为什么不是"APK 只放基础方块、其余放线上"：id 必须从 0 连续，只能按前缀切；
 * 而按前缀切会把**最值钱的那批**（各种变体的硬度/光照/形状）公开挂在网上，
 * 保密反而变差。放全量快照 + 小增量，保密面最小、可迭代面最大。
 *
 * ---------------------------------------------------------------------------
 * 两条**必须**守住的纪律
 *
 * 1. **id 只能往末尾追加**。基线里已有方块的 id 一旦变动，老 App 解出来的地图里
 *    每一个方块都会错位（存档里存的是数字 id）。所以 patch 只能改属性、不能改 id，
 *    appends 只能接在末尾。
 * 2. **增量必须能安全失败**。文件缺失 / JSON 坏 / 基线对不上 → 一律**忽略增量照常启动**，
 *    绝不能让"一个几百字节的文件"把整个游戏挡在门外。
 * ---------------------------------------------------------------------------
 */

import type { BlockDef } from './blocks.ts';
import type { BlockShape } from './blockState.ts';

/** 增量格式版本。**加字段就要 +1**，老 App 见到不认识的版本会忽略整个增量。 */
export const CORE_DELTA_VERSION = 1;

/** 可以被 patch 覆盖的数据字段（刻意不含 `id` / `name`：改了会错位或撞名） */
export interface CoreDeltaFields {
  readonly tiles?: readonly [string, string, string];
  readonly shape?: BlockShape;
  readonly solid?: boolean;
  readonly opaque?: boolean;
  readonly suffocates?: boolean;
  readonly liquid?: boolean;
  readonly translucent?: boolean;
  readonly light?: number;
  readonly lightOpacity?: number;
  readonly facesPlayer?: boolean;
  readonly facesSneak?: boolean;
  readonly facesNormal?: boolean;
  readonly itemless?: boolean;
  readonly waterPlant?: boolean;
}

export interface CoreDeltaPatch {
  readonly name: string;
  readonly set: CoreDeltaFields;
}

export interface CoreDeltaAppend extends CoreDeltaFields {
  readonly name: string;
}

export interface CoreDelta {
  readonly version: number;
  /** 应用前基线应有多少个方块（防"拿新基线算的增量套在旧基线上"） */
  readonly baseCount: number;
  /** 基线名字表的指纹（防"数量一样但内容不同的基线"） */
  readonly baseFingerprint: string;
  readonly patches: readonly CoreDeltaPatch[];
  readonly appends: readonly CoreDeltaAppend[];
}

/** 能参与 patch / append 的字段名白名单 */
const FIELD_KEYS = [
  'tiles',
  'shape',
  'solid',
  'opaque',
  'suffocates',
  'liquid',
  'translucent',
  'light',
  'lightOpacity',
  'facesPlayer',
  'facesSneak',
  'facesNormal',
  'itemless',
  'waterPlant',
] as const satisfies readonly (keyof CoreDeltaFields)[];

/**
 * 名字表指纹（FNV-1a 32 位）。
 *
 * 用**同步**的简单散列而不是 `crypto.subtle`（异步）：启动路径上一个 await 都不多要，
 * 而且这里要防的只是"基线内容不同但数量相同"这种失误，不是攻击。
 */
export function fingerprint(blocks: readonly BlockDef[]): string {
  let hash = 0x811c9dc5;
  for (const block of blocks) {
    for (let i = 0; i < block.name.length; i++) {
      hash ^= block.name.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    // 分隔符：避免 ['ab','c'] 与 ['a','bc'] 撞在一起
    hash ^= 0x0a;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function readFields(raw: Record<string, unknown>, where: string, extraKeys: readonly string[] = []): CoreDeltaFields {
  // 认不出的字段直接报错，而不是忽略：增量是**跨版本**的（线上文件可能比 App 新），
  // 悄悄跳过会在"新版本改了语义"时变成静默错方块
  const allowed = new Set<string>([...FIELD_KEYS, ...extraKeys]);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) throw new Error(`${where}: 不认识的字段 ${key}`);
  }
  const out: Record<string, unknown> = {};
  for (const key of FIELD_KEYS) {
    const value = raw[key];
    if (value === undefined) continue;
    if (key === 'tiles') {
      if (!Array.isArray(value) || value.length !== 3 || value.some((t) => typeof t !== 'string')) {
        throw new Error(`${where}: tiles 必须是 3 个字符串`);
      }
      out[key] = value;
    } else if (key === 'light' || key === 'lightOpacity') {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 15) {
        throw new Error(`${where}: ${key} 必须是 0~15 的整数（读到 ${String(value)}）`);
      }
      out[key] = value;
    } else if (key === 'shape') {
      if (typeof value !== 'string' || value.length === 0) throw new Error(`${where}: shape 必须是非空字符串`);
      out[key] = value;
    } else if (typeof value !== 'boolean') {
      throw new Error(`${where}: ${key} 必须是布尔值（读到 ${String(value)}）`);
    } else {
      out[key] = value;
    }
  }
  if (Object.keys(out).length === 0) throw new Error(`${where}: 没有任何可应用的字段`);
  return out as CoreDeltaFields;
}

/**
 * 校验并解析增量文件。
 *
 * 严格到"多一个不认识的字段就报错"的程度：增量是**跨版本**存在的（线上文件可能比 App 新），
 * 悄悄忽略不认识的字段会在"新版本改了语义"时变成静默错方块。宁可整体忽略。
 */
export function parseCoreDelta(raw: unknown): CoreDelta {
  if (typeof raw !== 'object' || raw === null) throw new Error('增量不是对象');
  const data = raw as Record<string, unknown>;
  if (data.version !== CORE_DELTA_VERSION) {
    throw new Error(`增量版本不支持：文件 v${String(data.version)}，本 App 只认 v${CORE_DELTA_VERSION}`);
  }
  if (typeof data.baseCount !== 'number' || !Number.isInteger(data.baseCount)) {
    throw new Error('baseCount 缺失或不是整数');
  }
  if (typeof data.baseFingerprint !== 'string' || data.baseFingerprint.length === 0) {
    throw new Error('baseFingerprint 缺失');
  }
  const patchesRaw = data.patches;
  const appendsRaw = data.appends;
  if (!Array.isArray(patchesRaw) || !Array.isArray(appendsRaw)) throw new Error('patches / appends 必须是数组');

  const patches: CoreDeltaPatch[] = patchesRaw.map((item, index) => {
    const entry = item as Record<string, unknown>;
    const name = entry.name;
    if (typeof name !== 'string' || name.length === 0) throw new Error(`patches[${index}]: name 缺失`);
    const set = entry.set;
    if (typeof set !== 'object' || set === null) throw new Error(`patches[${index}]: set 缺失`);
    return { name, set: readFields(set as Record<string, unknown>, `patches[${index}]`) };
  });

  const appends: CoreDeltaAppend[] = appendsRaw.map((item, index) => {
    const entry = item as Record<string, unknown>;
    const name = entry.name;
    if (typeof name !== 'string' || name.length === 0) throw new Error(`appends[${index}]: name 缺失`);
    return { name, ...readFields(entry, `appends[${index}]`, ['name']) };
  });

  return {
    version: CORE_DELTA_VERSION,
    baseCount: data.baseCount,
    baseFingerprint: data.baseFingerprint,
    patches,
    appends,
  };
}

/**
 * 把增量应用到基线上，返回**新表**（不改入参）。
 *
 * 任何不一致都直接抛：调用方（`hostCore`）会 catch 掉并保持旧表——"少几个新方块"
 * 远好于"表错位、满世界变成别的方块"。
 */
export function applyCoreDelta(base: readonly BlockDef[], delta: CoreDelta): readonly BlockDef[] {
  if (base.length !== delta.baseCount) {
    throw new Error(`增量对不上基线：增量要求 ${delta.baseCount} 个方块，当前 ${base.length} 个`);
  }
  const actual = fingerprint(base);
  if (actual !== delta.baseFingerprint) {
    throw new Error(`增量对不上基线：指纹 ${delta.baseFingerprint} ≠ ${actual}`);
  }

  const table = base.slice();
  const indexByName = new Map<string, number>();
  for (let id = 0; id < table.length; id++) indexByName.set(table[id]!.name, id);

  for (const patch of delta.patches) {
    const id = indexByName.get(patch.name);
    if (id === undefined) throw new Error(`增量要改的方块不存在：${patch.name}`);
    table[id] = { ...table[id]!, ...patch.set };
  }

  for (const append of delta.appends) {
    if (indexByName.has(append.name)) throw new Error(`增量要新增的方块已存在：${append.name}`);
    const id = table.length;
    table.push({
      id,
      name: append.name,
      tiles: append.tiles ?? ['stone', 'stone', 'stone'],
      solid: append.solid ?? true,
      opaque: append.opaque ?? true,
      // 与 `buildBlockTable()` 的默认值保持一致：不填就跟 opaque 走
      suffocates: append.suffocates ?? (append.opaque ?? true),
      light: append.light ?? 0,
      lightOpacity: append.lightOpacity ?? ((append.opaque ?? true) ? 15 : 0),
      liquid: append.liquid ?? false,
      translucent: append.translucent ?? false,
      shape: append.shape ?? 'cube',
      facesPlayer: append.facesPlayer ?? false,
      facesSneak: append.facesSneak ?? false,
      facesNormal: append.facesNormal ?? false,
      itemless: append.itemless ?? false,
      waterPlant: append.waterPlant ?? false,
    });
    indexByName.set(append.name, id);
  }

  return table;
}

/**
 * 由"旧基线"和"新表"算出增量（构建工具用）。
 *
 * 只支持**改属性**与**末尾追加**：
 *  - 旧有新无 → 抛（删方块会让存档里的 id 全部错位，必须发版处理）；
 *  - 名字相同但字段不同 → patch；
 *  - 新名字 → append（顺序即 id 顺序）。
 */
export function buildDelta(base: readonly BlockDef[], next: readonly BlockDef[]): CoreDelta {
  const patches: CoreDeltaPatch[] = [];
  const baseByName = new Map<string, BlockDef>();
  for (const block of base) baseByName.set(block.name, block);

  const nextByName = new Set(next.map((block) => block.name));
  const removed = base.filter((block) => !nextByName.has(block.name)).map((block) => block.name);
  if (removed.length > 0) {
    throw new Error(`不支持删除方块（会让存档 id 错位）：${removed.slice(0, 5).join(', ')}${removed.length > 5 ? ' …' : ''}`);
  }

  for (const block of next) {
    const old = baseByName.get(block.name);
    if (old === undefined) continue; // 新增，下面统一处理
    const set: Record<string, unknown> = {};
    for (const key of FIELD_KEYS) {
      const before = old[key];
      const after = block[key];
      if (key === 'tiles') {
        const b = before as readonly string[];
        const a = after as readonly string[];
        if (b[0] !== a[0] || b[1] !== a[1] || b[2] !== a[2]) set[key] = a;
      } else if (before !== after) {
        set[key] = after;
      }
    }
    if (Object.keys(set).length > 0) patches.push({ name: block.name, set: set as CoreDeltaFields });
  }

  const appends: CoreDeltaAppend[] = [];
  for (const block of next) {
    if (baseByName.has(block.name)) continue;
    const entry: Record<string, unknown> = { name: block.name };
    for (const key of FIELD_KEYS) {
      const value = block[key];
      if (value === undefined) continue;
      // `tiles` 是元组，JSON 里就是数组
      entry[key] = value;
    }
    appends.push(entry as unknown as CoreDeltaAppend);
  }

  return {
    version: CORE_DELTA_VERSION,
    baseCount: base.length,
    baseFingerprint: fingerprint(base),
    patches,
    appends,
  };
}

/** 增量是否什么都没改（构建工具据此决定要不要产出文件） */
export function isEmptyDelta(delta: CoreDelta): boolean {
  return delta.patches.length === 0 && delta.appends.length === 0;
}
