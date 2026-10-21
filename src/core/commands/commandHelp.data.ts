/**
 * 命令自身的 `usage` / `description`（`/help` 列表里显示的那两句）。
 *
 * 与 `commandMessages.data.ts` 分开放：那份是**执行之后的回执**，
 * 这份是**命令清单的元数据**。两者生命周期不同——这张表在 `/help` 里被读，
 * 那份在命令跑完之后被读——混在一起以后改一处容易看错。
 *
 * 键是 command 的 `name`（`give` / `tp` …），不是中文原文：
 * 这里一条命令对应一对（usage + description），用名字做键天然唯一，
 * 也不会因为改了一句中文描述就整条失联。
 *
 * ⚠️ 本文件不 import 任何东西（同 `commandMessages.data.ts`）：`I18n.ts` 要读它，
 * 它若反向 import `I18n.ts` 就是循环依赖。
 */

/** `usage`（命令语法，含中文参数名）→ 英文 */
export const COMMAND_USAGE_EN: Readonly<Record<string, string>> = {
  help: '/help [command]',
  tp: '/tp <x> <y> <z> [dimension]',
  give: '/give <item> [count]',
  clear: '/clear',
  time: '/time set <day|noon|night|midnight|ticks>',
  weather: '/weather <clear|rain|thunder>',
  difficulty: '/difficulty <peaceful|easy|normal|hard>',
  gamerule: '/gamerule <rule> [value]',
  effect: '/effect <give|clear> <effect> [seconds] [level]',
  summon: '/summon <entity> [x] [y] [z]',
  kill: '/kill [@s|radius]',
  setblock: '/setblock <x> <y> <z> <block>',
  spawnpoint: '/spawnpoint [x y z]',
  setworldspawn: '/setworldspawn [x y z]',
  particle: '/particle <type> [count]',
  tell: '/tell <message>',
  msg: '/msg <message>',
  playsound: '/playsound <sound>',
  me: '/me <action>',
  say: '/say <message>',
  enchant: '/enchant <enchantment> [level]',
  clone: '/clone <x1> <y1> <z1> <x2> <y2> <z2> <dx> <dy> <dz> [masked|replace]',
  fill: '/fill <x1> <y1> <z1> <x2> <y2> <z2> <block>',
  gamemode: '/gamemode <survival|creative|adventure|spectator>',
  seed: '/seed',
  list: '/list',
  xp: '/xp add <points> | /xp set <level> | /xp query',
  worldborder: '/worldborder get | /worldborder set <size> | /worldborder center <x> <z>',
  execute: '/execute <as|at|positioned|if|unless> … run <command>',
  locate: '/locate biome <biome> | /locate structure <structure>',
  damage: '/damage <targets> <damage>',
  loot: '/loot give <loot table> [count]',
  data: '/data get block <x> <y> <z> [path] | /data get entity <targets> [path] | /data merge block <x> <y> <z> <slot> <item> [count] | /data merge entity <targets> Health <value> | /data merge entity <targets> CustomName <name>',
  team: '/team add|remove|list|join|leave|modify (friendlyFire|color|prefix|suffix) …',
  advancement: '/advancement grant|revoke <advancement id | *>',
  scoreboard:
    '/scoreboard objectives add|remove|list|setdisplay … / players set|add|remove|operation|get|list|reset …',
};

/** `description`（一句话说明）→ 英文。键是命令名。 */
export const COMMAND_DESCRIPTION_EN: Readonly<Record<string, string>> = {
  help: 'List every command, or show the usage of one',
  tp: 'Teleport to coordinates (supports ~ relative values)',
  give: 'Give yourself items (names accept English, Chinese or numeric ids)',
  clear: 'Empty your inventory',
  time: 'Set the time of day',
  weather: 'Change the weather',
  difficulty: 'Set the difficulty (hostile mobs do not spawn on Peaceful)',
  gamerule:
    'Read or change game rules — keep inventory on death / mob spawning / mob griefing / daylight cycle / natural regeneration / random tick speed / mob drops / weather cycle. The help picker shows Chinese names; the command itself still takes the English rule names.',
  effect: 'Apply or clear status effects (e.g. /effect give speed 10 2)',
  summon: 'Summon an entity at a position (defaults to in front of you)',
  kill: 'Kill yourself, or clear hostile mobs within a radius',
  setblock: 'Place a single block',
  spawnpoint: 'Set your personal spawn point (no coordinates = where you stand)',
  setworldspawn: 'Set the world spawn point (no coordinates = where you stand)',
  particle: 'Spawn particles at your position (heart / crit / flame / portal / explosion)',
  tell: 'Send yourself a private message (same as /say in single player)',
  msg: 'Same as /tell',
  playsound: 'Play a sound at your position (names match the groups in audio settings)',
  me: 'Post an action message ("* Steve waved")',
  say: 'Post a message to chat',
  enchant: 'Enchant the held item (level defaults to 1, capped at the maximum)',
  clone: 'Copy a region elsewhere (32,768 block limit; masked only overwrites air)',
  fill: 'Fill a cuboid region with a block (32,768 block limit)',
  gamemode:
    'Switch game mode (creative = fly + invulnerable + instant break; adventure = no breaking or placing; spectator = fly through blocks, no interaction)',
  seed: 'Show the world seed',
  list: 'List online players',
  xp: 'Read or change experience and level',
  worldborder:
    'Read or change the world border (crossing it hurts; leaving the soft zone pushes you back)',
  execute: 'Run a command as another target or from another position (chainable)',
  locate: 'Find the nearest matching biome (ring search over chunks, radius 640) or structure',
  damage: 'Deal damage to target entities (damage is in points, 2 points = 1 heart)',
  loot: 'Roll a loot table and put the result in your inventory',
  data: 'Read or write a subset of block-entity and entity fields (no generic NBT path — see TASKS)',
  team: 'Teams: create, join, recolor, set prefix/suffix and friendly fire (friendly damage and collision are not wired yet — see TASKS M23)',
  advancement: 'Grant or revoke advancements (`*` = all)',
  scoreboard: 'Scoreboard: objectives, scores and display slots',
};
