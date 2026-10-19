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
