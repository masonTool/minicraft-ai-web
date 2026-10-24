/**
 * 存档（K1）：IndexedDB 持久化
 *
 * 存五样东西：
 *   1. **meta**：世界种子、存档版本、创建时间、最后游玩时间——启动时先读它，
 *      种子不一致就说明"这是一个新世界"，不能把旧存档的改动叠到新地形上
 *   2. **player**：位置、朝向、维度、时间、生命/饥饿/氧气、背包与选中槽
 *   3. **chunks**：**只存玩家改过的格子**（增量，见 `ChunkEdits.ts`），
 *      键是 `维度|cx,cz`，值是两条 Uint32Array 的 buffer（下标 + 打包后的 id/状态）
 *   4. **containers**：箱子/熔炉/附魔台/铁砧/酿造台的内容与运转状态
 *      （C7 尾巴补上的第四样——在这之前容器内容**关掉页面就没了**，
 *      序列化本身在 `ContainerSave.ts`）
 *   5. **signs**：告示牌上的文字（B12，批次 80；序列化在 `world/SignText.ts`）
 *   6. **frames**：物品展示框里挂着的东西（B14，批次 86；序列化在 `world/ItemFrame.ts`）
 *   7. **advancements**：成就/进度（M7，批次 87；序列化在 `progress/AdvancementTracker.ts`）
 *   8. **scoreboard**：记分板（M23，批次 456；序列化在 `world/Scoreboard.ts` 的 `snapshot`）
 *   9. **teams**：队伍（M23，批次 468；序列化在 `world/Teams.ts` 的 `snapshot`）
 *  10. **commandBlocks**：命令方块的内容（批次 477；序列化在 `world/CommandBlocks.ts`）
 *  11. **armorStands**：盔甲架上的装备（批次 492；序列化在 `world/ArmorStands.ts`）
 *  12. **paintings**：多格画的锚点（批次 495；序列化在 `world/Paintings.ts`）
 *
 * 仓库版本：现在 **10**（每加一个对象仓 +1，`onupgradeneeded` 会补建，老存档自动升级）。
 *
 * 为什么用 IndexedDB 而不是 localStorage：
 *   localStorage 只能存字符串且容量约 5MB，把二进制转 base64 还会再胖 33%；
 *   IndexedDB 直接存 ArrayBuffer，容量按磁盘配额，也支持异步事务不卡主线程。
 *
 * 该模块不依赖渲染层，浏览器之外（离线测试）可以注入一个假的 indexedDB。
 */

import { ChunkEdits, type SerializedEdits } from './ChunkEdits.ts';
import { resetSaveIssues } from './SaveIssues.ts';
import type { SerializedContainer } from './ContainerSave.ts';
import type { SerializedSign } from '../world/SignText.ts';
import type { SerializedFrame } from '../world/ItemFrame.ts';
import type { SerializedAdvancements } from '../progress/AdvancementTracker.ts';
import type { ScoreboardSnapshot } from '../world/Scoreboard.ts';
import type { TeamsSnapshot } from '../world/Teams.ts';
import type { SerializedCommandBlock } from '../world/CommandBlocks.ts';
import type { SerializedArmorStand } from '../world/ArmorStands.ts';
import type { SerializedPainting } from '../world/Paintings.ts';
import type { SavedVehicle } from '../entity/VehicleParking.ts';
import type { SavedEntityRecord } from '../entity/EntityParking.ts';
import type { StatisticsData } from '../survival/Statistics.ts';
import { LEGACY_WORLD_ID, dbNameFor } from './WorldRegistry.ts';
import type { StoreDump } from './SaveTransfer.ts';
import { SAVE_VERSION, migratePlayer } from './SaveMigrations.ts';
// 新手引导的进度（引导3）：序列化形状由 `TutorialTracker` 定义，存档只搬运
import type { SerializedTutorial } from '../../tutorial/TutorialTracker.ts';

/**
 * 存档结构版本（口径在 `SaveMigrations.ts`：每加一条迁移规则 +1）。
 * 这里是**转发**，好让老调用方继续 `import { SAVE_VERSION } from './SaveGame.ts'`。
 */
export { SAVE_VERSION };

/** IndexedDB 结构版本：加对象仓就要 +1（`onupgradeneeded` 里补建，旧库自动升级） */
const DB_VERSION = 11;
const STORE_META = 'meta';
import type { ItemStack } from '../container/Inventory.ts';
import type { GameMode } from '../world/GameMode.ts';

const STORE_PLAYER = 'player';
const STORE_CHUNKS = 'chunks';
const STORE_CONTAINERS = 'containers';
/**
 * 告示牌上的文字（B12，批次 80）——第 5 个对象仓。
 *
 * 为什么单开一个仓而不是塞进 containers：容器那一份是"方块物品栏"，
 * 而牌子装的是**几行文字**，两者的校验、脏数据容忍度、以后要加的字段都不一样
 * （混在一起以后想给箱子加个字段，就得连带把牌子那条读法也改一遍）。
 * 仓库版本从 2 升到 3：`onupgradeneeded` 会把缺的仓补建出来，老存档自动升级。
 */
const STORE_SIGNS = 'signs';
/**
 * 物品展示框里挂着的东西（B14，批次 86）——第 6 个对象仓。
 *
 * 与牌子上的字同一类"按坐标存的运行时数据"，也就照它单开一个仓：
 * 装的是**物品**而不是文字，校验规则（id 要能在物品表里查到、数量夹到 1~64、
 * 耐久/附魔/名字要原样带回来）与牌子的"四行文字"完全不是一回事。
 * 仓库版本从 3 升到 4，老存档自动补建。
 */
const STORE_FRAMES = 'frames';
/**
 * 成就 / 进度（M7，批次 87）——第 7 个对象仓。
 *
 * 内容只有"达成了哪些 id + 计数型进度集"，**整份覆盖写**（条数以十计，比按条写省心）；
 * 与容器/牌子不同的一点：它**不属于任何坐标**，是纯玩家状态——
 * 所以它跟着玩家走（以后做多人时"每个人的进度"也是这一份结构的扩展口）。
 * 仓库版本从 4 升到 5，老存档自动补建。
 */
const STORE_ADVANCEMENTS = 'advancements';
/**
 * 记分板（M23，批次 456）——第 8 个对象仓。
 *
 * 内容是一份 `ScoreboardSnapshot`（目标 + 分数 + 显示槽位），**整份覆盖写**：
 * 条数以十计，与成就进度同一档；它也不属于任何坐标，是纯世界状态。
 * 仓库版本从 5 升到 6，老存档自动补建（缺这一份时侧边栏就是空的，不会坏）。
 */
const STORE_SCOREBOARD = 'scoreboard';
/**
 * 队伍（M23，批次 468）——第 9 个对象仓。
 *
 * 与记分板同一层（纯世界状态、整份覆盖写）；单独开仓是因为两者的校验规则不同：
 * 队伍的成员是"一个人只能在一个队里"，记分板是"一个人可以有很多目标的分数"。
 * 仓库版本从 6 升到 7，老存档自动补建（缺这一份就是"没有队伍"）。
 */
const STORE_TEAMS = 'teams';
/**
 * 命令方块的内容（批次 477）——第 10 个对象仓。
 *
 * 与告示牌文字同一档：按坐标存的纯文本表，条数不多、整份覆盖写。
 * 仓库版本 7 → 8，老存档自动补建（缺这一份 = 所有命令方块都没命令）。
 */
const STORE_COMMAND_BLOCKS = 'commandBlocks';
/**
 * 盔甲架上的装备（批次 492，B51）——第 11 个对象仓。
 *
 * 与展示框同一档：按坐标存"四个槽各是什么"，条数不多、整份覆盖写。
 * 仓库版本 8 → 9，老存档自动补建（缺这一份 = 所有盔甲架都是空的）。
 */
const STORE_ARMOR_STANDS = 'armorStands';
/**
 * 多格拼贴的画（批次 495，B51）——第 12 个对象仓。
 *
 * 只存**锚点 + 名字 + 朝向**（每格能从"锚点 + 尺寸"重建），所以一条就是一幅画。
 * 仓库版本 9 → 10，老存档自动补建。
 */
const STORE_PAINTINGS = 'paintings';
/**
 * 新手引导（引导3，批次 20261022-1954）——第 13 个对象仓。
 *
 * 存两件事：**进度**（`state`，由 `TutorialTracker.serialize()` 生成）与
 * **玩家点过「不再提示」**。仓库版本 10 → 11，老存档自动补建。
 *
 * ⚠️ 缺这份数据 = 老存档：主程序据此**不弹引导**（老玩家不该被当成新手）。
 * 这不是"坏数据"，是合法状态，所以不能按 null 一律当新世界处理。
 */
export interface TutorialSave {
  state: SerializedTutorial;
  dismissed: boolean;
}
const STORE_TUTORIAL = 'tutorial';

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
  /**
   * 游戏模式（批次 181）。
   *
   * 老存档没有这个字段 → 迁移规则：`flying === true` 视为创造，否则生存
   *（见 `SaveMigrations` 的 v1→v2）。之后模式与飞行各存各的：创造模式也可以是走路的。
   */
  gameMode?: GameMode;
  timeOfDay: number;
  /**
   * 世界已经过了几天（批次 84，月相用）：从开服算起的**整天数**，第 0 天是满月。
   * 老存档没有这个字段 → 当成第 0 天（满月），不迁移、不改存档版本号。
   */
  dayCount?: number;
  /**
   * **连续多少天没睡**（批次 126，幻翼的依据）。睡着归零、每天日出 +1。
   *
   * 与 `dayCount` 一样：老存档没有这一项 → 当成 0 天（刚睡过，不会立刻招来幻翼），
   * 不迁移、不改存档版本号。
   */
  daysWithoutSleep?: number;
  /**
   * 天气（L6，批次 85）：`{ kind, seconds }` 两个数。
   *
   * ⚠️ 它放在**玩家存档**里其实有点别扭（天气是世界的属性，不是玩家的）——
   * 但难度与游戏规则当年也是这么放的（见上面那两条），所以这里跟着既有口径走：
   * **一处放世界状态，好过两处各放一半**。以后要挪进世界元数据时，
   * `restoreWeather` 已经能容忍"字段缺失"，迁移只要挪一行。
   */
  weather?: { kind: string; seconds: number };
  /**
   * 世界边界（K12，批次 175）：中心 + 边长。
   *
   * 与天气同一个理由放在玩家存档里（见上面那段的说明：**一处放世界状态，
   * 好过两处各放一半**）。老存档没有这个字段 → `normalizeBorder` 回退默认
   * （3 千万格 = 没有边界），不迁移、不改存档版本号。
   */
  border?: { centerX: number; centerZ: number; size: number };
  /**
   * 停放中的载具（批次 258，J2 第二刀）：船与三种矿车的「种类 + 坐标 + 朝向 + 维度」。
   *
   * 只存一份**纯数据**，不存实体引用：读档时按维度/区块把记录放回 `VehicleParking`，
   * 等那一块区块加载时再原样造回（与"区块卸载时登记"是同一条恢复路径）。
   * 老存档没有这个字段 → 当成"没有载具"，不迁移、不改存档版本号。
   */
  vehicles?: SavedVehicle[];
  /**
   * 生物与掉落物（批次 258；批次 445 补齐附加数据）：同样按「维度 + 坐标」存纯数据，
   * 区块加载时造回。
   *
   * 存：种类/坐标/血量/驯服/坐下/被牵/剪毛/羊毛色 + 幼体（含剩余成长秒数）+
   * 状态效果 + 掉落物的耐久/附魔/改名/潜影盒内容物。
   * ⚠️ 仍不存：繁殖与求爱计时、马鞍、羊驼的箱子。老存档缺这些字段 → 用默认值。
   */
  entities?: SavedEntityRecord[];
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
  /** 经验值与等级（I5）；旧存档没有时视为 0 级 */
  xp?: { level: number; progress: number; total: number; partial: number };
  /**
   * 末影箱（批次 71，B44）：**27 格，跟着玩家走**。
   *
   * 为什么放在玩家存档里而不是容器存档里：容器存档是**按坐标**存的
   * （`dimension | x,y,z`），而末影箱的内容**不属于任何一格方块**——
   * 世界里所有末影箱打开的都是同一份。原版也是"每个玩家一份"，
   * 所以玩家存档正好是那条"非坐标"的通道，不需要给存档加新的 store。
   * 旧存档没有这个字段 → 空箱子（与 `xp` / `effects` 同一条处理）。
   */
  enderChest?: (ItemStack | null)[];
  /**
   * 睡出来的重生点（B13 / I13，批次 79）：床脚那一格的坐标 + 它所在的维度。
   *
   * 与"世界出生点"分开存：床没了（被拆/被爆）之后死亡应当回退到世界出生点，
   * 而**是不是还在**这件事要等世界加载出来才知道（`main` 在重生那一刻校验）。
   * 旧存档没有这个字段 → 没有床重生点，与 `xp` / `effects` 同一条处理。
   */
  bedSpawn?: { x: number; y: number; z: number; dimension: string };
  /** 世界统计（批次 552）：挖/放/击杀/死亡/距离/游玩秒数；旧存档按全 0 处理 */
  statistics?: StatisticsData;
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
   * 导出**全部对象仓**（批次 591，L2）。
   *
   * 不逐个调用 `loadXxx()`：那些方法把值转成了运行时类型（Uint32Array 等），
   * 再写回去还要反推原始结构；这里按 store 原样导出，导入时原样放回，
   * 新增对象仓也不必回来改这份代码。
   */
  async exportStores(): Promise<StoreDump> {
    const dump: StoreDump = {};
    for (const name of Array.from(this.db.objectStoreNames)) {
      const [keys, values] = await this.transaction(name, 'readonly', (store) =>
        Promise.all([
          promisify(store.getAllKeys() as IDBRequest<IDBValidKey[]>),
          promisify(store.getAll() as IDBRequest<unknown[]>),
        ]),
      );
      dump[name] = keys.map((key, index) => ({
        // 本项目的键全是字符串（区块是 `dimension|cx,cz`），但类型上保留数字
        key: key as string | number,
        value: values[index],
      }));
    }
    return dump;
  }

  /**
   * 把导出的对象仓写回**当前世界**（批次 591）。
   *
   * 只清空/写入两边都认识的 store：导入文件来自旧版本时少了新对象仓，
   * 新版本里多出来的仓保持为空，而不是把整个导入判失败。
   */
  async importStores(dump: StoreDump): Promise<void> {
    for (const [name, entries] of Object.entries(dump)) {
      if (!this.db.objectStoreNames.contains(name)) continue;
      await this.transaction(name, 'readwrite', (store) => {
        store.clear();
        for (const entry of entries) {
          try {
            store.put(entry.value, entry.key as IDBValidKey);
          } catch {
            // 单条坏数据跳过：导入一张被手改过的文件，不该让整个流程失败
          }
        }
      });
    }
  }

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
    // 批次 20261025-0117（合规 5）：开一个世界就把"读档丢东西"的账清零——
    // 否则上一个世界的问题会挂在新世界头上，导出日志的人会以为这个档也坏了。
    resetSaveIssues();
    const dbName = dbNameFor(worldId);
    try {
      const request = factory.open(dbName, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META);
        if (!db.objectStoreNames.contains(STORE_PLAYER)) db.createObjectStore(STORE_PLAYER);
        if (!db.objectStoreNames.contains(STORE_CHUNKS)) db.createObjectStore(STORE_CHUNKS);
        if (!db.objectStoreNames.contains(STORE_CONTAINERS)) db.createObjectStore(STORE_CONTAINERS);
        if (!db.objectStoreNames.contains(STORE_SIGNS)) db.createObjectStore(STORE_SIGNS);
        if (!db.objectStoreNames.contains(STORE_FRAMES)) db.createObjectStore(STORE_FRAMES);
        if (!db.objectStoreNames.contains(STORE_ADVANCEMENTS)) db.createObjectStore(STORE_ADVANCEMENTS);
        if (!db.objectStoreNames.contains(STORE_SCOREBOARD)) db.createObjectStore(STORE_SCOREBOARD);
        if (!db.objectStoreNames.contains(STORE_TEAMS)) db.createObjectStore(STORE_TEAMS);
        if (!db.objectStoreNames.contains(STORE_COMMAND_BLOCKS)) db.createObjectStore(STORE_COMMAND_BLOCKS);
        if (!db.objectStoreNames.contains(STORE_ARMOR_STANDS)) db.createObjectStore(STORE_ARMOR_STANDS);
        if (!db.objectStoreNames.contains(STORE_PAINTINGS)) db.createObjectStore(STORE_PAINTINGS);
        if (!db.objectStoreNames.contains(STORE_TUTORIAL)) db.createObjectStore(STORE_TUTORIAL);
      };
      const db = await promisify(request);
      const save = new SaveGame(db, worldId);
      save.meta = await save.readMeta();
      // 结构版本（C8 / 批次 193）：
      //  - **比程序新** → 按新世界处理。玩家在别的设备上玩过新版本时，硬读一半字段
      //    再写回去会把存档写坏，这比"这个存档暂时读不了"糟得多；
      //  - **比程序旧** → 保留 meta，读玩家数据时按 `SaveMigrations` 的链逐级升上来。
      if (save.meta && save.meta.version > SAVE_VERSION) {
        console.warn(
          `[save] 存档版本 ${save.meta.version} 比当前程序（${SAVE_VERSION}）新，按新世界处理`,
        );
        save.meta = null;
      } else if (save.meta && save.meta.version < SAVE_VERSION) {
        console.info(`[save] 存档版本 ${save.meta.version} → ${SAVE_VERSION}，读档时按迁移规则升级`);
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
    if (value === undefined || value === null) return null;

    // 旧存档：按版本链升级（批次 193，C8）。`meta.version` 就是这份玩家数据的版本——
    // 两份永远是同一次保存写下来的，所以拿它当起点。
    const fromVersion = this.meta?.version ?? SAVE_VERSION;
    const migrated = migratePlayer(value, fromVersion);
    if (!migrated) {
      console.warn(`[save] 存档 v${fromVersion} 无法迁移到 v${SAVE_VERSION}，本次按"没有玩家数据"处理`);
      return null;
    }
    if (migrated.applied.length > 0) {
      console.info(`[save] 存档已升级：${migrated.applied.join('；')}`);
      // 让下一次自动保存写出新版本号（否则每次读档都要再迁移一遍）
      if (this.meta) this.meta.version = SAVE_VERSION;
    }
    return migrated.player as unknown as PlayerSave;
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

  /**
   * 读容器内容（C7 尾巴）。
   * **整份一次读写**：容器数量以人为单位（几百个已经很多了），
   * 而"按坐标懒加载"会带来与区块增量同样的时序问题（加载时还不知道有没有内容）。
   */
  async loadContainers(): Promise<SerializedContainer[]> {
    const value = await this.transaction(STORE_CONTAINERS, 'readonly', (store) =>
      promisify(store.get('containers') as IDBRequest<SerializedContainer[] | undefined>),
    );
    return value ?? [];
  }

  /**
   * 写容器内容（C7 尾巴）：**整体覆盖**而不是增量。
   * 容器会被搬走、清空、破坏，做增量就要额外维护一张"哪些容器脏了"的表；
   * 而整份内容本身很小（几十个容器、每个几格），整写省心且不会漏。
   */
  async saveContainers(containers: SerializedContainer[]): Promise<void> {
    await this.transaction(STORE_CONTAINERS, 'readwrite', (store) => {
      store.put(containers, 'containers');
    });
  }

  async savePlayer(player: PlayerSave): Promise<void> {
    await this.transaction(STORE_PLAYER, 'readwrite', (store) => {
      store.put(player, 'player');
    });
  }

  /**
   * 读告示牌上的文字（B12，批次 80）。
   *
   * 与容器同一条口径：**整份一次读写**——牌子数量以人为单位，
   * 而"按坐标懒加载"会因为"加载那一刻还不知道有没有内容"而闪一下。
   * 内容本身很小（每块牌子几十字节），整写省心、也不会漏。
   */
  async loadSigns(): Promise<SerializedSign[]> {
    const value = await this.transaction(STORE_SIGNS, 'readonly', (store) =>
      promisify(store.get('signs') as IDBRequest<SerializedSign[] | undefined>),
    );
    return value ?? [];
  }

  /**
   * 读展示框里挂着的东西（B14，批次 86）。
   *
   * 与容器/牌子同一条：**整份一次读写**——框数以人为单位，整写省心也不会漏。
   */
  async loadFrames(): Promise<SerializedFrame[]> {
    const value = await this.transaction(STORE_FRAMES, 'readonly', (store) =>
      promisify(store.get('frames') as IDBRequest<SerializedFrame[] | undefined>),
    );
    return value ?? [];
  }

  async saveFrames(frames: SerializedFrame[]): Promise<void> {
    await this.transaction(STORE_FRAMES, 'readwrite', (store) => {
      store.put(frames, 'frames');
    });
  }

  /**
   * 读成就/进度（M7，批次 87）：**整份一次读**，脏数据逐条跳过由调用方处理
   * （`AdvancementTracker.restore` 自己会校验 id、剪掉断链——判定与容错都在纯逻辑那一层，
   * 存档这一层只管搬运）。
   */
  async loadAdvancements(): Promise<SerializedAdvancements | null> {
    const value = await this.transaction(STORE_ADVANCEMENTS, 'readonly', (store) =>
      promisify(store.get('advancements') as IDBRequest<SerializedAdvancements | undefined>),
    );
    return value ?? null;
  }

  async saveAdvancements(progress: SerializedAdvancements): Promise<void> {
    await this.transaction(STORE_ADVANCEMENTS, 'readwrite', (store) => {
      store.put(progress, 'advancements');
    });
  }

  /**
   * 读记分板（M23，批次 456）。
   *
   * 校验在 `Scoreboard.restore`（坏的条目跳过、好的收下，返回跳过的条数）；
   * 存档这一层只负责搬运——与成就进度同一条分工。
   */
  async loadScoreboard(): Promise<ScoreboardSnapshot | null> {
    const value = await this.transaction(STORE_SCOREBOARD, 'readonly', (store) =>
      promisify(store.get('scoreboard') as IDBRequest<ScoreboardSnapshot | undefined>),
    );
    return value ?? null;
  }

  async saveScoreboard(snapshot: ScoreboardSnapshot): Promise<void> {
    await this.transaction(STORE_SCOREBOARD, 'readwrite', (store) => {
      store.put(snapshot, 'scoreboard');
    });
  }

  /** 读队伍（批次 468）：校验在 `Teams.restore`（坏的跳过、好的收下） */
  async loadTeams(): Promise<TeamsSnapshot | null> {
    const value = await this.transaction(STORE_TEAMS, 'readonly', (store) =>
      promisify(store.get('teams') as IDBRequest<TeamsSnapshot | undefined>),
    );
    return value ?? null;
  }

  async saveTeams(snapshot: TeamsSnapshot): Promise<void> {
    await this.transaction(STORE_TEAMS, 'readwrite', (store) => {
      store.put(snapshot, 'teams');
    });
  }

  /** 读命令方块（批次 477）：校验在 `CommandBlockStore.restore` */
  async loadCommandBlocks(): Promise<SerializedCommandBlock[] | null> {
    const value = await this.transaction(STORE_COMMAND_BLOCKS, 'readonly', (store) =>
      promisify(store.get('commandBlocks') as IDBRequest<SerializedCommandBlock[] | undefined>),
    );
    return value ?? null;
  }

  async saveCommandBlocks(list: SerializedCommandBlock[]): Promise<void> {
    await this.transaction(STORE_COMMAND_BLOCKS, 'readwrite', (store) => {
      store.put(list, 'commandBlocks');
    });
  }

  /** 读盔甲架（批次 492）：校验在 `restoreArmorStands` */
  async loadArmorStands(): Promise<SerializedArmorStand[] | null> {
    const value = await this.transaction(STORE_ARMOR_STANDS, 'readonly', (store) =>
      promisify(store.get('armorStands') as IDBRequest<SerializedArmorStand[] | undefined>),
    );
    return value ?? null;
  }

  async saveArmorStands(list: SerializedArmorStand[]): Promise<void> {
    await this.transaction(STORE_ARMOR_STANDS, 'readwrite', (store) => {
      store.put(list, 'armorStands');
    });
  }

  /** 读多格画（批次 495）：校验在 `restorePaintings` */
  async loadPaintings(): Promise<SerializedPainting[] | null> {
    const value = await this.transaction(STORE_PAINTINGS, 'readonly', (store) =>
      promisify(store.get('paintings') as IDBRequest<SerializedPainting[] | undefined>),
    );
    return value ?? null;
  }

  async savePaintings(list: SerializedPainting[]): Promise<void> {
    await this.transaction(STORE_PAINTINGS, 'readwrite', (store) => {
      store.put(list, 'paintings');
    });
  }

  /**
   * 读新手引导（引导3）：**整份一次读**，细校验交给 `TutorialTracker.restore`。
   *
   * 返回 null 的语义是"这个存档没有引导数据"（老存档），**不是读失败**：
   * 主程序按"已经会玩"处理，不给老玩家弹新手卡片。
   */
  async loadTutorial(): Promise<TutorialSave | null> {
    const value = await this.transaction(STORE_TUTORIAL, 'readonly', (store) =>
      promisify(store.get('tutorial') as IDBRequest<TutorialSave | undefined>),
    );
    if (!value || typeof value !== 'object') return null;
    return value;
  }

  async saveTutorial(data: TutorialSave): Promise<void> {
    await this.transaction(STORE_TUTORIAL, 'readwrite', (store) => {
      store.put(data, 'tutorial');
    });
  }

  async saveSigns(signs: SerializedSign[]): Promise<void> {
    await this.transaction(STORE_SIGNS, 'readwrite', (store) => {
      store.put(signs, 'signs');
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
