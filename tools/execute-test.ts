/**
 * 目标选择器与 `/execute` 离线测试（K11，批次 399）
 *
 * 这两件事都是**纯解析 + 纯判定**：`Selectors.ts` 只认一个 `entities()` 快照，
 * `Commands.ts` 的 `/execute` 只改"执行原点/执行者"，都不碰 DOM、不碰渲染循环。
 * 所以"`@e[type=zombie,limit=1]` 挑中的是哪一只"能在 Node 里钉死。
 *
 * 运行：npm run test:execute
 */

import { AdvancementTracker } from '../src/core/progress/AdvancementTracker.ts';
import {
  executeCommand,
  type CommandContext,
  type CommandFeedback,
  type Difficulty,
  type GameRules,
} from '../src/core/commands/Commands.ts';
import {
  PLAYER_ENTITY_ID,
  describeSelector,
  isSelector,
  parseSelector,
  resolveSelector,
  type CommandEntity,
  type SelectorView,
} from '../src/core/commands/Selectors.ts';
import { DEFAULT_GAME_RULES } from '../src/core/world/Rules.ts';
import { defaultBorder, type WorldBorder } from '../src/core/world/WorldBorder.ts';
import { resolveBlockId } from '../src/core/registry/itemNames.ts';
import { Scoreboard } from '../src/core/world/Scoreboard.ts';

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

interface FakeMob {
  id: string;
  type: string;
  name: string;
  x: number;
  y: number;
  z: number;
}

/** 假世界：只记下命令产生的结果 */
class FakeWorld implements CommandContext {
  playerName_ = '玩家';
  pos = { x: 10.5, y: 64, z: -3.5, dimension: 'overworld' };
  flying = false;
  creative = true;
  time = 0;
  weather: 'clear' | 'rain' | 'thunder' = 'clear';
  difficultyValue: Difficulty = 'normal';
  rules: GameRules = { ...DEFAULT_GAME_RULES };
  border: WorldBorder = defaultBorder();
  blocks = new Map<string, number>();
  mobs: FakeMob[] = [];
  effects = new Map<string, { seconds: number; amplifier: number }>();
  teleports: Array<{ x: number; y: number; z: number }> = [];
  killed = 0;
  spawned: Array<{ type: string; x: number; y: number; z: number }> = [];

  playerName(): string {
    return this.playerName_;
  }
  position() {
    return { ...this.pos };
  }
  teleport(x: number, y: number, z: number): boolean {
    this.teleports.push({ x, y, z });
    this.pos = { ...this.pos, x, y, z };
    return true;
  }
  setPersonalSpawn(): void {}
  setWorldSpawn(): void {}
  enchantHeld(): boolean {
    return true;
  }
  playSound(): boolean {
    return true;
  }
  spawnParticle(): boolean {
    return true;
  }
  give(): number {
    return 1;
  }
  clearInventory(): number {
    return 0;
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
    this.killed++;
  }
  seed(): number {
    return 12345;
  }
  getBlock(x: number, y: number, z: number): number {
    return this.blocks.get(`${x},${y},${z}`) ?? 0;
  }
  setBlock(x: number, y: number, z: number, id: number): boolean {
    this.blocks.set(`${x},${y},${z}`, id);
    return true;
  }
  fillBlocks(): number {
    return 0;
  }
  setTimeOfDay(t: number): void {
    this.time = t;
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
    this.border = { ...this.border, ...patch };
    return { ...this.border };
  }
  summon(type: string, x: number, y: number, z: number): boolean {
    this.spawned.push({ type, x, y, z });
    return true;
  }
  killNearby(): number {
    return 0;
  }
  applyEffect(name: string): boolean {
    this.effects.set(name, { seconds: 0, amplifier: 0 });
    return true;
  }
  clearEffects(): void {
    this.effects.clear();
  }
  addXp(): number {
    return 0;
  }
  setXpLevel(): void {}
  xpState() {
    return { level: 0, progress: 0, toNext: 0, total: 0 };
  }
  onlinePlayers(): string[] {
    return [`${this.playerName_}(你)`];
  }
  /** 记分板（M23，批次 402）：`/execute if score` 用它 */
  readonly board = new Scoreboard();
  scoreboard(): Scoreboard {
    return this.board;
  }
  /** 进度（批次 415）：`/advancement` 用它授/收 */
  readonly progressTracker = new AdvancementTracker();
  advancements(): AdvancementTracker {
    return this.progressTracker;
  }
  /** 群系名（批次 416）：`/locate biome` 用它；假世界固定返回 null */
  biomeNameAt(): string | null {
    return null;
  }
  entities(): readonly CommandEntity[] {
    const list: CommandEntity[] = [
      {
        id: PLAYER_ENTITY_ID,
        type: 'player',
        name: this.playerName_,
        x: this.pos.x,
        y: this.pos.y,
        z: this.pos.z,
        isPlayer: true,
      },
    ];
    for (const mob of this.mobs) {
      list.push({ ...mob, isPlayer: false });
    }
    return list;
  }
}

/** 一套标准世界：玩家 (10.5, 64, -3.5)，周围四只生物 */
function makeWorld(): FakeWorld {
  const world = new FakeWorld();
  world.mobs = [
    { id: 'mob:1', type: 'zombie', name: '僵尸', x: 12, y: 64, z: -3 },
    { id: 'mob:2', type: 'zombie', name: '僵尸', x: 30, y: 64, z: -3 },
    { id: 'mob:3', type: 'skeleton', name: '骷髅', x: 11, y: 64, z: -3 },
    { id: 'mob:4', type: 'villager', name: '村民', x: 10, y: 64, z: 2 },
  ];
  return world;
}

function run(world: FakeWorld, line: string): Recorder {
  const out = new Recorder();
  executeCommand(line, world, out);
  return out;
}

const origin = { x: 10.5, y: 64, z: -3.5 };
const view = (world: FakeWorld): SelectorView => ({
  entities: () => world.entities(),
  playerName: () => world.playerName(),
});

// ---------------------------------------------------------------- 选择器解析

console.log('\n选择器解析');
{
  check('isSelector 认 @p', isSelector('@p'));
  check('isSelector 不认 @p 之外的东西', !isSelector('玩家'));

  const p = parseSelector('@p');
  check('@p 解析成 kind=@p', typeof p !== 'string' && p.kind === '@p');

  const typed = parseSelector('@e[type=zombie]');
  check(
    'type 过滤被读进来',
    typeof typed !== 'string' && typed.filter.types.join(',') === 'zombie',
  );

  const multi = parseSelector('@e[type=zombie|skeleton]');
  check(
    'type 支持竖线多值',
    typeof multi !== 'string' && multi.filter.types.join(',') === 'zombie,skeleton',
  );

  const near = parseSelector('@a[distance=..10]');
  check(
    'distance=..10 → 0..10',
    typeof near !== 'string' && near.filter.distance?.min === 0 && near.filter.distance.max === 10,
  );

  const far = parseSelector('@e[distance=5..]');
  check(
    'distance=5.. → 5..Infinity',
    typeof far !== 'string' && far.filter.distance?.min === 5 && far.filter.distance.max === Infinity,
  );

  const exact = parseSelector('@e[distance=3]');
  check(
    'distance=3 → 3..3（原版是"正好这个距离"）',
    typeof exact !== 'string' && exact.filter.distance?.min === 3 && exact.filter.distance.max === 3,
  );

  const limited = parseSelector('@p[limit=3,sort=furthest]');
  check(
    'limit 与 sort 一起解析',
    typeof limited !== 'string' && limited.filter.limit === 3 && limited.filter.sort === 'furthest',
  );

  check('未知选择器 @x 报错', typeof parseSelector('@x') === 'string');
  check('未知过滤参数报错', typeof parseSelector('@e[foo=1]') === 'string');
  check('缺等号报错', typeof parseSelector('@e[type]') === 'string');
  check('空值报错', typeof parseSelector('@e[type=]') === 'string');
  check('非数字 distance 报错', typeof parseSelector('@e[distance=abc]') === 'string');
  check('倒置区间报错', typeof parseSelector('@e[distance=8..2]') === 'string');
  check('limit=0 报错', typeof parseSelector('@e[limit=0]') === 'string');
  check('limit 小数报错', typeof parseSelector('@e[limit=1.5]') === 'string');
  check('未知 sort 报错', typeof parseSelector('@e[sort=abc]') === 'string');
  check('方括号没闭合报错', typeof parseSelector('@e[type=zombie') === 'string');
  check('@e 不带过滤合法', typeof parseSelector('@e') !== 'string');

  const described = parseSelector('@e[type=zombie,limit=2]');
  check(
    'describeSelector 只回显写下来的参数',
    typeof described !== 'string' && describeSelector(described) === '@e[type=zombie,limit=2]',
    typeof described === 'string' ? described : describeSelector(described),
  );
}

// ---------------------------------------------------------------- 选择器求值

console.log('\n选择器求值');
{
  const world = makeWorld();
  const resolve = (text: string, executor = PLAYER_ENTITY_ID, random?: () => number) => {
    const parsed = parseSelector(text);
    if (typeof parsed === 'string') throw new Error(parsed);
    return resolveSelector(parsed, { ...view(world), random }, origin, executor);
  };

  check('@e 拿到全部 5 只（含玩家）', resolve('@e').length === 5, String(resolve('@e').length));
  check('@a 只拿玩家', resolve('@a').length === 1 && resolve('@a')[0]!.isPlayer);
  check('@p 拿到最近的一个玩家', resolve('@p').length === 1 && resolve('@p')[0]!.id === PLAYER_ENTITY_ID);
  check('@s 拿到执行者自己', resolve('@s')[0]?.id === PLAYER_ENTITY_ID);
  check('@s 的执行者不在快照里时返回空', resolve('@s', 'mob:99').length === 0);
  check(
    '@p 只挑玩家（不会挑到更近的生物）',
    resolve('@p').every((entity) => entity.isPlayer),
  );

  const zombies = resolve('@e[type=zombie]');
  check('type=zombie 只挑僵尸', zombies.length === 2 && zombies.every((e) => e.type === 'zombie'));
  check('type 竖线多值挑两种', resolve('@e[type=zombie|skeleton]').length === 3);
  check('type 不认识时返回空', resolve('@e[type=ender_dragon]').length === 0);

  check('distance=..3 只留 3 格内', resolve('@e[distance=..3]').length === 3, String(resolve('@e[distance=..3]').length));
  check('distance=10.. 只留远处', resolve('@e[distance=10..]').length === 1);
  check(
    'distance 是三维距离（骷髅 0.7 格、僵尸 1.6 格）',
    resolve('@e[distance=..1]').length === 2,
    String(resolve('@e[distance=..1]').length),
  );

  const nearestZombie = resolve('@e[type=zombie,limit=1,sort=nearest]');
  check('limit+sort=nearest 挑最近那只', nearestZombie.length === 1 && nearestZombie[0]!.id === 'mob:1');

  const furthest = resolve('@e[limit=1,sort=furthest]');
  check('sort=furthest 挑最远那只', furthest.length === 1 && furthest[0]!.id === 'mob:2');

  const random = resolve('@e[limit=1,sort=random]', PLAYER_ENTITY_ID, () => 0);
  check('sort=random 在随机源确定时可复现', random.length === 1 && random[0]!.id === 'mob:1', random[0]?.id);

  check('name 过滤按中文名', resolve('@e[name=村民]').length === 1);
  check('name 过滤也能挑玩家昵称', resolve('@e[name=玩家]').length === 1);

  check('@p 默认只给一只', resolve('@p').length === 1);
  check('@e 默认不截断', resolve('@e[type=zombie]').length === 2);
}

// ---------------------------------------------------------------- /execute

console.log('\n/execute 链式执行');
{
  const world = makeWorld();
  const stone = resolveBlockId('stone')!;

  const positioned = run(world, '/execute positioned 0 70 0 run setblock ~ ~ ~ stone');
  check(
    'positioned 之后的 ~ 以新原点为准',
    world.getBlock(0, 70, 0) === stone,
    positioned.lastError,
  );

  const at = run(world, '/execute at @e[type=zombie,limit=1,sort=nearest] run setblock ~ ~ ~ stone');
  check('at 把原点挪到目标身上', world.getBlock(12, 64, -3) === stone, at.lastError);

  const chained = run(world, '/execute positioned 0 64 0 positioned ~ ~5 ~ run setblock ~ ~ ~ stone');
  check('两层 positioned 逐层叠加相对坐标', world.getBlock(0, 69, 0) === stone, chained.lastError);

  const sayAs = run(world, '/execute as @e[type=skeleton] run say 你好');
  check('as 对每个目标各执行一次', sayAs.infos.includes('你好'), sayAs.infos.join('|'));

  const missing = run(world, '/execute as @e[type=ender_dragon] run say 你好');
  check(
    '目标为空时报错而不是静默',
    missing.errors.some((line) => line.includes('没有匹配到任何目标')),
    missing.errors.join('|'),
  );

  world.setBlock(3, 64, 3, stone);
  const ifBlock = run(world, '/execute if block 3 64 3 stone run say 有');
  check('if block 成立 → 执行', ifBlock.infos.includes('有'), ifBlock.errors.join('|'));

  const ifBlockMiss = run(world, '/execute if block 3 64 3 dirt run say 没有');
  check('if block 不成立 → 静默（无 info 无 error）', ifBlockMiss.infos.length === 0 && ifBlockMiss.errors.length === 0);

  const unlessBlock = run(world, '/execute unless block 3 64 3 dirt run say 反着来');
  check('unless block 反向成立 → 执行', unlessBlock.infos.includes('反着来'));

  const ifEntity = run(world, '/execute if entity @e[type=zombie] run say 有僵尸');
  check('if entity 成立 → 执行', ifEntity.infos.includes('有僵尸'));

  const ifEntityMiss = run(world, '/execute if entity @e[type=ender_dragon] run say 有龙');
  check('if entity 不成立 → 静默', ifEntityMiss.infos.length === 0 && ifEntityMiss.errors.length === 0);

  // 条件 + 位置同时用：只有条件成立时才写方块
  world.blocks.clear();
  run(world, '/execute if entity @e[type=zombie] positioned 1 64 1 run setblock ~ ~ ~ stone');
  check('条件成立时 positioned 生效', world.getBlock(1, 64, 1) === stone);
  world.blocks.clear();
  run(world, '/execute if entity @e[type=ender_dragon] positioned 2 64 2 run setblock ~ ~ ~ stone');
  check('条件不成立时一个方块都不写', world.blocks.size === 0);

  // `as` 只换执行者、不动位置：`~ ~ ~` 仍然是玩家脚下
  world.blocks.clear();
  run(world, '/execute as @e[type=skeleton] run setblock ~ ~ ~ stone');
  check(
    'as 不改位置（~ 仍是玩家坐标）',
    world.getBlock(10, 64, -4) === stone || world.getBlock(10, 64, -3) === stone,
    [...world.blocks.keys()].join('|'),
  );

  // 相对坐标经过 `at` 之后按目标算
  world.blocks.clear();
  run(world, '/execute at @e[type=villager] run setblock ~ ~2 ~ stone');
  check('at 之后相对坐标按目标算', world.getBlock(10, 66, 2) === stone, [...world.blocks.keys()].join('|'));

  // 内层命令的报错照常透出
  const innerError = run(world, '/execute positioned 0 64 0 run setblock 0 64 0 不存在的方块');
  check('内层命令的报错会透出来', innerError.errors.length > 0, innerError.errors.join('|'));
}

console.log('\n/execute 错误路径');
{
  const world = makeWorld();

  const noRun = run(world, '/execute positioned 0 64 0');
  check('缺 run 报错', noRun.errors.some((line) => line.includes('run')), noRun.errors.join('|'));

  const emptyRun = run(world, '/execute run');
  check('run 后面没内容报错', emptyRun.errors.length > 0);

  const unknown = run(world, '/execute foo run say hi');
  check(
    '未知子命令报错并列出可用项',
    unknown.errors.some((line) => line.includes('未知的 execute 子命令')),
    unknown.errors.join('|'),
  );

  const badFilter = run(world, '/execute as @e[bad=1] run say hi');
  check('选择器写错时整条不执行', badFilter.errors.some((line) => line.includes('未知的过滤参数')));

  const badCoord = run(world, '/execute positioned a b c run say hi');
  check('positioned 坐标不合法时报错', badCoord.errors.some((line) => line.includes('坐标不合法')), badCoord.errors.join('|'));

  const unsupported = run(world, '/execute if data 玩家 run say hi');
  check(
    '未支持的条件（data）明确报"还不支持"',
    unsupported.errors.some((line) => line.includes('还不支持')),
    unsupported.errors.join('|'),
  );

  // score 是支持的（批次 402）：没有分数时条件不成立、且不报错
  const noScore = run(world, '/execute if score 玩家 kills > 1 run say 分数到了');
  check('if score 在没有分数时静默不成立', noScore.infos.length === 0 && noScore.errors.length === 0);
  world.board.addObjective('kills', 'dummy');
  world.board.setScore('玩家', 'kills', 3);
  const hasScore = run(world, '/execute if score 玩家 kills > 1 run say 分数到了');
  check('if score 成立时执行', hasScore.infos.includes('分数到了'), hasScore.errors.join('|'));
  const reversed = run(world, '/execute unless score 玩家 kills > 5 run say 还没到');
  check('unless score 反向成立时执行', reversed.infos.includes('还没到'));
  const badOp = run(world, '/execute if score 玩家 kills ?? 1 run say hi');
  check(
    'score 的运算符写错时报错',
    badOp.errors.some((line) => line.includes('运算符')),
    badOp.errors.join('|'),
  );

  // 嵌套上限：9 层 execute 必须被拦下来，而不是把栈打穿
  let deep = 'say 深';
  for (let i = 0; i < 9; i++) deep = `execute positioned 0 ${70 + i} 0 run ${deep}`;
  const tooDeep = run(world, `/${deep}`);
  check(
    '嵌套超过 8 层时报错（不会打穿调用栈）',
    tooDeep.errors.some((line) => line.includes('嵌套太深')),
    tooDeep.errors.join('|'),
  );

  // 3 层是合法的
  let ok = 'say 正好';
  for (let i = 0; i < 3; i++) ok = `execute positioned 0 ${70 + i} 0 run ${ok}`;
  const fine = run(world, `/${ok}`);
  check('3 层嵌套正常工作', fine.infos.includes('正好'), fine.errors.join('|'));
}

// ---------------------------------------------------------------- 命令表

console.log('\n命令表');
{
  const world = makeWorld();
  const help = run(world, '/help');
  check('/help 里出现 execute', help.infos.some((line) => line.includes('execute')), help.infos.join('|').slice(0, 200));

  const unknown = run(world, '/executee');
  check('拼错的命令名仍然是"未知命令"', unknown.errors.some((line) => line.includes('未知的命令')));
}

console.log(`\n${failed === 0 ? '全部通过' : '有失败'}：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
