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

import { resolveBlockId, resolveItemId, translateName, itemLabel } from '../registry/itemNames.ts';
import { Block } from '../registry/blocks.ts';
import { mobTypeById, MOB_TYPES } from '../entity/mobs.ts';
import { ENCHANTMENTS } from '../registry/enchantments.ts';
import {
  DIFFICULTIES,
  DIFFICULTY_LABELS,
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
import { findNearestBiome } from '../gen/Locate.ts';
import { CLONE_LIMIT, cloneRegion, cloneVolume, normalizeCloneBox } from './Clone.ts';
// 队伍（M23 最后一块，批次 468）
import { TEAM_COLORS, type Teams } from '../world/Teams.ts';
// 记分板（M23，批次 402）：纯类，规则一条都不依赖世界
import {
  SCORE_OPERATIONS,
  SCOREBOARD_SLOTS,
  SLOT_LABELS,
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
  setCreative(on: boolean): void;
  isCreative(): boolean;
  killPlayer(): void;
  seed(): number;

  // ---- 世界
  getBlock(x: number, y: number, z: number): number;
  setBlock(x: number, y: number, z: number, id: number): boolean;
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

const numericRule = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, Math.round(value)));

/** 天气的中文名（批次 221）：`/weather` 的回执以前直接印 `rain` 这种英文原值 */
const WEATHER_LABELS: Record<'clear' | 'rain' | 'thunder', string> = {
  clear: '晴天',
  rain: '下雨',
  thunder: '雷暴',
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
          out.error(`未知的命令：${wanted}`);
          return;
        }
        // 一条消息只放一行：聊天栏按"新消息在上"渲染，所以先发描述、再发用法，
        // 屏幕上看到的就是"用法在上、描述在下"。
        out.info(spec.description);
        out.info(spec.usage);
        return;
      }
      // 每条命令单独一条消息（聊天栏再按实际宽度折叠），不再拼成一个多行大块。
      // 同样按"新消息在上"倒着发：标题最后发 → 显示在最上面，下面依次是第 1、2…条。
      for (let i = COMMANDS.length - 1; i >= 0; i--) {
        const spec = COMMANDS[i]!;
        out.info(`${spec.usage} — ${spec.description}`);
      }
      out.info(`可用命令（${COMMANDS.length} 条）：`);
    },
  },
  {
    name: 'tp',
    usage: '/tp <x> <y> <z> [维度]',
    description: '传送到坐标（支持 ~ 相对写法）',
    run(args, ctx, out) {
      const pos = parsePosition(args, ctx.position());
      if (!pos) {
        out.error('坐标格式不对：应为 /tp <x> <y> <z> [维度]');
        return;
      }
      const dimension = args[3]?.toLowerCase();
      if (!ctx.teleport(pos.x, pos.y, pos.z, dimension)) {
        out.error(`传送失败：维度 ${dimension} 不存在`);
        return;
      }
      const where = dimension ? `（${dimension}）` : '';
      out.info(`已将 ${ctx.playerName()} 传送到 ${fmt(pos.x)} ${fmt(pos.y)} ${fmt(pos.z)}${where}`);
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
        out.error('用法：/give <物品> [数量]');
        return;
      }
      const count = args[1] === undefined ? 1 : Math.floor(num(args[1]));
      if (!Number.isFinite(count) || count <= 0) {
        out.error(`数量不对：${args[1]}`);
        return;
      }
      const given = ctx.give(name, count);
      if (given < 0) {
        out.error(`找不到物品：${name}（可以试 /give stone 或 /give 石头）`);
        return;
      }
      // 背包塞不下时给出去了也会丢，这里如实告诉玩家实际给到的数量
      out.info(`已给予 ${translateName(name)} ×${given}${given < count ? `（背包只装得下 ${given} 个）` : ''}`);
    },
  },
  {
    name: 'clear',
    usage: '/clear',
    description: '清空自己的背包',
    creativeOnly: true,
    run(_args, ctx, out) {
      const removed = ctx.clearInventory();
      out.info(`已清空背包（移除 ${removed} 组物品）`);
    },
  },
  {
    name: 'time',
    usage: '/time set <day|noon|night|midnight|数字>',
    description: '设置时间',
    run(args, ctx, out) {
      const action = args[0]?.toLowerCase();
      if (action !== 'set' && action !== 'add') {
        out.error('用法：/time set <day|noon|night|midnight|数字>');
        return;
      }
      const t = parseTime(args[1]);
      if (t === null) {
        out.error(`时间格式不对：${args[1] ?? '(空)'}`);
        return;
      }
      ctx.setTimeOfDay(action === 'add' ? (ctx.timeOfDay() + t) % 1 : t);
      out.info(`已将时间设置为 ${args[1]}`);
    },
  },
  {
    name: 'weather',
    usage: '/weather <clear|rain|thunder>',
    description: '切换天气',
    run(args, ctx, out) {
      const kind = args[0]?.toLowerCase();
      if (kind !== 'clear' && kind !== 'rain' && kind !== 'thunder') {
        out.error('用法：/weather <clear|rain|thunder>');
        return;
      }
      ctx.setWeather(kind);
      // 回执用中文；预计时长由主程序的天气播报补一句（`App.announceWeather`）
      out.info(`天气已切换为 ${WEATHER_LABELS[kind]}`);
    },
  },
  {
    name: 'difficulty',
    usage: '/difficulty <peaceful|easy|normal|hard>',
    description: '设置难度（和平难度下敌对生物不会生成）',
    run(args, ctx, out) {
      const value = args[0]?.toLowerCase() as Difficulty | undefined;
      if (!value || !DIFFICULTIES.includes(value)) {
        out.error(`用法：/difficulty <${DIFFICULTIES.join('|')}>`);
        return;
      }
      ctx.setDifficulty(value);
      out.info(`难度已设置为 ${DIFFICULTY_LABELS[value]}（${value}）`);
    },
  },
  {
    name: 'gamerule',
    usage: '/gamerule <规则> [值]',
    description:
      '查看或修改游戏规则（keepInventory / doMobSpawning / mobGriefing / doDaylightCycle / ' +
      'naturalRegeneration / randomTickSpeed / doMobLoot / doTileDrops / doWeatherCycle / ' +
      'doInsomnia / doImmediateRespawn）',
    run(args, ctx, out) {
      const rules = ctx.gameRules();
      const key = args[0] as keyof GameRules | undefined;
      if (!key) {
        const lines = Object.entries(rules).map(([name, value]) => `${name} = ${value}`);
        out.info(`当前游戏规则：\n${lines.join('\n')}`);
        return;
      }
      if (!(key in rules)) {
        out.error(`未知的游戏规则：${key}`);
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
          out.error(`${key} 只能是 true / false`);
          return;
        }
        ctx.setGameRule(key, (lower === 'true') as GameRules[typeof key]);
        out.info(`${key} 已设置为 ${lower}`);
        return;
      }
      const value = num(raw);
      if (Number.isNaN(value)) {
        out.error(`${key} 需要一个数字`);
        return;
      }
      const clamped = numericRule(value, 0, 100);
      ctx.setGameRule(key, clamped as GameRules[typeof key]);
      out.info(`${key} 已设置为 ${clamped}`);
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
        out.info('已清除全部状态效果');
        return;
      }
      if (action !== 'give') {
        out.error('用法：/effect <give|clear> <效果> [秒数] [等级]');
        return;
      }
      const name = args[1];
      if (!name) {
        out.error('用法：/effect give <效果> [秒数] [等级]');
        return;
      }
      const seconds = args[2] === undefined ? 30 : num(args[2]);
      if (!Number.isFinite(seconds) || seconds <= 0) {
        out.error(`秒数不对：${args[2]}`);
        return;
      }
      const amplifier = args[3] === undefined ? 0 : Math.floor(num(args[3]));
      if (!ctx.applyEffect(name, seconds, Math.max(0, amplifier))) {
        out.error(`未知的状态效果：${name}`);
        return;
      }
      out.info(`已给予状态效果 ${name} ${seconds} 秒（等级 ${amplifier + 1}）`);
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
        out.error(`用法：/summon <生物> [x] [y] [z]（可用：${MOB_TYPES.map((type) => type.id).join(', ')}）`);
        return;
      }
      const base = ctx.position();
      // 没给坐标时丢在玩家前方两格，避免直接压在脸上
      const pos = args.length > 1
        ? parsePosition(args.slice(1), base)
        : { x: base.x, y: base.y, z: base.z };
      if (!pos) {
        out.error('坐标格式不对');
        return;
      }
      if (!ctx.summon(name, pos.x, pos.y, pos.z)) {
        out.error(`未知的生物：${name}（可用：${MOB_TYPES.map((type) => type.id).join(', ')}）`);
        return;
      }
      out.info(`已召唤 ${name}`);
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
        out.info(`已清除 ${killed} 个生物（半径 ${radius}）`);
        return;
      }
      if (!isSelfTarget(first, ctx.playerName())) {
        out.error('只能对自己使用 /kill');
        return;
      }
      ctx.killPlayer();
      out.info(`${ctx.playerName()} 死了`);
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
        out.error('用法：/setblock <x> <y> <z> <方块>');
        return;
      }
      const id = resolveBlockId(name);
      if (id === undefined) {
        out.error(`找不到方块：${name}`);
        return;
      }
      if (!ctx.setBlock(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z), id)) {
        out.error('位置超出世界范围');
        return;
      }
      out.info(`已放置 ${translateName(name)} 于 ${Math.floor(pos.x)} ${Math.floor(pos.y)} ${Math.floor(pos.z)}`);
    },
  },
  {
    name: 'spawnpoint',
    usage: '/spawnpoint [x y z]',
    description: '设置个人重生点（不带坐标 = 当前位置）',
    run(args, ctx, out) {
      const pos = args.length >= 3 ? parsePosition(args.slice(0, 3), ctx.position()) : ctx.position();
      if (!pos) {
        out.error('用法：/spawnpoint [x y z]');
        return;
      }
      ctx.setPersonalSpawn(pos.x, pos.y, pos.z);
      out.info(`已将重生点设置为 ${Math.floor(pos.x)} ${Math.floor(pos.y)} ${Math.floor(pos.z)}`);
    },
  },
  {
    name: 'setworldspawn',
    usage: '/setworldspawn [x y z]',
    description: '设置世界出生点（不带坐标 = 当前位置）',
    run(args, ctx, out) {
      const pos = args.length >= 3 ? parsePosition(args.slice(0, 3), ctx.position()) : ctx.position();
      if (!pos) {
        out.error('用法：/setworldspawn [x y z]');
        return;
      }
      ctx.setWorldSpawn(pos.x, pos.y, pos.z);
      out.info(`已将世界出生点设置为 ${Math.floor(pos.x)} ${Math.floor(pos.y)} ${Math.floor(pos.z)}`);
    },
  },
  {
    name: 'particle',
    usage: '/particle <类型> [数量]',
    description: '在玩家位置生成粒子（heart / crit / flame / portal / explosion）',
    run(args, ctx, out) {
      const kind = args[0];
      if (!kind) {
        out.error('用法：/particle <类型> [数量]');
        return;
      }
      const count = args[1] === undefined ? 8 : Number(args[1]);
      if (!Number.isInteger(count) || count < 1 || count > 200) {
        out.error('数量必须是 1~200 的整数');
        return;
      }
      const pos = ctx.position();
      if (!ctx.spawnParticle(kind, pos.x, pos.y, pos.z, count)) {
        out.error(`找不到粒子：${kind}`);
        return;
      }
      out.info(`已生成 ${count} 个 ${kind} 粒子`);
    },
  },
  {
    name: 'tell',
    usage: '/tell <内容>',
    description: '给自己发一条私聊（单人下等同 /say）',
    run(args, ctx, out) {
      const text = args.join(' ').trim();
      if (!text) {
        out.error('用法：/tell <内容>');
        return;
      }
      out.info(`[${ctx.playerName()} -> 你] ${text}`);
    },
  },
  {
    name: 'msg',
    usage: '/msg <内容>',
    description: '同 /tell',
    run(args, ctx, out) {
      const text = args.join(' ').trim();
      if (!text) {
        out.error('用法：/msg <内容>');
        return;
      }
      out.info(`[${ctx.playerName()} -> 你] ${text}`);
    },
  },
  {
    name: 'playsound',
    usage: '/playsound <音效>',
    description: '在玩家所在位置播一个音效（名字见音效设置里的分组）',
    run(args, ctx, out) {
      const name = args[0];
      if (!name) {
        out.error('用法：/playsound <音效>');
        return;
      }
      if (!ctx.playSound(name)) {
        out.error(`找不到音效：${name}`);
        return;
      }
      out.info(`已播放音效 ${name}`);
    },
  },
  {
    name: 'me',
    usage: '/me <动作>',
    description: '发一条动作消息（“* 玩家 挥了挥手”）',
    run(args, ctx, out) {
      const text = args.join(' ').trim();
      if (!text) {
        out.error('用法：/me <动作>');
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
        out.error('用法：/say <内容>');
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
        out.error('用法：/enchant <附魔> [等级]');
        return;
      }
      const def = ENCHANTMENTS.find((entry) => entry.id === key || entry.name === key);
      if (!def) {
        out.error(`找不到附魔：${key}`);
        return;
      }
      const requested = args[1] === undefined ? 1 : Number(args[1]);
      if (!Number.isInteger(requested) || requested < 1) {
        out.error('等级必须是正整数');
        return;
      }
      const level = Math.min(requested, def.maxLevel);
      if (!ctx.enchantHeld(def.id, level)) {
        out.error('手上没有可附魔的物品');
        return;
      }
      out.info(`已给手持物品附上 ${def.name} ${level}`);
    },
  },
  {
    name: 'clone',
    usage: '/clone <x1> <y1> <z1> <x2> <y2> <z2> <dx> <dy> <dz> [masked|replace]',
    description: '把一块区域复制到别处（单次上限 32768 格；masked = 只覆盖空气）',
    creativeOnly: true,
    run(args, ctx, out) {
      if (args.length < 9) {
        out.error('用法：/clone <x1> <y1> <z1> <x2> <y2> <z2> <dx> <dy> <dz> [masked|replace]');
        return;
      }
      const base = ctx.position();
      const from = parsePosition(args.slice(0, 3), base);
      const to = parsePosition(args.slice(3, 6), base);
      if (!from || !to) {
        out.error('坐标格式不对');
        return;
      }
      const offset = {
        x: Number(args[6]),
        y: Number(args[7]),
        z: Number(args[8]),
      };
      if (!Number.isFinite(offset.x) || !Number.isFinite(offset.y) || !Number.isFinite(offset.z)) {
        // 位移只接受数字（不接受 ~ / ^）：它是"相对源区域"的量，不是坐标
        out.error('位移只能是数字：<dx> <dy> <dz>');
        return;
      }
      const modeArg = (args[9] ?? 'replace').toLowerCase();
      if (modeArg !== 'replace' && modeArg !== 'masked') {
        out.error(`模式只有 masked / replace：${modeArg}`);
        return;
      }
      const box = normalizeCloneBox(
        { x: Math.floor(from.x), y: Math.floor(from.y), z: Math.floor(from.z) },
        { x: Math.floor(to.x), y: Math.floor(to.y), z: Math.floor(to.z) },
      );
      const volume = cloneVolume(box);
      if (volume > CLONE_LIMIT) {
        out.error(`区域太大（${volume} 格），上限 ${CLONE_LIMIT}`);
        return;
      }
      const target = {
        x: box.x1 + Math.floor(offset.x),
        y: box.y1 + Math.floor(offset.y),
        z: box.z1 + Math.floor(offset.z),
      };
      const result = cloneRegion(
        { read: (x, y, z) => ctx.getBlock(x, y, z), write: (x, y, z, id) => void ctx.setBlock(x, y, z, id) },
        box,
        { x: Math.floor(offset.x), y: Math.floor(offset.y), z: Math.floor(offset.z) },
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
        out.error('用法：/fill <x1> <y1> <z1> <x2> <y2> <z2> <方块>');
        return;
      }
      const base = ctx.position();
      const from = parsePosition(args.slice(0, 3), base);
      const to = parsePosition(args.slice(3, 6), base);
      const id = resolveBlockId(args[6]!);
      if (!from || !to) {
        out.error('坐标格式不对');
        return;
      }
      if (id === undefined) {
        out.error(`找不到方块：${args[6]}`);
        return;
      }
      const volume =
        (Math.abs(Math.floor(from.x) - Math.floor(to.x)) + 1) *
        (Math.abs(Math.floor(from.y) - Math.floor(to.y)) + 1) *
        (Math.abs(Math.floor(from.z) - Math.floor(to.z)) + 1);
      if (volume > 32768) {
        out.error(`区域太大（${volume} 格），上限 32768`);
        return;
      }
      const placed = ctx.fillBlocks(
        Math.floor(from.x), Math.floor(from.y), Math.floor(from.z),
        Math.floor(to.x), Math.floor(to.y), Math.floor(to.z),
        id,
      );
      out.info(`已填充 ${placed} 格 ${translateName(args[6]!)}`);
    },
  },
  {
    name: 'gamemode',
    usage: '/gamemode <creative|survival>',
    description: '切换创造/生存（创造 = 飞行 + 不受伤 + 秒破）',
    // ⚠️ 故意**不设** creativeOnly：否则一旦切到生存就再也切不回来了
    // （其他创造专用命令仍然要求创造模式）。原版这条命令是权限等级控制的。
    run(args, ctx, out) {
      const mode = args[0]?.toLowerCase();
      if (mode !== 'creative' && mode !== 'survival' && mode !== 'c' && mode !== 's') {
        out.error('用法：/gamemode <creative|survival>');
        return;
      }
      const creative = mode === 'creative' || mode === 'c';
      ctx.setCreative(creative);
      ctx.setFlying(creative);
      out.info(`已将游戏模式设置为 ${creative ? '创造' : '生存'}`);
    },
  },
  {
    name: 'seed',
    usage: '/seed',
    description: '显示世界种子',
    run(_args, ctx, out) {
      out.info(`世界种子：${ctx.seed()}`);
    },
  },
  {
    name: 'list',
    usage: '/list',
    description: '列出在线玩家',
    run(_args, ctx, out) {
      const players = ctx.onlinePlayers();
      out.info(`在线玩家（${players.length}）：${players.join(', ')}`);
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
        out.info(`等级 ${state.level}：${state.progress}/${state.toNext}（累计 ${state.total} 点）`);
        return;
      }
      if (mode !== 'add' && mode !== 'set') {
        out.error('用法：/xp add <点数> | /xp set <等级> | /xp query');
        return;
      }

      const value = Number(args[1]);
      if (!Number.isFinite(value) || value < 0) {
        out.error(`数量无效：${args[1] ?? '(空)'}`);
        return;
      }

      if (mode === 'add') {
        // 0.4 这样的点数允许（原版经验球是整数，但命令接受小数并向下取整）
        const gained = ctx.addXp(value);
        const after = ctx.xpState();
        out.info(`已给予 ${value} 点经验（实际进账 ${gained} 点），当前等级 ${after.level}`);
      } else {
        ctx.setXpLevel(Math.floor(value));
        out.info(`已将等级设置为 ${Math.floor(value)}`);
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
          out.error(`边长必须是 ≥ ${BORDER_MIN_SIZE} 的数字（当前 ${current.size}）`);
          return;
        }
        const next = ctx.setWorldBorder({ size: clampBorderSize(size) });
        out.info(`世界边界已设为边长 ${next.size} 格（中心 ${next.centerX}, ${next.centerZ}）`);
        return;
      }
      if (mode === 'center') {
        const centerX = num(args[1]);
        const centerZ = num(args[2]);
        if (!Number.isFinite(centerX) || !Number.isFinite(centerZ)) {
          out.error('用法：/worldborder center <x> <z>');
          return;
        }
        const next = ctx.setWorldBorder({ centerX: Math.floor(centerX), centerZ: Math.floor(centerZ) });
        out.info(`世界中心已设为 (${next.centerX}, ${next.centerZ})，边长 ${next.size} 格`);
        return;
      }
      out.error('用法：/worldborder get | set <边长> | center <x> <z>');
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
    usage: '/locate biome <群系名>',
    description: '找最近的指定群系（按区块环搜索，半径 640 格）',
    run(args, ctx, out) {
      const kind = (args[0] ?? '').toLowerCase();
      const target = args[1];
      if (!target || (kind !== 'biome' && kind !== 'structure')) {
        out.error('用法：/locate biome <群系名> | /locate structure <结构名>');
        return;
      }
      // ---- 结构（批次 464）：结构位置是"种子 + 候选规则"的纯函数，
      //      主线程重算一遍即可，不需要 Worker 的生成器
      if (kind === 'structure') {
        if (!ctx.locateStructure) {
          out.error('这个维度还不支持 /locate structure（目前只做了主世界）');
          return;
        }
        const hit = ctx.locateStructure(target.toLowerCase());
        if (!hit) {
          out.error(`附近没有找到 ${target}（结构名要用 village / stronghold / mineshaft 这类）`);
          return;
        }
        out.info(
          `最近的 ${target} 在 ${hit.x}, ${hit.y}, ${hit.z}（约 ${Math.round(hit.distance)} 格）`,
        );
        return;
      }
      const position = ctx.position();
      const hit = findNearestBiome((x, z) => ctx.biomeNameAt(x, z), target, position);
      if (!hit) {
        out.error(`640 格内没有找到 ${target}（试试点名更常见的群系，或者先走远一点）`);
        return;
      }
      const first = hit.distance === 0;
      out.info(
        first
          ? `你脚下就是 ${target}（${hit.x}, ${hit.z}）`
          : `最近的 ${target} 在 ${hit.x}, ${hit.z}（约 ${Math.round(hit.distance)} 格）`,
      );
    },
  },
  {
    name: 'team',
    usage: '/team add|remove|list|join|leave|modify …',
    description: '队伍：建队、拉人、改颜色与友好伤害（免伤/碰撞还没接，见 TASKS M23）',
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
        out.error('用法：/advancement grant|revoke <进度 id | *>');
        return;
      }
      const tracker = ctx.advancements();
      const all = target === '*';
      if (!all && !advancementById(target)) {
        out.error(`没有这条进度：${target}`);
        return;
      }
      const ids = all ? tracker.defs.map((def) => def.id) : [target];
      let changed = 0;
      for (const id of ids) {
        if (action === 'grant' ? tracker.grant(id) : tracker.revoke(id)) changed++;
      }
      const verb = action === 'grant' ? '授予' : '收回';
      out.info(`已${verb} ${changed} 条进度${all ? '（全部）' : `：${target}`}`);
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
    out.error('请输入命令，例如 /help');
    return true;
  }

  const spec = findCommand(parsed.name);
  if (!spec) {
    out.error(`未知的命令：/${parsed.name}（输入 /help 查看全部）`);
    return true;
  }

  if (spec.creativeOnly && !ctx.isCreative()) {
    out.error(`/${spec.name} 只能在创造模式下使用`);
    return true;
  }

  try {
    spec.run(parsed.args, ctx, out);
  } catch (error) {
    out.error(`命令执行出错：${error instanceof Error ? error.message : String(error)}`);
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
      if (command.length === 0) return '用法：/execute … run <命令>';
      ops.push({ kind: 'run', command });
      return ops;
    }

    if (token === 'as' || token === 'at') {
      const text = args[index + 1];
      if (!text) return `用法：/execute ${token} <目标选择器> … run <命令>`;
      const selector = parseSelector(text);
      if (typeof selector === 'string') return selector;
      ops.push({ kind: token, selector });
      index += 2;
      continue;
    }

    if (token === 'positioned') {
      const coords = args.slice(index + 1, index + 4);
      if (coords.length < 3) return '用法：/execute positioned <x> <y> <z> … run <命令>';
      ops.push({ kind: 'positioned', coords });
      index += 4;
      continue;
    }

    if (token === 'if' || token === 'unless') {
      const sub = (args[index + 1] ?? '').toLowerCase();

      if (sub === 'block') {
        const coords = args.slice(index + 2, index + 5);
        const block = args[index + 5];
        if (coords.length < 3 || !block) return `用法：/execute ${token} block <x> <y> <z> <方块> … run <命令>`;
        ops.push({ kind: 'cond', invert: token === 'unless', condition: { kind: 'block', coords, block } });
        index += 6;
        continue;
      }

      if (sub === 'entity') {
        const text = args[index + 2];
        if (!text) return `用法：/execute ${token} entity <目标选择器> … run <命令>`;
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
          return `用法：/execute ${token} score <目标> <目标名> <运算符> <数值> … run <命令>`;
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

  return '用法：/execute … run <命令>';
}

/** 求一个条件。坐标与选择器都相对**当前执行原点**（`at` / `positioned` 之后的值） */
function evalCondition(condition: ExecCondition, state: ExecState, ctx: CommandContext, out: CommandFeedback): boolean {
  if (condition.kind === 'block') {
    const position = parsePosition([...condition.coords], state.origin);
    if (!position) {
      out.error('execute if block：坐标不合法');
      return false;
    }
    const id = resolveBlockId(condition.block);
    if (id === undefined) {
      out.error(`找不到方块：${condition.block}`);
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
        out.error(`execute 嵌套太深（上限 ${EXECUTE_MAX_DEPTH} 层）`);
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
        out.error(`选择器 ${describeSelector(op.selector)} 没有匹配到任何目标`);
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
        out.error(`选择器 ${describeSelector(op.selector)} 没有匹配到任何目标`);
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
        out.error('execute positioned：坐标不合法');
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

const SCOREBOARD_USAGE =
  '用法：/scoreboard objectives <add|remove|list|setdisplay> … 或 /scoreboard players <set|add|remove|operation|get|list|reset> …';

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
  out.error(SCOREBOARD_USAGE);
}

function runScoreboardObjectives(args: string[], ctx: CommandContext, out: CommandFeedback): void {
  const board = ctx.scoreboard();
  const sub = (args[1] ?? '').toLowerCase();

  if (sub === 'add') {
    const name = args[2];
    const criterion = (args[3] ?? 'dummy').toLowerCase();
    const displayName = args.slice(4).join(' ').trim();
    if (!name) {
      out.error('用法：/scoreboard objectives add <名称> [准则] [显示名]');
      return;
    }
    if (!isValidScoreName(name)) {
      out.error(`目标名只能用字母/数字/下划线，1~16 个字符：${name}`);
      return;
    }
    if (!SUPPORTED_CRITERIA.includes(criterion)) {
      out.error(`暂不支持准则 ${criterion}（只有 ${SUPPORTED_CRITERIA.join(' / ')}）`);
      return;
    }
    if (!board.addObjective(name, criterion, displayName)) {
      out.error(`目标 ${name} 已经存在`);
      return;
    }
    out.info(`已创建目标 ${name}（${criterion}${displayName ? `，显示为“${displayName}”` : ''}）`);
    return;
  }

  if (sub === 'remove') {
    const name = args[2];
    if (!name) {
      out.error('用法：/scoreboard objectives remove <名称>');
      return;
    }
    if (!board.removeObjective(name)) {
      out.error(`目标 ${name} 不存在`);
      return;
    }
    out.info(`已删除目标 ${name}（连同它记下的所有分数）`);
    return;
  }

  if (sub === 'list') {
    const names = board.objectiveNames();
    if (names.length === 0) {
      out.info('还没有任何记分板目标');
      return;
    }
    const described = names.map((name) => {
      const objective = board.objective(name)!;
      const shown = objective.displayName === objective.name ? '' : `，显示为“${objective.displayName}”`;
      return `${objective.name}（${objective.criterion}${shown}）`;
    });
    out.info(`共 ${names.length} 个目标：${described.join('、')}`);
    return;
  }

  if (sub === 'setdisplay') {
    const slot = (args[2] ?? '').toLowerCase() as ScoreboardSlot;
    if (!SCOREBOARD_SLOTS.includes(slot)) {
      out.error(`槽位只能是 ${SCOREBOARD_SLOTS.join(' / ')}`);
      return;
    }
    const objective = args[3];
    if (!objective) {
      board.setDisplay(slot, null);
      out.info(`已清空${SLOT_LABELS[slot]}`);
      return;
    }
    if (!board.setDisplay(slot, objective)) {
      out.error(`目标 ${objective} 不存在`);
      return;
    }
    out.info(`${SLOT_LABELS[slot]}现在显示目标 ${objective}`);
    return;
  }

  out.error('用法：/scoreboard objectives <add|remove|list|setdisplay> …');
}

/**
 * `/team`（批次 468）。
 *
 * ⚠️ 只做**数据层**：建队 / 拉人 / 查归属 / 改颜色与友好伤害。
 * 队友免伤、碰撞开关、名字颜色三项要"伤害来源"与"名字渲染"，还没接
 * （差异写在 `Teams.ts` 的文件头与 TASKS M23 里）。
 */
function runTeam(args: string[], ctx: CommandContext, out: CommandFeedback): void {
  const teams = ctx.teams();
  const sub = (args[0] ?? '').toLowerCase();
  const usage =
    '用法：/team add <队伍> [显示名] | remove <队伍> | list | join <队伍> [成员] | leave [成员] | modify <队伍> friendlyFire <true|false> | color <颜色>';

  if (sub === 'add') {
    const name = args[1];
    if (!name) {
      out.error(usage);
      return;
    }
    const displayName = args.slice(2).join(' ').trim();
    if (!teams.add(name, displayName)) {
      out.error(`队伍 ${name} 已经存在`);
      return;
    }
    out.info(`已创建队伍 ${name}${displayName ? `（显示为「${displayName}」）` : ''}`);
    return;
  }

  if (sub === 'remove') {
    const name = args[1];
    if (!name) {
      out.error(usage);
      return;
    }
    if (!teams.remove(name)) {
      out.error(`队伍 ${name} 不存在`);
      return;
    }
    out.info(`已删除队伍 ${name}（成员一并解绑）`);
    return;
  }

  if (sub === 'list') {
    const all = teams.list();
    if (all.length === 0) {
      out.info('还没有任何队伍');
      return;
    }
    const described = all.map((team) => {
      const members = teams.membersOf(team.name);
      const shown = team.displayName === team.name ? '' : `，显示为「${team.displayName}」`;
      return `${team.name}（${team.color}，友好伤害${team.friendlyFire ? '开' : '关'}${shown}，${members.length} 人）`;
    });
    out.info(`共 ${all.length} 个队伍：${described.join('；')}`);
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
      out.error(`队伍 ${teamName} 不存在`);
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
      out.error(`成员 ${memberArg} 没有匹配到任何对象`);
      return;
    }
    if (sub === 'join') {
      for (const member of members) {
        if (!teams.join(teamName!, member)) {
          out.error(`成员 ${member} 的名字不合法（1~16 个字符）`);
          continue;
        }
        out.info(`已把 ${member} 加入队伍 ${teamName}`);
      }
    } else {
      for (const member of members) {
        if (!teams.leave(member)) {
          out.info(`${member} 本来就不在任何队伍里`);
          continue;
        }
        out.info(`已让 ${member} 退出队伍`);
      }
    }
    return;
  }

  if (sub === 'modify') {
    const name = args[1];
    const key = (args[2] ?? '').toLowerCase();
    const value = args[3];
    if (!name || !key || value === undefined) {
      out.error(usage);
      return;
    }
    if (!teams.get(name)) {
      out.error(`队伍 ${name} 不存在`);
      return;
    }
    if (key === 'friendlyfire') {
      const on = value.toLowerCase() === 'true';
      if (value.toLowerCase() !== 'true' && value.toLowerCase() !== 'false') {
        out.error('友好伤害只能是 true 或 false');
        return;
      }
      teams.setFriendlyFire(name, on);
      out.info(`队伍 ${name} 的友好伤害已${on ? '打开' : '关闭'}`);
      return;
    }
    if (key === 'color') {
      if (!teams.setColor(name, value.toLowerCase())) {
        out.error(`颜色不认识：${value}（可用 ${TEAM_COLORS.join(' / ')}）`);
        return;
      }
      out.info(`队伍 ${name} 的颜色已改为 ${value.toLowerCase()}`);
      return;
    }
    out.error(`不认识的属性 ${key}（只有 friendlyFire 与 color）`);
    return;
  }

  out.error(usage);
}

function runScoreboardPlayers(args: string[], ctx: CommandContext, out: CommandFeedback): void {
  const board = ctx.scoreboard();
  const sub = (args[1] ?? '').toLowerCase();
  const target = args[2];
  if (!target) {
    out.error('用法：/scoreboard players <set|add|remove|operation|get|list|reset> <目标> …');
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
    out.error(`目标 ${target} 没有匹配到任何对象`);
    return;
  }

  if (sub === 'set' || sub === 'add' || sub === 'remove') {
    const objective = args[3];
    const raw = args[4];
    if (!objective || raw === undefined) {
      out.error(`用法：/scoreboard players ${sub} <目标> <目标名> <分数>`);
      return;
    }
    const amount = Number(raw);
    if (!Number.isFinite(amount)) {
      out.error(`分数必须是数字：${raw}`);
      return;
    }
    if (!board.objective(objective)) {
      out.error(`目标 ${objective} 不存在`);
      return;
    }
    for (const holder of holders) {
      if (sub === 'set') {
        board.setScore(holder, objective, amount);
        out.info(`已将 ${holder} 的 ${objective} 设为 ${board.getScore(holder, objective)}`);
      } else if (sub === 'add') {
        const next = board.addScore(holder, objective, amount);
        out.info(`已将 ${holder} 的 ${objective} 加至 ${next}`);
      } else {
        const next = board.removeScore(holder, objective, amount);
        out.info(`已将 ${holder} 的 ${objective} 减至 ${next}`);
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
        `用法：/scoreboard players operation <目标> <目标名> <运算> <来源> <来源目标名>（运算：${SCORE_OPERATIONS.join(' ')}）`,
      );
      return;
    }
    if (!board.objective(objective)) {
      out.error(`目标 ${objective} 不存在`);
      return;
    }
    if (!board.objective(sourceObjective)) {
      out.error(`目标 ${sourceObjective} 不存在`);
      return;
    }
    const sourceHolders = holderNamesOf(sourceTarget, state, ctx, out);
    if (sourceHolders === null) return;
    if (sourceHolders.length === 0) {
      out.error(`来源 ${sourceTarget} 没有匹配到任何对象`);
      return;
    }
    // 原版是"每个 target 与每个 source 各算一次"（两边都可以是选择器）
    for (const holder of holders) {
      for (const source of sourceHolders) {
        const next = board.operate(holder, objective, op, source, sourceObjective);
        out.info(`已将 ${holder} 的 ${objective} 设为 ${next}（${op} ${source} 的 ${sourceObjective}）`);
      }
    }
    return;
  }

  if (sub === 'get') {
    const objective = args[3];
    if (!objective) {
      out.error('用法：/scoreboard players get <目标> <目标名>');
      return;
    }
    if (!board.objective(objective)) {
      out.error(`目标 ${objective} 不存在`);
      return;
    }
    for (const holder of holders) {
      const score = board.getScore(holder, objective);
      if (score === null) out.info(`${holder} 没有 ${objective} 的分数`);
      else out.info(`${holder} 的 ${objective} 是 ${score}`);
    }
    return;
  }

  if (sub === 'list') {
    for (const holder of holders) {
      const objectives = board.objectivesOf(holder);
      if (objectives.length === 0) {
        out.info(`${holder} 还没有任何分数`);
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
      out.info(removed === 0 ? `${holder} 本来就没有分数` : `已清空 ${holder} 的 ${removed} 个目标的分数`);
    }
    return;
  }

  out.error('用法：/scoreboard players <set|add|remove|operation|get|list|reset> <目标> …');
}
