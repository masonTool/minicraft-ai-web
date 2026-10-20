/**
 * 命令系统（M5）与难度/游戏规则（I7/I11）离线测试
 *
 * 命令行是最"宽进"的输入面：玩家会写 `/give stone 64` `/tp ~ ~5 ~` `/time set noon`，
 * 也会写错成 `/give ston`、`/tp abc`。这里把解析、边界与报错全部钉死——
 * 命令的解析层不碰 DOM，因此能在 Node 里跑。
 *
 * 运行：npm run test:commands
 */

import {
  buildCommand,
  commandHelpEntries,
  suggestCommandValues,
  type CommandHelpField,
} from '../src/core/commands/CommandHelp.ts';
import { AdvancementTracker } from '../src/core/progress/AdvancementTracker.ts';
import { ADVANCEMENTS } from '../src/core/progress/advancements.ts';
import { findNearestBiome } from '../src/core/gen/Locate.ts';
import { CLONE_LIMIT, cloneRegion, cloneVolume, normalizeCloneBox } from '../src/core/commands/Clone.ts';
import {
  COMMANDS,
  commandNames,
  DIFFICULTY_LABELS,
  DIFFICULTIES,
  executeCommand,
  isSelfTarget,
  isValidMob,
  parseCommand,
  parseCoordinate,
  parsePosition,
  parseTime,
  type CommandContext,
  type CommandFeedback,
  type Difficulty,
  type GameRules,
} from '../src/core/commands/Commands.ts';
import type { CommandEntity } from '../src/core/commands/Selectors.ts';
import { Scoreboard } from '../src/core/world/Scoreboard.ts';
import { Teams } from '../src/core/world/Teams.ts';
import {
  DEFAULT_GAME_RULES,
  DIFFICULTIES as RULE_DIFFICULTIES,
  difficultyProfile,
  isDifficulty,
  normalizeDifficulty,
  normalizeGameRules,
} from '../src/core/world/Rules.ts';
import { BLOCKS } from '../src/core/registry/blocks.ts';
import { defaultBorder, normalizeBorder, type WorldBorder } from '../src/core/world/WorldBorder.ts';
import { resolveBlockId, resolveItemId } from '../src/core/registry/itemNames.ts';
import { Experience } from '../src/core/survival/Experience.ts';

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.log(`  ✗ ${label}${detail ? `  →  ${detail}` : ''}`);
  }
}

/** 记录反馈的假出口 */
class Recorder implements CommandFeedback {
  readonly infos: string[] = [];
  readonly errors: string[] = [];
  info(text: string): void {
    this.infos.push(text);
  }
  error(text: string): void {
    this.errors.push(text);
  }
  get lastInfo(): string {
    return this.infos[this.infos.length - 1] ?? '';
  }
  get lastError(): string {
    return this.errors[this.errors.length - 1] ?? '';
  }
}

/** 假上下文：把命令产生的效果记下来，不碰真实世界 */
class FakeWorld implements CommandContext {
  playerName_ = '玩家';
  pos = { x: 10.5, y: 64, z: -3.5, dimension: 'overworld' };
  flying = true;
  creative = true;
  time = 0;
  weather: 'clear' | 'rain' | 'thunder' = 'clear';
  // ⚠️ 字段名必须与接口的**方法名**错开：接口里 `difficulty` / `gameRules` 是方法，
  // 桩对象再写一个同名字段就会正面相撞（而运行时 `ctx.difficulty` 拿到值还是函数都"能跑"）
  difficultyValue: Difficulty = 'normal';
  rules: GameRules = { ...DEFAULT_GAME_RULES };
  /** 世界边界（K12，批次 175）：`/worldborder` 改它 */
  border: WorldBorder = defaultBorder();
  inventory = new Map<number, number>();
  blocks = new Map<string, number>();
  mobs: Array<{ type: string; x: number; y: number; z: number }> = [];
  effects = new Map<string, { seconds: number; amplifier: number }>();
  teleports: Array<{ x: number; y: number; z: number; dimension?: string }> = [];
  seed_ = 4242;

  playerName(): string {
    return this.playerName_;
  }
  position() {
    return { ...this.pos };
  }
  teleport(x: number, y: number, z: number, dimension?: string): boolean {
    if (dimension && !['overworld', 'nether', 'end'].includes(dimension)) return false;
    this.teleports.push({ x, y, z, dimension });
    this.pos = { x, y, z, dimension: dimension ?? this.pos.dimension };
    return true;
  }
  personalSpawn: { x: number; y: number; z: number } | null = null;
  worldSpawn: { x: number; y: number; z: number } | null = null;
  setPersonalSpawn(x: number, y: number, z: number): void {
    this.personalSpawn = { x, y, z };
  }
  setWorldSpawn(x: number, y: number, z: number): void {
    this.worldSpawn = { x, y, z };
  }
  particles: string[] = [];
  spawnParticle(name: string): boolean {
    this.particles.push(name);
    return name !== 'nope';
  }
  played: string[] = [];
  playSound(name: string): boolean {
    this.played.push(name);
    return name === 'click';
  }
  enchanted: { id: string; level: number } | null = null;
  enchantHeld(id: string, level: number): boolean {
    this.enchanted = { id, level };
    return true;
  }
  give(_itemName: string, _count: number): number {
    throw new Error('give 应该由测试覆盖');
  }
  clearInventory(): number {
    const count = this.inventory.size;
    this.inventory.clear();
    return count;
  }
  setFlying(on: boolean): void {
    this.flying = on;
  }
  isFlying(): boolean {
    return this.flying;
  }
  setGameMode(mode: 'survival' | 'creative' | 'spectator'): void {
    // 与真实现同一口径：旁观也算"能飞"，所以 flying = mode !== 'survival'
    this.creative = mode === 'creative';
    this.flying = mode !== 'survival';
    this.gameMode_ = mode;
  }
  gameMode_: 'survival' | 'creative' | 'spectator' = 'survival';
  isCreative(): boolean {
    return this.creative;
  }
  killPlayer(): void {
    this.playerName_ = '玩家(已死)';
  }
  seed(): number {
    return this.seed_;
  }
  getBlock(x: number, y: number, z: number): number {
    return this.blocks.get(`${x},${y},${z}`) ?? 0;
  }
  setBlock(x: number, y: number, z: number, id: number): boolean {
    this.blocks.set(`${x},${y},${z}`, id);
    return true;
  }
  fillBlocks(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, id: number): number {
    let placed = 0;
    for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) {
      for (let z = Math.min(z1, z2); z <= Math.max(z1, z2); z++) {
        for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) {
          this.blocks.set(`${x},${y},${z}`, id);
          placed++;
        }
      }
    }
    return placed;
  }
  setTimeOfDay(t: number): void {
    this.time = ((t % 1) + 1) % 1;
  }
  timeOfDay(): number {
    return this.time;
  }
  setWeather(kind: 'clear' | 'rain' | 'thunder'): void {
    this.weather = kind;
  }
  difficulty(): Difficulty {
    return this.difficultyValue;
  }
  setDifficulty(value: Difficulty): void {
    this.difficultyValue = value;
  }
  gameRules(): GameRules {
    return this.rules;
  }
  setGameRule<K extends keyof GameRules>(key: K, value: GameRules[K]): void {
    this.rules[key] = value;
  }
  worldBorder(): WorldBorder {
    return { ...this.border };
  }
  setWorldBorder(patch: Partial<WorldBorder>): WorldBorder {
    this.border = normalizeBorder({ ...this.border, ...patch });
    return { ...this.border };
  }
  summon(name: string, x: number, y: number, z: number): boolean {
    if (!isValidMob(name)) return false;
    this.mobs.push({ type: name, x, y, z });
    return true;
  }
  killNearby(radius: number): number {
    const before = this.mobs.length;
    this.mobs = this.mobs.filter((mob) => Math.hypot(mob.x - this.pos.x, mob.z - this.pos.z) > radius);
    return before - this.mobs.length;
  }
  applyEffect(name: string, seconds: number, amplifier: number): boolean {
    if (!['speed', 'poison', 'night_vision'].includes(name)) return false;
    this.effects.set(name, { seconds, amplifier });
    return true;
  }
  clearEffects(): void {
    this.effects.clear();
  }
  onlinePlayers(): string[] {
    return ['玩家(你)'];
  }
  /** 记分板（M23，批次 402） */
  readonly board = new Scoreboard();
  scoreboard(): Scoreboard {
    return this.board;
  }
  /** 队伍（批次 468）：命令测试里共用一份实例 */
  teams(): Teams {
    return this.teams_;
  }
  readonly teams_ = new Teams();
  /** 进度（批次 415）：`/advancement` 用它授/收 */
  readonly progressTracker = new AdvancementTracker();
  advancements(): AdvancementTracker {
    return this.progressTracker;
  }
  /** 群系名（批次 416）：`/locate biome` 用它；假世界固定返回 null */
  biomeNameAt(): string | null {
    return null;
  }
  /**
   * 最近的结构（批次 464）：假世界只认 `village`，返回一个固定位置。
   * ⚠️ 故意**不**实现下界/末地的分派——那两个维度在真实现里也返回 null。
   */
  locateStructure(kind: string): { x: number; y: number; z: number; distance: number } | null {
    return kind === 'village' ? { x: 120, y: 64, z: -80, distance: 144 } : null;
  }
  /** 发放物品（批次 480，`/loot`）：记下给了什么 */
  readonly given: number[] = [];
  giveById(itemId: number, count: number): number {
    this.given.push(itemId);
    return count;
  }
  /** 伤害（批次 480，`/damage`）：假世界认玩家与 `mob:1` */
  readonly damaged: Array<{ id: string; amount: number }> = [];
  damageEntity(entityId: string, amount: number): boolean {
    if (entityId !== 'player' && entityId !== 'mob:1') return false;
    this.damaged.push({ id: entityId, amount });
    return true;
  }
  /** 方块信息（批次 479）：假世界只有 (0,64,0) 是石头，其余空气 */
  blockInfoAt(x: number, y: number, z: number): { id: number; name: string; state: number } | null {
    if (x === 0 && y === 64 && z === 0) return { id: 1, name: 'minecraft:stone', state: 0 };
    return null;
  }
  /** 选择器快照（批次 399）：这一套里没有生物，只交出玩家自己 */
  entities(): readonly CommandEntity[] {
    return [
      {
        id: 'player',
        type: 'player',
        name: this.playerName_,
        x: this.pos.x,
        y: this.pos.y,
        z: this.pos.z,
        isPlayer: true,
      },
    ];
  }

  /**
   * 经验（I5）：直接用真的 `Experience`，而不是再造一个简化模型——
   * 命令测试要验的正是"`/xp` 有没有走对那条等级公式"。
   */
  readonly experience = new Experience();
  addXp(amount: number): number {
    return this.experience.add(amount);
  }
  setXpLevel(level: number): void {
    this.experience.setLevel(level);
  }
  xpState(): { level: number; progress: number; toNext: number; total: number } {
    return {
      level: this.experience.level,
      progress: this.experience.progress,
      toNext: this.experience.toNext,
      total: this.experience.total,
    };
  }
}

// ⚠️ 这里原本有一段 `Object.assign(FakeWorld.prototype, {...})` 的补丁：把接口要求的方法名
// 补到原型上（因为类里当初用的是 `difficulty_` / `rules_` 这种带后缀的名字）。现在类里
// **直接就叫** `difficulty()` / `gameRules()`，补丁不但多余，还会盖掉类上的实现——
// 于是改名之后它静静地读到了一个不存在的字段，断言全绿变全红（O6 顺带收掉）。

function run(input: string, world = new FakeWorld()): { out: Recorder; world: FakeWorld } {
  const out = new Recorder();
  executeCommand(input, world, out);
  return { out, world };
}

// ---------------------------------------------------------------- 1. 解析层

console.log('\n[命令解析]');
{
  check('拆分命令与参数', JSON.stringify(parseCommand('/give stone 64')) === JSON.stringify({ name: 'give', args: ['stone', '64'] }));
  check('多个空格也算一个分隔', parseCommand('/tp   1   2   3')?.args.length === 3);
  check('不带斜杠也能解析', parseCommand('time set day')?.name === 'time');
  check('空输入返回 null', parseCommand('   ') === null);

  check('~ 表示当前位置', parseCoordinate('~', 10.5) === 10.5);
  check('~5 表示偏移', parseCoordinate('~5', 10.5) === 15.5);
  check('~-3 支持负数偏移', parseCoordinate('~-3', 10.5) === 7.5);
  check('绝对坐标', parseCoordinate('12', 999) === 12);
  check('非法坐标是 NaN', Number.isNaN(parseCoordinate('abc', 0)));
  check('缺省参数用当前位置', parsePosition([], { x: 1, y: 2, z: 3 })?.y === 2);

  check('day = 0', parseTime('day') === 0);
  check('noon = 0.25', parseTime('noon') === 0.25);
  check('midnight = 0.75', parseTime('midnight') === 0.75);
  check('数字按 tick 换算（12000 = 0.5）', parseTime('12000') === 0.5);
  check('非法时间返回 null', parseTime('teatime') === null);

  check('@s 是自己', isSelfTarget('@s', '玩家') && isSelfTarget('@p', '玩家') && isSelfTarget(undefined, '玩家'));
  check('别人不是自己', !isSelfTarget('Alex', '玩家'));

  check(`命令表 ${COMMANDS.length} 条且用法都以 / 开头`, COMMANDS.length >= 15 && COMMANDS.every((spec) => spec.usage.startsWith('/')));
  check('命令名唯一', new Set(commandNames()).size === commandNames().length);
}

// ---------------------------------------------------------------- 2. 非命令

console.log('\n[普通发言不当命令]');
{
  const world = new FakeWorld();
  const out = new Recorder();
  const handled = executeCommand('大家好啊', world, out);
  check('不以 / 开头的文字不被当作命令', handled === false && out.infos.length === 0);
  const handled2 = executeCommand('/nope', world, out);
  check('未知命令给出报错与 /help 提示', handled2 === true && out.lastError.includes('/help'));
}

// ---------------------------------------------------------------- 3. 各条命令

console.log('\n[传送与坐标]');
{
  const { out, world } = run('/tp 100 70 -200');
  check('/tp 落到指定坐标', world.pos.x === 100 && world.pos.y === 70 && world.pos.z === -200, JSON.stringify(world.pos));
  check('/tp 有反馈', out.lastInfo.includes('100'));
  const rel = run('/tp ~ ~5 ~', world);
  check('~ 相对坐标基于当前位置', rel.world.pos.y === 75);
  const bad = run('/tp abc 1 2');
  check('非法坐标报错', bad.out.lastError.includes('坐标格式'));
  const dim = run('/tp 0 100 0 nether');
  check('可以指定维度', dim.world.pos.dimension === 'nether');
  const badDim = run('/tp 0 100 0 火星');
  check('维度名非法时报错', badDim.out.lastError.includes('维度'));
}

console.log('\n[给物品与清背包]');
{
  const world = new FakeWorld();
  const out = new Recorder();
  // 覆盖 give：按名字解析成 id 后记账
  world.give = (name: string, count: number) => {
    const id = resolveItemId(name);
    if (id === undefined) return -1;
    world.inventory.set(id, (world.inventory.get(id) ?? 0) + count);
    return count;
  };
  executeCommand('/give stone 5', world, out);
  check('英文名可以给物品', (world.inventory.get(resolveItemId('stone')!) ?? 0) === 5);
  executeCommand('/give 石头 2', world, out);
  check('中文名也能给（累加到同一格）', (world.inventory.get(resolveItemId('stone')!) ?? 0) === 7);
  executeCommand('/give not_a_block 1', world, out);
  check('不存在的物品给出可操作的报错', out.lastError.includes('找不到物品') && out.lastError.includes('/give stone'));
  executeCommand('/give stone 0', world, out);
  check('数量为 0 被拒绝', out.lastError.includes('数量'));
  executeCommand('/clear', world, out);
  // 两次 /give 给的是同一种物品（合并进同一格），所以只清掉了 1 组
  check('/clear 清空并报告组数', world.inventory.size === 0 && out.lastInfo.includes('1'));
}

console.log('\n[时间与天气]');
{
  const { world } = run('/time set night');
  check('/time set night → 0.5', world.time === 0.5);
  run('/time set noon', world);
  check('/time set noon → 0.25', world.time === 0.25);
  const add = run('/time add 12000', world);
  check('/time add 是叠加（0.25 + 0.5 = 0.75）', Math.abs(add.world.time - 0.75) < 1e-9, String(add.world.time));
  const bad = run('/time set teatime');
  check('非法时间报错', bad.out.lastError.includes('时间格式'));
  const weather = run('/weather thunder');
  // 批次 221：回执改成中文（以前直接印 `thunder`）
  check('/weather 生效', weather.world.weather === 'thunder' && weather.out.lastInfo.includes('雷暴'));
  const rainy = run('/weather rain', weather.world);
  check('/weather rain 回执是"下雨"', rainy.out.lastInfo.includes('下雨'), rainy.out.lastInfo);
  const sunny = run('/weather clear', weather.world);
  check('/weather clear 回执是"晴天"', sunny.out.lastInfo.includes('晴天'), sunny.out.lastInfo);
  const badWeather = run('/weather sunny');
  check('非法天气报错', badWeather.out.lastError.includes('用法'));
}

console.log('\n[难度与游戏规则]');
{
  const { world, out } = run('/difficulty hard');
  check('/difficulty 生效', world.difficulty() === 'hard' && out.lastInfo.includes('困难'));
  const bad = run('/difficulty 地狱');
  check('非法难度报错并列出可选值', bad.out.lastError.includes('peaceful'));
  const peaceful = run('/difficulty peaceful');
  check('和平难度可用', peaceful.world.difficulty() === 'peaceful');

  const rule = run('/gamerule keepInventory true');
  check('布尔规则可设置', rule.world.rules.keepInventory === true && rule.out.lastInfo.includes('true'));
  const wrong = run('/gamerule keepInventory 1');
  check('布尔规则只认 true/false', wrong.out.lastError.includes('true / false'));
  const speed = run('/gamerule randomTickSpeed 10');
  check('数值规则可设置', speed.world.rules.randomTickSpeed === 10);
  const clamped = run('/gamerule randomTickSpeed 999');
  check('数值规则会被夹紧', clamped.world.rules.randomTickSpeed === 100, String(clamped.world.rules.randomTickSpeed));
  // 批次 409：reducedDebugInfo（调试面板收起）
  const reduced = run('/gamerule reducedDebugInfo true');
  check('reducedDebugInfo 能设成 true', reduced.world.rules.reducedDebugInfo === true, reduced.out.lastError);
  // 批次 488：两条"功能做了、规则跟上"的开关
  const patrolRule = run('/gamerule doPatrolSpawning false');
  check('doPatrolSpawning 能关（巡逻队）', patrolRule.world.rules.doPatrolSpawning === false, patrolRule.out.lastError);
  const blockRule = run('/gamerule commandBlockOutput false');
  check('commandBlockOutput 能关（命令方块输出）', blockRule.world.rules.commandBlockOutput === false, blockRule.out.lastError);
  const patrolBack = run('/gamerule doPatrolSpawning true');
  check('还能再打开', patrolBack.world.rules.doPatrolSpawning === true);
  check('规则列表里能看到它（不必记名字）', run('/gamerule').out.lastInfo.includes('reducedDebugInfo'));
  // 批次 433：doFireTick（火是否蔓延与熄灭）
  const fire = run('/gamerule doFireTick false');
  check('doFireTick 能设成 false', fire.world.rules.doFireTick === false, fire.out.lastError);
  check('规则列表里能看到 doFireTick', run('/gamerule').out.lastInfo.includes('doFireTick'));
  check('布尔规则不接受 1（只认 true/false）', run('/gamerule reducedDebugInfo 1').out.lastError.length > 0);

  const read = run('/gamerule doMobSpawning');
  check('只给规则名时是查询', read.out.lastInfo.includes('doMobSpawning = true'));
  const list = run('/gamerule');
  check('不给参数时列出全部', list.out.lastInfo.includes('keepInventory') && list.out.lastInfo.includes('randomTickSpeed'));
  const unknown = run('/gamerule 飞行 true');
  check('未知规则报错', unknown.out.lastError.includes('未知的游戏规则'));
}

console.log('\n[方块操作]');
{
  const { world, out } = run('/setblock 5 70 5 stone');
  check('/setblock 写入方块', world.getBlock(5, 70, 5) === resolveBlockId('stone'));
  check('/setblock 有坐标反馈', out.lastInfo.includes('5 70 5'));
  const bad = run('/setblock 5 70 5 不存在');
  check('非法方块名报错', bad.out.lastError.includes('找不到方块'));
  const fill = run('/fill 0 70 0 3 70 3 glass');
  check('/fill 填充 16 格', fill.world.getBlock(3, 70, 3) === resolveBlockId('glass') && fill.out.lastInfo.includes('16'));
  const tooBig = run('/fill 0 0 0 100 100 100 stone');
  check('超大区域被拒绝（上限 32768）', tooBig.out.lastError.includes('32768'));
  const air = run('/setblock 0 70 0 air');
  check('air 可以被放置（挖空）', air.world.getBlock(0, 70, 0) === 0);
}

console.log('\n[实体与效果]');
{
  const summon = run('/summon zombie 3 70 3');
  check('/summon 生成生物', summon.world.mobs.length === 1 && summon.world.mobs[0]!.type === 'zombie');
  const badMob = run('/summon 龙');
  check('未知生物报错并列出可用名', badMob.out.lastError.includes('zombie'));
  const kill = run('/kill 10', summon.world);
  check('/kill <半径> 清除附近生物', kill.world.mobs.length === 0 && kill.out.lastInfo.includes('1'));
  const killSelf = run('/kill');
  check('/kill 自杀有反馈', killSelf.out.lastInfo.includes('死了'));

  const effect = run('/effect give speed 10 1');
  check('/effect give 生效', effect.world.effects.get('speed')?.seconds === 10 && effect.world.effects.get('speed')?.amplifier === 1);
  const clear = run('/effect clear');
  check('/effect clear 清空', clear.world.effects.size === 0);
  const badEffect = run('/effect give 飞行 10');
  check('未知效果报错', badEffect.out.lastError.includes('未知的状态效果'));
}

console.log('\n[模式、种子与权限]');
{
  const { world, out } = run('/gamemode survival');
  check('/gamemode survival 关掉飞行', world.flying === false && world.creative === false && out.lastInfo.includes('生存'));
  const creative = run('/gamemode c');
  check('/gamemode c 是 creative 的简写', creative.world.creative === true);
  // 批次 491：旁观是第三种模式（不是"创造 + 特判"）
  const spectator = run('/gamemode sp');
  check('/gamemode sp 是 spectator 的简写', spectator.world.gameMode_ === 'spectator', spectator.out.lastError);
  check('旁观也算能飞', spectator.world.flying === true);
  check('旁观不是创造', spectator.world.creative === false);
  check('旁观的中文名', spectator.out.lastInfo.includes('旁观'), spectator.out.lastInfo);
  const badMode = run('/gamemode nope');
  check('拼错的模式报用法', badMode.out.lastError.includes('spectator'), badMode.out.lastError);
  const seed = run('/seed');
  check('/seed 显示种子', seed.out.lastInfo.includes('4242'));
  const list = run('/list');
  check('/list 列出玩家', list.out.lastInfo.includes('玩家'));

  // 生存模式下创造专用命令应被拒绝
  const survival = new FakeWorld();
  survival.creative = false;
  const denied = new Recorder();
  executeCommand('/give stone 1', survival, denied);
  check('生存模式下 /give 被拒绝', denied.lastError.includes('创造模式'));
  const help = new Recorder();
  executeCommand('/help tp', survival, help);
  check(
    '非创造专用命令（/help）不受影响，且用法与描述各占一条消息',
    help.infos.length === 2 && help.infos.join('\n').includes('/tp'),
    String(help.infos.length),
  );
}

console.log('\n[/help]');
{
  const all = run('/help');
  check('/help 标题最后发（聊天栏新消息在上，标题会显示在最上面）', all.out.lastInfo.includes(`可用命令（${COMMANDS.length} 条）`));
  check(
    '/help 每条命令单独一条消息（不再拼成一个多行大块）',
    all.out.infos.length === COMMANDS.length + 1 &&
      COMMANDS.every((spec) => all.out.infos.some((line) => line.startsWith(spec.usage))),
    `${all.out.infos.length} 条 / ${COMMANDS.length} 个命令`,
  );
  const one = run('/help fill');
  const oneText = one.out.infos.join('\n');
  check('/help <命令> 用法与描述分开，且都能看到', oneText.includes('/fill') && oneText.includes('32768'));
  const unknown = run('/help nope');
  check('/help <未知> 报错', unknown.out.lastError.includes('未知的命令'));
}

// ---------------------------------------------------------------- 4. 规则与难度

console.log('\n[难度与游戏规则的数据层]');
{
  check('难度四档且与原版同名', JSON.stringify([...DIFFICULTIES]) === JSON.stringify(['peaceful', 'easy', 'normal', 'hard']));
  check('命令模块与规则模块共用同一份难度定义', JSON.stringify([...RULE_DIFFICULTIES]) === JSON.stringify([...DIFFICULTIES]));
  check('每档都有中文名', DIFFICULTIES.every((value) => DIFFICULTY_LABELS[value].length > 0));
  check('isDifficulty 正确判定', isDifficulty('hard') && !isDifficulty('HARD'));

  check('和平难度不刷敌对生物', difficultyProfile('peaceful').hostileSpawning === false);
  check('和平难度生物伤害为 0', difficultyProfile('peaceful').mobDamage === 0);
  check('和平难度饿不死', difficultyProfile('peaceful').starveRate === 0);
  check('困难伤害高于普通', difficultyProfile('hard').mobDamage > difficultyProfile('normal').mobDamage);
  check('普通是基准（倍率 1）', difficultyProfile('normal').mobDamage === 1);
  check('未知难度回退普通', difficultyProfile('nope' as Difficulty).mobDamage === 1);

  check('旧存档缺字段时全部回退默认', JSON.stringify(normalizeGameRules(undefined)) === JSON.stringify(DEFAULT_GAME_RULES));
  check('脏数据被逐项丢弃', normalizeGameRules({ keepInventory: 'yes', randomTickSpeed: 'many' }).keepInventory === false);
  check('数值规则被夹紧并取整', normalizeGameRules({ randomTickSpeed: 999.7 }).randomTickSpeed === 100);
  check('合法字段被保留', normalizeGameRules({ mobGriefing: false, randomTickSpeed: 5 }).mobGriefing === false);
  check('难度脏数据回退普通', normalizeDifficulty('地狱') === 'normal' && normalizeDifficulty(undefined) === 'normal');
}

// ---------------------------------------------------------------- 5. 名字解析

console.log('\n[物品/方块名解析]');
{
  check('英文短名', resolveItemId('stone') === resolveItemId('minecraft:stone'));
  check('中文名', resolveItemId('石头') === resolveItemId('stone'));
  check('数字 id', resolveItemId(String(resolveItemId('stone'))) === resolveItemId('stone'));
  check('未知名返回 undefined', resolveItemId('not_a_thing') === undefined);
  check('方块名解析（air 特判为 0）', resolveBlockId('air') === 0 && resolveBlockId('石头') === resolveItemId('stone'));
  check('每个方块都能被解析出来（名字表与方块表一致）', BLOCKS.every((def) => !def || def.id === 0 || resolveBlockId(def.name.replace('minecraft:', '')) === def.id));
}

// ---------------------------------------------------------------- 6. 经验（I5）

console.log('\n[/xp 命令]');
{
  const { world, out } = run('/xp query');
  check('初始是 0 级', out.lastInfo.includes('等级 0'), out.lastInfo);

  const add = run('/xp add 7', world);
  check('加 7 点经验升到 1 级（原版 0→1 级只要 7 点）', world.experience.level === 1, String(world.experience.level));
  check('反馈里说明了实际进账', add.out.lastInfo.includes('实际进账 7'), add.out.lastInfo);

  run('/xp add 100', world);
  check('一次加 100 点会连升好几级', world.experience.level > 3, String(world.experience.level));

  run('/xp set 30', world);
  check('set 直接设等级', world.experience.level === 30);
  const query = run('/xp query', world);
  check('query 报出当前等级与进度', query.out.lastInfo.includes('等级 30'), query.out.lastInfo);

  const bad = run('/xp add abc', world);
  check('非法数量报错而不是静默', bad.out.lastError.includes('数量无效'), bad.out.lastError);
  const negative = run('/xp add -5', world);
  check('负数经验被拒绝', negative.out.lastError.includes('数量无效'), negative.out.lastError);
  const unknown = run('/xp nope', world);
  check('未知子命令给出用法', unknown.out.lastError.includes('用法'), unknown.out.lastError);
  check('失败时等级没被改动', world.experience.level === 30, String(world.experience.level));
}

console.log('\n[批次 368：/spawnpoint 与 /setworldspawn]');
{
  const world = new FakeWorld();
  const out = new Recorder();
  executeCommand('/spawnpoint', world, out);
  check('不带坐标 → 设在玩家当前位置', world.personalSpawn?.x === 10.5 && world.personalSpawn?.z === -3.5, JSON.stringify(world.personalSpawn));
  executeCommand('/setworldspawn 1 70 2', world, out);
  check('带坐标 → 设在世界出生点', world.worldSpawn?.x === 1 && world.worldSpawn?.y === 70 && world.worldSpawn?.z === 2, JSON.stringify(world.worldSpawn));
  check('两条命令都有成功反馈', out.infos.length >= 2, `${out.infos.length}`);
}

console.log('\n[批次 372：/enchant]');
{
  const world = new FakeWorld();
  const out = new Recorder();
  executeCommand('/enchant 锋利 5', world, out);
  check('按中文名找到附魔并夹到上限', world.enchanted?.id === 'sharpness' && world.enchanted?.level === 5, JSON.stringify(world.enchanted));
  executeCommand('/enchant 不存在的附魔', world, out);
  check('未知附魔给出错误', out.lastError.includes('找不到附魔'), out.lastError);
}

console.log('\n[批次 373：/me 与 /say]');
{
  const world = new FakeWorld();
  const out = new Recorder();
  executeCommand('/me 挥了挥手', world, out);
  check('/me 带玩家名', out.lastInfo.includes('* 玩家 挥了挥手'), out.lastInfo);
  executeCommand('/say 大家好啊', world, out);
  check('/say 原样发消息', out.lastInfo === '大家好啊', out.lastInfo);
  executeCommand('/me', world, out);
  check('/me 空参数给用法', out.lastError.includes('用法'), out.lastError);
}

console.log('\n[批次 389：/playsound]');
{
  const world = new FakeWorld();
  const out = new Recorder();
  executeCommand('/playsound click', world, out);
  check('认识的音效会播放', world.played.includes('click') && out.lastInfo.includes('click'), out.lastInfo);
  executeCommand('/playsound nope', world, out);
  check('不认识的音效给出错误', out.lastError.includes('找不到音效'), out.lastError);
}


console.log('\n[批次 396：/particle /target /tell /msg]');
{
  const world = new FakeWorld();
  const out = new Recorder();
  executeCommand('/particle crit 12', world, out);
  check('认识的粒子会生成', world.particles.includes('crit') && out.lastInfo.includes('12'), out.lastInfo);
  executeCommand('/particle nope', world, out);
  check('未知粒子给出错误', out.lastError.includes('找不到粒子'), out.lastError);
  executeCommand('/tell 你好', world, out);
  check('/tell 带来源', out.lastInfo.includes('玩家') && out.lastInfo.includes('你好'), out.lastInfo);
  executeCommand('/msg 在吗', world, out);
  check('/msg 带来源', out.lastInfo.includes('在吗'), out.lastInfo);
  executeCommand('/particle crit 999', world, out);
  check('粒子数量超限报错', out.lastError.includes('1~200'), out.lastError);
}

console.log('\n[记分板（M23，批次 402）]');
{
  const world = new FakeWorld();
  const out = new Recorder();
  const run = (line: string): Recorder => {
    out.infos.length = 0;
    out.errors.length = 0;
    executeCommand(line, world, out);
    return out;
  };

  run('/scoreboard objectives add kills dummy 击杀数');
  check('建目标', world.board.objectiveNames().includes('kills'), out.lastError);
  check('显示名生效', world.board.objective('kills')?.displayName === '击杀数');
  check('重名报错', run('/scoreboard objectives add kills').lastError.includes('已经存在'));
  check('非法名报错', run('/scoreboard objectives add 目标!').lastError.includes('目标名'));
  check('准则不支持时报错（不假装接受）', run('/scoreboard objectives add food health').lastError.includes('准则'));

  run('/scoreboard players set 甲 kills 3');
  check('设分', world.board.getScore('甲', 'kills') === 3, out.lastError);
  run('/scoreboard players add 甲 kills 2');
  check('加分', world.board.getScore('甲', 'kills') === 5);
  run('/scoreboard players remove 甲 kills 4');
  check('减分', world.board.getScore('甲', 'kills') === 1);
  run('/scoreboard players remove 甲 kills 10');
  check('可以减成负数（原版也是）', world.board.getScore('甲', 'kills') === -9);

  run('/scoreboard players set 甲 kills 999999999999');
  check('超过 32 位整数时被夹住', world.board.getScore('甲', 'kills') === 2147483647);
  run('/scoreboard players get 甲 kills');
  check('查询回执带数值', out.lastInfo.includes('2147483647'), out.lastInfo);

  run('/scoreboard players set 甲 nope 1');
  check('目标不存在时报错', out.lastError.includes('不存在'));

  run('/scoreboard players set @p kills 7');
  check(
    '@p 解析成玩家昵称当持有人',
    world.board.getScore(world.playerName_, 'kills') === 7,
    out.lastError,
  );

  run('/scoreboard players list 甲');
  check('列出某人的分数', out.lastInfo.includes('kills='), out.lastInfo);

  // ---- 运算（批次 467）：target = target op source
  run('/scoreboard objectives add base dummy');
  run('/scoreboard players set 甲 kills 10');
  run('/scoreboard players set 乙 base 3');
  run('/scoreboard players operation 甲 kills = 乙 base');
  check('= 赋值', world.board.getScore('甲', 'kills') === 3, out.lastError);
  run('/scoreboard players operation 甲 kills += 乙 base');
  check('+= 加', world.board.getScore('甲', 'kills') === 6);
  run('/scoreboard players operation 甲 kills -= 乙 base');
  check('-= 减', world.board.getScore('甲', 'kills') === 3);
  run('/scoreboard players operation 甲 kills *= 乙 base');
  check('*= 乘', world.board.getScore('甲', 'kills') === 9);
  run('/scoreboard players operation 甲 kills /= 乙 base');
  check('/= 整除', world.board.getScore('甲', 'kills') === 3);
  run('/scoreboard players operation 甲 kills %= 乙 base');
  check('%= 取余', world.board.getScore('甲', 'kills') === 0);

  run('/scoreboard players set 甲 kills 7');
  run('/scoreboard players set 乙 base 0');
  run('/scoreboard players operation 甲 kills /= 乙 base');
  check('除数为 0 时分数不变（原版行为，不报错）', world.board.getScore('甲', 'kills') === 7);

  run('/scoreboard players set 乙 base 3');
  run('/scoreboard players operation 甲 kills < 乙 base');
  check('< 取小', world.board.getScore('甲', 'kills') === 3);
  run('/scoreboard players operation 甲 kills > 乙 base');
  check('> 取大', world.board.getScore('甲', 'kills') === 3);
  run('/scoreboard players set 甲 kills 9');
  run('/scoreboard players operation 甲 kills >< 乙 base');
  check(
    '>< 交换两边的分数',
    world.board.getScore('甲', 'kills') === 3 && world.board.getScore('乙', 'base') === 9,
    `甲=${world.board.getScore('甲', 'kills')} 乙=${world.board.getScore('乙', 'base')}`,
  );

  run('/scoreboard players operation 甲 nope = 乙 base');
  check('目标不存在时报错', out.lastError.includes('不存在'), out.lastError);
  run('/scoreboard players operation 甲 kills = 乙 nope');
  check('来源目标不存在时报错', out.lastError.includes('不存在'), out.lastError);
  run('/scoreboard players operation 甲 kills');
  check('参数不够报用法', out.lastError.includes('用法'), out.lastError);
  run('/scoreboard players operation 甲 kills ** 乙 base');
  check('不认识的运算符报错', out.lastError.includes('运算：'), out.lastError);

  // 来源可以是选择器（原版最常见的用法就是把玩家的分数合并到计数器里）
  run('/scoreboard players set 甲 kills 5');
  run('/scoreboard players operation 甲 kills = @p kills');
  check(
    '来源用选择器时展开成持有人',
    world.board.getScore('甲', 'kills') === world.board.getScore(world.playerName_, 'kills'),
    `${world.board.getScore('甲', 'kills')}`,
  );

  // ---- /team（批次 468）
  run('/team add red 红队');
  check('建队', world.teams_.get('red') !== null, out.lastError);
  check('显示名生效', world.teams_.get('red')?.displayName === '红队');
  check('重名报错', run('/team add red').lastError.includes('已经存在'));
  run('/team add blue');
  check('建第二个队', world.teams_.count === 2, out.lastError);

  run('/team join red @p');
  check('把自己拉进队', world.teams_.teamOf(world.playerName_)?.name === 'red', out.lastError);
  run('/team join blue @p');
  check('换队时自动退出旧队（一人只能在一个队）', world.teams_.teamOf(world.playerName_)?.name === 'blue');
  check('旧队里没有人了', world.teams_.membersOf('red').length === 0);

  run('/team leave');
  check('退出队伍', world.teams_.teamOf(world.playerName_) === null, out.lastError);
  check('本来没队时只是提示', run('/team leave').lastInfo.includes('本来就不在'), out.lastInfo);

  run('/team join nope @p');
  check('加入不存在的队报错', out.lastError.includes('不存在'), out.lastError);

  run('/team modify red friendlyFire true');
  check('打开友好伤害', world.teams_.get('red')?.friendlyFire === true, out.lastError);
  run('/team modify red friendlyFire maybe');
  check('友好伤害只接受 true/false', out.lastError.includes('true 或 false'), out.lastError);
  run('/team modify red color purple');
  check('改颜色', world.teams_.get('red')?.color === 'purple', out.lastError);
  run('/team modify red color rainbow');
  check('不认识的颜色报错', out.lastError.includes('颜色不认识'), out.lastError);
  run('/team modify nope color red');
  check('改不存在的队报错', out.lastError.includes('不存在'), out.lastError);

  run('/team list');
  check('列出队伍（带人数）', out.lastInfo.includes('人'), out.lastInfo);

  run('/team remove red');
  check('删队', world.teams_.get('red') === null, out.lastError);
  run('/team remove red');
  check('删不存在的队报错', out.lastError.includes('不存在'));

  check('同一队的两个人算队友（friendlyFire 判定的入口）', (() => {
    world.teams_.add('pair');
    world.teams_.join('pair', 'A');
    world.teams_.join('pair', 'B');
    return world.teams_.sameTeam('A', 'B') && !world.teams_.sameTeam('A', 'C');
  })());


  // ---- /data（批次 479）
  run('/data get entity @s');
  check('读自己的位置', out.lastInfo.includes('Pos = ['), out.lastInfo);
  check('回执里带类型', out.lastInfo.includes('player'), out.lastInfo);
  run('/data get entity @e[type=zombie]');
  check('没有匹配时报错', out.lastError.includes('没有匹配到'), out.lastError);
  run('/data get block 0 64 0');
  check('读方块', out.lastInfo.includes('minecraft:stone'), out.lastInfo);
  check('回执带状态位', out.lastInfo.includes('状态位'), out.lastInfo);
  run('/data get block 1 64 0');
  check('空气格报错', out.lastError.includes('空气'), out.lastError);
  run('/data get block 0 64');
  check('坐标不全报用法', out.lastError.includes('用法'), out.lastError);
  run('/data merge entity @s');
  check('只支持 get（merge 明确拒绝）', out.lastError.includes('用法'), out.lastError);
  run('/data get');
  check('缺参数报用法', out.lastError.includes('用法'), out.lastError);


  // ---- /damage（批次 480）
  run('/damage @s 6');
  check('对匹配到的实体造成伤害', world.damaged.length === 1 && world.damaged[0]!.amount === 6, JSON.stringify(world.damaged));
  run('/damage @s 0');
  check('伤害必须大于 0', out.lastError.includes('大于 0'), out.lastError);
  run('/damage @s');
  check('缺伤害报用法', out.lastError.includes('用法'), out.lastError);
  run('/damage @e[type=enderman] 3');
  check('没有匹配时报错', out.lastError.includes('没有匹配到'), out.lastError);

  // ---- /loot（批次 480）
  run('/loot give village_house');
  check('掷一次战利品表会往背包塞东西', world.given.length > 0, `${world.given.length} 件`);
  const before = world.given.length;
  run('/loot give village_house 3');
  check('数量参数生效（掷 3 次）', world.given.length > before, `${world.given.length - before} 件`);
  run('/loot give nope');
  check('表名不存在时报错', out.lastError.includes('没有这张战利品表'), out.lastError);
  run('/loot give village_house 99');
  check('数量上限 10', out.lastError.includes('1~10'), out.lastError);
  run('/loot');
  check('缺参数报用法', out.lastError.includes('用法'), out.lastError);

  run('/scoreboard players reset 甲');
  check('重置清空该人的分数', world.board.getScore('甲', 'kills') === null);

  run('/scoreboard objectives setdisplay sidebar kills');
  check('侧边栏显示目标', world.board.display('sidebar') === 'kills');
  check('槽位名非法报错', run('/scoreboard objectives setdisplay 侧边栏 kills').lastError.includes('槽位'));
  check('显示不存在的目标报错', run('/scoreboard objectives setdisplay sidebar nope').lastError.includes('不存在'));
  run('/scoreboard objectives setdisplay sidebar');
  check('不写目标名 = 清空槽位', world.board.display('sidebar') === null);

  world.board.setScore('乙', 'kills', 4);
  run('/scoreboard objectives remove kills');
  check('删目标', world.board.objective('kills') === null);
  check('删目标连带清掉分数', world.board.getScore('乙', 'kills') === null);

  run('/scoreboard');
  check('不带子命令时给用法', out.lastError.includes('用法'));

  // 存读档口径：坏条目跳过、好的收下（SaveGame 接进来时靠这个数验收）
  const restored = new Scoreboard();
  const skipped = restored.restore({
    objectives: [
      { name: 'ok', criterion: 'dummy', displayName: '', scores: [['甲', 3]] },
      { name: 'bad name', criterion: 'dummy', displayName: '', scores: [] },
    ],
    displays: [
      ['sidebar', 'ok'],
      ['list', 'missing'],
    ],
  });
  check('restore 跳过非法目标与悬空槽位', skipped === 2, String(skipped));
  check('restore 收下合法的部分', restored.getScore('甲', 'ok') === 3);
  check('restore 恢复显示槽位', restored.display('sidebar') === 'ok');
}

console.log('\n[进度命令 /advancement（批次 415）]');
{
  const world = new FakeWorld();
  const out = new Recorder();
  const run2 = (line: string): Recorder => {
    out.infos.length = 0;
    out.errors.length = 0;
    executeCommand(line, world, out);
    return out;
  };
  const first = ADVANCEMENTS[0]!.id;

  check('命令表里有 /advancement', COMMANDS.some((command) => command.name === 'advancement'));

  run2(`/advancement grant ${first}`);
  check('授予一条进度', world.progressTracker.isEarned(first), out.lastError);
  check('重复授予报告 0 条', run2(`/advancement grant ${first}`).lastInfo.includes('0 条'), out.lastInfo);

  run2(`/advancement revoke ${first}`);
  check('收回一条进度', !world.progressTracker.isEarned(first));
  check('收回没达成的进度也报告 0 条', run2(`/advancement revoke ${first}`).lastInfo.includes('0 条'));

  check('未知的进度 id 报错', run2('/advancement grant no/such_thing').lastError.includes('没有这条进度'));
  check('动作写错报用法', run2('/advancement 拿走 ' + first).lastError.includes('用法'));

  run2('/advancement grant *');
  const earned = ADVANCEMENTS.filter((def) => world.progressTracker.isEarned(def.id)).length;
  check('`*` 一次全给', earned === ADVANCEMENTS.length, `${earned} / ${ADVANCEMENTS.length}`);

  // 收回父条目会连带收回子条目（否则界面上子条目挂在 ??? 底下）
  const parent = ADVANCEMENTS.find((def) => ADVANCEMENTS.some((child) => child.parent === def.id));
  if (parent) {
    const child = ADVANCEMENTS.find((def) => def.parent === parent.id)!;
    run2(`/advancement revoke ${parent.id}`);
    check('收回父条目连带收回子条目', !world.progressTracker.isEarned(child.id), child.id);
    check('父条目本身也收回了', !world.progressTracker.isEarned(parent.id));
  }
}

console.log('\n[/locate biome（批次 416）]');
{
  // ---- 纯逻辑：假探针（脚下 80×80 是平原，正东 100 格外是沙漠，其余是海洋）
  const probe = (x: number, z: number): string | null => {
    if (x > 100) return 'desert';
    if (Math.abs(x) < 40 && Math.abs(z) < 40) return 'plains';
    return 'ocean';
  };
  const here = findNearestBiome(probe, 'plains', { x: 0, z: 0 });
  check('脚下就是目标群系时立刻返回（距离 0）', here !== null && here.distance === 0, JSON.stringify(here));

  const desert = findNearestBiome(probe, 'desert', { x: 0, z: 0 });
  check('按环由近到远找到沙漠', desert !== null && desert.x > 100, JSON.stringify(desert));
  check('沙漠确实比海洋远（先命中的是近的那一环）', desert !== null && desert.ring >= 40);

  const none = findNearestBiome(() => 'ocean', 'desert', { x: 0, z: 0 }, { maxRadius: 64 });
  check('半径内没有就返回 null（不是死循环）', none === null);

  const a = findNearestBiome(probe, 'desert', { x: 7, z: -3 });
  const b = findNearestBiome(probe, 'desert', { x: 7, z: -3 });
  check('同样的输入两次结果完全一致（验收脚本靠这个）', JSON.stringify(a) === JSON.stringify(b), JSON.stringify(a));

  const unknown = findNearestBiome(() => null, 'plains', { x: 0, z: 0 }, { maxRadius: 32 });
  check('探针全返回 null（区块没生成）时也只是"没找到"', unknown === null);

  // ---- 命令层
  const world = new FakeWorld();
  const out = new Recorder();
  const run3 = (line: string): Recorder => {
    out.infos.length = 0;
    out.errors.length = 0;
    executeCommand(line, world, out);
    return out;
  };
  check('缺参数报用法', run3('/locate biome').lastError.includes('用法'));
  check(
    'structure 能找到（批次 464：主线程重算候选点，不需要 Worker）',
    run3('/locate structure village').lastInfo.includes('120, 64, -80'),
    out.lastInfo,
  );
  check('回执里带距离', run3('/locate structure village').lastInfo.includes('144 格'), out.lastInfo);
  check(
    '结构名不认识时报告没找到（不是静默成功）',
    run3('/locate structure stronghold').lastError.includes('没有找到'),
    out.lastError,
  );
  check('缺结构名报用法', run3('/locate structure').lastError.includes('用法'));
  check('假世界查不到群系时报告没找到', run3('/locate biome plains').lastError.includes('没有找到'));
}

console.log('\n[/clone 区域复制（批次 431）]');
{
  // ---- 纯逻辑：用 Map 当世界
  const world = new Map<string, number>();
  const key = (x: number, y: number, z: number): string => `${x},${y},${z}`;
  const io = {
    read: (x: number, y: number, z: number) => world.get(key(x, y, z)) ?? 0,
    write: (x: number, y: number, z: number, id: number) => void world.set(key(x, y, z), id),
  };

  // 摆一个 2×1×2 的"房子"：四个角是石头，其余空气
  world.set(key(0, 0, 0), 1);
  world.set(key(1, 0, 0), 1);
  world.set(key(0, 0, 1), 1);
  world.set(key(1, 0, 1), 1);

  const box = normalizeCloneBox({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 1 });
  check('体积算得对', cloneVolume(box) === 4, String(cloneVolume(box)));
  check('归一化把对角点排成 min/max', box.x1 === 0 && box.x2 === 1 && box.y1 === 0 && box.y2 === 0);

  const plain = cloneRegion(io, box, { x: 10, y: 0, z: 0 }, 'replace');
  check('replace 复制了全部 4 格', plain.copied === 4 && plain.skipped === 0, JSON.stringify(plain));
  check('目标位置真的有石头', io.read(10, 0, 0) === 1 && io.read(11, 0, 1) === 1);

  // masked：目标已有一格石头 → 那一格跳过，不覆盖
  world.set(key(20, 0, 0), 7);
  const masked = cloneRegion(io, box, { x: 20, y: 0, z: 0 }, 'masked');
  check('masked 跳过非空气格', masked.skipped === 1 && masked.copied === 3, JSON.stringify(masked));
  check('被占的那格没被覆盖', io.read(20, 0, 0) === 7);
  check('其余格子照常复制', io.read(21, 0, 1) === 1);

  // 重叠复制：先读后写，结果不能取决于遍历顺序
  world.clear();
  world.set(key(0, 0, 0), 1);
  world.set(key(1, 0, 0), 2);
  const overlap = normalizeCloneBox({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
  cloneRegion(io, overlap, { x: 1, y: 0, z: 0 }, 'replace');
  check('重叠复制不会把源数据覆盖坏', io.read(1, 0, 0) === 1 && io.read(2, 0, 0) === 2,
    `${io.read(1, 0, 0)} / ${io.read(2, 0, 0)}`);
  check('上限是 32768', CLONE_LIMIT === 32768);

  // ---- 命令层
  const fake = new FakeWorld();
  const out = new Recorder();
  const run4 = (line: string): Recorder => {
    out.infos.length = 0;
    out.errors.length = 0;
    executeCommand(line, fake, out);
    return out;
  };
  check('参数不够报用法', run4('/clone 0 0 0 1 1 1 5').lastError.includes('用法'));
  check('位移必须是数字', run4('/clone 0 0 0 1 1 1 ~ ~ ~').lastError.includes('位移'));
  check('模式写错报错', run4('/clone 0 0 0 1 1 1 5 0 0 nope').lastError.includes('模式'));
  check('超上限报错', run4('/clone 0 0 0 99 99 99 0 0 0').lastError.includes('上限'));
}

// ---------------------------------------------------------------- /help 生成器
//
// 批次 533（用户）：/help 改成独立弹窗，并且能用表单生成命令。
// 这一组只测纯逻辑：usage → 字段 → 回拼命令；DOM 由 ui-test 守。
{
  const equal = (label: string, actual: unknown, expected: unknown): void => {
    check(label, Object.is(actual, expected), `实际 ${String(actual)}，期望 ${String(expected)}`);
  };
  const entries = commandHelpEntries();
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  const fieldsOf = (name: string, variant = 0) => {
    const entry = byName.get(name)!;
    return entry.variants[variant]!.parts
      .filter((part) => part.kind === 'field')
      .map((part) => (part as { kind: 'field'; field: CommandHelpField }).field);
  };
  const field = (name: string, label: string, variant = 0) => {
    const found = fieldsOf(name, variant).find((item) => item.label === label);
    check(`${name} 有「${label}」字段`, found !== undefined);
    return found!;
  };

  equal('帮助条目覆盖全部命令（/help 自身除外）', entries.length, COMMANDS.length - 1);
  check('每条命令都有用法与说明', entries.every((entry) => entry.usage.length > 0 && entry.description.length > 0));
  check('每条命令至少有一个变体', entries.every((entry) => entry.variants.length > 0));
  check('/help 不在指令列表里', !byName.has('help'));
  check(
    '指令按字母排序',
    entries.every((entry, index) => index === 0 || entries[index - 1]!.name.localeCompare(entry.name, 'en') <= 0),
    entries.map((entry) => entry.name).join(','),
  );

  {
    const item = field('give', '物品');
    const count = field('give', '数量');
    equal(
      'give 能生成完整命令',
      buildCommand(byName.get('give')!, 0, { [item.key]: 'stone', [count.key]: '64' }),
      '/give stone 64',
    );
    equal(
      'give 的必填项没填时返回 null',
      buildCommand(byName.get('give')!, 0, { [count.key]: '64' }),
      null,
    );
  }

  {
    const time = field('time', '时间');
    equal('time 的固定选项 + 数字自定义是 combo', time.kind, 'combo');
    equal(
      'time 能生成 /time set noon',
      buildCommand(byName.get('time')!, 0, { [time.key]: 'noon' }),
      '/time set noon',
    );
    equal(
      'time 的自定义数字优先',
      buildCommand(byName.get('time')!, 0, { [time.key]: 'day', [`${time.key}__custom`]: '1000' }),
      '/time set 1000',
    );
    equal(
      '选了自定义但没填数字时不允许生成',
      buildCommand(byName.get('time')!, 0, { [time.key]: '__custom__' }),
      null,
    );
  }

  {
    const weather = field('weather', '天气');
    equal('weather 是下拉', weather.kind, 'select');
    equal('weather 的 clear 在天气语境下叫晴天', weather.options![0]!.label, '晴天');
  }

  {
    const action = field('effect', '操作');
    const effect = field('effect', '效果');
    equal('effect 的操作是下拉', action.kind, 'select');
    equal('effect 的效果是下拉', effect.kind, 'select');
    equal('effect 的 clear 在效果语境下叫清除', action.options![1]!.label, '清除');
  }

  {
    const dimension = field('tp', '维度');
    equal('tp 的维度是可选下拉', dimension.kind, 'select');
    check('tp 的维度可以不填', dimension.optional);
  }

  {
    const entry = byName.get('worldborder')!;
    equal('worldborder 拆成三个变体', entry.variants.length, 3);
    check('worldborder 变体名不重复', new Set(entry.variants.map((variant) => variant.label)).size === 3);
  }

  {
    const entry = byName.get('xp')!;
    equal('xp 拆成三个变体', entry.variants.length, 3);
    const points = fieldsOf('xp', 0)[0]!;
    equal('xp add 能生成命令', buildCommand(entry, 0, { [points.key]: '10' }), '/xp add 10');
  }

  {
    const entry = byName.get('team')!;
    const mode = field('team', '操作');
    equal('team 的操作是下拉', mode.kind, 'select');
    check('team 能生成带模式的命令', (buildCommand(entry, 0, {}) ?? '').startsWith('/team '));
  }

  {
    const entry = byName.get('scoreboard')!;
    check(
      'scoreboard 两个变体的名字能区分（记分项/玩家）',
      entry.variants.length === 2 && entry.variants[0]!.label !== entry.variants[1]!.label,
      entry.variants.map((variant) => variant.label).join(' | '),
    );
  }

  {
    const entry = byName.get('execute')!;
    const fields = fieldsOf('execute');
    const rest = fields.find((item) => item.label === '其余参数')!;
    const command = fields.find((item) => item.label === '命令')!;
    equal(
      'execute 的 … 不会把后面的 run <命令> 吞掉',
      buildCommand(entry, 0, { [rest.key]: '@s', [command.key]: 'say hi' }),
      '/execute as @s run say hi',
    );
  }

  {
    const spawn = byName.get('spawnpoint')!;
    equal('spawnpoint 的 [x y z] 合成一个坐标字段', fieldsOf('spawnpoint').length, 1);
    equal('spawnpoint 可以只生成 /spawnpoint', buildCommand(spawn, 0, {}), '/spawnpoint');
  }

  {
    const mob = field('summon', '生物');
    equal('summon 的生物是下拉', mob.kind, 'select');
    check(
      '召唤生物显示中文名（值仍是英文 id）',
      mob.options!.some((option) => option.value === 'zombie' && option.label.includes('僵尸')),
      mob.options!.slice(0, 3).map((option) => `${option.value}=${option.label}`).join(','),
    );
  }

  {
    const rule = field('gamerule', '规则');
    check(
      '游戏规则显示中文名（值仍是英文 id）',
      rule.options!.some(
        (option) => option.value === 'keepInventory' && option.label.includes('死亡后保留物品'),
      ),
      rule.options!.slice(0, 3).map((option) => `${option.value}=${option.label}`).join(','),
    );
    const value = field('gamerule', '值');
    equal('gamerule 的值是 true/false + 自定义数字', value.kind, 'combo');
    check('gamerule 的值有中文开启/关闭', value.options!.some((option) => option.label.includes('开启')));
  }

  {
    const type = field('particle', '类型');
    equal('particle 的类型是下拉', type.kind, 'select');
    check('particle 的类型有中文名', type.options!.some((option) => option.label.includes('爱心')));
  }

  {
    const table = field('loot', '战利品表');
    equal('loot 的战利品表是下拉', table.kind, 'select');
    check(
      '战利品表显示中文名（值仍是英文 key）',
      table.options!.some((option) => option.value === 'village_house' && option.label.includes('村庄小屋')),
    );
  }

  {
    const condition = field('execute', '条件');
    check(
      'execute 的条件词带中文解释（作为/在/定位到…）',
      condition.options!.some((option) => option.value === 'as' && option.label.includes('作为')),
    );
  }

  {
    const progress = field('advancement', '进度');
    equal('advancement 的进度是下拉', progress.kind, 'select');
    check(
      '进度显示中文标题（值仍是英文 id）',
      progress.options!.some(
        (option) => option.value === 'minecraft:story/root' && option.label.includes('我的世界'),
      ),
      progress.options!.slice(0, 2).map((option) => `${option.value}=${option.label}`).join(','),
    );
  }

  {
    const items = suggestCommandValues('item', '石头');
    check(
      '物品联想支持中文名',
      items.some((item) => item.value === 'stone' && item.label.includes('石头')),
      items.map((item) => `${item.value}=${item.label}`).join(','),
    );
    const english = suggestCommandValues('item', 'diamond');
    check('物品联想支持英文 id', english.some((item) => item.value.includes('diamond')));
    const blocks = suggestCommandValues('block', 'stone');
    check('方块联想返回方块 id', blocks.some((item) => item.value === 'stone'));
    equal('空输入不弹一大串联想', suggestCommandValues('item', '').length, 0);
  }

  equal('没有参数的 /seed 直接生成', buildCommand(byName.get('seed')!, 0, {}), '/seed');
}

console.log(`\n命令测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
