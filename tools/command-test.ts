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
  setCreative(on: boolean): void {
    this.creative = on;
  }
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
  check('非创造专用命令（/help）不受影响', help.infos.length === 1 && help.lastInfo.includes('/tp'));
}

console.log('\n[/help]');
{
  const all = run('/help');
  check('/help 列出全部命令', all.out.lastInfo.includes(`可用命令（${COMMANDS.length} 条）`));
  const one = run('/help fill');
  check('/help <命令> 给出用法', one.out.lastInfo.includes('/fill') && one.out.lastInfo.includes('32768'));
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

console.log(`\n命令测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
