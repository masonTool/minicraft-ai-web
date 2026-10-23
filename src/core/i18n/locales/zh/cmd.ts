/**
 * 中文文案·命令元数据（`cmd.*`：`/help` 列表里的用法与说明）
 *
 * ⚠️ 多语言 P1：这两组原来分居两处 —— 中文写死在 `Commands.ts` 的 spec 里、
 * 英文在 `commandHelp.data.ts`（键=命令名）。现在统一成 `cmd.<name>.usage` / `.desc`，
 * 与界面文案同一套键空间、同一套回落链，6 种语言不用再各开一张平行表。
 *
 * 值的来源：由 `.tmp/gen-cmd-locale.ts` 从 `COMMANDS` 与旧英文表**逐字照搬**，
 * 不是手抄；`test:i18n` 另有一条"表里 72 条与 spec 逐条一致"的护栏，防以后改文案只改一处。
 */

export const cmd = {
  // ---- /help
  'cmd.help.usage': "/help [命令]",
  'cmd.help.desc': "列出所有命令，或查看某条命令的用法",
  // ---- /tp
  'cmd.tp.usage': "/tp <x> <y> <z> [维度]",
  'cmd.tp.desc': "传送到坐标（支持 ~ 相对写法）",
  // ---- /give
  'cmd.give.usage': "/give <物品> [数量]",
  'cmd.give.desc': "给自己物品（物品名支持中文/英文/数字 id）",
  // ---- /clear
  'cmd.clear.usage': "/clear",
  'cmd.clear.desc': "清空自己的背包",
  // ---- /time
  'cmd.time.usage': "/time set <day|noon|night|midnight|数字>",
  'cmd.time.desc': "设置时间",
  // ---- /weather
  'cmd.weather.usage': "/weather <clear|rain|thunder>",
  'cmd.weather.desc': "切换天气",
  // ---- /difficulty
  'cmd.difficulty.usage': "/difficulty <peaceful|easy|normal|hard>",
  'cmd.difficulty.desc': "设置难度（和平难度下敌对生物不会生成）",
  // ---- /gamerule
  'cmd.gamerule.usage': "/gamerule <规则> [值]",
  'cmd.gamerule.desc': "查看或修改游戏规则，例如“死亡后保留物品 / 生物自然生成 / 生物破坏方块 / 昼夜循环 / 自然回血 / 随机刻速度 / 生物掉落物 / 天气循环”。帮助弹窗的下拉里有中文名，命令里仍使用对应的英文规则名。",
  // ---- /effect
  'cmd.effect.usage': "/effect <give|clear> <效果> [秒数] [等级]",
  'cmd.effect.desc': "给予或清除状态效果（如 /effect give speed 10 2）",
  // ---- /summon
  'cmd.summon.usage': "/summon <生物> [x] [y] [z]",
  'cmd.summon.desc': "在指定位置召唤生物（默认在自己面前）",
  // ---- /kill
  'cmd.kill.usage': "/kill [@s|半径]",
  'cmd.kill.desc': "杀死自己，或清除附近半径内的生物",
  // ---- /setblock
  'cmd.setblock.usage': "/setblock <x> <y> <z> <方块>",
  'cmd.setblock.desc': "放置一个方块",
  // ---- /spawnpoint
  'cmd.spawnpoint.usage': "/spawnpoint [x y z]",
  'cmd.spawnpoint.desc': "设置个人重生点（不带坐标 = 当前位置）",
  // ---- /setworldspawn
  'cmd.setworldspawn.usage': "/setworldspawn [x y z]",
  'cmd.setworldspawn.desc': "设置世界出生点（不带坐标 = 当前位置）",
  // ---- /particle
  'cmd.particle.usage': "/particle <类型> [数量]",
  'cmd.particle.desc': "在玩家位置生成粒子（爱心 / 暴击 / 火焰 / 传送门 / 爆炸）",
  // ---- /tell
  'cmd.tell.usage': "/tell <内容>",
  'cmd.tell.desc': "给自己发一条私聊（单人下等同 /say）",
  // ---- /msg
  'cmd.msg.usage': "/msg <内容>",
  'cmd.msg.desc': "同 /tell",
  // ---- /playsound
  'cmd.playsound.usage': "/playsound <音效>",
  'cmd.playsound.desc': "在玩家所在位置播一个音效（名字见音效设置里的分组）",
  // ---- /me
  'cmd.me.usage': "/me <动作>",
  'cmd.me.desc': "发一条动作消息（“* 玩家 挥了挥手”）",
  // ---- /say
  'cmd.say.usage': "/say <内容>",
  'cmd.say.desc': "向聊天栏发一条消息",
  // ---- /enchant
  'cmd.enchant.usage': "/enchant <附魔> [等级]",
  'cmd.enchant.desc': "给手持物品附魔（等级默认 1，超过上限按上限算）",
  // ---- /clone
  'cmd.clone.usage': "/clone <x1> <y1> <z1> <x2> <y2> <z2> <dx> <dy> <dz> [masked|replace]",
  'cmd.clone.desc': "把一块区域复制到别处（单次上限 32768 格；“遮罩”模式只覆盖空气）",
  // ---- /fill
  'cmd.fill.usage': "/fill <x1> <y1> <z1> <x2> <y2> <z2> <方块>",
  'cmd.fill.desc': "用方块填充一个长方体区域（单次上限 32768 格）",
  // ---- /gamemode
  'cmd.gamemode.usage': "/gamemode <survival|creative|adventure|spectator>",
  'cmd.gamemode.desc': "切换游戏模式（创造 = 飞行 + 不受伤 + 秒破；冒险 = 不能破坏/放方块；旁观 = 穿墙飞行 + 不能交互）",
  // ---- /seed
  'cmd.seed.usage': "/seed",
  'cmd.seed.desc': "显示世界种子",
  // ---- /list
  'cmd.list.usage': "/list",
  'cmd.list.desc': "列出在线玩家",
  // ---- /xp
  'cmd.xp.usage': "/xp add <点数> | /xp set <等级> | /xp query",
  'cmd.xp.desc': "查看或修改经验值与等级",
  // ---- /worldborder
  'cmd.worldborder.usage': "/worldborder get | /worldborder set <边长> | /worldborder center <x> <z>",
  'cmd.worldborder.desc': "查看或修改世界边界（越界掉血、超出软区会被推回）",
  // ---- /execute
  'cmd.execute.usage': "/execute <as|at|positioned|if|unless> … run <命令>",
  'cmd.execute.desc': "以指定目标与位置执行一条命令（可链式叠加）",
  // ---- /locate
  'cmd.locate.usage': "/locate biome <群系名> | /locate structure <结构名>",
  'cmd.locate.desc': "找最近的指定群系或结构（群系按区块环搜 640 格，结构按单元重算）",
  // ---- /damage
  'cmd.damage.usage': "/damage <目标> <伤害>",
  'cmd.damage.desc': "对目标实体造成伤害（伤害是点数，2 点 = 1 颗心）",
  // ---- /loot
  'cmd.loot.usage': "/loot give <战利品表> [数量]",
  'cmd.loot.desc': "把一张战利品表掷点后塞进自己的背包",
  // ---- /data
  'cmd.data.usage': "/data get block <x> <y> <z> [路径] | /data get entity <选择器> [路径] | /data merge block <x> <y> <z> <格号> <物品> [数量] | /data merge entity <选择器> Health <数值> | /data merge entity <选择器> CustomName <名称>",
  'cmd.data.desc': "读/写方块实体与实体的一个字段子集（没有通用 NBT 路径，见 TASKS）",
  // ---- /team
  'cmd.team.usage': "/team add|remove|list|join|leave|modify …",
  'cmd.team.desc': "队伍：建队、拉人、改颜色、前后缀与友好伤害（免伤/碰撞还没接，见 TASKS M23）",
  // ---- /advancement
  'cmd.advancement.usage': "/advancement grant|revoke <进度 id | *>",
  'cmd.advancement.desc': "授予或收回进度（`*` = 全部）",
  // ---- /scoreboard
  'cmd.scoreboard.usage': "/scoreboard objectives add|remove|list|setdisplay … / players set|add|remove|operation|get|list|reset …",
  'cmd.scoreboard.desc': "记分板：目标、分数与显示槽位",
} as const;
