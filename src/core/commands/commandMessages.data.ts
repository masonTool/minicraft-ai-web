/**
 * 命令反馈的「中文原文 → 英文」表（数据）。
 *
 * ⚠️ **这个文件不许 import 任何东西**。
 *
 * 原因：`I18n.ts` 要把它并进 EN 表，而 `messages.ts`（取文案的入口）要 import `I18n.ts`。
 * 三者一旦互相引用就是循环依赖 —— 实测表现是 `COMMAND_MESSAGES_EN` 在模块初始化时为
 * `undefined`，`Object.keys(undefined)` 直接抛 `TypeError`。
 * 所以数据单独一层、零依赖，`I18n.ts` 只从这里取表。顺序天然变成：data → I18n → messages。
 */

export const COMMAND_MESSAGES_EN: Readonly<Record<string, string>> = {
  // ---- /tp ----
  '坐标格式不对：应为 /tp <x> <y> <z> [维度]': 'Bad coordinates: expected /tp <x> <y> <z> [dimension]',
  '传送失败：维度 {dimension} 不存在': 'Teleport failed: dimension {dimension} does not exist',
  '已将 {player} 传送到 {x} {y} {z}{suffix}': 'Teleported {player} to {x} {y} {z}{suffix}',
  // ---- /give /clear ----
  '数量不对：{count}': 'Bad count: {count}',
  '找不到物品：{name}（可以试 /give stone 或 /give 石头）':
    'Unknown item: {name} (try /give stone)',
  '已给予 {item} ×{given}{note}': 'Gave {item} ×{given}{note}',
  '（背包只装得下 {given} 个）': ' (inventory only had room for {given})',
  '已清空背包（移除 {removed} 组物品）': 'Cleared the inventory ({removed} stacks removed)',
  // ---- /time /weather /difficulty /gamerule ----
  '时间格式不对：{value}': 'Bad time format: {value}',
  '已将时间设置为 {value}': 'Set the time to {value}',
  '(空)': '(empty)',
  '天气已切换为 {weather}': 'Weather set to {weather}',
  '难度已设置为 {difficulty}（{value}）': 'Difficulty set to {difficulty} ({value})',
  '当前游戏规则：\n{rules}': 'Current game rules:\n{rules}',
  '未知的游戏规则：{key}': 'Unknown game rule: {key}',
  '{key} 只能是 true / false': '{key} must be true or false',
  '{key} 已设置为 {value}': '{key} set to {value}',
  '{key} 需要一个数字': '{key} needs a number',
  // ---- /effect ----
  '已清除全部状态效果': 'Cleared all status effects',
  '秒数不对：{seconds}': 'Bad duration: {seconds}',
  '未知的状态效果：{name}': 'Unknown status effect: {name}',
  '已给予状态效果 {name} {seconds} 秒（等级 {level}）':
    'Applied {name} for {seconds}s (level {level})',
  // ---- /summon /kill ----
  '坐标格式不对': 'Bad coordinates',
  '未知的生物：{name}（可用：{available}）': 'Unknown entity: {name} (available: {available})',
  '已召唤 {name}': 'Summoned {name}',
  '已清除 {count} 个生物（半径 {radius}）': 'Removed {count} entities (radius {radius})',
  '只能对自己使用 /kill': '/kill can only target yourself',
  '{player} 死了': '{player} died',
  // ---- /setblock /spawnpoint /setworldspawn ----
  '找不到方块：{name}': 'Unknown block: {name}',
  '位置超出世界范围': 'Position is outside the world border',
  '已放置 {block} 于 {x} {y} {z}': 'Placed {block} at {x} {y} {z}',
  '已将重生点设置为 {x} {y} {z}': 'Spawn point set to {x} {y} {z}',
  '已将世界出生点设置为 {x} {y} {z}': 'World spawn set to {x} {y} {z}',
  // ---- /particle /tell /msg /playsound /me /say ----
  '数量必须是 1~200 的整数': 'Count must be an integer between 1 and 200',
  '找不到粒子：{kind}': 'Unknown particle: {kind}',
  '已生成 {count} 个 {kind} 粒子': 'Spawned {count} {kind} particles',
  '[{from} -> 你] {text}': '[{from} -> you] {text}',
  '找不到音效：{name}': 'Unknown sound: {name}',
  '已播放音效 {name}': 'Played sound {name}',
  // ---- /enchant ----
  '找不到附魔：{key}': 'Unknown enchantment: {key}',
  '等级必须是正整数': 'Level must be a positive integer',
  '手上没有可附魔的物品': 'Nothing in hand can be enchanted',
  '已给手持物品附上 {name} {level}': 'Applied {name} {level} to the held item',
  // ---- /clone /fill ----
  '位移只能是数字：<dx> <dy> <dz>': 'Offsets must be numbers: <dx> <dy> <dz>',
  '模式只有 masked / replace：{mode}': 'Mode must be masked or replace: {mode}',
  '区域太大（{volume} 格），上限 {limit}': 'Area too large ({volume} blocks); limit is {limit}',
  '已填充 {count} 格 {block}': 'Filled {count} blocks with {block}',
  // ---- /gamemode /seed /list /xp ----
  '已将游戏模式设置为 {mode}': 'Game mode set to {mode}',
  '世界种子：{seed}': 'World seed: {seed}',
  '在线玩家（{count}）：{players}': 'Online players ({count}): {players}',
  '等级 {level}：{progress}/{next}（累计 {total} 点）':
    'Level {level}: {progress}/{next} ({total} points total)',
  '数量无效：{value}': 'Invalid amount: {value}',
  '已给予 {value} 点经验（实际进账 {gained} 点），当前等级 {level}':
    'Gave {value} XP ({gained} counted), now level {level}',
  '已将等级设置为 {level}': 'Level set to {level}',
  // ---- /worldborder ----
  '边长必须是 ≥ {min} 的数字（当前 {current}）':
    'Size must be a number ≥ {min} (current {current})',
  '世界边界已设为边长 {size} 格（中心 {x}, {z}）':
    'World border set to {size} blocks (center {x}, {z})',
  '世界中心已设为 ({x}, {z})，边长 {size} 格':
    'World border center set to ({x}, {z}), size {size} blocks',
  // ---- /locate ----
  '这个维度还不支持 /locate structure（目前只做了主世界）':
    '/locate structure is not supported in this dimension yet (overworld only)',
  '附近没有找到 {target}（结构名要用 village / stronghold / mineshaft 这类）':
    'No {target} found nearby (use names like village / stronghold / mineshaft)',
  '640 格内没有找到 {target}（试试点名更常见的群系，或者先走远一点）':
    'No {target} within 640 blocks (try a more common biome, or walk further)',
  // ---- /damage /loot /advancement ----
  '这个环境不支持 /damage': '/damage is not supported here',
  '没有匹配到实体：{target}': 'No entities matched: {target}',
  '对 {count} 个实体造成了 {amount} 点伤害': 'Dealt {amount} damage to {count} entities',
  '数量要在 1~10 之间': 'Count must be between 1 and 10',
  '没有这张战利品表：{table}（用 village_house / mineshaft / dungeon 这类）':
    'Unknown loot table: {table} (use names like village_house / mineshaft / dungeon)',
  '这个环境不支持发放物品': 'Giving items is not supported here',
  '从 {table} 掷了 {times} 次，塞进背包 {given} 件':
    'Rolled {table} {times} times, put {given} items in the inventory',
  '没有这条进度：{target}': 'Unknown advancement: {target}',
  '已{verb} {count} 条进度{scope}': '{verb} {count} advancements{scope}',
  '（全部）': ' (all)',
  '（可用：{available}）': ' (available: {available})',
  '（伤害要大于 0）': ' (damage must be greater than 0)',
  ' 或 ': ' or ',
  // ---- /execute ----
  'execute if block：坐标不合法': 'execute if block: invalid coordinates',
  'execute 嵌套太深（上限 {limit} 层）': 'execute nested too deep (limit is {limit})',
  '选择器 {selector} 没有匹配到任何目标': 'Selector {selector} matched no targets',
  'execute positioned：坐标不合法': 'execute positioned: invalid coordinates',
  // ---- /scoreboard ----
  '目标名只能用字母/数字/下划线，1~16 个字符：{name}':
    'Objective names allow letters/digits/underscore, 1-16 chars: {name}',
  '暂不支持准则 {criterion}（只有 {supported}）':
    'Criteria {criterion} not supported yet (only {supported})',
  '目标 {name} 已经存在': 'Objective {name} already exists',
  '已创建目标 {name}（{criterion}{display}）': 'Created objective {name} ({criterion}{display})',
  '，显示为“{display}”': ', shown as "{display}"',
  '目标 {name} 不存在': 'Objective {name} does not exist',
  '已删除目标 {name}（连同它记下的所有分数）':
    'Deleted objective {name} (along with every score it held)',
  '还没有任何记分板目标': 'No scoreboard objectives yet',
  '共 {count} 个目标：{list}': '{count} objectives: {list}',
  '槽位只能是 {slots}': 'Slot must be one of {slots}',
  '已清空{slot}': 'Cleared {slot}',
  '{slot}现在显示目标 {objective}': '{slot} now shows objective {objective}',
  // ---- /data ----
  '这个维度读不到方块数据': 'Block data is not readable in this dimension',
  '({x}, {y}, {z}) 是空气或还没加载': '({x}, {y}, {z}) is air or not loaded yet',
  '({x}, {y}, {z}) = {name}（状态位 {state}）': '({x}, {y}, {z}) = {name} (state {state})',
  '……还有 {count} 个匹配': '… {count} more matches',
  // ---- /team ----
  '队伍 {name} 已经存在': 'Team {name} already exists',
  '已创建队伍 {name}{display}': 'Created team {name}{display}',
  '（显示为「{display}」）': ' (shown as "{display}")',
  '队伍 {name} 不存在': 'Team {name} does not exist',
  '已删除队伍 {name}（成员一并解绑）': 'Deleted team {name} (members unbound too)',
  '还没有任何队伍': 'No teams yet',
  '共 {count} 个队伍：{list}': '{count} teams: {list}',
  '友伤害只能是 true 或 false': 'Friendly fire must be true or false',
  '成员 {member} 没有匹配到任何对象': 'Member {member} matched nothing',
  '成员 {name} 的名字不合法（1~16 个字符）': 'Invalid member name (1-16 chars): {name}',
  '已把 {member} 加入队伍 {team}': 'Added {member} to team {team}',
  '{member} 本来就不在任何队伍里': '{member} was not on any team',
  '已让 {member} 退出队伍': 'Removed {member} from their team',
  '颜色不认识：{value}（可用 {colors}）': 'Unknown color: {value} (available: {colors})',
  '队伍 {name} 的颜色已改为 {color}': 'Team {name} color changed to {color}',
  '不认识的属性 {key}（只有 friendlyFire 与 color）':
    'Unknown property {key} (only friendlyFire and color)',
  '友好伤害只能是 true 或 false': 'Friendly fire must be true or false',
  '队伍 {name} 的友好伤害已{state}': 'Team {name} friendly fire is now {state}',
  '打开': 'on',
  '关闭': 'off',
  // ---- /scoreboard players ----
  '目标 {target} 没有匹配到任何对象': 'Target {target} matched nothing',
  '分数必须是数字：{raw}': 'Score must be a number: {raw}',
  '已将 {holder} 的 {objective} 设为 {score}': 'Set {holder} {objective} to {score}',
  '已将 {holder} 的 {objective} 加至 {score}': 'Added to {holder} {objective}, now {score}',
  '已将 {holder} 的 {objective} 减至 {score}': 'Subtracted from {holder} {objective}, now {score}',
  '来源 {source} 没有匹配到任何对象': 'Source {source} matched nothing',
  '已将 {holder} 的 {objective} 设为 {score}（{op} {source} 的 {sourceObjective}）':
    'Set {holder} {objective} to {score} ({op} {source} {sourceObjective})',
  '{holder} 没有 {objective} 的分数': '{holder} has no score for {objective}',
  '{holder} 的 {objective} 是 {score}': '{holder} {objective} is {score}',
  '{holder} 还没有任何分数': '{holder} has no scores yet',
  '{holder} 本来就没有分数': '{holder} had no scores to begin with',
  '已清空 {holder} 的 {count} 个目标的分数': 'Cleared {count} objectives for {holder}',
  // ---- 选择器 ----
  '目标必须是单一实体（选择器 {selector}）': 'Target must be a single entity (selector {selector})',
};
