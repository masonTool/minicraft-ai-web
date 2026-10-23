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
  'cmd.data.usage': "/data get block <x> <y> <z> [path] | /data get entity <selector> [path] | /data merge block <x> <y> <z> <slot> <item> [count] | /data merge entity <selector> Health <number> | /data merge entity <selector> CustomName <name>",
  'cmd.data.desc': "Read or write a subset of block-entity and entity fields (no generic NBT path — see TASKS)",
  // ---- /team
  'cmd.team.usage': '/team add|remove|list|join|leave|modify …',
  'cmd.team.desc': "Teams: create, join, recolor, set prefix/suffix and friendly fire (friendly damage and collision are not wired yet — see TASKS M23)",
  // ---- /advancement
  'cmd.advancement.usage': "/advancement grant|revoke <advancement id | *>",
  'cmd.advancement.desc': "Grant or revoke advancements (`*` = all)",
  // ---- /scoreboard
  'cmd.scoreboard.usage': "/scoreboard objectives add|remove|list|setdisplay … / players set|add|remove|operation|get|list|reset …",
  'cmd.scoreboard.desc': "Scoreboard: objectives, scores and display slots",

  // ---- 命令帮助面板（多语言 P1-3b）：值标签 / 字段短标签 / 面板短语。
  // 这里只放**显示文案**；"哪种字段做成数字框/下拉"的身份判断在 commandFields.data.ts
  "cmd.help.value.peaceful": "Peaceful",
  "cmd.help.value.easy": "Easy",
  "cmd.help.value.normal": "Normal",
  "cmd.help.value.hard": "Hard",
  "cmd.help.value.clear": "Clear",
  "cmd.help.value.rain": "Rain",
  "cmd.help.value.thunder": "Thunder",
  "cmd.help.value.survival": "Survival",
  "cmd.help.value.creative": "Creative",
  "cmd.help.value.spectator": "Spectator",
  "cmd.help.value.day": "Day",
  "cmd.help.value.noon": "Noon",
  "cmd.help.value.night": "Night",
  "cmd.help.value.midnight": "Midnight",
  "cmd.help.value.masked": "Masked",
  "cmd.help.value.replace": "Replace",
  "cmd.help.value.give": "Give",
  "cmd.help.value.set": "Set",
  "cmd.help.value.add": "Add",
  "cmd.help.value.remove": "Remove",
  "cmd.help.value.list": "List",
  "cmd.help.value.join": "Join",
  "cmd.help.value.leave": "Leave",
  "cmd.help.value.modify": "Modify",
  "cmd.help.value.merge": "Merge",
  "cmd.help.value.get": "Get",
  "cmd.help.value.query": "Query",
  "cmd.help.value.center": "Center",
  "cmd.help.value.grant": "Grant",
  "cmd.help.value.revoke": "Revoke",
  "cmd.help.value.entity": "Entity",
  "cmd.help.value.block": "Block",
  "cmd.help.value.objectives": "Objectives",
  "cmd.help.value.players": "Players",
  "cmd.help.value.as": "As",
  "cmd.help.value.at": "At",
  "cmd.help.value.positioned": "Positioned",
  "cmd.help.value.if": "If",
  "cmd.help.value.unless": "Unless",
  "cmd.help.value.run": "Run",
  "cmd.help.value.overworld": "Overworld",
  "cmd.help.value.nether": "Nether",
  "cmd.help.value.end": "The End",
  "cmd.help.value.biome": "Biome",
  "cmd.help.value.all": "All (*)",
  "cmd.help.arg.item": "Item",
  "cmd.help.arg.count": "Count",
  "cmd.help.arg.dimension": "Dimension",
  "cmd.help.arg.rule": "Rule",
  "cmd.help.arg.value": "Value",
  "cmd.help.arg.effect": "Effect",
  "cmd.help.arg.seconds": "Seconds",
  "cmd.help.arg.level": "Level",
  "cmd.help.arg.entity": "Entity",
  "cmd.help.arg.radius": "Radius",
  "cmd.help.arg.block": "Block",
  "cmd.help.arg.type": "Type",
  "cmd.help.arg.message": "Message",
  "cmd.help.arg.sound": "Sound",
  "cmd.help.arg.enchantment": "Enchantment",
  "cmd.help.arg.action": "Action",
  "cmd.help.arg.biome": "Biome",
  "cmd.help.arg.structure": "Structure",
  "cmd.help.arg.targets": "Targets",
  "cmd.help.arg.damage": "Damage",
  "cmd.help.arg.loot": "Loot table",
  "cmd.help.arg.selector": "Selector",
  "cmd.help.arg.size": "Size",
  "cmd.help.arg.points": "Points",
  "cmd.help.arg.slot": "Slot",
  "cmd.help.arg.path": "Path",
  "cmd.help.arg.number": "Number",
  "cmd.help.arg.name": "Name",
  "cmd.help.ui.default": "Default",
  "cmd.help.ui.action": "Action",
  "cmd.help.ui.rest": "Remaining arguments",
  "cmd.help.ui.fillAsUsed": "Fill as shown",
  "cmd.help.ui.coords": "Coordinates",
  "cmd.help.ui.commandExample": "e.g. say hi / give @s stone",
  "cmd.help.ui.overworld": "Overworld",
  "cmd.help.ui.nether": "Nether",
  "cmd.help.ui.end": "The End",
  "cmd.help.ui.heart": "Heart (heart)",
  "cmd.help.ui.crit": "Crit (crit)",
  "cmd.help.ui.flame": "Flame (flame)",
  "cmd.help.ui.portal": "Portal (portal)",
  "cmd.help.ui.explosion": "Explosion (explosion)",
  "cmd.help.ui.value": "Value",
  "cmd.help.ui.on": "On (true)",
  "cmd.help.ui.off": "Off (false)",
  "cmd.help.ui.numberExample": "Number (e.g. 3)",
  "cmd.help.ui.clearSky": "Clear",
  "cmd.help.ui.labelTime": "Time",
  "cmd.help.ui.labelDifficulty": "Difficulty",
  "cmd.help.ui.labelWeather": "Weather",
  "cmd.help.ui.labelMode": "Mode",
  "cmd.help.ui.labelCondition": "Condition",
  "cmd.help.ui.labelTargetRadius": "Target / radius",
  "cmd.help.ui.suggestItem": "Chinese or English id, e.g. stone",
  "cmd.help.ui.suggestTarget": "@s (you) / @p (nearest player) / player name",
  "cmd.help.ui.messageHint": "The text to send",
  "cmd.help.ui.actionExample": "e.g. jumped once",
  "cmd.help.ui.soundId": "Sound id, e.g. block.note_block.harp (note block)",
  "cmd.help.ui.biomeId": "Biome id, e.g. plains / desert",
  "cmd.help.ui.structureId": "Structure name, e.g. village / bastion_remnant",
  "cmd.help.ui.pathHint": "Optional (lists all); entity Health / CustomName, block Slots[i]",
  "cmd.help.ui.writeName": "The name to write",
  "cmd.help.ui.ruleName": "Rule name",
  "cmd.help.ui.labelWithValue": "{label} ({value})",
  "cmd.help.ui.titleWithId": "{title} ({id})",
  "cmd.help.ui.actionN": "Action {n}",
  "cmd.help.ui.command": "Command",
  "cmd.help.ui.cannotLocate": "{label} ({key}, cannot locate)",
  "cmd.help.ui.advancement": "Advancement",
  "cmd.help.ui.allAdvancements": "All advancements (*)",
  "cmd.help.ui.enterNumber": "Enter a number",
  "cmd.help.ui.near": "~ or a number",

  // ---- command help panel (screen chrome, P1-4)
  "cmd.help.screen.title": "Command Help",
  "cmd.help.screen.search": "Search commands…",
  "cmd.help.screen.close": "Close",
  "cmd.help.screen.empty": "No matching commands",
  "cmd.help.screen.creativeOnly": "Requires Creative Mode",
  "cmd.help.screen.note": "Dropdowns show localized names; the command uses the English id. Text fields for items and blocks also accept localized names.",
  "cmd.help.screen.action": "Action",
  "cmd.help.screen.fill": "Insert into chat",
  "cmd.help.screen.optional": "{label} (optional)",
  "cmd.help.screen.none": "Leave empty",
  "cmd.help.screen.customEllipsis": "Custom…",
  "cmd.help.screen.custom": "Custom",
  "cmd.help.screen.needRequired": "Fill in the required fields first",
  "cmd.help.screen.stillRequired": "Some required fields are still empty",
} satisfies Pick<Messages, keyof typeof zhcmd>;
