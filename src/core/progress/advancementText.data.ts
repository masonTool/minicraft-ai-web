/**
 * 成就的英文标题 / 说明（批次 620，补 Q15 留下的数据层）。
 *
 * ⚠️ **本文件不许 import 任何东西**。`I18n.ts` 与 `AdvancementScreen` 都会读它，
 * 一旦反向 import 就是循环依赖（批次 618 在 `commandMessages.data.ts` 上踩过：
 * 表现为对方拿到 `undefined`，`Object.keys(undefined)` 直接抛）。
 *
 * 为什么按 **id** 映射，而不是给 `AdvancementDef` 加 `titleEn`/`descEn` 字段：
 *   · `advancements.ts` 里 100 条是**一张大表**，加字段等于每条都要多写两行、
 *     且中英隔了 100 行，对不上时没人看得出来；
 *   · 离线断言（`test:advancement`）按**中文** title 匹配，它验的是"判定逻辑对不对"，
 *     不是"翻译对不对"。加英文到原对象上会让那批断言要跟着改，收益为零。
 * 所以英文单独一层，界面按 id 取；取不到就回落中文（英文界面上看得见，好定位）。
 *
 * id 用原版全名（`minicraft:story/root`），与 `advancements.ts` 一一对应。
 */

export interface AdvancementText {
  readonly title: string;
  readonly desc: string;
}

/** `id` → 英文标题与说明 */
export const ADVANCEMENT_TEXT_EN: Readonly<Record<string, AdvancementText>> = {
  // ---------------- story（我的世界）
  'minicraft:story/root': { title: 'Minicraft', desc: 'Open your inventory (E) and look at what you have' },
  'minicraft:story/mine_wood': { title: 'First Log', desc: 'Chop any kind of log (bare hands work, an axe is faster)' },
  'minicraft:story/mine_stone': { title: 'First Cobblestone', desc: 'Mine a piece of cobblestone with a pickaxe' },
  'minicraft:story/upgrade_tools': { title: 'Stone Pickaxe', desc: 'Craft a stone pickaxe' },
  'minicraft:story/smelt_iron': { title: 'First Smelt', desc: 'Smelt an iron ingot (put raw iron in a furnace)' },
  'minicraft:story/iron_tools': { title: "Iron Tools", desc: 'Craft an iron pickaxe' },
  'minicraft:story/obtain_armor': { title: 'Chestplate On', desc: 'Obtain any chestplate (leather / iron / gold / diamond)' },
  'minicraft:story/form_obsidian': { title: 'Water on Lava', desc: 'Mine a block of obsidian (needs a diamond pickaxe)' },
  'minicraft:story/mine_diamond': { title: 'First Diamond', desc: 'Mine your first diamond' },
  'minicraft:story/shiny_gear': { title: 'Diamond Armour', desc: 'Wear diamonds (any piece of diamond armour)' },
  'minicraft:story/enchant_item': { title: 'Enchanted Once', desc: 'Obtain an enchanted item (enchanting table or anvil)' },
  'minicraft:story/enter_the_nether': { title: 'Step Into the Nether', desc: 'Light a nether portal with flint and steel, then step in' },
  'minicraft:story/enter_the_end': { title: 'Step Into the End', desc: 'Step into the end portal' },
  'minicraft:story/mine_gold': { title: 'Gold in the Rock', desc: 'Mine raw gold (gold ore is densest below Y=32)' },
  'minicraft:story/obtain_prismarine_shard': { title: 'Prismarine', desc: 'Obtain a prismarine shard (dropped by guardians)' },
  'minicraft:story/obtain_ancient_debris': { title: 'Debris from the Deep', desc: 'Mine ancient debris below Y=15 in the nether' },
  'minicraft:story/obtain_netherite_ingot': { title: 'Netherite', desc: 'Craft a netherite ingot from 4 netherite scraps + 4 gold ingots' },
  'minicraft:story/obtain_ender_chest': { title: 'Ender Chest', desc: 'Craft an ender chest (8 obsidian + 1 eye of ender)' },
  'minicraft:story/obtain_iron_block': { title: 'Block of Iron', desc: 'Compress 9 iron ingots into an iron block' },
  'minicraft:story/obtain_gold_block': { title: 'Block of Gold', desc: 'Compress 9 gold ingots into a gold block' },
  'minicraft:story/obtain_diamond_block': { title: 'Block of Diamond', desc: 'Compress 9 diamonds into a diamond block' },
  'minicraft:story/obtain_emerald_block': { title: 'Block of Emerald', desc: 'Compress 9 emeralds into an emerald block' },
  'minicraft:story/obtain_anvil': { title: 'Blacksmith', desc: 'Craft an anvil (3 iron blocks + 4 iron ingots)' },
  'minicraft:story/obtain_enchanting_table': { title: 'Enchanting Table', desc: 'Craft an enchanting table (4 obsidian + 2 diamonds + 1 book)' },
  'minicraft:story/obtain_bookshelf': { title: 'Bookshelf', desc: 'Craft a bookshelf (6 planks + 3 books)' },
  'minicraft:story/obtain_golden_apple': { title: 'Golden Apple', desc: 'Surround an apple with 8 gold ingots' },
  'minicraft:story/obtain_ender_eye': { title: 'Eye of Ender', desc: 'Craft an eye of ender (ender pearl + blaze powder)' },
  'minicraft:story/obtain_iron_pickaxe': { title: 'Iron Pickaxe', desc: 'Craft an iron pickaxe from 3 iron ingots + 2 sticks' },
  'minicraft:story/obtain_diamond_sword': { title: 'Diamond Sword', desc: 'Craft a diamond sword from 2 diamonds + 1 stick' },

  // ---------------- nether（下界）
  'minicraft:nether/root': { title: 'Nether', desc: 'Set foot in the nether for the first time' },
  'minicraft:nether/obtain_ancient_debris': { title: 'Hidden in the Depths', desc: 'Mine ancient debris (most common between Y=8 and Y=22)' },
  'minicraft:nether/obtain_blaze_rod': { title: 'Blaze Rod in Hand', desc: 'Get a blaze rod from a blaze (only in nether fortresses)' },
  'minicraft:nether/find_fortress': { title: 'Found the Fortress', desc: 'Harvest nether wart from soul sand in a nether fortress' },
  'minicraft:nether/create_beacon': { title: 'Beacon Lit', desc: 'Craft a beacon (3 nether star shards + 5 glass + 1 nether star)' },

  // ---------------- end（末地）
  'minicraft:end/root': { title: 'The End', desc: 'Set foot in the end for the first time' },
  'minicraft:end/kill_dragon': { title: 'Dragon Defeated', desc: 'Knock out the end crystals on ten pillars first, then bring the dragon down' },
  'minicraft:end/dragon_egg': { title: 'The Egg Is Yours', desc: 'Pick up the dragon egg' },
  'minicraft:end/obtain_elytra': { title: 'Sky Above', desc: 'Take elytra from a chest in an end city' },
  'minicraft:end/kill_enderman': { title: 'Visitor from the End', desc: 'Kill an enderman (do not look it in the eye)' },

  // ---------------- adventure（冒险）
  'minicraft:adventure/root': { title: 'Setting Off', desc: 'Defeat a hostile mob' },
  'minicraft:adventure/kill_a_mob': { title: 'First Fight', desc: 'Defeat 3 different hostile mobs' },
  'minicraft:adventure/kill_all_mobs': { title: 'The Hunting List', desc: 'Defeat every one of the hostile mob types (no need to do it in one run)' },
  'minicraft:adventure/sleep_in_bed': { title: 'Get Some Sleep', desc: 'Sleep in a bed until morning (right-click the bed after dark)' },
  'minicraft:adventure/trade': { title: 'Closed a Trade', desc: 'Complete a trade with a villager (give it a workstation first so it picks a profession)' },
  'minicraft:adventure/breed_an_animal': { title: 'Bred a Pair', desc: 'Feed two of the same animal so they have a baby' },
  'minicraft:adventure/kill_a_creeper': { title: 'Sssssss…', desc: 'Kill a creeper (do not let it blow up first)' },
  'minicraft:adventure/kill_a_spider': { title: 'Spider Trail', desc: 'Kill a spider' },
  'minicraft:adventure/kill_a_skeleton': { title: 'Bone to Pick', desc: 'Kill a skeleton (watch out for its arrows)' },
  'minicraft:adventure/kill_a_zombie': { title: 'Walking Dead', desc: 'Kill a zombie' },
  'minicraft:adventure/place_sign': { title: 'Leave a Note', desc: 'Place a sign (6 planks + 1 stick)' },
  'minicraft:adventure/lightning_rod': { title: 'Lightning Rod', desc: 'Obtain a lightning rod (3 copper ingots)' },
  'minicraft:adventure/obtain_map': { title: 'Cartographer', desc: 'Craft an empty map (8 paper + 1 compass)' },
  'minicraft:adventure/obtain_compass': { title: 'Find North', desc: 'Craft a compass (4 iron ingots + 1 redstone)' },
  'minicraft:adventure/obtain_clock': { title: 'Time Is Money', desc: 'Craft a clock (4 gold ingots + 1 redstone)' },
  'minicraft:adventure/obtain_saddle': { title: 'Saddled Up', desc: 'Obtain a saddle (desert temple chests have them)' },
  'minicraft:adventure/obtain_crossbow': { title: 'Crossbow Loaded', desc: 'Craft a crossbow (pillager outpost chests have them too)' },
  'minicraft:adventure/obtain_bone_block': { title: 'Treasure in Bone', desc: 'Obtain a bone block (compress 9 bone meal, or dig up a fossil)' },
  'minicraft:adventure/kill_a_blaze': { title: 'Blaze Terminator', desc: 'Kill a blaze (only in nether fortresses)' },
  'minicraft:adventure/kill_a_ghast': { title: 'Ghast Away', desc: 'Kill a ghast (you can hit its fireballs back)' },
  'minicraft:adventure/kill_a_piglin': { title: 'Piglin Unwelcome', desc: 'Kill a piglin (it is usually neutral, do not strike first)' },
  'minicraft:adventure/kill_a_hoglin': { title: 'Hoglin Hunter', desc: 'Kill a hoglin (the nether boar)' },
  'minicraft:adventure/kill_a_shulker': { title: 'Shell Breaker', desc: 'Kill a shulker (near end cities)' },
  'minicraft:adventure/kill_a_silverfish': { title: 'Pest Control', desc: 'Kill a silverfish (they crawl out of stronghold spawners)' },
  'minicraft:adventure/kill_a_drowned': { title: 'Deep Sea Hunter', desc: 'Kill a drowned (in the ocean, or on the shore at night)' },
  'minicraft:adventure/kill_a_husk': { title: 'Husk', desc: 'Kill a husk (the desert zombie variant)' },
  'minicraft:adventure/kill_a_stray': { title: 'Frost Arrows', desc: 'Kill a stray (the snowy skeleton variant)' },
  'minicraft:adventure/kill_a_phantom': { title: 'Stop Staying Up', desc: 'Kill a phantom (they come after a few nights without sleep)' },
  'minicraft:adventure/kill_a_slime': { title: 'Slime', desc: 'Kill a slime (big ones split when hit)' },
  'minicraft:adventure/kill_a_magma_cube': { title: 'Magma Cube', desc: 'Kill a magma cube (the nether slime)' },
  'minicraft:adventure/kill_a_cave_spider': { title: 'Cave Sweeper', desc: 'Kill a cave spider (abandoned mine spawners)' },
  'minicraft:adventure/kill_a_wither_skeleton': { title: 'Blackstone Guard', desc: 'Kill a wither skeleton (nether fortress)' },
  'minicraft:adventure/kill_a_pillager': { title: 'Arrow Back at You', desc: 'Kill a pillager (near an outpost)' },
  'minicraft:adventure/kill_iron_golem': { title: 'Ingratitude', desc: 'Kill an iron golem (it guards villages and will not attack first)' },
  'minicraft:adventure/kill_a_guardian': { title: 'Deep Sea Guard', desc: 'Kill a guardian (near an ocean monument)' },
  'minicraft:adventure/kill_an_elder_guardian': { title: 'The Old Gaze', desc: 'Defeat an elder guardian (80 HP, inflicts mining fatigue)' },
  'minicraft:adventure/kill_a_wither': { title: 'Wither Terminator', desc: 'Defeat the wither (summon with 4 soul sand + 3 wither skeleton skulls)' },
  'minicraft:adventure/defend_village': { title: 'Defend the Village', desc: 'Kill a pillager within 64 blocks of a village' },
  'minicraft:adventure/hero_of_the_village': { title: 'Village Savior', desc: 'Fend off a raid near a village (5 pillagers in total)' },
  'minicraft:adventure/explore_10_biomes': { title: 'Adventurer', desc: 'Walk through 10 different biomes (no need to do it in one run)' },
  'minicraft:adventure/obtain_ender_pearl': { title: 'Ender Pearl', desc: 'Get an ender pearl from an enderman' },
  'minicraft:adventure/obtain_blaze_powder': { title: 'Blaze Powder', desc: 'Grind a blaze rod into blaze powder (a brewing ingredient)' },
  'minicraft:adventure/obtain_slime_ball': { title: 'Slimeball', desc: 'Get a slimeball from a slime' },
  'minicraft:adventure/obtain_bow': { title: 'Bow', desc: 'Craft a bow from 3 sticks + 3 string' },

  // ---------------- husbandry（农牧）
  'minicraft:husbandry/root': { title: 'Sowing and Raising', desc: 'Harvest your first crop (ripe wheat / beetroot / carrot / potato)' },
  'minicraft:husbandry/plant_seed': { title: 'Planting', desc: 'Plant seeds on farmland (hoe the dirt into farmland first)' },
  'minicraft:husbandry/fishy_business': { title: 'Reeled One In', desc: 'Catch a fish (right-click water with a rod, reel in when the bobber sinks)' },
  'minicraft:husbandry/balanced_diet': { title: 'A Bit of Everything', desc: 'Eat many different kinds of food (raw or cooked, grown or caught all count)' },
  'minicraft:husbandry/breed_all': { title: 'Rancher', desc: 'Breed cows, pigs, sheep and chickens once each' },
  'minicraft:husbandry/beelocation': { title: 'Moving the Hive', desc: 'Obtain a bee nest (craft from 3 honeycomb + 6 planks, or mine it with Silk Touch)' },
  'minicraft:husbandry/wax_on': { title: 'Wiped with Wax', desc: 'Wax a copper block with honeycomb (craft: copper block + honeycomb)' },
  'minicraft:husbandry/obtain_honeycomb': { title: 'Dance with Bees', desc: 'Get honeycomb from a bee nest (meadow nests drop some when broken)' },
  'minicraft:husbandry/obtain_honey_bottle': { title: 'Sweet Honey', desc: 'Craft a honey bottle from honeycomb + a glass bottle' },
  'minicraft:husbandry/obtain_cake': { title: 'The Cake Is a Lie', desc: 'Craft a cake (3 milk buckets + 2 sugar + 1 egg + 3 wheat)' },
  'minicraft:husbandry/obtain_bread': { title: 'Bread', desc: 'Craft bread from 3 wheat' },
  'minicraft:husbandry/obtain_cookie': { title: 'Cookie', desc: 'Bake a batch of cookies from wheat + cocoa beans' },
  'minicraft:husbandry/obtain_pumpkin_pie': { title: 'Pumpkin Pie', desc: 'Craft a pumpkin pie (pumpkin + sugar + egg)' },
  'minicraft:husbandry/obtain_mushroom_stew': { title: 'Mushroom Stew', desc: 'Cook mushroom stew from two kinds of mushroom + a bowl' },
  'minicraft:husbandry/obtain_cooked_beef': { title: 'Steak', desc: 'Cook raw beef in a furnace' },
  'minicraft:husbandry/obtain_cooked_porkchop': { title: 'Cooked Porkchop', desc: 'Cook raw porkchop in a furnace' },
  'minicraft:husbandry/obtain_fishing_rod': { title: 'Fishing Rod', desc: 'Craft a fishing rod from 3 sticks + 2 string' },
};

/** 五个标签页名（`ADVANCEMENT_TABS[].title`） */
export const ADVANCEMENT_TAB_EN: Readonly<Record<string, string>> = {
  world: 'Block World',
  nether: 'Nether',
  end: 'The End',
  adventure: 'Adventure',
  husbandry: 'Husbandry',
};
