/**
 * 英文文案·命令元数据（`cmd.*`，与 `locales/zh/cmd.ts` 键集必须相同）
 *
 * ⚠️ 多语言 P1：值由旧 `commandHelp.data.ts` 逐字搬来，措辞一个字都没动。
 */

import type { Messages } from '../zh/index.ts';
import type { cmd as zhcmd } from '../zh/cmd.ts';

export const cmd = {
  // ---- /help
  'cmd.help.usage': "/help [command]",
  'cmd.help.desc': "List every command, or show the usage of one",
  // ---- /tp
  'cmd.tp.usage': "/tp <x> <y> <z> [dimension]",
  'cmd.tp.desc': "Teleport to coordinates (supports ~ relative values)",
  // ---- /give
  'cmd.give.usage': "/give <item> [count]",
  'cmd.give.desc': "Give yourself items (names accept English, Chinese or numeric ids)",
  // ---- /clear
  'cmd.clear.usage': "/clear",
  'cmd.clear.desc': "Empty your inventory",
  // ---- /time
  'cmd.time.usage': "/time set <day|noon|night|midnight|ticks>",
  'cmd.time.desc': "Set the time of day",
  // ---- /weather
  'cmd.weather.usage': "/weather <clear|rain|thunder>",
  'cmd.weather.desc': "Change the weather",
  // ---- /difficulty
  'cmd.difficulty.usage': "/difficulty <peaceful|easy|normal|hard>",
  'cmd.difficulty.desc': "Set the difficulty (hostile mobs do not spawn on Peaceful)",
  // ---- /gamerule
  'cmd.gamerule.usage': "/gamerule <rule> [value]",
  'cmd.gamerule.desc': "Read or change game rules — keep inventory on death / mob spawning / mob griefing / daylight cycle / natural regeneration / random tick speed / mob drops / weather cycle. The help picker shows Chinese names; the command itself still takes the English rule names.",
  // ---- /effect
  'cmd.effect.usage': "/effect <give|clear> <effect> [seconds] [level]",
  'cmd.effect.desc': "Apply or clear status effects (e.g. /effect give speed 10 2)",
  // ---- /summon
  'cmd.summon.usage': "/summon <entity> [x] [y] [z]",
  'cmd.summon.desc': "Summon an entity at a position (defaults to in front of you)",
  // ---- /kill
  'cmd.kill.usage': "/kill [@s|radius]",
  'cmd.kill.desc': "Kill yourself, or clear hostile mobs within a radius",
  // ---- /setblock
  'cmd.setblock.usage': "/setblock <x> <y> <z> <block>",
  'cmd.setblock.desc': "Place a single block",
  // ---- /spawnpoint
  'cmd.spawnpoint.usage': "/spawnpoint [x y z]",
  'cmd.spawnpoint.desc': "Set your personal spawn point (no coordinates = where you stand)",
  // ---- /setworldspawn
  'cmd.setworldspawn.usage': "/setworldspawn [x y z]",
  'cmd.setworldspawn.desc': "Set the world spawn point (no coordinates = where you stand)",
  // ---- /particle
  'cmd.particle.usage': "/particle <type> [count]",
  'cmd.particle.desc': "Spawn particles at your position (heart / crit / flame / portal / explosion)",
  // ---- /tell
  'cmd.tell.usage': "/tell <message>",
  'cmd.tell.desc': "Send yourself a private message (same as /say in single player)",
  // ---- /msg
  'cmd.msg.usage': "/msg <message>",
  'cmd.msg.desc': "Same as /tell",
  // ---- /playsound
  'cmd.playsound.usage': "/playsound <sound>",
  'cmd.playsound.desc': "Play a sound at your position (names match the groups in audio settings)",
  // ---- /me
  'cmd.me.usage': "/me <action>",
  'cmd.me.desc': "Post an action message (\"* Steve waved\")",
  // ---- /say
  'cmd.say.usage': "/say <message>",
  'cmd.say.desc': "Post a message to chat",
  // ---- /enchant
  'cmd.enchant.usage': "/enchant <enchantment> [level]",
  'cmd.enchant.desc': "Enchant the held item (level defaults to 1, capped at the maximum)",
  // ---- /clone
  'cmd.clone.usage': "/clone <x1> <y1> <z1> <x2> <y2> <z2> <dx> <dy> <dz> [masked|replace]",
  'cmd.clone.desc': "Copy a region elsewhere (32,768 block limit; masked only overwrites air)",
  // ---- /fill
  'cmd.fill.usage': "/fill <x1> <y1> <z1> <x2> <y2> <z2> <block>",
  'cmd.fill.desc': "Fill a cuboid region with a block (32,768 block limit)",
  // ---- /gamemode
  'cmd.gamemode.usage': "/gamemode <survival|creative|adventure|spectator>",
  'cmd.gamemode.desc': "Switch game mode (creative = fly + invulnerable + instant break; adventure = no breaking or placing; spectator = fly through blocks, no interaction)",
  // ---- /seed
  'cmd.seed.usage': "/seed",
  'cmd.seed.desc': "Show the world seed",
  // ---- /list
  'cmd.list.usage': "/list",
  'cmd.list.desc': "List online players",
  // ---- /xp
  'cmd.xp.usage': "/xp add <points> | /xp set <level> | /xp query",
  'cmd.xp.desc': "Read or change experience and level",
  // ---- /worldborder
  'cmd.worldborder.usage': "/worldborder get | /worldborder set <size> | /worldborder center <x> <z>",
  'cmd.worldborder.desc': "Read or change the world border (crossing it hurts; leaving the soft zone pushes you back)",
  // ---- /execute
  'cmd.execute.usage': "/execute <as|at|positioned|if|unless> … run <command>",
  'cmd.execute.desc': "Run a command as another target or from another position (chainable)",
  // ---- /locate
  'cmd.locate.usage': "/locate biome <biome> | /locate structure <structure>",
  'cmd.locate.desc': "Find the nearest matching biome (ring search over chunks, radius 640) or structure",
  // ---- /damage
  'cmd.damage.usage': "/damage <targets> <damage>",
  'cmd.damage.desc': "Deal damage to target entities (damage is in points, 2 points = 1 heart)",
  // ---- /loot
  'cmd.loot.usage': "/loot give <loot table> [count]",
  'cmd.loot.desc': "Roll a loot table and put the result in your inventory",
  // ---- /data
  'cmd.data.usage': "/data get block <x> <y> <z> [path] | /data get entity <targets> [path] | /data merge block <x> <y> <z> <slot> <item> [count] | /data merge entity <targets> Health <value> | /data merge entity <targets> CustomName <name>",
  'cmd.data.desc': "Read or write a subset of block-entity and entity fields (no generic NBT path — see TASKS)",
  // ---- /team
  'cmd.team.usage': "/team add|remove|list|join|leave|modify (friendlyFire|color|prefix|suffix) …",
  'cmd.team.desc': "Teams: create, join, recolor, set prefix/suffix and friendly fire (friendly damage and collision are not wired yet — see TASKS M23)",
  // ---- /advancement
  'cmd.advancement.usage': "/advancement grant|revoke <advancement id | *>",
  'cmd.advancement.desc': "Grant or revoke advancements (`*` = all)",
  // ---- /scoreboard
  'cmd.scoreboard.usage': "/scoreboard objectives add|remove|list|setdisplay … / players set|add|remove|operation|get|list|reset …",
  'cmd.scoreboard.desc': "Scoreboard: objectives, scores and display slots",
} satisfies Pick<Messages, keyof typeof zhcmd>;
