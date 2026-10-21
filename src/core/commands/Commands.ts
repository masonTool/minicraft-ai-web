/**
 * 命令系统（`/tp` `/give` `/time` …）
 *
 * 设计：**解析与执行都在这里，且不碰 DOM**——命令上下文（`CommandContext`）是一个接口，
 * 由主程序实现（它知道世界、玩家、天气、存档…）。好处是命令逻辑可以离线跑测试，
 * 也方便以后做服务端权威（服务端跑同一套 `executeCommand`）。
 *
 * 与命令行的关系：`executeCommand` 只管"字符串 → 效果 + 反馈"，
 * 输入框、历史记录、Tab 补全在 `ui/ChatInput.ts` 里。
 *
 * 数值与写法尽量对齐原版：
 *  - 坐标支持绝对、相对（`~`、`~5`）；缺省参数沿用玩家当前位置
 *  - 物品名支持 `minecraft:stone` / `stone` / `石头` / 数字 id
 *  - 时间支持 `day` / `noon` / `night` / `midnight` / 数字 tick
 *  - 反馈文案与原版风格一致（"已将时间设置为 day"、"找不到物品 xxx"）
 */

import { usageError } from './UsageText.ts';
import { commandDescription, commandUsage, msg, pickLabel } from './messages.ts';
import { t, tp } from '../i18n/I18n.ts';
import { resolveBlockId, resolveItemId, translateName, itemLabel } from '../registry/itemNames.ts';
// 注册名（`stone` 这种短 id）：`/data` 的回执要同时给中文名与注册名
import { itemName } from '../registry/items.ts';
import { Block } from '../registry/blocks.ts';
import { mobTypeById, MOB_TYPES } from '../entity/mobs.ts';
import { ENCHANTMENTS } from '../registry/enchantments.ts';
import {
  DIFFICULTIES,
  DIFFICULTY_LABELS,
  DIFFICULTY_LABELS_EN,
  clampRuleNumber,
  type Difficulty,
  type GameRules,
} from '../world/Rules.ts';
// 世界边界（K12，批次 175）：命令只做参数校验，夹取/描述都由纯函数给
import {
  BORDER_MIN_SIZE,
  clampBorderSize,
  describeBorder,
  type WorldBorder,
} from '../world/WorldBorder.ts';
import type { AdvancementTracker } from '../progress/AdvancementTracker.ts';
import { advancementById } from '../progress/advancements.ts';
import { findNearestBiome, LOCATE_DEFAULT_RADIUS } from '../gen/Locate.ts';
// `/locate structure` 的结构名清单（批次 624 / Q22）：零依赖数据表，不拖生成器进来
import { findStructureName, structureNamesIn } from './structureNames.data.ts';
// 维度标签：报"这个结构只在 X 生成"时按语言取
import { DIMENSION_LABELS as DIM_LABELS, type DimensionId } from '../gen/Dimension.ts';

/**
 * 维度的英文名（中文名在 `gen/Dimension.ts` 的 `DIMENSION_LABELS`）。
 *
 * 为什么不放进那张表：那张表服务于 **HUD**（永远中文，HUD 不做多语言），
 * 而这里是命令回执（要跟界面语言走）。塞进去会让 HUD 在英文界面下变成英文，
 * 那是另一件事，不该被这条命令顺手改掉。
 */
const DIMENSION_LABELS_EN: Readonly<Record<DimensionId, string>> = {
  overworld: 'the Overworld',
  nether: 'the Nether',
  end: 'the End',
};
import {
  CLONE_LIMIT,
  cloneBoxInWorld,
  cloneBoxesOverlap,
  cloneRegion,
  cloneVolume,
  normalizeCloneBox,
  shiftCloneBox,
} from './Clone.ts';
import { WORLD_MAX_Y, WORLD_MIN_Y } from '../world/Chunk.ts';
// `/data` 的路径与快照（批次 623 / Q21）：纯逻辑、零运行时依赖，可离线断言
import {
  BLOCK_PATHS,
  ENTITY_PATHS,
  canWriteSlot,
  filledSlots,
  parseDataPath,
  parseHealthValue,
  pathFitsBlock,
  pathFitsEntity,
  slotAt,
  type BlockEntityData,
  type EntityData,
} from './BlockData.ts';
// 只借类型：`/data` 写回容器内容时要交出 `ItemStack[]`
import type { ItemStack } from '../container/Inventory.ts';
// 战利品表（批次 480：`/loot`）
import { lootTableByIndex, lootTableIndex, rollLoot } from '../registry/loot.ts';
// 队伍（M23 最后一块，批次 468）
import { TEAM_COLORS, type Teams } from '../world/Teams.ts';
// 记分板（M23，批次 402）：纯类，规则一条都不依赖世界
import {
  SCORE_OPERATIONS,
  SCOREBOARD_SLOTS,
  SLOT_LABELS,
  SLOT_LABELS_EN,
  SUPPORTED_CRITERIA,
  isValidScoreName,
  type ScoreOperation,
  type Scoreboard,
  type ScoreboardSlot,
} from '../world/Scoreboard.ts';
// 目标选择器（批次 399）：`/execute` 的目标解析与求值都在这个纯模块里
import {
  PLAYER_ENTITY_ID,
  describeSelector,
  isSelector,
  parseSelector,
  resolveSelector,
  type CommandEntity,
  type ParsedSelector,
  type SelectorOrigin,
  type SelectorView,
} from './Selectors.ts';

export { DIFFICULTIES, DIFFICULTY_LABELS, DEFAULT_GAME_RULES } from '../world/Rules.ts';
// 游戏模式（批次 491）：`/gamemode` 的三种取值与中文名
import { GAME_MODE_LABELS_EN, GAME_MODE_LABELS } from '../world/GameMode.ts';
export type { Difficulty, GameRules } from '../world/Rules.ts';

/** 命令能看到的"世界与玩家" */
export interface CommandContext {
  // ---- 玩家
  playerName(): string;
  position(): { x: number; y: number; z: number; dimension: string };
  teleport(x: number, y: number, z: number, dimension?: string): boolean;
  /** 设置个人重生点（`/spawnpoint`，批次 368） */
  setPersonalSpawn(x: number, y: number, z: number): void;
  /** 设置世界出生点（`/setworldspawn`，批次 368） */
  setWorldSpawn(x: number, y: number, z: number): void;
  /** 给手持物品附魔（`/enchant`，批次 372）；成功返回 true */
  enchantHeld(id: string, level: number): boolean;
  /** 播一个音效（`/playsound`，批次 389）；名字不认识返回 false */
  playSound(name: string): boolean;
  /** 在指定位置生成粒子（`/particle`，批次 396）；名字不认识返回 false */
  spawnParticle(name: string, x: number, y: number, z: number, count: number): boolean;
  /** 成功返回实际给出的数量，物品名不认识返回 -1 */
  give(itemName: string, count: number): number;
  clearInventory(): number;
  setFlying(on: boolean): void;
  isFlying(): boolean;
  /**
   * 切游戏模式（批次 491 起收三种：生存 / 创造 / 旁观）。
   *
   * 以前是 `setCreative(boolean)`，加旁观时改成传入完整模式名——
   * 布尔没法表达第三种，硬塞会变成"旁观 = 创造 + 一堆特判"。
   */
  setGameMode(mode: 'survival' | 'creative' | 'adventure' | 'spectator'): void;
  isCreative(): boolean;
  killPlayer(): void;
  seed(): number;

  // ---- 世界
  getBlock(x: number, y: number, z: number): number;
  setBlock(x: number, y: number, z: number, id: number): boolean;
  /**
   * 读状态字节（批次 622 / Q20）。**可选**：不想改的老测试 stub 不给也能跑，
   * 那时按 0 处理 —— 但 `/clone` 不带状态就等于复制楼梯全朝北。
   */
  getBlockState?(x: number, y: number, z: number): number;
  /** 写入 id + 状态（批次 622 / Q20）。理由同 `getBlockState?` */
  setBlockState?(x: number, y: number, z: number, id: number, state: number): boolean;
  fillBlocks(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, id: number): number;

  // ---- 时间与天气
  setTimeOfDay(t: number): void;
  timeOfDay(): number;
  setWeather(kind: 'clear' | 'rain' | 'thunder'): void;

  // ---- 规则与难度
  difficulty(): Difficulty;
  setDifficulty(value: Difficulty): void;
  gameRules(): GameRules;
  setGameRule<K extends keyof GameRules>(key: K, value: GameRules[K]): void;

  // ---- 世界边界（K12，批次 175）
  /** 当前边界（中心 + 边长） */
  worldBorder(): WorldBorder;
  /** 改一部分（`set` 只改边长、`center` 只改中心）；返回改完之后的完整状态 */
  setWorldBorder(patch: Partial<WorldBorder>): WorldBorder;

  // ---- 实体
  /** 在玩家附近召唤一只生物；名字不认识返回 false */
  summon(mobName: string, x: number, y: number, z: number): boolean;
  /** 杀死玩家附近（半径 r）的实体，返回击杀数 */
  killNearby(radius: number): number;
  /**
   * 给某个实体造成伤害（批次 480，`/damage`）。
   * @param entityId `CommandEntity.id`（`mob:12` / 玩家固定 id）
   * @returns 找没找到（找不到返回 false）
   */
  damageEntity?(entityId: string, amount: number): boolean;
  /**
   * 按**物品 id** 直接塞进背包（批次 480，`/loot` 用）。
   *
   * 为什么不复用 `give(name)`：战利品表里是 id，反查注册名要再过一层表；
   * 这里直接按 id 给，省一道"名字对不对"的风险。
   * @returns 实际塞进去的数量（背包满了会少于请求值）
   */
  giveById?(itemId: number, count: number): number;

  // ---- 状态效果（I4）
  applyEffect(effectName: string, seconds: number, amplifier: number): boolean;
  clearEffects(): void;

  // ---- 经验（I5）
  /** 加经验（允许小数）；返回实际进账的整点经验 */
  addXp(amount: number): number;
  /** 直接设置等级（`/xp set`） */
  setXpLevel(level: number): void;
  xpState(): { level: number; progress: number; toNext: number; total: number };

  // ---- 联机
  onlinePlayers(): string[];

  // ---- 实体快照（批次 399，给选择器用）
  /**
   * 当前维度里的全部实体（含玩家自己）的**扁平快照**。
   *
   * 为什么不是"按 id 查一只"：`@e[distance=..5]` 要先拿到全部再筛，
   * 逐个查询等于让调用方实现一遍选择器。这里只交出数据，筛选规则全在
   * `Selectors.ts`（纯函数，可离线断言）。
   */
  entities(): readonly CommandEntity[];

  // ---- 世界查询（批次 416：`/locate`）
  /**
   * (x, z) 处的群系名（主线程上是一次气候噪声查询，很便宜）。
   * 传 null 表示这一列还查不到（区块没生成好）——搜索会跳过它。
   */
  biomeNameAt(x: number, z: number): string | null;
  /**
   * 找最近的结构（批次 464，`/locate structure`）。
   *
   * 为什么放在 ctx 而不是命令层直接算：结构与地形一样要"种子 + 生成器"，
   * 那两样只有主程序有；命令层只负责把结果翻译成人话。
   * 返回 null = 这个维度还不支持（下界/末地各自的结构入口是另一批）。
   */
  locateStructure?(kind: string): { x: number; y: number; z: number; distance: number } | null;

  /**
   * 读一格的方块信息（批次 479，`/data get block`）。
   *
   * 返回 null = 空气或这一列还没加载。只交出"是什么、状态位多少"，
   * 容器内容、告示牌文字这些**方块实体**数据不在这里（要另一条通道）。
   */
  blockInfoAt?(x: number, y: number, z: number): { id: number; name: string; state: number } | null;

  /**
   * 读一格的**方块实体**（批次 623 / Q21）：容器种类 + 逐格内容。
   *
   * 与 `blockInfoAt` 分开是刻意的：那个回答"这一格是什么方块"（很便宜，任何一格都有答案），
   * 这个回答"这一格里装了什么"（只有容器方块有答案，而且要用到主程序的容器映射）。
   * 返回 null = 这一格不是容器方块（或区块没加载）。
   *
   * ⚠️ 交出的是**快照**而不是容器实例：命令层不该拿到能 tick 的对象。
   */
  blockEntityAt?(x: number, y: number, z: number): BlockEntityData | null;

  /**
   * 写回某一格容器的内容（批次 623 / Q21，`/data merge block`）。
   *
   * 为什么是"整组内容"而不是"单格"：容器实例的 `set` 会触发 `onChange`/`onMutate`，
   * 逐格写会让界面与联机同步各刷一遍；一次交一整组则由主程序自己决定怎么刷。
   *
   * @returns false = 这一格不是容器方块（没写进去）
   */
  setBlockEntitySlots?(x: number, y: number, z: number, slots: (ItemStack | null)[]): boolean;

  /**
   * 读一只实体的**数据字段**（批次 623 / Q21）。
   *
   * @param entityId `CommandEntity.id`（`mob:12` / 玩家固定 id）
   * @returns null = 找不到这个 id
   */
  entityData?(entityId: string): EntityData | null;

  /**
   * 写一只实体的血量 / 名字（批次 623 / Q21，`/data merge entity`）。
   *
   * @returns false = 没有这个 id，或这种实体不支持这两项
   */
  setEntityData?(entityId: string, patch: { health?: number; customName?: string }): boolean;

  // ---- 进度（M7，批次 415）
  /** 队伍（批次 468，`/team` 用它） */
  teams(): Teams;

  /** 这份存档的进度跟踪器（`/advancement` 用它授/收） */
  advancements(): AdvancementTracker;

  // ---- 记分板（M23，批次 402）
  /** 这个世界的记分板（`/scoreboard` 与 `/execute if score` 共用同一份） */
  scoreboard(): Scoreboard;
}

/** 命令反馈的出口（聊天栏） */
export interface CommandFeedback {
  /** 正常反馈（白色） */
  info(text: string): void;
  /** 报错（红色） */
  error(text: string): void;
}

export interface CommandSpec {
  name: string;
  /** 用法（/help 里显示） */
  usage: string;
  description: string;
  /** 需要创造模式（原版是权限等级） */
  creativeOnly?: boolean;
  run(args: string[], ctx: CommandContext, out: CommandFeedback): void;
}

// ---------------------------------------------------------------- 参数解析

/** 解析一个数字；不认识返回 NaN */
function num(text: string | undefined): number {
  if (text === undefined) return Number.NaN;
  const value = Number(text);
  return Number.isFinite(value) ? value : Number.NaN;
}

/**
 * 解析一个坐标分量。
 * `~` = 玩家当前位置，`~5` = 当前位置 +5，其它按绝对坐标。
 */
export function parseCoordinate(text: string | undefined, current: number): number {
  if (text === undefined || text === '~') return current;
  if (text.startsWith('~')) {
    const offset = Number(text.slice(1));
    return Number.isFinite(offset) ? current + offset : Number.NaN;
  }
  return num(text);
}

/** 三个坐标分量一起解析（缺省为 `~`） */
export function parsePosition(
  args: string[],
  base: { x: number; y: number; z: number },
): { x: number; y: number; z: number } | null {
  const x = parseCoordinate(args[0] ?? '~', base.x);
  const y = parseCoordinate(args[1] ?? '~', base.y);
  const z = parseCoordinate(args[2] ?? '~', base.z);
  if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(z)) return null;
  return { x, y, z };
}

/** `day` / `noon` / `night` / `midnight` / tick → 0~1 的一天内时刻 */
export function parseTime(text: string | undefined): number | null {
  if (text === undefined) return null;
  const named: Record<string, number> = { day: 0, noon: 0.25, sunset: 0.5, night: 0.5, midnight: 0.75, sunrise: 0 };
  const lower = text.toLowerCase();
  if (lower in named) return named[lower]!;
  if (lower === 'day') return 0;
  const ticks = num(text);
  if (Number.isNaN(ticks)) return null;
  // 原版一天 24000 tick；0 tick = 日出
  const t = (ticks % 24000) / 24000;
  return t < 0 ? t + 1 : t;
}

/** 把玩家名/`@s`/`@p` 这类目标简化为"是否有权限操作自己" */
export function isSelfTarget(text: string | undefined, playerName: string): boolean {
  if (text === undefined) return true;
  const lower = text.toLowerCase();
  return lower === '@s' || lower === '@p' || lower === playerName.toLowerCase();
}

// ---------------------------------------------------------------- 命令表

/** 天气的中文名（批次 221）：`/weather` 的回执以前直接印 `rain` 这种英文原值 */
const WEATHER_LABELS: Record<'clear' | 'rain' | 'thunder', string> = {
  clear: '晴天',
  rain: '下雨',
  thunder: '雷暴',
};

/** 英文名（批次 617）：回执句式翻了之后，嵌在里面的值也必须跟着翻 */
const WEATHER_LABELS_EN: Record<'clear' | 'rain' | 'thunder', string> = {
  clear: 'Clear',
  rain: 'Rain',
  thunder: 'Thunder',
};

export const COMMANDS: readonly CommandSpec[] = [
  {
    name: 'help',
    usage: '/help [命令]',
    description: '列出所有命令，或查看某条命令的用法',
    run(args, _ctx, out) {
      const wanted = args[0]?.replace('/', '').toLowerCase();
      if (wanted) {
        const spec = findCommand(wanted);
        if (!spec) {
          out.error(tp('command.unknownHelp', { name: wanted }));
          return;
        }
        // 一条消息只放一行：聊天栏按"新消息在上"渲染，所以先发描述、再发用法，
        // 屏幕上看到的就是"用法在上、描述在下"。
        out.info(commandDescription(spec));
        out.info(commandUsage(spec));
        return;
      }
      // 每条命令单独一条消息（聊天栏再按实际宽度折叠），不再拼成一个多行大块。
      // 同样按"新消息在上"倒着发：标题最后发 → 显示在最上面，下面依次是第 1、2…条。
      for (let i = COMMANDS.length - 1; i >= 0; i--) {
        const spec = COMMANDS[i]!;
        out.info(`${commandUsage(spec)} — ${commandDescription(spec)}`);
      }
      out.info(tp('command.listTitle', { count: COMMANDS.length }));
    },
  },
  {
    name: 'tp',
    usage: '/tp <x> <y> <z> [维度]',
    description: '传送到坐标（支持 ~ 相对写法）',
    run(args, ctx, out) {
      const pos = parsePosition(args, ctx.position());
      if (!pos) {
        out.error(msg('坐标格式不对：应为 /tp <x> <y> <z> [维度]'));
        return;
      }
      const dimension = args[3]?.toLowerCase();
      if (!ctx.teleport(pos.x, pos.y, pos.z, dimension)) {
        out.error(msg('传送失败：维度 {dimension} 不存在', { dimension: dimension }));
        return;
      }
      const where = dimension ? `（${dimension}）` : '';
      out.info(msg('已将 {player} 传送到 {x} {y} {z}{suffix}', { player: ctx.playerName(), x: fmt(pos.x), y: fmt(pos.y), z: fmt(pos.z), suffix: where }));
    },
  },
  {
    name: 'give',
    usage: '/give <物品> [数量]',
    description: '给自己物品（物品名支持中文/英文/数字 id）',
    creativeOnly: true,
    run(args, ctx, out) {
      const name = args[0];
      if (!name) {
        out.error(usageError('/give <物品> [数量]'));
        return;
      }
      const count = args[1] === undefined ? 1 : Math.floor(num(args[1]));
      if (!Number.isFinite(count) || count <= 0) {
        out.error(msg('数量不对：{count}', { count: args[1] }));
        return;
      }
      const given = ctx.give(name, count);
      if (given < 0) {
        out.error(msg('找不到物品：{name}（可以试 /give stone 或 /give 石头）', { name: name }));
        return;
      }
      // 背包塞不下时给出去了也会丢，这里如实告诉玩家实际给到的数量
      out.info(
      msg('已给予 {item} ×{given}{note}', {
        item: translateName(name),
        given,
        note: given < count ? msg('（背包只装得下 {given} 个）', { given }) : '',
      }),
    );
    },
  },
  {
    name: 'clear',
    usage: '/clear',
    description: '清空自己的背包',
    creativeOnly: true,
    run(_args, ctx, out) {
      const removed = ctx.clearInventory();
      out.info(msg('已清空背包（移除 {removed} 组物品）', { removed: removed }));
    },
  },
  {
    name: 'time',
    usage: '/time set <day|noon|night|midnight|数字>',
    description: '设置时间',
    run(args, ctx, out) {
      const action = args[0]?.toLowerCase();
      if (action !== 'set' && action !== 'add') {
        out.error(usageError('/time set <day|noon|night|midnight|数字>'));
        return;
      }
      const t = parseTime(args[1]);
      if (t === null) {
        out.error(msg('时间格式不对：{value}', { value: args[1] ?? '(空)' }));
        return;
      }
      ctx.setTimeOfDay(action === 'add' ? (ctx.timeOfDay() + t) % 1 : t);
      out.info(msg('已将时间设置为 {value}', { value: args[1] }));
    },
  },
  {
    name: 'weather',
    usage: '/weather <clear|rain|thunder>',
    description: '切换天气',
    run(args, ctx, out) {
      const kind = args[0]?.toLowerCase();
      if (kind !== 'clear' && kind !== 'rain' && kind !== 'thunder') {
        out.error(usageError('/weather <clear|rain|thunder>'));
        return;
      }
      ctx.setWeather(kind);
      // 回执用中文；预计时长由主程序的天气播报补一句（`App.announceWeather`）
      out.info(msg('天气已切换为 {weather}', { weather: pickLabel(WEATHER_LABELS[kind], WEATHER_LABELS_EN[kind]) }));
    },
  },
  {
    name: 'difficulty',
    usage: '/difficulty <peaceful|easy|normal|hard>',
    description: '设置难度（和平难度下敌对生物不会生成）',
    run(args, ctx, out) {
      const value = args[0]?.toLowerCase() as Difficulty | undefined;
      if (!value || !DIFFICULTIES.includes(value)) {
        out.error(usageError(`/difficulty <${DIFFICULTIES.join('|')}>`));
        return;
      }
      ctx.setDifficulty(value);
      out.info(msg('难度已设置为 {difficulty}（{value}）', { difficulty: pickLabel(DIFFICULTY_LABELS[value], DIFFICULTY_LABELS_EN[value]), value: value }));
    },
  },
  {
    name: 'gamerule',
    usage: '/gamerule <规则> [值]',
    description:
      '查看或修改游戏规则，例如“死亡后保留物品 / 生物自然生成 / 生物破坏方块 / 昼夜循环 / ' +
      '自然回血 / 随机刻速度 / 生物掉落物 / 天气循环”。帮助弹窗的下拉里有中文名，' +
      '命令里仍使用对应的英文规则名。',
    run(args, ctx, out) {
      const rules = ctx.gameRules();
      const key = args[0] as keyof GameRules | undefined;
      if (!key) {
        const lines = Object.entries(rules).map(([name, value]) => `${name} = ${value}`);
        out.info(msg('当前游戏规则：\n{rules}', { rules: lines.join('\n') }));
        return;
      }
      if (!(key in rules)) {
        out.error(msg('未知的游戏规则：{key}', { key: key }));
        return;
      }
      const current = rules[key];
      const raw = args[1];
      if (raw === undefined) {
        out.info(`${key} = ${current}`);
        return;
      }
      if (typeof current === 'boolean') {
        const lower = raw.toLowerCase();
        if (lower !== 'true' && lower !== 'false') {
          out.error(msg('{key} 只能是 true / false', { key: key }));
          return;
        }
        ctx.setGameRule(key, (lower === 'true') as GameRules[typeof key]);
        out.info(msg('{key} 已设置为 {value}', { key: key, value: lower }));
        return;
      }
      const value = num(raw);
      if (Number.isNaN(value)) {
        out.error(msg('{key} 需要一个数字', { key: key }));
        return;
      }
      // ⚠️ 范围按**每条规则自己**取（批次 625 / Q23）：以前一律夹到 0~100，
      // 而 `maxCommandChainLength` 要能设到 65536 —— 统一夹取会把它静默压成 100，
      // 表现是"命令说设成功了、实际生效的是 100"，这种错最难查。
      const clamped = clampRuleNumber(key, value);
      ctx.setGameRule(key, clamped as GameRules[typeof key]);
      // 夹取必须说出来：玩家设 999 时看到 100，才知道是夹了而不是没生效
      out.info(
        clamped === Math.round(value)
          ? msg('{key} 已设置为 {value}', { key: key, value: clamped })
          : msg('{key} 已设置为 {value}（超出范围，已夹到 {clamped}）', {
              key: key,
              value: Math.round(value),
              clamped: clamped,
            }),
      );
    },
  },
  {
    name: 'effect',
    usage: '/effect <give|clear> <效果> [秒数] [等级]',
    description: '给予或清除状态效果（如 /effect give speed 10 2）',
    run(args, ctx, out) {
      const action = args[0]?.toLowerCase();
      if (action === 'clear') {
        ctx.clearEffects();
        out.info(msg('已清除全部状态效果'));
        return;
      }
      if (action !== 'give') {
        out.error(usageError('/effect <give|clear> <效果> [秒数] [等级]'));
        return;
      }
      const name = args[1];
      if (!name) {
        out.error(usageError('/effect give <效果> [秒数] [等级]'));
        return;
      }
      const seconds = args[2] === undefined ? 30 : num(args[2]);
      if (!Number.isFinite(seconds) || seconds <= 0) {
        out.error(msg('秒数不对：{seconds}', { seconds: args[2] }));
        return;
      }
      const amplifier = args[3] === undefined ? 0 : Math.floor(num(args[3]));
      if (!ctx.applyEffect(name, seconds, Math.max(0, amplifier))) {
        out.error(msg('未知的状态效果：{name}', { name: name }));
        return;
      }
      out.info(msg('已给予状态效果 {name} {seconds} 秒（等级 {level}）', { name: name, seconds: seconds, level: amplifier + 1 }));
    },
  },
  {
    name: 'summon',
    usage: '/summon <生物> [x] [y] [z]',
    description: '在指定位置召唤生物（默认在自己面前）',
    creativeOnly: true,
    run(args, ctx, out) {
      const name = args[0]?.toLowerCase();
      if (!name) {
        out.error(
      usageError('/summon <生物> [x] [y] [z]') +
        msg('（可用：{available}）', { available: MOB_TYPES.map((type) => type.id).join(', ') }),
    );
        return;
      }
      const base = ctx.position();
      // 没给坐标时丢在玩家前方两格，避免直接压在脸上
      const pos = args.length > 1
        ? parsePosition(args.slice(1), base)
        : { x: base.x, y: base.y, z: base.z };
      if (!pos) {
        out.error(msg('坐标格式不对'));
        return;
      }
      if (!ctx.summon(name, pos.x, pos.y, pos.z)) {
        out.error(msg('未知的生物：{name}（可用：{available}）', { name: name, available: MOB_TYPES.map((type) => type.id).join(', ') }));
        return;
      }
      out.info(msg('已召唤 {name}', { name: name }));
    },
  },
  {
    name: 'kill',
    usage: '/kill [@s|半径]',
    description: '杀死自己，或清除附近半径内的生物',
    run(args, ctx, out) {
      const first = args[0];
      if (first !== undefined && Number.isFinite(Number(first))) {
        const radius = Math.max(0, Number(first));
        const killed = ctx.killNearby(radius);
        out.info(msg('已清除 {count} 个生物（半径 {radius}）', { count: killed, radius: radius }));
        return;
      }
      if (!isSelfTarget(first, ctx.playerName())) {
        out.error(msg('只能对自己使用 /kill'));
        return;
      }
      ctx.killPlayer();
      out.info(msg('{player} 死了', { player: ctx.playerName() }));
    },
  },
  {
    name: 'setblock',
    usage: '/setblock <x> <y> <z> <方块>',
    description: '放置一个方块',
    creativeOnly: true,
    run(args, ctx, out) {
      const pos = parsePosition(args.slice(0, 3), ctx.position());
      const name = args[3];
      if (!pos || !name) {
        out.error(usageError('/setblock <x> <y> <z> <方块>'));
        return;
      }
      const id = resolveBlockId(name);
      if (id === undefined) {
        out.error(msg('找不到方块：{name}', { name: name }));
        return;
      }
      if (!ctx.setBlock(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z), id)) {
        out.error(msg('位置超出世界范围'));
        return;
      }
      out.info(msg('已放置 {block} 于 {x} {y} {z}', { block: translateName(name), x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) }));
    },
  },
  {
    name: 'spawnpoint',
    usage: '/spawnpoint [x y z]',
    description: '设置个人重生点（不带坐标 = 当前位置）',
    run(args, ctx, out) {
      const pos = args.length >= 3 ? parsePosition(args.slice(0, 3), ctx.position()) : ctx.position();
      if (!pos) {
        out.error(usageError('/spawnpoint [x y z]'));
        return;
      }
      ctx.setPersonalSpawn(pos.x, pos.y, pos.z);
      out.info(msg('已将重生点设置为 {x} {y} {z}', { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) }));
    },
  },
  {
    name: 'setworldspawn',
    usage: '/setworldspawn [x y z]',
    description: '设置世界出生点（不带坐标 = 当前位置）',
    run(args, ctx, out) {
      const pos = args.length >= 3 ? parsePosition(args.slice(0, 3), ctx.position()) : ctx.position();
      if (!pos) {
        out.error(usageError('/setworldspawn [x y z]'));
        return;
      }
      ctx.setWorldSpawn(pos.x, pos.y, pos.z);
      out.info(msg('已将世界出生点设置为 {x} {y} {z}', { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) }));
    },
  },
  {
    name: 'particle',
    usage: '/particle <类型> [数量]',
    description: '在玩家位置生成粒子（爱心 / 暴击 / 火焰 / 传送门 / 爆炸）',
    run(args, ctx, out) {
      const kind = args[0];
      if (!kind) {
        out.error(usageError('/particle <类型> [数量]'));
        return;
      }
      const count = args[1] === undefined ? 8 : Number(args[1]);
      if (!Number.isInteger(count) || count < 1 || count > 200) {
        out.error(msg('数量必须是 1~200 的整数'));
        return;
      }
      const pos = ctx.position();
      if (!ctx.spawnParticle(kind, pos.x, pos.y, pos.z, count)) {
        out.error(msg('找不到粒子：{kind}', { kind: kind }));
        return;
      }
      out.info(msg('已生成 {count} 个 {kind} 粒子', { count: count, kind: kind }));
    },
  },
  {
    name: 'tell',
    usage: '/tell <内容>',
    description: '给自己发一条私聊（单人下等同 /say）',
    run(args, ctx, out) {
      const text = args.join(' ').trim();
      if (!text) {
        out.error(usageError('/tell <内容>'));
        return;
      }
      out.info(msg('[{from} -> 你] {text}', { from: ctx.playerName(), text: text }));
    },
  },
  {
    name: 'msg',
    usage: '/msg <内容>',
    description: '同 /tell',
    run(args, ctx, out) {
      const text = args.join(' ').trim();
      if (!text) {
        out.error(usageError('/msg <内容>'));
        return;
      }
      out.info(msg('[{from} -> 你] {text}', { from: ctx.playerName(), text: text }));
    },
  },
  {
    name: 'playsound',
    usage: '/playsound <音效>',
    description: '在玩家所在位置播一个音效（名字见音效设置里的分组）',
    run(args, ctx, out) {
      const name = args[0];
      if (!name) {
        out.error(usageError('/playsound <音效>'));
        return;
      }
      if (!ctx.playSound(name)) {
        out.error(msg('找不到音效：{name}', { name: name }));
        return;
      }
      out.info(msg('已播放音效 {name}', { name: name }));
    },
  },
  {
    name: 'me',
    usage: '/me <动作>',
    description: '发一条动作消息（“* 玩家 挥了挥手”）',
    run(args, ctx, out) {
      const text = args.join(' ').trim();
      if (!text) {
        out.error(usageError('/me <动作>'));
        return;
      }
      out.info(`* ${ctx.playerName()} ${text}`);
    },
  },
  {
    name: 'say',
    usage: '/say <内容>',
    description: '向聊天栏发一条消息',
    run(args, _ctx, out) {
      const text = args.join(' ').trim();
      if (!text) {
        out.error(usageError('/say <内容>'));
        return;
      }
      out.info(text);
    },
  },
  {
    name: 'enchant',
    usage: '/enchant <附魔> [等级]',
    description: '给手持物品附魔（等级默认 1，超过上限按上限算）',
    run(args, ctx, out) {
      const key = args[0];
      if (!key) {
        out.error(usageError('/enchant <附魔> [等级]'));
        return;
      }
      const def = ENCHANTMENTS.find((entry) => entry.id === key || entry.name === key);
      if (!def) {
        out.error(msg('找不到附魔：{key}', { key: key }));
        return;
      }
      const requested = args[1] === undefined ? 1 : Number(args[1]);
      if (!Number.isInteger(requested) || requested < 1) {
        out.error(msg('等级必须是正整数'));
        return;
      }
      const level = Math.min(requested, def.maxLevel);
      if (!ctx.enchantHeld(def.id, level)) {
        out.error(msg('手上没有可附魔的物品'));
        return;
      }
      out.info(msg('已给手持物品附上 {name} {level}', { name: def.name, level: level }));
    },
  },
  {
    name: 'clone',
    usage: '/clone <x1> <y1> <z1> <x2> <y2> <z2> <dx> <dy> <dz> [masked|replace]',
    description: '把一块区域复制到别处（单次上限 32768 格；“遮罩”模式只覆盖空气）',
    creativeOnly: true,
    run(args, ctx, out) {
      if (args.length < 9) {
        out.error(usageError('/clone <x1> <y1> <z1> <x2> <y2> <z2> <dx> <dy> <dz> [masked|replace]'));
        return;
      }
      const base = ctx.position();
      const from = parsePosition(args.slice(0, 3), base);
      const to = parsePosition(args.slice(3, 6), base);
      if (!from || !to) {
        out.error(msg('坐标格式不对'));
        return;
      }
      const offset = {
        x: Number(args[6]),
        y: Number(args[7]),
        z: Number(args[8]),
      };
      if (!Number.isFinite(offset.x) || !Number.isFinite(offset.y) || !Number.isFinite(offset.z)) {
        // 位移只接受数字（不接受 ~ / ^）：它是"相对源区域"的量，不是坐标
        out.error(msg('位移只能是数字：<dx> <dy> <dz>'));
        return;
      }
      const modeArg = (args[9] ?? 'replace').toLowerCase();
      if (modeArg !== 'replace' && modeArg !== 'masked') {
        out.error(msg('模式只有 masked / replace：{mode}', { mode: modeArg }));
        return;
      }
      const box = normalizeCloneBox(
        { x: Math.floor(from.x), y: Math.floor(from.y), z: Math.floor(from.z) },
        { x: Math.floor(to.x), y: Math.floor(to.y), z: Math.floor(to.z) },
      );
      const volume = cloneVolume(box);
      if (volume > CLONE_LIMIT) {
        out.error(msg('区域太大（{volume} 格），上限 {limit}', { volume: volume, limit: CLONE_LIMIT }));
        return;
      }
      const shift = { x: Math.floor(offset.x), y: Math.floor(offset.y), z: Math.floor(offset.z) };
      const targetBox = shiftCloneBox(box, shift);
      // 目标压到源上直接拒绝（原版同）：允许的话"把房子往东挪 2 格"会得到
      // 半新半旧的结果，玩家会以为指令坏了（批次 622 / Q20）
      if (cloneBoxesOverlap(box, targetBox)) {
        out.error(msg('目标区域与源区域重叠'));
        return;
      }
      // 越界也拒绝：越界的写会被世界静默丢弃，那样会回"已复制 N 格"却什么都没发生
      if (!cloneBoxInWorld(targetBox, WORLD_MIN_Y, WORLD_MAX_Y)) {
        out.error(msg('目标区域超出世界竖直范围（{min} ~ {max}）', { min: WORLD_MIN_Y, max: WORLD_MAX_Y }));
        return;
      }
      const target = { x: targetBox.x1, y: targetBox.y1, z: targetBox.z1 };
      const result = cloneRegion(
        {
          read: (x, y, z) => ctx.getBlock(x, y, z),
          write: (x, y, z, id) => void ctx.setBlock(x, y, z, id),
          // 状态一起复制（批次 622 / Q20）：楼梯朝向、台阶双层、告示牌朝向都靠它
          readState: ctx.getBlockState ? (x, y, z) => ctx.getBlockState!(x, y, z) : undefined,
          writeState: ctx.setBlockState
            ? (x, y, z, id, state) => void ctx.setBlockState!(x, y, z, id, state)
            : undefined,
        },
        box,
        shift,
        modeArg,
      );
      const masked = result.skipped > 0 ? `（masked：跳过 ${result.skipped} 格非空气）` : '';
      out.info(
        `已复制 ${result.copied} / ${result.volume} 格到 ${target.x} ${target.y} ${target.z}${masked}`,
      );
    },
  },
  {
    name: 'fill',
    usage: '/fill <x1> <y1> <z1> <x2> <y2> <z2> <方块>',
    description: '用方块填充一个长方体区域（单次上限 32768 格）',
    creativeOnly: true,
    run(args, ctx, out) {
      if (args.length < 7) {
        out.error(usageError('/fill <x1> <y1> <z1> <x2> <y2> <z2> <方块>'));
        return;
      }
      const base = ctx.position();
      const from = parsePosition(args.slice(0, 3), base);
      const to = parsePosition(args.slice(3, 6), base);
      const id = resolveBlockId(args[6]!);
      if (!from || !to) {
        out.error(msg('坐标格式不对'));
        return;
      }
      if (id === undefined) {
        out.error(msg('找不到方块：{name}', { name: args[6] }));
        return;
      }
      const volume =
        (Math.abs(Math.floor(from.x) - Math.floor(to.x)) + 1) *
        (Math.abs(Math.floor(from.y) - Math.floor(to.y)) + 1) *
        (Math.abs(Math.floor(from.z) - Math.floor(to.z)) + 1);
      if (volume > 32768) {
        out.error(msg('区域太大（{volume} 格），上限 {limit}', { volume, limit: 32768 }));
        return;
      }
      const placed = ctx.fillBlocks(
        Math.floor(from.x), Math.floor(from.y), Math.floor(from.z),
        Math.floor(to.x), Math.floor(to.y), Math.floor(to.z),
        id,
      );
      out.info(msg('已填充 {count} 格 {block}', { count: placed, block: translateName(args[6]!) }));
    },
  },
  {
    name: 'gamemode',
    usage: '/gamemode <survival|creative|adventure|spectator>',
    description: '切换游戏模式（创造 = 飞行 + 不受伤 + 秒破；冒险 = 不能破坏/放方块；旁观 = 穿墙飞行 + 不能交互）',
    // ⚠️ 故意**不设** creativeOnly：否则一旦切到生存就再也切不回来了
    // （其他创造专用命令仍然要求创造模式）。原版这条命令是权限等级控制的。
    run(args, ctx, out) {
      // 缩写：c / s / a / sp（原版也收单字母）
      const raw = args[0]?.toLowerCase();
      const mode =
        raw === 'c'
          ? 'creative'
          : raw === 's'
            ? 'survival'
            : raw === 'a'
              ? 'adventure'
              : raw === 'sp'
                ? 'spectator'
                : raw;
      if (mode !== 'survival' && mode !== 'creative' && mode !== 'adventure' && mode !== 'spectator') {
        out.error(usageError('/gamemode <survival|creative|adventure|spectator>'));
        return;
      }
      ctx.setGameMode(mode);
      // 飞行由 `setGameMode` 内部处理（旁观强制飞、切回生存强制落地），
      // 这里**不再**单独调 `setFlying`——两处都设会让"切到生存却还在飞"再现
      out.info(msg('已将游戏模式设置为 {mode}', { mode: pickLabel(GAME_MODE_LABELS[mode], GAME_MODE_LABELS_EN[mode]) }));
    },
  },
  {
    name: 'seed',
    usage: '/seed',
    description: '显示世界种子',
    run(_args, ctx, out) {
      out.info(msg('世界种子：{seed}', { seed: ctx.seed() }));
    },
  },
  {
    name: 'list',
    usage: '/list',
    description: '列出在线玩家',
    run(_args, ctx, out) {
      const players = ctx.onlinePlayers();
      out.info(msg('在线玩家（{count}）：{players}', { count: players.length, players: players.join(', ') }));
    },
  },
  {
    // 与原版的 `/xp add|set|query` 对应；原版还有 `<n>L` 的"按级给"写法，这里没做
    name: 'xp',
    usage: '/xp add <点数> | /xp set <等级> | /xp query',
    description: '查看或修改经验值与等级',
    run(args, ctx, out) {
      const mode = (args[0] ?? 'query').toLowerCase();
      const state = ctx.xpState();

      if (mode === 'query') {
        out.info(msg('等级 {level}：{progress}/{next}（累计 {total} 点）', { level: state.level, progress: state.progress, next: state.toNext, total: state.total }));
        return;
      }
      if (mode !== 'add' && mode !== 'set') {
        out.error(usageError('/xp add <点数> | /xp set <等级> | /xp query'));
        return;
      }

      const value = Number(args[1]);
      if (!Number.isFinite(value) || value < 0) {
        out.error(msg('数量无效：{value}', { value: args[1] ?? '(空)' }));
        return;
      }

      if (mode === 'add') {
        // 0.4 这样的点数允许（原版经验球是整数，但命令接受小数并向下取整）
        const gained = ctx.addXp(value);
        const after = ctx.xpState();
        out.info(msg('已给予 {value} 点经验（实际进账 {gained} 点），当前等级 {level}', { value: value, gained: gained, level: after.level }));
      } else {
        ctx.setXpLevel(Math.floor(value));
        out.info(msg('已将等级设置为 {level}', { level: Math.floor(value) }));
      }
    },
  },
  {
    name: 'worldborder',
    usage: '/worldborder get | /worldborder set <边长> | /worldborder center <x> <z>',
    description: '查看或修改世界边界（越界掉血、超出软区会被推回）',
    run(args, ctx, out) {
      const mode = (args[0] ?? 'get').toLowerCase();
      const current = ctx.worldBorder();

      if (mode === 'get') {
        out.info(describeBorder(current));
        return;
      }
      if (mode === 'set') {
        const size = Number(args[1]);
        if (!Number.isFinite(size) || size < BORDER_MIN_SIZE) {
          out.error(msg('边长必须是 ≥ {min} 的数字（当前 {current}）', { min: BORDER_MIN_SIZE, current: current.size }));
          return;
        }
        const next = ctx.setWorldBorder({ size: clampBorderSize(size) });
        out.info(msg('世界边界已设为边长 {size} 格（中心 {x}, {z}）', { size: next.size, x: next.centerX, z: next.centerZ }));
        return;
      }
      if (mode === 'center') {
        const centerX = num(args[1]);
        const centerZ = num(args[2]);
        if (!Number.isFinite(centerX) || !Number.isFinite(centerZ)) {
          out.error(usageError('/worldborder center <x> <z>'));
          return;
        }
        const next = ctx.setWorldBorder({ centerX: Math.floor(centerX), centerZ: Math.floor(centerZ) });
        out.info(msg('世界中心已设为 ({x}, {z})，边长 {size} 格', { x: next.centerX, z: next.centerZ, size: next.size }));
        return;
      }
      out.error(usageError('/worldborder get | set <边长> | center <x> <z>'));
    },
  },
  {
    name: 'execute',
    usage: '/execute <as|at|positioned|if|unless> … run <命令>',
    description: '以指定目标与位置执行一条命令（可链式叠加）',
    run(args, ctx, out) {
      runExecute(args, ctx, out);
    },
  },
  {
    name: 'locate',
    usage: '/locate biome <群系名> | /locate structure <结构名>',
    description: '找最近的指定群系或结构（群系按区块环搜 640 格，结构按单元重算）',
    run(args, ctx, out) {
      // ---- 结构（批次 464 主体，批次 624 / Q22 补三个失败分支）----
      // 原来这一支有三个问题，都是"实测才会撞到"的那种：
      //  ① 名字不认识 / 属于别的维度，回执都说"附近没有找到" —— 玩家会一直往远处走；
      //  ② 三种失败（找不到 / 名字不认识 / 这个维度不支持）回执一模一样，没法排查；
      //  ③ 整个回执是模板字符串拼的，英文模式下整句中文原样漏出来；
      //     `test:i18n` 只跑 `/locate`（不带参数）那一条，永远走不到成功分支，所以从没红过。
      // 现在：先查名字 → 再分维度校验 → 再判断有没有定位实现 → 最后才真去找。
      if ((args[0] ?? '').toLowerCase() === 'structure') {
        const raw = args[1];
        if (!raw) {
          out.error(usageError('/locate biome <群系名> | /locate structure <结构名>'));
          return;
        }
        const entry = findStructureName(raw);
        if (!entry) {
          // 候选清单按**当前维度**给（下界只有 3 种，没必要让玩家看 18 个主世界名字）
          out.error(
            msg('没有这种结构：{name}（这个维度有 {names}）', {
              name: raw,
              names: structureNamesIn(ctx.position().dimension as DimensionId),
            }),
          );
          return;
        }
        const here = ctx.position().dimension as DimensionId;
        if (entry.dimension !== here) {
          out.error(
            msg('{name} 只在{Dimension}生成，这里是{Current}（可定位的有 {names}）', {
              name: pickLabel(entry.label, entry.labelEn),
              Dimension: pickLabel(DIM_LABELS[entry.dimension], DIMENSION_LABELS_EN[entry.dimension]),
              Current: pickLabel(DIM_LABELS[here], DIMENSION_LABELS_EN[here]),
              names: structureNamesIn(here),
            }),
          );
          return;
        }
        if (!entry.locatable) {
          // 结构会生成、但"找最近一个"还没写。说清楚，别让它冒充"附近没有"
          out.error(
            msg('{name} 还不能用 /locate 找（结构本身会生成，只是搜索还没做）', {
              name: pickLabel(entry.label, entry.labelEn),
            }),
          );
          return;
        }
        if (!ctx.locateStructure) {
          out.error(msg('这个维度读不到结构位置'));
          return;
        }
        const hit = ctx.locateStructure(entry.key);
        if (!hit) {
          // 名称与维度都对，纯粹是这一带没生成：换一句"没找到"并给出搜索范围
          out.error(
            msg('{radius} 格内没有 {name}（换一个位置再试，或者往外走远一点）', {
              radius: LOCATE_DEFAULT_RADIUS,
              name: pickLabel(entry.label, entry.labelEn),
            }),
          );
          return;
        }
        out.info(
          msg('最近的{name}在 {x}, {y}, {z}（约 {distance} 格）', {
            name: pickLabel(entry.label, entry.labelEn),
            x: hit.x,
            y: hit.y,
            z: hit.z,
            distance: Math.round(hit.distance),
          }),
        );
        return;
      }

      // ---- 群系 ----
      const kind = (args[0] ?? '').toLowerCase();
      const target = args[1];
      if (kind !== 'biome' || !target) {
        out.error(usageError('/locate biome <群系名> | /locate structure <结构名>'));
        return;
      }
      const position = ctx.position();
      const hit = findNearestBiome((x, z) => ctx.biomeNameAt(x, z), target, position);
      if (!hit) {
        out.error(
          msg('{radius} 格内没有找到 {target}（试试点名更常见的群系，或者先走远一点）', {
            radius: LOCATE_DEFAULT_RADIUS,
            target: target,
          }),
        );
        return;
      }
      // 脚下就是它：单独一句（原来这条也是模板字符串，英文模式下整句中文）
      if (hit.distance === 0) {
        out.info(msg('你脚下就是 {target}（{x}, {z}）', { target: target, x: hit.x, z: hit.z }));
        return;
      }
      out.info(
        msg('最近的 {target} 在 {x}, {z}（约 {distance} 格）', {
          target: target,
          x: hit.x,
          z: hit.z,
          distance: Math.round(hit.distance),
        }),
      );
    },
  },
  {
    name: 'damage',
    usage: '/damage <目标> <伤害>',
    description: '对目标实体造成伤害（伤害是点数，2 点 = 1 颗心）',
    run(args, ctx, out) {
      const target = args[0];
      const rawAmount = args[1];
      const amount = Number(rawAmount);
      if (!target || rawAmount === undefined || !Number.isFinite(amount) || amount <= 0) {
        out.error(usageError('/damage <目标> <伤害>') + msg('（伤害要大于 0）'));
        return;
      }
      if (!ctx.damageEntity) {
        out.error(msg('这个环境不支持 /damage'));
        return;
      }
      const position = ctx.position();
      const state: ExecState = {
        origin: { x: position.x, y: position.y, z: position.z },
        executorId: selfEntityId(ctx),
      };
      const selector = parseSelector(target);
      if (typeof selector === 'string') {
        out.error(selector);
        return;
      }
      const found = resolveSelector(selector, selectorView(ctx), state.origin, state.executorId);
      if (found.length === 0) {
        out.error(msg('没有匹配到实体：{target}', { target: target }));
        return;
      }
      let hit = 0;
      for (const entity of found) {
        if (ctx.damageEntity(entity.id, amount)) hit++;
      }
      out.info(msg('对 {count} 个实体造成了 {amount} 点伤害', { count: hit, amount: amount }));
    },
  },
  {
    name: 'loot',
    usage: '/loot give <战利品表> [数量]',
    description: '把一张战利品表掷点后塞进自己的背包',
    run(args, ctx, out) {
      // ⚠️ 只支持"给自己"：`/loot give @a loot …` 那种广播式发放要按目标逐个塞，
      // 而本项目只有本地玩家一个背包，做出来也是假的（差异记在 TASKS）
      const mode = (args[0] ?? '').toLowerCase();
      // 兼容两种写法：`/loot give <表>` 与 `/loot give <目标> loot <表>`
      const tableKey = (mode === 'give' && args[2] === 'loot' ? args[3] : args[1])?.toLowerCase();
      const rawCount = (mode === 'give' && args[2] === 'loot' ? args[4] : args[2]) ?? '1';
      const times = Math.floor(Number(rawCount));
      if (mode !== 'give' || !tableKey) {
        out.error(usageError('/loot give <战利品表> [数量]'));
        return;
      }
      if (!Number.isFinite(times) || times < 1 || times > 10) {
        out.error(msg('数量要在 1~10 之间'));
        return;
      }
      const index = lootTableIndex(tableKey);
      const table = index > 0 ? lootTableByIndex(index) : null;
      if (!table) {
        out.error(msg('没有这张战利品表：{table}（用 village_house / mineshaft / dungeon 这类）', { table: tableKey }));
        return;
      }
      if (!ctx.giveById) {
        out.error(msg('这个环境不支持发放物品'));
        return;
      }
      let given = 0;
      for (let i = 0; i < times; i++) {
        for (const stack of rollLoot(table, Math.random)) {
          given += ctx.giveById(stack.id, stack.count);
        }
      }
      out.info(msg('从 {table} 掷了 {times} 次，塞进背包 {given} 件', { table: tableKey, times: times, given: given }));
    },
  },
  {
    name: 'data',
    usage:
      '/data get block <x> <y> <z> [路径] | /data get entity <选择器> [路径] | /data merge block <x> <y> <z> <格号> <物品> [数量] | /data merge entity <选择器> Health <数值> | /data merge entity <选择器> CustomName <名称>',
    description: '读/写方块实体与实体的一个字段子集（没有通用 NBT 路径，见 TASKS）',
    run(args, ctx, out) {
      runData(args, ctx, out);
    },
  },
  {
    name: 'team',
    usage: '/team add|remove|list|join|leave|modify …',
    description: '队伍：建队、拉人、改颜色、前后缀与友好伤害（免伤/碰撞还没接，见 TASKS M23）',
    run(args, ctx, out) {
      runTeam(args, ctx, out);
    },
  },
  {
    name: 'advancement',
    usage: '/advancement grant|revoke <进度 id | *>',
    description: '授予或收回进度（`*` = 全部）',
    run(args, ctx, out) {
      const action = (args[0] ?? '').toLowerCase();
      const target = args[1];
      if ((action !== 'grant' && action !== 'revoke') || !target) {
        out.error(usageError('/advancement grant|revoke <进度 id | *>'));
        return;
      }
      const tracker = ctx.advancements();
      const all = target === '*';
      if (!all && !advancementById(target)) {
        out.error(msg('没有这条进度：{target}', { target: target }));
        return;
      }
      const ids = all ? tracker.defs.map((def) => def.id) : [target];
      let changed = 0;
      for (const id of ids) {
        if (action === 'grant' ? tracker.grant(id) : tracker.revoke(id)) changed++;
      }
      const verb = action === 'grant' ? '授予' : '收回';
      out.info(
      msg('已{verb} {count} 条进度{scope}', {
        verb,
        count: changed,
        scope: all ? msg('（全部）') : `：${target}`,
      }),
    );
    },
  },
  {
    name: 'scoreboard',
    usage: '/scoreboard objectives add|remove|list|setdisplay … / players set|add|remove|operation|get|list|reset …',
    description: '记分板：目标、分数与显示槽位',
    run(args, ctx, out) {
      runScoreboard(args, ctx, out);
    },
  },
];

export function findCommand(name: string): CommandSpec | undefined {
  return COMMANDS.find((spec) => spec.name === name);
}

/** 拆分一行命令：`/give stone 64` → { name: 'give', args: ['stone','64'] } */
export function parseCommand(input: string): { name: string; args: string[] } | null {
  const trimmed = input.trim().replace(/^\//, '');
  if (trimmed.length === 0) return null;
  const parts = trimmed.split(/\s+/);
  return { name: parts[0]!.toLowerCase(), args: parts.slice(1) };
}

/**
 * 执行一行命令（不含前导 `/` 也能识别）。
 * @returns 是否被当作命令处理（false 表示这行不是命令，应该当聊天发出去）
 */
export function executeCommand(input: string, ctx: CommandContext, out: CommandFeedback): boolean {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return false;

  const parsed = parseCommand(trimmed);
  if (!parsed) {
    out.error(t('command.empty'));
    return true;
  }

  const spec = findCommand(parsed.name);
  if (!spec) {
    out.error(tp('command.unknown', { name: parsed.name }));
    return true;
  }

  if (spec.creativeOnly && !ctx.isCreative()) {
    out.error(tp('command.creativeOnly', { name: spec.name }));
    return true;
  }

  try {
    spec.run(parsed.args, ctx, out);
  } catch (error) {
    out.error(tp('command.failed', { message: error instanceof Error ? error.message : String(error) }));
  }
  return true;
}

/** 格式化坐标（保留一位小数，整数不显示小数点） */
function fmt(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** 生物名列表（供补全与报错提示用） */
export function mobNames(): string[] {
  return MOB_TYPES.map((type) => type.id);
}

/** 校验生物名（`/summon` 与别的调用方共用） */
export function isValidMob(name: string): boolean {
  return mobTypeById(name) !== undefined;
}

/** `/help` 与补全都要用的命令名列表 */
export function commandNames(): string[] {
  return COMMANDS.map((spec) => spec.name);
}

/** 方块名是否存在（供 /setblock 的补全用） */
export function isValidBlockName(name: string): boolean {
  return resolveBlockId(name) !== undefined;
}

/** 物品名是否存在 */
export function isValidItemName(name: string): boolean {
  return resolveItemId(name) !== undefined;
}

/** 给界面用：物品名 → 中文名（不认识时原样返回） */
export function displayItem(name: string): string {
  const id = resolveItemId(name);
  return id === undefined ? name : itemLabel(id);
}

/** 常用方块常量导出（命令默认参数用） */
export const COMMAND_BLOCKS = { AIR: Block.AIR, STONE: Block.STONE } as const;

// ---------------------------------------------------------------- /execute（批次 399）

/**
 * `/execute` 的嵌套上限。
 * 不设上限的话 `/execute run execute run execute run …` 能把调用栈打穿
 * （而它不是崩在解析层，是崩在第 3000 层——报错信息对玩家毫无意义）。
 */
const EXECUTE_MAX_DEPTH = 8;

/** 当前嵌套层数：命令是单线程执行的，模块级计数器足够（`finally` 里一定回退） */
let executeDepth = 0;

/** 执行状态：`as` 换执行者、`at` 换原点，两者独立（与原版一致） */
interface ExecState {
  origin: SelectorOrigin;
  executorId: string;
}

type ExecCondition =
  | { kind: 'block'; coords: readonly string[]; block: string }
  | { kind: 'entity'; selector: ParsedSelector }
  /** `/execute if score <目标> <目标名> <运算符> <数值>`（批次 402） */
  | { kind: 'score'; target: string; objective: string; op: string; value: number };

type ExecOp =
  | { kind: 'as'; selector: ParsedSelector }
  | { kind: 'at'; selector: ParsedSelector }
  | { kind: 'positioned'; coords: readonly string[] }
  | { kind: 'cond'; invert: boolean; condition: ExecCondition }
  | { kind: 'run'; command: string };

/** 选择器需要的世界视图（只交数据，筛选规则在 `Selectors.ts`） */
function selectorView(ctx: CommandContext): SelectorView {
  return {
    entities: () => ctx.entities(),
    playerName: () => ctx.playerName(),
  };
}

/** 执行者默认是"自己"：按昵称在快照里找玩家 */
function selfEntityId(ctx: CommandContext): string {
  const name = ctx.playerName().toLowerCase();
  const self = ctx.entities().find((entity) => entity.isPlayer && entity.name.toLowerCase() === name);
  return self?.id ?? PLAYER_ENTITY_ID;
}

/**
 * 把一条链式 `/execute` 拆成操作序列。
 * **先整条解析完再执行**：这样"最后一个 `run` 写错了"不会让前半段已经动了世界
 * （原版也是这个顺序——语法错就一个副作用都不产生）。
 */
function parseExecuteOps(args: readonly string[]): ExecOp[] | string {
  const ops: ExecOp[] = [];
  let index = 0;

  while (index < args.length) {
    const token = (args[index] ?? '').toLowerCase();

    if (token === 'run') {
      const command = args
        .slice(index + 1)
        .join(' ')
        .trim();
      if (command.length === 0) return usageError('/execute … run <命令>');
      ops.push({ kind: 'run', command });
      return ops;
    }

    if (token === 'as' || token === 'at') {
      const text = args[index + 1];
      if (!text) return usageError(`/execute ${token} <目标选择器> … run <命令>`);
      const selector = parseSelector(text);
      if (typeof selector === 'string') return selector;
      ops.push({ kind: token, selector });
      index += 2;
      continue;
    }

    if (token === 'positioned') {
      const coords = args.slice(index + 1, index + 4);
      if (coords.length < 3) return usageError('/execute positioned <x> <y> <z> … run <命令>');
      ops.push({ kind: 'positioned', coords });
      index += 4;
      continue;
    }

    if (token === 'if' || token === 'unless') {
      const sub = (args[index + 1] ?? '').toLowerCase();

      if (sub === 'block') {
        const coords = args.slice(index + 2, index + 5);
        const block = args[index + 5];
        if (coords.length < 3 || !block) return usageError(`/execute ${token} block <x> <y> <z> <方块> … run <命令>`);
        ops.push({ kind: 'cond', invert: token === 'unless', condition: { kind: 'block', coords, block } });
        index += 6;
        continue;
      }

      if (sub === 'entity') {
        const text = args[index + 2];
        if (!text) return usageError(`/execute ${token} entity <目标选择器> … run <命令>`);
        const selector = parseSelector(text);
        if (typeof selector === 'string') return selector;
        ops.push({ kind: 'cond', invert: token === 'unless', condition: { kind: 'entity', selector } });
        index += 3;
        continue;
      }

      if (sub === 'score') {
        // if score <目标> <目标名> <运算符> <数值>
        const target = args[index + 2];
        const objective = args[index + 3];
        const op = args[index + 4];
        const rawValue = args[index + 5];
        if (!target || !objective || !op || rawValue === undefined) {
          return usageError(`/execute ${token} score <目标> <目标名> <运算符> <数值> … run <命令>`);
        }
        if (!SCORE_OPERATORS.includes(op)) {
          return `score 的运算符只能是 ${SCORE_OPERATORS.join(' / ')}：${op}`;
        }
        const value = Number(rawValue);
        if (!Number.isFinite(value)) return `score 的数值不合法：${rawValue}`;
        ops.push({
          kind: 'cond',
          invert: token === 'unless',
          condition: { kind: 'score', target, objective, op, value },
        });
        index += 6;
        continue;
      }

      return `execute 还不支持 ${token} ${sub || '<条件>'}（已支持 block / entity / score）`;
    }

    return `未知的 execute 子命令：${token}（可用 as / at / positioned / if / unless / run）`;
  }

  return usageError('/execute … run <命令>');
}

/** 求一个条件。坐标与选择器都相对**当前执行原点**（`at` / `positioned` 之后的值） */
function evalCondition(condition: ExecCondition, state: ExecState, ctx: CommandContext, out: CommandFeedback): boolean {
  if (condition.kind === 'block') {
    const position = parsePosition([...condition.coords], state.origin);
    if (!position) {
      out.error(msg('execute if block：坐标不合法'));
      return false;
    }
    const id = resolveBlockId(condition.block);
    if (id === undefined) {
      out.error(msg('找不到方块：{name}', { name: condition.block }));
      return false;
    }
    return (
      ctx.getBlock(Math.floor(position.x), Math.floor(position.y), Math.floor(position.z)) === id
    );
  }

  if (condition.kind === 'entity') {
    return resolveSelector(condition.selector, selectorView(ctx), state.origin, state.executorId).length > 0;
  }

  // `if score`：目标可以写名字，也可以写选择器；**多目标时要求每一个都满足**
  // （原版按目标逐个求值，写成"任意一个满足"会让 `if score @a kills > 5`
  //  在只有一个人达标时也放行——那不是玩家想要的语义）
  const holders = holderNamesOf(condition.target, state, ctx, out);
  if (holders === null) return false;
  if (holders.length === 0) return false;
  const board = ctx.scoreboard();
  return holders.every((holder) => {
    const score = board.getScore(holder, condition.objective);
    if (score === null) return false; // 原版：没有这条分数就是"不成立"，不按 0 算
    return compareScore(score, condition.op, condition.value);
  });
}

/** `if score` 的运算符（只认这六个，写别的当场报错） */
const SCORE_OPERATORS: readonly string[] = ['<', '<=', '=', '==', '>=', '>'];

function compareScore(score: number, op: string, value: number): boolean {
  switch (op) {
    case '<':
      return score < value;
    case '<=':
      return score <= value;
    case '=':
    case '==':
      return score === value;
    case '>=':
      return score >= value;
    case '>':
      return score > value;
    default:
      return false;
  }
}

/**
 * 记分板命令里的"目标"：可以是一个名字（`甲`），也可以是选择器（`@a` / `@e[type=zombie]`）。
 * 选择器解析失败时**返回 null 并已报错**（与"匹配到 0 个"的 `[]` 区分开）。
 */
function holderNamesOf(
  target: string,
  state: ExecState,
  ctx: CommandContext,
  out: CommandFeedback,
): string[] | null {
  if (!isSelector(target)) return [target];
  const selector = parseSelector(target);
  if (typeof selector === 'string') {
    out.error(selector);
    return null;
  }
  return resolveSelector(selector, selectorView(ctx), state.origin, state.executorId).map((entity) => entity.name);
}

/**
 * 派生一个"执行原点被替换掉"的上下文。
 *
 * ⚠️ 用 `Object.create(ctx)` 而不是 `{ ...ctx }`：主程序交来的是对象字面量
 * （展开没问题），但测试里的 `FakeWorld` 是类实例——它的方法在**原型**上，
 * 展开会把整批方法丢掉，而报错方式是"`ctx.give is not a function`"，
 * 看起来像命令写错了。
 */
function withExecutionOrigin(ctx: CommandContext, origin: SelectorOrigin): CommandContext {
  const dimension = ctx.position().dimension;
  const derived = Object.create(ctx) as CommandContext;
  derived.position = () => ({ x: origin.x, y: origin.y, z: origin.z, dimension });
  return derived;
}

function runExecOps(
  ops: readonly ExecOp[],
  index: number,
  state: ExecState,
  ctx: CommandContext,
  out: CommandFeedback,
): void {
  if (index >= ops.length) return;
  const op = ops[index]!;

  switch (op.kind) {
    case 'run': {
      if (executeDepth >= EXECUTE_MAX_DEPTH) {
        out.error(msg('execute 嵌套太深（上限 {limit} 层）', { limit: EXECUTE_MAX_DEPTH }));
        return;
      }
      executeDepth++;
      try {
        executeCommand(`/${op.command}`, withExecutionOrigin(ctx, state.origin), out);
      } finally {
        executeDepth--;
      }
      return;
    }

    case 'as': {
      const targets = resolveSelector(op.selector, selectorView(ctx), state.origin, state.executorId);
      if (targets.length === 0) {
        out.error(msg('选择器 {selector} 没有匹配到任何目标', { selector: describeSelector(op.selector) }));
        return;
      }
      for (const target of targets) {
        // `as` 只换执行者，**不动位置**（位置由 `at` 负责）
        runExecOps(ops, index + 1, { ...state, executorId: target.id }, ctx, out);
      }
      return;
    }

    case 'at': {
      const targets = resolveSelector(op.selector, selectorView(ctx), state.origin, state.executorId);
      if (targets.length === 0) {
        out.error(msg('选择器 {selector} 没有匹配到任何目标', { selector: describeSelector(op.selector) }));
        return;
      }
      for (const target of targets) {
        runExecOps(ops, index + 1, { ...state, origin: { x: target.x, y: target.y, z: target.z } }, ctx, out);
      }
      return;
    }

    case 'positioned': {
      const position = parsePosition([...op.coords], state.origin);
      if (!position) {
        out.error(msg('execute positioned：坐标不合法'));
        return;
      }
      runExecOps(ops, index + 1, { ...state, origin: position }, ctx, out);
      return;
    }

    case 'cond': {
      const ok = evalCondition(op.condition, state, ctx, out);
      const pass = op.invert ? !ok : ok;
      // 条件不满足时**静默**（原版也是不输出任何东西）
      if (pass) runExecOps(ops, index + 1, state, ctx, out);
      return;
    }
  }
}

/** `/execute` 的入口 */
function runExecute(args: string[], ctx: CommandContext, out: CommandFeedback): void {
  const ops = parseExecuteOps(args);
  if (typeof ops === 'string') {
    out.error(ops);
    return;
  }

  const position = ctx.position();
  const state: ExecState = {
    origin: { x: position.x, y: position.y, z: position.z },
    executorId: selfEntityId(ctx),
  };
  runExecOps(ops, 0, state, ctx, out);
}

// ---------------------------------------------------------------- /scoreboard（批次 402）

/**
 * `/scoreboard` 的用法提示。
 *
 * ⚠️ 必须是**函数**，不能是模块级常量：常量在模块加载时求值一次，
 * 那一刻语言还是默认的 zh，之后切到英文也不会变 —— 实测就是这样漏出中文。
 * 一次错误示范：它原来叫 `scoreboardUsage()`，实测英文模式下仍是「用法：…」。
 */
function scoreboardUsage(): string {
  return (
    usageError('/scoreboard objectives <add|remove|list|setdisplay> …') +
    msg(' 或 ') +
    usageError('/scoreboard players <set|add|remove|operation|get|list|reset> …')
  );
}

function runScoreboard(args: string[], ctx: CommandContext, out: CommandFeedback): void {
  const branch = (args[0] ?? '').toLowerCase();
  if (branch === 'objectives') {
    runScoreboardObjectives(args, ctx, out);
    return;
  }
  if (branch === 'players') {
    runScoreboardPlayers(args, ctx, out);
    return;
  }
  out.error(scoreboardUsage());
}

function runScoreboardObjectives(args: string[], ctx: CommandContext, out: CommandFeedback): void {
  const board = ctx.scoreboard();
  const sub = (args[1] ?? '').toLowerCase();

  if (sub === 'add') {
    const name = args[2];
    const criterion = (args[3] ?? 'dummy').toLowerCase();
    const displayName = args.slice(4).join(' ').trim();
    if (!name) {
      out.error(usageError('/scoreboard objectives add <名称> [准则] [显示名]'));
      return;
    }
    if (!isValidScoreName(name)) {
      out.error(msg('目标名只能用字母/数字/下划线，1~16 个字符：{name}', { name: name }));
      return;
    }
    if (!SUPPORTED_CRITERIA.includes(criterion)) {
      out.error(msg('暂不支持准则 {criterion}（只有 {supported}）', { criterion: criterion, supported: SUPPORTED_CRITERIA.join(' / ') }));
      return;
    }
    if (!board.addObjective(name, criterion, displayName)) {
      out.error(msg('目标 {name} 已经存在', { name: name }));
      return;
    }
    out.info(
      msg('已创建目标 {name}（{criterion}{display}）', {
        name,
        criterion,
        display: displayName ? msg('，显示为“{display}”', { display: displayName }) : '',
      }),
    );
    return;
  }

  if (sub === 'remove') {
    const name = args[2];
    if (!name) {
      out.error(usageError('/scoreboard objectives remove <名称>'));
      return;
    }
    if (!board.removeObjective(name)) {
      out.error(msg('目标 {name} 不存在', { name: name }));
      return;
    }
    out.info(msg('已删除目标 {name}（连同它记下的所有分数）', { name: name }));
    return;
  }

  if (sub === 'list') {
    const names = board.objectiveNames();
    if (names.length === 0) {
      out.info(msg('还没有任何记分板目标'));
      return;
    }
    const described = names.map((name) => {
      const objective = board.objective(name)!;
      const shown = objective.displayName === objective.name ? '' : `，显示为“${objective.displayName}”`;
      return `${objective.name}（${objective.criterion}${shown}）`;
    });
    out.info(msg('共 {count} 个目标：{list}', { count: names.length, list: described.join('、') }));
    return;
  }

  if (sub === 'setdisplay') {
    const slot = (args[2] ?? '').toLowerCase() as ScoreboardSlot;
    if (!SCOREBOARD_SLOTS.includes(slot)) {
      out.error(msg('槽位只能是 {slots}', { slots: SCOREBOARD_SLOTS.join(' / ') }));
      return;
    }
    const objective = args[3];
    if (!objective) {
      board.setDisplay(slot, null);
      out.info(msg('已清空{slot}', { slot: pickLabel(SLOT_LABELS[slot], SLOT_LABELS_EN[slot]) }));
      return;
    }
    if (!board.setDisplay(slot, objective)) {
      out.error(msg('目标 {name} 不存在', { name: objective }));
      return;
    }
    out.info(msg('{slot}现在显示目标 {objective}', { slot: pickLabel(SLOT_LABELS[slot], SLOT_LABELS_EN[slot]), objective: objective }));
    return;
  }

  out.error(usageError('/scoreboard objectives <add|remove|list|setdisplay> …'));
}

/**
 * `/data`（批次 479 只做 `get`，批次 623 补成 `get|merge`）。
 *
 * 原版的 `merge` / `modify` 要"按 NBT 路径写"，本项目的实体与方块数据是强类型字段
 * （坐标、血量、状态位），**没有一棵可写的 NBT 树**。所以这里的策略是：
 * 只承认真实存在的那几项，路径白名单在 `BlockData.ts`（纯逻辑、可离线断言）。
 *
 *   /data get   block <x> <y> <z> [路径]      → 方块是什么 / 容器里有什么
 *   /data get   entity <选择器> [路径]        → Pos / 血量 / 名字
 *   /data merge block <x> <y> <z> <格号> <物品> [数量]
 *   /data merge entity <选择器> Health <值>
 *   /data merge entity <选择器> CustomName <名字>
 *
 * `modify` 不做（原版它是"对数字做 +="，我们这边能被它改的只有血量一项，
 * 为了一个字段引入一套运算语法不值得），遇到时明确说一句。
 *
 * 读出来的是**人话**（`Pos = [1.5, 64.0, -3.2]`），不是 JSON：
 * 这是个调试命令，玩家要看的是"它在哪、是什么"。
 */
function runData(args: string[], ctx: CommandContext, out: CommandFeedback): void {
  const usage = usageError(
    '/data get block <x> <y> <z> [路径] | /data get entity <选择器> [路径] | /data merge block <x> <y> <z> <格号> <物品> [数量] | /data merge entity <选择器> Health <数值> | /data merge entity <选择器> CustomName <名称>',
  );
  const mode = (args[0] ?? '').toLowerCase();
  const kind = (args[1] ?? '').toLowerCase();
  if ((mode !== 'get' && mode !== 'merge') || (kind !== 'entity' && kind !== 'block')) {
    // `modify` 单独给一句人话，而不是让它落进"用法错误"里
    if (mode === 'modify') {
      out.error(msg('/data modify 还没实现：能被它改的只有血量一项，直接用 /data merge entity <选择器> Health <值>'));
      return;
    }
    out.error(usage);
    return;
  }

  if (kind === 'entity') {
    if (mode === 'get') runDataGetEntity(args, ctx, out, usage);
    else runDataMergeEntity(args, ctx, out, usage);
    return;
  }
  if (mode === 'get') runDataGetBlock(args, ctx, out, usage);
  else runDataMergeBlock(args, ctx, out, usage);
}

/** 把一个选择器解析成"能操作的实体 id"（找不到就把错报出去并返回 null） */
function resolveOneTarget(
  target: string | undefined,
  ctx: CommandContext,
  out: CommandFeedback,
): string | null {
  if (!target) return null;
  const position = ctx.position();
  const state: ExecState = {
    origin: { x: position.x, y: position.y, z: position.z },
    executorId: selfEntityId(ctx),
  };
  const selector = parseSelector(target);
  if (typeof selector === 'string') {
    out.error(selector);
    return null;
  }
  const found = resolveSelector(selector, selectorView(ctx), state.origin, state.executorId);
  if (found.length === 0) {
    out.error(msg('没有匹配到实体：{target}', { target: target }));
    return null;
  }
  // 写回只对**第一个**匹配的实体做（原版 `merge` 也是对所有匹配的都写，
  // 但我们的写入口一次只能改一只，多目标就变成"静默只改了第一只"——
  // 不如明说一句，让玩家自己写 @e[limit=1]
  if (found.length > 1) {
    out.error(msg('一次只能改一只实体（匹配到 {count} 只）：请把选择器写窄一点，例如 @e[type=zombie,limit=1]', {
      count: found.length,
    }));
    return null;
  }
  return found[0]!.id;
}

/** `/data get entity <选择器> [路径]` */
function runDataGetEntity(args: string[], ctx: CommandContext, out: CommandFeedback, usage: string): void {
  const target = args[2];
  if (!target) {
    out.error(usage);
    return;
  }
  const path = parseDataPath(args[3]);
  if (path === null || !pathFitsEntity(path)) {
    out.error(msg('实体上没有这条路径：{path}（能读的有 {paths}）', {
      path: args[3] ?? '',
      paths: ENTITY_PATHS.join(' / '),
    }));
    return;
  }
  const position = ctx.position();
  const state: ExecState = {
    origin: { x: position.x, y: position.y, z: position.z },
    executorId: selfEntityId(ctx),
  };
  // 名字（非选择器）也当实体名处理：原版 `@e` 与 `Steve` 都收
  const selector = parseSelector(target);
  if (typeof selector === 'string') {
    out.error(selector);
    return;
  }
  const found = resolveSelector(selector, selectorView(ctx), state.origin, state.executorId);
  if (found.length === 0) {
    out.error(msg('没有匹配到实体：{target}', { target: target }));
    return;
  }
  // 最多列 5 只（原版也是"只显示第一个 + 数量"，这里折中）
  for (const entity of found.slice(0, 5)) {
    const fields = ctx.entityData?.(entity.id);
    if (path.kind === 'health') {
      if (fields?.health === undefined) {
        // 掉落物/箭/矿车这类没有血量：报一句，而不是显示 0
        out.info(msg('{name} 没有血量这一项', { name: entity.name }));
        continue;
      }
      out.info(msg('{name} Health = {value}{max}', {
        name: entity.name,
        value: fmt(fields.health),
        max: fields.maxHealth === undefined ? '' : ` / ${fmt(fields.maxHealth)}`,
      }));
      continue;
    }
    if (path.kind === 'customName') {
      out.info(msg('{name} CustomName = {value}', {
        name: entity.name,
        value: fields?.customName ?? msg('（没有名字）'),
      }));
      continue;
    }
    const parts = [
      `Pos = [${entity.x.toFixed(1)}, ${entity.y.toFixed(1)}, ${entity.z.toFixed(1)}]`,
      `type = ${entity.type}`,
      `name = ${entity.name}`,
    ];
    if (fields?.health !== undefined) {
      parts.push(`Health = ${fmt(fields.health)}${fields.maxHealth === undefined ? '' : ` / ${fmt(fields.maxHealth)}`}`);
    }
    if (fields?.customName !== undefined) parts.push(`CustomName = ${fields.customName}`);
    out.info(`${entity.type}（${entity.name}）：${parts.join('，')}`);
  }
  if (found.length > 5) out.info(msg('……还有 {count} 个匹配', { count: found.length - 5 }));
}

/**
 * 解析 `<x> <y> <z>`（从 `args[offset]` 起三个），支持 `~` 相对写法。
 *
 * 为什么要单独一个函数：这批之前 `/data` 的三个坐标是 `Number(raw)` 直接转的，
 * `~` 会变成 NaN 然后报"用法错误"——而**原版是收相对坐标的**，
 * 实测第一条 `\/data get block ~ ~-1 ~`（"看我脚下是什么"，最自然的写法）就被拒了。
 *
 * @returns null = 三个都缺或有一个不是合法坐标（调用方报用法）
 */
function parseBlockXYZ(
  args: string[],
  offset: number,
  ctx: CommandContext,
): { x: number; y: number; z: number } | null {
  const raw = [args[offset], args[offset + 1], args[offset + 2]];
  if (raw.some((text) => text === undefined)) return null;
  const pos = ctx.position();
  const x = parseCoordinate(raw[0], pos.x);
  const y = parseCoordinate(raw[1], pos.y);
  const z = parseCoordinate(raw[2], pos.z);
  if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(z)) return null;
  return { x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) };
}

/** `/data get block <x> <y> <z> [路径]` */
function runDataGetBlock(args: string[], ctx: CommandContext, out: CommandFeedback, usage: string): void {
  const at = parseBlockXYZ(args, 2, ctx);
  if (!at) {
    out.error(usage);
    return;
  }
  const bx = at.x;
  const by = at.y;
  const bz = at.z;
  if (!ctx.blockInfoAt) {
    out.error(msg('这个维度读不到方块数据'));
    return;
  }
  const info = ctx.blockInfoAt(bx, by, bz);
  if (!info) {
    out.error(msg('({x}, {y}, {z}) 是空气或还没加载', { x: bx, y: by, z: bz }));
    return;
  }
  const path = parseDataPath(args[5]);
  if (path === null || !pathFitsBlock(path)) {
    out.error(msg('这个方块上没有这条路径：{path}（能读的有 {paths}）', {
      path: args[5] ?? '',
      paths: BLOCK_PATHS.join(' / '),
    }));
    return;
  }

  const data = ctx.blockEntityAt?.(bx, by, bz) ?? null;
  if (path.kind === 'slot') {
    if (!data) {
      out.error(msg('({x}, {y}, {z}) 的 {name} 没有方块实体（不是容器）', { x: bx, y: by, z: bz, name: info.name }));
      return;
    }
    const entry = slotAt(data, path.index);
    if (!entry) {
      // 越界与空格分开说：前者是格号算错了，后者是"这里本来就空"
      if (!canWriteSlot(data, path.index)) {
        out.error(msg('格号越界：{index}（这种容器只有 {count} 格，0 ~ {last}）', {
          index: path.index,
          count: data.slots.length,
          last: Math.max(0, data.slots.length - 1),
        }));
        return;
      }
      out.info(msg('Slots[{index}] =（空）', { index: path.index }));
      return;
    }
    out.info(msg('Slots[{index}] = {item} ×{count}', {
      index: entry.index,
      item: `${itemLabel(entry.id)}（${itemName(entry.id)}）`,
      count: entry.count,
    }));
    return;
  }

  // 根：方块是什么 + 方块实体里有什么
  if (!data) {
    out.info(msg('({x}, {y}, {z}) = {name}（状态位 {state}，没有方块实体）', {
      x: bx,
      y: by,
      z: bz,
      name: info.name,
      state: info.state,
    }));
    return;
  }
  const filled = filledSlots(data);
  out.info(msg('({x}, {y}, {z}) = {name}（状态位 {state}，方块实体 {kind}，共 {total} 格，{used} 格有东西）', {
    x: bx,
    y: by,
    z: bz,
    name: info.name,
    state: info.state,
    kind: data.kind,
    total: data.slots.length,
    used: filled.length,
  }));
  for (const entry of filled) {
    out.info(msg('  Slots[{index}] = {item} ×{count}', {
      index: entry.index,
      item: `${itemLabel(entry.id)}（${itemName(entry.id)}）`,
      count: entry.count,
    }));
  }
}

/** `/data merge block <x> <y> <z> <格号> <物品> [数量]` */
function runDataMergeBlock(args: string[], ctx: CommandContext, out: CommandFeedback, usage: string): void {
  const at = parseBlockXYZ(args, 2, ctx);
  const slotArg = args[5];
  const itemArg = args[6];
  if (!at || slotArg === undefined || itemArg === undefined) {
    out.error(usage);
    return;
  }
  const bx = at.x;
  const by = at.y;
  const bz = at.z;
  const index = Number(slotArg);
  if (!Number.isSafeInteger(index) || index < 0) {
    out.error(msg('格号必须是不小于 0 的整数：{value}', { value: slotArg }));
    return;
  }
  const count = args[7] === undefined ? 1 : Number(args[7]);
  if (!Number.isFinite(count) || count <= 0 || !Number.isInteger(count)) {
    out.error(msg('数量必须是正整数：{value}', { value: args[7] ?? '' }));
    return;
  }
  const itemId = resolveItemId(itemArg);
  if (itemId === undefined) {
    out.error(msg('找不到物品：{name}（可以试 /data merge block … 1 stone）', { name: itemArg }));
    return;
  }
  if (!ctx.setBlockEntitySlots) {
    out.error(msg('这个维度写不了方块实体'));
    return;
  }
  const data = ctx.blockEntityAt?.(bx, by, bz) ?? null;
  if (!data) {
    out.error(msg('({x}, {y}, {z}) 没有方块实体（不是容器）', { x: bx, y: by, z: bz }));
    return;
  }
  if (!canWriteSlot(data, index)) {
    out.error(msg('格号越界：{index}（这种容器只有 {count} 格，0 ~ {last}）', {
      index,
      count: data.slots.length,
      last: data.slots.length - 1,
    }));
    return;
  }
  // 整组内容拷一份再改（`data.slots` 可能是只读快照）
  const next: (ItemStack | null)[] = data.slots.map((stack) => (stack ? { ...stack } : null));
  next[index] = { id: itemId, count };
  if (!ctx.setBlockEntitySlots(bx, by, bz, next)) {
    out.error(msg('({x}, {y}, {z}) 写不进去（这一格不是容器方块）', { x: bx, y: by, z: bz }));
    return;
  }
  out.info(msg('已把 ({x}, {y}, {z}) 的 Slots[{index}] 设为 {item} ×{count}', {
    x: bx,
    y: by,
    z: bz,
    index,
    item: `${itemLabel(itemId)}（${itemName(itemId)}）`,
    count,
  }));
}

/** `/data merge entity <选择器> Health|CustomName <值>` */
function runDataMergeEntity(args: string[], ctx: CommandContext, out: CommandFeedback, usage: string): void {
  const target = args[2];
  const field = (args[3] ?? '').toLowerCase();
  const value = args.slice(4).join(' ').trim();
  if (!target || field.length === 0 || value.length === 0) {
    out.error(usage);
    return;
  }
  if (field !== 'health' && field !== 'customname') {
    out.error(msg('实体上能写的只有 Health 与 CustomName，没有 {field}', { field: args[3] ?? '' }));
    return;
  }
  if (!ctx.setEntityData) {
    out.error(msg('这个维度写不了实体数据'));
    return;
  }
  const entityId = resolveOneTarget(target, ctx, out);
  if (entityId === null) return;

  const fields = ctx.entityData?.(entityId) ?? null;
  if (field === 'health') {
    const parsed = parseHealthValue(value, fields?.maxHealth ?? Infinity);
    if (parsed === null) {
      out.error(msg('Health 需要一个数字：{value}', { value }));
      return;
    }
    if (fields?.health === undefined) {
      out.error(msg('这只实体没有血量这一项（只有生物有）'));
      return;
    }
    if (!ctx.setEntityData(entityId, { health: parsed })) {
      out.error(msg('写不进去：这只实体不支持改血量'));
      return;
    }
    const clamped = fields.maxHealth !== undefined && Number(value) > fields.maxHealth;
    out.info(msg('已把血量设为 {value}{max}{note}', {
      value: fmt(parsed),
      max: fields.maxHealth === undefined ? '' : ` / ${fmt(fields.maxHealth)}`,
      // 夹取必须说出来：玩家写 999 时看到 20，才知道是夹了而不是没生效
      note: clamped ? msg('（超出上限，已夹到上限）') : '',
    }));
    return;
  }

  // CustomName
  if (fields === null) {
    out.error(msg('找不到这只实体'));
    return;
  }
  if (!ctx.setEntityData(entityId, { customName: value })) {
    out.error(msg('写不进去：这只实体不支持改名'));
    return;
  }
  out.info(msg('已把名字设为「{name}」', { name: value }));
}

/**
 * `/team`（批次 468）。
 *
 * ⚠️ 只做**数据层**：建队 / 拉人 / 查归属 / 改颜色与友好伤害。
 * 队友免伤、碰撞开关、名字颜色三项要"伤害来源"与"名字渲染"，还没接
 * （差异写在 `Teams.ts` 的文件头与 TASKS M23 里）。
 */
/**
 * 剥掉前后缀两侧的引号。
 *
 * 为什么需要：原版清除前后缀写 `/team modify red prefix ""`，而我们的命令解析
 * 把 `""` 当成**字面两个引号**（没有引号语法）。不剥的话"清空"会变成"前后缀是
 * 一对引号"，而且玩家没法把它改回来——只有在再敲一次空值时才是空的。
 * 只剥**成对**的 `"` / `'`（`"红"` → `红`），不剥中间出现的。
 */
function stripAffixQuotes(raw: string): string {
  const text = raw.trim();
  if (text.length < 2) return text;
  const first = text[0];
  const last = text[text.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return text.slice(1, -1);
  }
  return text;
}

function runTeam(args: string[], ctx: CommandContext, out: CommandFeedback): void {
  const teams = ctx.teams();
  const sub = (args[0] ?? '').toLowerCase();
  const usage =
    usageError(
      '/team add <队伍> [显示名] | remove <队伍> | list | join <队伍> [成员] | leave [成员] | modify <队伍> friendlyFire <true|false> | color <颜色> | prefix <前缀> | suffix <后缀>',
    );

  if (sub === 'add') {
    const name = args[1];
    if (!name) {
      out.error(usage);
      return;
    }
    const displayName = args.slice(2).join(' ').trim();
    if (!teams.add(name, displayName)) {
      out.error(msg('队伍 {name} 已经存在', { name: name }));
      return;
    }
    out.info(
      msg('已创建队伍 {name}{display}', {
        name,
        display: displayName ? msg('（显示为「{display}」）', { display: displayName }) : '',
      }),
    );
    return;
  }

  if (sub === 'remove') {
    const name = args[1];
    if (!name) {
      out.error(usage);
      return;
    }
    if (!teams.remove(name)) {
      out.error(msg('队伍 {name} 不存在', { name: name }));
      return;
    }
    out.info(msg('已删除队伍 {name}（成员一并解绑）', { name: name }));
    return;
  }

  if (sub === 'list') {
    const all = teams.list();
    if (all.length === 0) {
      out.info(msg('还没有任何队伍'));
      return;
    }
    const described = all.map((team) => {
      const members = teams.membersOf(team.name);
      const shown = team.displayName === team.name ? '' : `，显示为「${team.displayName}」`;
      // 前后缀只在设过的时候才写出来：没设的队伍那一段是噪声
      const affix = `${team.prefix ? `，前缀「${team.prefix}」` : ''}${team.suffix ? `，后缀「${team.suffix}」` : ''}`;
      return `${team.name}（${team.color}，友好伤害${team.friendlyFire ? '开' : '关'}${shown}${affix}，${members.length} 人）`;
    });
    out.info(msg('共 {count} 个队伍：{list}', { count: all.length, list: described.join('；') }));
    return;
  }

  if (sub === 'join' || sub === 'leave') {
    const teamName = sub === 'join' ? args[1] : undefined;
    const memberArg = sub === 'join' ? args[2] : args[1];
    if (sub === 'join' && !teamName) {
      out.error(usage);
      return;
    }
    // 队不存在要**先说清楚**：否则 `teams.join` 返回 false 会被下面的分支
    // 误报成"成员名字不合法"（第一版就是这么错的）
    if (sub === 'join' && !teams.get(teamName!)) {
      out.error(msg('队伍 {name} 不存在', { name: teamName }));
      return;
    }
    const position = ctx.position();
    const state: ExecState = {
      origin: { x: position.x, y: position.y, z: position.z },
      executorId: selfEntityId(ctx),
    };
    // 成员省略 = 自己（原版 `/team join <队>` 就是把自己拉进去）
    const members = memberArg
      ? holderNamesOf(memberArg, state, ctx, out)
      : [ctx.playerName()];
    if (members === null) return;
    if (members.length === 0) {
      out.error(msg('成员 {member} 没有匹配到任何对象', { member: memberArg }));
      return;
    }
    if (sub === 'join') {
      for (const member of members) {
        if (!teams.join(teamName!, member)) {
          out.error(msg('成员 {name} 的名字不合法（1~16 个字符）', { name: member }));
          continue;
        }
        out.info(msg('已把 {member} 加入队伍 {team}', { member: member, team: teamName }));
      }
    } else {
      for (const member of members) {
        if (!teams.leave(member)) {
          out.info(msg('{member} 本来就不在任何队伍里', { member: member }));
          continue;
        }
        out.info(msg('已让 {member} 退出队伍', { member: member }));
      }
    }
    return;
  }

  if (sub === 'modify') {
    const name = args[1];
    const key = (args[2] ?? '').toLowerCase();
    const value = args[3];
    const isAffix = key === 'prefix' || key === 'suffix';
    // 前后缀**可以不带值**（`/team modify red prefix` = 清除，原版也允许省略或写 `""`）；
    // friendlyFire / color 必须带值，少一个就报用法而不是静默改坏。
    if (!name || !key || (value === undefined && !isAffix)) {
      out.error(usage);
      return;
    }
    if (!teams.get(name)) {
      out.error(msg('队伍 {name} 不存在', { name: name }));
      return;
    }
    if (key === 'friendlyfire') {
      const on = value.toLowerCase() === 'true';
      if (value.toLowerCase() !== 'true' && value.toLowerCase() !== 'false') {
        out.error(msg('友好伤害只能是 true 或 false'));
        return;
      }
      teams.setFriendlyFire(name, on);
      // `state` 也要过 `msg()`（理由同下面 prefix/suffix 那条注释）
      out.info(msg('队伍 {name} 的友好伤害已{state}', { name: name, state: msg(on ? '打开' : '关闭') }));
      return;
    }
    if (key === 'color') {
      if (!teams.setColor(name, value.toLowerCase())) {
        out.error(msg('颜色不认识：{value}（可用 {colors}）', { value: value, colors: TEAM_COLORS.join(' / ') }));
        return;
      }
      out.info(msg('队伍 {name} 的颜色已改为 {color}', { name: name, color: value.toLowerCase() }));
      return;
    }
    if (isAffix) {
      // 前后缀是自由文本，**空格要保留**（`[ 红 队 ]` 这种就是想带空格），
      // 所以把第 4 段之后全部拼回来；两侧的引号（原版写 `""` 表示清空）先剥掉。
      const text = stripAffixQuotes(args.slice(3).join(' '));
      const applied = key === 'prefix' ? teams.setPrefix(name, text) : teams.setSuffix(name, text);
      if (!applied) {
        out.error(msg('队伍 {name} 不存在', { name: name }));
        return;
      }
      // ⚠️ 参数本身也要过 `msg()`：`msg()` 只替换 {占位符}、**不会翻译传进来的值**，
      // 直接把 '前缀' 塞进去，英文界面上就会出现 "Cleared the 前缀 of team red"
      // （既有那条 `友好伤害已{state}` 是同一个问题，本轮顺手一起修）
      const part = msg(key === 'prefix' ? '前缀' : '后缀');
      // 提示里用**清洗之后**的值：玩家敲了换行/超长时，看到的是真正生效的那一段
      const shown = key === 'prefix' ? (teams.get(name)?.prefix ?? '') : (teams.get(name)?.suffix ?? '');
      out.info(
        shown.length === 0
          ? msg('队伍 {name} 的{part}已清除', { name: name, part })
          : msg('队伍 {name} 的{part}已改为「{text}」', { name: name, part, text: shown }),
      );
      return;
    }
    out.error(msg('不认识的属性 {key}（只有 friendlyFire / color / prefix / suffix）', { key: key }));
    return;
  }

  out.error(usage);
}

function runScoreboardPlayers(args: string[], ctx: CommandContext, out: CommandFeedback): void {
  const board = ctx.scoreboard();
  const sub = (args[1] ?? '').toLowerCase();
  const target = args[2];
  if (!target) {
    out.error(usageError('/scoreboard players <set|add|remove|operation|get|list|reset> <目标> …'));
    return;
  }

  // 目标可以是名字，也可以是选择器（`@a` / `@e[type=zombie]`）
  const position = ctx.position();
  const state: ExecState = {
    origin: { x: position.x, y: position.y, z: position.z },
    executorId: selfEntityId(ctx),
  };
  const holders = holderNamesOf(target, state, ctx, out);
  if (holders === null) return;
  if (holders.length === 0) {
    out.error(msg('目标 {target} 没有匹配到任何对象', { target: target }));
    return;
  }

  if (sub === 'set' || sub === 'add' || sub === 'remove') {
    const objective = args[3];
    const raw = args[4];
    if (!objective || raw === undefined) {
      out.error(usageError(`/scoreboard players ${sub} <目标> <目标名> <分数>`));
      return;
    }
    const amount = Number(raw);
    if (!Number.isFinite(amount)) {
      out.error(msg('分数必须是数字：{raw}', { raw: raw }));
      return;
    }
    if (!board.objective(objective)) {
      out.error(msg('目标 {name} 不存在', { name: objective }));
      return;
    }
    for (const holder of holders) {
      if (sub === 'set') {
        board.setScore(holder, objective, amount);
        out.info(msg('已将 {holder} 的 {objective} 设为 {score}', { holder: holder, objective: objective, score: board.getScore(holder, objective) }));
      } else if (sub === 'add') {
        const next = board.addScore(holder, objective, amount);
        out.info(msg('已将 {holder} 的 {objective} 加至 {score}', { holder: holder, objective: objective, score: next }));
      } else {
        const next = board.removeScore(holder, objective, amount);
        out.info(msg('已将 {holder} 的 {objective} 减至 {score}', { holder: holder, objective: objective, score: next }));
      }
    }
    return;
  }

  // ---- 运算（批次 467）：target = target op source，两边缺分数按 0 算
  if (sub === 'operation') {
    const objective = args[3];
    const op = (args[4] ?? '') as ScoreOperation;
    const sourceTarget = args[5];
    const sourceObjective = args[6];
    if (!objective || !SCORE_OPERATIONS.includes(op) || !sourceTarget || !sourceObjective) {
      out.error(
        usageError(
          `/scoreboard players operation <目标> <目标名> <运算> <来源> <来源目标名>（运算：${SCORE_OPERATIONS.join(' ')}）`,
        ),
      );
      return;
    }
    if (!board.objective(objective)) {
      out.error(msg('目标 {name} 不存在', { name: objective }));
      return;
    }
    if (!board.objective(sourceObjective)) {
      out.error(msg('目标 {name} 不存在', { name: sourceObjective }));
      return;
    }
    const sourceHolders = holderNamesOf(sourceTarget, state, ctx, out);
    if (sourceHolders === null) return;
    if (sourceHolders.length === 0) {
      out.error(msg('来源 {source} 没有匹配到任何对象', { source: sourceTarget }));
      return;
    }
    // 原版是"每个 target 与每个 source 各算一次"（两边都可以是选择器）
    for (const holder of holders) {
      for (const source of sourceHolders) {
        const next = board.operate(holder, objective, op, source, sourceObjective);
        out.info(msg('已将 {holder} 的 {objective} 设为 {score}（{op} {source} 的 {sourceObjective}）', { holder: holder, objective: objective, score: next, op: op, source: source, sourceObjective: sourceObjective }));
      }
    }
    return;
  }

  if (sub === 'get') {
    const objective = args[3];
    if (!objective) {
      out.error(usageError('/scoreboard players get <目标> <目标名>'));
      return;
    }
    if (!board.objective(objective)) {
      out.error(msg('目标 {name} 不存在', { name: objective }));
      return;
    }
    for (const holder of holders) {
      const score = board.getScore(holder, objective);
      if (score === null) out.info(msg('{holder} 没有 {objective} 的分数', { holder: holder, objective: objective }));
      else out.info(msg('{holder} 的 {objective} 是 {score}', { holder: holder, objective: objective, score: score }));
    }
    return;
  }

  if (sub === 'list') {
    for (const holder of holders) {
      const objectives = board.objectivesOf(holder);
      if (objectives.length === 0) {
        out.info(msg('{holder} 还没有任何分数', { holder: holder }));
        continue;
      }
      const parts = objectives.map((name) => `${name}=${board.getScore(holder, name)}`);
      out.info(`${holder}：${parts.join('，')}`);
    }
    return;
  }

  if (sub === 'reset') {
    for (const holder of holders) {
      const removed = board.resetHolder(holder);
      out.info(
      removed === 0
        ? msg('{holder} 本来就没有分数', { holder })
        : msg('已清空 {holder} 的 {count} 个目标的分数', { holder, count: removed }),
    );
    }
    return;
  }

  out.error(usageError('/scoreboard players <set|add|remove|operation|get|list|reset> <目标> …'));
}
