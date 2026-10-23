# 完成档案 · DONE

> 本文件是**已完成工作的唯一档案**，只回答"这批做了什么、怎么验的"——时间线，最近的在最上面。
> 按模块看现状与坑 → `OVERVIEW.md`；下次怎么避开 → `TIPS.md`；机制与格式 → `README.md`。
> **一条内容只写一个地方**，别在三份文档里各抄一遍。
>
> 收尾时**整份队列原样搬进来**（含每条任务下方的完成说明与 `[阻塞]`），标题格式
> `## 批次 <号> · 日期 · 会话 <前 8 位>`。

---

## 批次 20261024-0223 · 2026-10-24 · 会话 4024a9d4

- [x] [C1] 品牌收尾：六语言 `advancement.story_root.title`（现在是「Minecraft」，zh 是「我的世界」）→ `Minicraft`；`package.json` 的 `name`（`bedrock-118-web`）→ `minicraft`；注释里残留的 `MINECRAFT` / `Bedrock 1.18 Web` 一并改；**副标题 `1.18 · WEB EDITION` 删掉**（`BRAND_EDITION` 连同首页 `edition` 元素）
  - 做了什么：① 六语言 `advancement.story_root.title` —— en/de/ru/fr/pt 原来是 `Minecraft`、zh 是「我的世界」，全部改成 **`Minicraft`**；② `package.json` 的 `name`：`bedrock-118-web` → **`minicraft`**；③ 注释里残留的 `MINECRAFT`（`WorldScreen` 与 `index.html` 的布局说明）改成"品牌名的字母"，`index.html` 那条历史注释里的 `Bedrock 1.18 Web` 改成 `Minicraft`；④ **副标题删除**：`WorldScreen` 不再创建 `world-edition` 元素，`BRAND_EDITION` 置空并写明原因
  - 实测（浏览器，起 vite 5207 + 本机 Chrome）：`document.title = Minicraft`、`.world-logo = Minicraft`、`.world-edition` **已删除**，首页正文变成 `Minicraft WebGL2! 原生生存、创造与多世界存档 …` —— 只剩品牌名一行
  - ⚠️ 改了 4 条既有断言的判据（都是"用户要求变了"的直接后果）：① `i18n`「中文模式下标题与说明原样不动」→ 排除 `minecraft:story/root`（它现在**故意**等于品牌名）；② 「首页品牌块从 BRAND / BRAND_EDITION 取值」→ 改成「首页只显示品牌名（副标题已删）」；③ 「副标题是版本身份」→ 改成「副标题已删除（`BRAND_EDITION === ''`）」；④ 「中文成就标题与原文逐条一致」→ 排除 story_root；⑤ `ui`「首页品牌块取唯一真值」→ 改成验 `logo.textContent = BRAND` 且**不含** `world-edition`
  - 验证：`test:i18n` **523 / 0**；`ui` **926 / 0**；`test:offline` **172 / 172 套全绿**；`grep` 旧品牌名在 `src` / `public` / `index.html` / `docs` / `README.md` / `package.json` 里**只剩 `brand.ts` 的注释**（说明为什么删副标，属历史陈述）
  - 批次：20261024-0223
- [x] [C2] 全局语言遗漏复查：数据层面（2701 键 × 4 语言）已确认 0 缺键 / 0 含中文 / 0 空值；**源码层面 906 处硬编码中文**需要分类甄别（命令错误信息 28 处是玩家可见的、成就与物品说明 297 处是**回退原文**设计如此、diagPerf 32 处开发者面板）——调研结论写进说明，是否继续做由用户拍板
  - 做了什么：两条口径各扫一遍 —— ① **数据层**：2701 个键 × de/ru/fr/pt，查缺键 / 含中文 / 空值 / 占位符 / 与英文同形；② **源码层**：扫 `src` 下所有 `.ts` 的非注释字符串字面量里的中文，按文件计数并抽样看上下文
  - ✅ 数据层结论：**缺键 0 · 含中文 0 · 空值 0**（四语言全绿）；占位符不一致只有 5 处且全是**少用**（俄/法/葡的 `woodLog`/`woodPlanks`/`stemStage` 不提第二个 `{wood}`/`{crop}`、`armor` 不提 `{material}`），语义无损；与英文同形 de 78 / ru 9 / fr 102 / pt 55，**无整组可疑**（最大的 `label` 也只有 4/226）
  - ⚠️ 源码层结论：**906 处**硬编码中文，但绝大多数**不是遗漏** —— `advancements.ts`（205 条）与 `itemNames.ts`（92 条）是**中文原文回退值**（`advancementTitle()` / `itemDescription()` 先查表、缺键才回落，设计如此）；`diagPerf.ts`（32 条）是 `?debug=1` 的开发者面板
  - 🔴 **真遗漏（玩家可见，已立条目）**：① `Rules.ts` 的 `GAME_RULE_LABELS`（35 条规则描述，注释写明"**命令帮助的下拉用**"—— 与 P6-1 修的难度/模式同一类毛病）；② `Commands.ts` 里仍写死的中文回执（`/clone` 的「已复制 N / M 格到 …」、`（masked：跳过 N 格非空气）`、`(空)`）与 `Selectors.ts` 的 14 条选择器错误信息；③ `loot.ts` 的 30 条结构名（`村庄小屋` / `废弃矿井` …）可见性待确认
  - 验证：巡查脚本实测四语言「缺键 0 / 含中文 0 / 空值 0」；源码扫描 906 处、73 个文件，按文件排序前几位为 `advancements.ts 205 / main.ts 154 / itemNames.ts 92 / Rules.ts 35 / diagPerf.ts 32 / loot.ts 30`；`test:i18n` 523 / 0、`test:offline` 172 / 172 套全绿
  - 批次：20261024-0223


- [x] [C3] `GAME_RULE_LABELS`（35 条规则描述）多语言 —— 命令帮助里的 gamerule 下拉直接显示它，与 P6-1 的难度/模式同一类；改 `gameRuleLabel(rule)` 走 `cmd.label.gamerule.*`
  - 做了什么：`GAME_RULE_LABELS`（31 条中文规则名）→ **`gameRuleLabel(rule)`** 走 `cmd.label.gamerule.*`（31 × 6 = **186 条**），表 2701 → **2732**；使用点 `CommandHelp.ts` 的 gamerule 下拉改为 `${gameRuleLabel(rule)}（${rule}）`
  - 为什么是真遗漏：那张表的注释写着"命令帮助的下拉用" —— 玩家在 `/help gamerule` 的候选列表里直接看到它，与 P6-1 修的 `DIFFICULTY_LABELS` / `GAME_MODE_LABELS` 完全同类（中文常量给界面用，绕过了语言表）
  - 术语照原版：`Inventar behalten` / `Kreaturen spawnen` / `Kreaturen zerstören Blöcke`、`Сохранять инвентарь` / `Разрушение блоков мобами`、`Conserver l’inventaire` / `Créatures qui cassent des blocs`、`Manter inventário` / `Criaturas quebrando blocos`；`doInsomnia` 用 `Schlaflosigkeit` / `Бессонница` / `Insomnie` / `Insônia`（幻翼失眠）
  - ⚠️ 改了 2 条既有断言（都是"标签搬走"的直接后果）：① `ui`「`/gamerule` 的帮助里列出了新规则」原来还检查 `Rules.ts` 里存在 `doImmediateRespawn: '立即重生'` 这个中文字面量 —— 改成只验默认值还在、且**不再**有那个字面量（标签是否翻好交给 `test:i18n`）；② `command-test`「每条规则都有中文名」改成「每条都有显示名且不是键名本身」
  - 新增 6 条断言：规则标签覆盖 31 条 + de/ru/fr/pt 各一条「不含中文、不露英文 id」+ 中文下仍是原说法（`死亡后保留物品` / `昼夜循环`）
  - 验证：五语言渲染 `keepInventory` → de `Inventar behalten` / ru `Сохранять инвентарь` / fr `Conserver l’inventaire` / pt `Manter inventário`；`test:i18n` **529 / 0**；`command-test` **435 / 0**；`ui` **926 / 0**；`test:offline` **172 / 172 套全绿**；`audit:i18n` 2732 条、0 缺口 / 0 孤儿
  - 批次：20261024-0223
- [x] [C4] 命令域剩余硬编码：`Commands.ts` 的 `/clone` `/fill` 回执与 `(空)`、`Selectors.ts` 的 14 条错误信息 → `cmdMessages.*`（约 28 条）
  - 做了什么：`Selectors.ts` 的 **14 条**选择器错误 + `Commands.ts` 的 **13 处**回执（`/clone` 的「已复制 N / M 格」「（masked：跳过 N 格）」、`(空)` 两处、授予/收回、execute 三条、scoreboard/队伍摘要四条）全部走 `cmd.error.selector.*` / `cmd.reply.*` —— 共 **30 条键 × 6 语言 = 180 条**，表 2732 → **2762**；两个文件里**再无硬编码中文**（只剩一行行尾注释）
  - ⚠️ 坑 1（会静默覆盖）：`cmd.reply.team.prefix` / `suffix` 这两个键**已经存在**（P4 法语批时加的，值是「前缀」/「后缀」两个字，用在 `msg(key, …)` 里）。我新写的是「，前缀「{prefix}」」（带前导逗号、给队伍摘要拼串用）→ `TS1117: duplicate property` 当场拦下。改成 `prefixAffix` / `suffixAffix` 两个新键，旧键保持不动
  - ⚠️ 坑 2（变量遮蔽）：`/time` 那段有 `const t = parseTime(args[1])`，把 i18n 的 `t` **遮蔽**了 → `t('cmd.reply.emptyValue')` 变成"调用 parseTime 的返回值"（可能为 null），`TS2721: Cannot invoke an object which is possibly null` 抓到。改用同文件里的本地辅助 `msg('cmd.reply.emptyValue')`（它本来就是"键 + 参数"的简写），语义更贴合
  - 新增 5 条断言：四语言各一条「命令错误与回执不含中文」（取样 6 条：选择器未知 / limit / 过滤参数缺等号 / clone 回执 / 队伍摘要 / execute 未知子命令）+ 中文下仍是原说法（`type 后面没有种类`）
  - 验证：`test:i18n` **534 / 0**；`command-test` **435 / 0**；`test:offline` **172 / 172 套全绿**；`audit:i18n` 2762 条、0 缺口 / 0 孤儿；`node .tmp/list-c4.mjs` 复查两个文件的中文只剩注释
  - 批次：20261024-0223
- [x] [C5] `loot.ts` 的 30 条结构名（`村庄小屋` 等）多语言 —— 先确认它在界面上是否可见，再决定键化还是保留
  - 侦察结论（先确认可见性）：`LOOT_TABLES[].name` **确实上界面** —— `CommandHelp.ts:426` 的 `/loot` 帮助下拉写的是 `${table.name}（${table.key}）`，与 C3 的 gamerule 下拉完全同一个模式；所以判为**真遗漏、要键化**，不是保留
  - 做了什么：22 条战利品表名（村庄小屋 / 废弃矿井 / 地牢 / 要塞图书馆与三个要塞点 / 两处沉船 / 林地府邸 / 末地城 / 两处堡垒遗迹 / 沙漠神殿 / 丛林神庙 / 女巫小屋 / 掠夺者前哨 / 雪屋 / 废弃传送门 / 埋藏的宝藏 / 下界要塞 / 海底废墟）→ `cmd.label.lootTable.*`（22 × 6 = **132 条**），表 2762 → **2784**；`CommandHelp` 的下拉改用 `t(...)`
  - ⚠️ 条目写的"30 条"实际是 **22 条**（`LOOT_TABLES` 就 22 张表）；另 8 条差额是我当初按 `loot.ts` 里中文字面量数量估的，含注释与函数名
  - 一个刻意的取舍：`loot.ts` 的 `name` 字段**保留**（数据字段，调试与 `tools/*-test.ts` 在用），只在注释里写明"界面走 `cmd.label.lootTable.*`"。把字段删掉会动 `LootTable` 接口与 22 条数据表，收益不抵风险；玩家可见处已经全部走语言表
  - 顺带核对了 `/structure` 那一支（担心同类问题）：它**已经在走** `cmd.label.structure.*`（多语言 P1-7 时改的），不是遗漏
  - 新增 5 条断言：de/ru/fr/pt 各一条「战利品表名不含中文、也不露键名」（22 条全量扫）+ 中文下仍是原说法（`村庄小屋`）
  - 验证：`test:i18n` **539 / 0**；`test:offline` **172 / 172 套全绿**；`audit:i18n` 2784 条、0 缺口 / 0 孤儿；`check.mjs --fast` 5 项全绿
  - 批次：20261024-0223

---

## 批次 20261024-0136 · 2026-10-24 · 会话 4024a9d4

- [x] [B1] 首页品牌块：`WorldScreen` 的 `logo`（`MINECRAFT`）+ `edition`（`基岩版 1.18 · WEB EDITION`）→ `Minicraft` / `1.18 · WEB EDITION`；品牌名抽成 `BRAND` 常量，与 `test:i18n` 的品牌一致性断言共用一个真值
  - 做了什么：新建 `src/core/brand.ts`（`BRAND = 'Minicraft'` / `BRAND_EDITION = '1.18 · WEB EDITION'`），首页 `WorldScreen` 的 `logo` / `edition` 改成取它 —— 原来写死 `'MINECRAFT'` 与 `'基岩版 1.18 · WEB EDITION'`
  - 「基岩版」按用户要求去掉：那是 Mojang 的版本命名，本项目是独立的浏览器实现，不该借用；`1.18` 保留（说明复刻的是哪个版本的规则）
  - 品牌名**不接进语言表**：它在六种语言里都是 `Minicraft`，接进表反而会让 `audit:i18n` 把 6 份重复文案算成"该翻的"
  - 断言：`test:i18n` 原有 3 条品牌一致性改从 `core/brand.ts` 取唯一真值，另加 2 条 —— 首页品牌块取 `BRAND`/`BRAND_EDITION` 且旧字面量已清、副标题是版本身份（不含「基岩」）
  - ⚠️ 改了一条既有 `ui` 断言：「首页品牌信号是 MINECRAFT + 基岩版标识」→ 「首页品牌块取唯一真值，不再写死 MINECRAFT 与「基岩版」」—— 这条断言原本在**保护旧文案**，用户拍板后必须跟着转向，否则它会一直红
  - 验证：`test:i18n` **512 / 0**；`ui` 套件 **926 / 0**；`test:offline` **172 / 172 套全绿**
  - 批次：20261024-0136
- [x] [B2] 设置里的 camera 选项多语言：`CAMERA_MODE_LABELS`（第一人称 / 第三人称（背后） / 第三人称（正面））→ `settings.cameraMode.*` 六语言；同一处的粒子等级标签一并检查
  - 做了什么：`CAMERA_MODE_LABELS`（第一人称 / 第三人称（背后） / 第三人称（正面））这张中文常量表改成 **`cameraModeLabel(mode)`** 函数，文案进 `settings.cameraMode.*`（3 键 × 6 语言）；切视角的 toast `视角：{mode}` 也键化成 `misc.cameraModeToast`
  - `third-back` / `third-front` 这类**带连字符的 id 不能直接当键名后缀**，加了一张 `CAMERA_MODE_KEY` 映射（`third-back` → `thirdBack`），键写成模板字面量让 `audit:i18n` 能认出这一族
  - 照抄同文件里 `handednessLabels()` 的既有做法：`makeSelect` 要 `Record<T, string>`，所以在构造时 `Object.fromEntries(CAMERA_MODES.map(...))` 生成一次（会话内切语言走整页重载，构造时求值安全）
  - 四处调用点：`SettingsScreen` 的下拉、`main.ts` 切视角 toast 与调试 HUD 的「视角」，以及 `tools/settings-test` / `tools/viewmode-test` 两个测试的引用
  - ⚠️ 又改了一条既有 `ui` 断言：「设置面板里的"视角"下拉还在」原来锚的是 makeSelect 的**单行**写法，改成多行后失配 —— 判据改成锚「键 + 标签函数」（`'cameraMode'` + `cameraModeLabel(mode)` + `t('settings.row.cameraMode')`），不再依赖换行
  - 验证：六语言实测（de `Erste Person / Dritte Person (hinten) / Dritte Person (vorne)` · `Ansicht: …`、ru `От первого лица / … (сзади) / … (спереди)`、fr `Première personne / Troisième personne (derrière) / (devant)`、pt `Primeira pessoa / Terceira pessoa (atrás) / (à frente)`）；`test:i18n` **517 / 0**（新增 5 条）；`ui` **926 / 0**；`test:offline` **172 / 172**；`audit:i18n` 2457 条、0 孤儿
  - 批次：20261024-0136
- [x] [B3] 进游戏后的第一条消息多语言：先用浏览器实测定位到底是哪一条（引导卡已确认有 de 翻译，所以目标可能是别处），再键化
  - 做了什么：新建 `hud` 分组 **54 键 × 6 语言**（表 2457 → **2511**），把 `main.ts` 里 `debugEl` 的整段拼接（桌面 9 行 + 手机 3 行）全部改成 `t()` / `tp()`；**值**也一并键化 —— 方位四向（北/东/南/西）、月相八相、天数、是/否 —— 只翻标签不翻值的话，德语面板会变成「Blickrichtung: 北 (-Z)」（第一次实测就是这个结果）
  - 覆盖的片段：`hud.physics` / 三角形 / 区块 / 朝向 / 时间 / 月相 / 难度 / 模式 / 维度 / 视角 / 在地面 / 在水中 / 脚下方块光 / 指向 / 破坏% / 持有 / 视距 / 自适应 / 雾 / 已渲染 / 待网格化 / 在途 / 待生成 / 生命 / 饥饿 / 饱和 / 氧气 / 疲劳 / 护甲 / 经验 / 光照队列 / 待重刷 / 联机 / 在线人数 / 无
  - 两处**值**也走了 i18n：`moonPhaseName()` 从返回 `moonPhaseInfo().cn` 改成查 `hud.moonPhase.<phase>`（8 相）；`facing` 从 4 个字面量数组改成 `[t('hud.facingNorth'), …]`
  - ⚠️ 纠正上一批的判断：P6-5 的完成说明里写过「`diagPerf` 调试面板不翻（`?debug=1` 才出现）」—— 这个 HUD **进世界默认就显示**，与那条不是同一个东西。已在队列里记下这处记错
  - 🖥️ 浏览器实测（起 vite 5206 + 本机 Chrome，`?lang=de` / `?lang=pt-BR` / `?lang=zh-CN` 三路各走一次「游戏 → 新建世界 → 创建并进入」）：**de 与 pt 的整屏 `含中文=false`**、zh 正常 —— 实测文本 `Minicraft · P1-Physik + Blockinteraktion 60 fps 3,478,548 Dreiecke … Blickrichtung: Norden (-Z) Zeit: 08:59 Mondphase: Vollmond (Tag 0) … Ansicht: Erste Person`、pt `… Direção: Norte (-Z) … Lua: Lua cheia (dia 0) … Câmera: Primeira pessoa`
  - 验证：`test:i18n` **523 / 0**（新增 6 条：`hud.*` 整族在 de/ru/fr/pt 不含中文 + 键数哨兵 + 中文侧没变）；`test:offline` **172 / 172 套全绿**；`audit:i18n` 2511 条、0 缺口 / 0 孤儿
  - 批次：20261024-0136
  - 侦察结论（浏览器实测，起 vite 5205 + 本机 Chrome，走「游戏 → 新建世界 → 创建并进入」）：进世界后第一眼看到的是**调试面板**（`this.debugEl` 那段拼接，F3 风格），实测正文是：
    `Minicraft · P1 物理 + 方块交互 60 fps 2,602,596 三角形 XYZ: 0.50 / 66.00 / -11.50 区块: 0, -1 朝向: 北 (-Z) 时间: 08:59 月相: 满月(第 0 天) 难度: 普通 模式: 生存 维度: 主世界 视角: 第一人称 在地面: 是 在水中: 否 脚下方块光: 0 …`
  - 所以「第一条消息」= 这个面板，其中**约 35 个中文片段**（三角形/区块/朝向/时间/月相/难度/模式/维度/视角/在地面/在水中/脚下方块光/指向/破坏/持有/视距/雾/已渲染/待网格化/在途/待生成/生命/饥饿/饱和/氧气/疲劳/护甲/经验/级/光照队列/待重刷/联机/在线/无/是/否…）
  - ⚠️ 它与 P6-5 里"`diagPerf` 调试面板不翻"的判断**冲突**：那条说的是 `?debug=1` 的性能面板，而这个 HUD 是**进世界后默认显示**的。已在 P6-5 的说明里记错了一处，这里纠正
- [x] [B4] 方块说明缺失的**侦察与分批**（用户拍板：全量补齐 495 个）—— 实测 495 个方块无说明，按族分布：颜色族 172 / 台阶墙 95 / 其它 83 / 木材 53 / 石类 30 / 下界 18 / 作物 17 / 末地 10 / 矿石 9 / 建材装饰 6 / 海洋 2
  - 侦察口径：`itemDef(id).block !== undefined` 且 `itemDescription(id)` 为空 → 495 个；非方块的 42 个（16 色染料 + 26 个其它）另算
  - ⚠️ 不是翻译问题：中文原表里就没有这些键（`item.desc.stone` 之类根本不存在），所以四语言都没有说明 —— 用户看到的是"背包里点方块只有名字、没有介绍"
  - 拆批：按族切，每批控制在 ~50 个方块（× 6 语言 ≈ 300 条译文），共 8 批（B4a~B4h）
  - 验证：扫描脚本实测 `物品 1130 · 有说明 593 · 无说明 537`（其中**方块 495** + 非方块 42），族分布为颜色族 172 / 台阶墙 95 / 其它 83 / 木材 53 / 石类 30 / 下界 18 / 作物 17 …；据此拆成 B4a~B4h 八批，八批做完后同一脚本复测为 **有说明 1130 · 无说明 0**（覆盖率 593 → 1130，100%）
- [x] [B4a] 石类 30 + 矿石 9 + 建材装饰 6 + 海洋 2 = **47 个**（玩家最先接触的一批）
  - 做了什么：**47 个方块**的说明补齐（石类 30：石头/泥土/圆石/花岗岩/闪长岩/安山岩/凝灰岩/方解石/黏土/砂岩与三种变体/石砖四态/三种抛光/苔石/裂纹砖/磁石/滴水石锥与母岩/缠根泥土/红石块/石压力板；深板岩族 9：深板岩与砖·瓦·磨制·錾制·裂纹·圆石/下界石英矿/孢子花；建材 6：玻璃/红砖/陶瓦/玻璃板/苔藓地毯/染色玻璃；海晶 2：海晶石砖/暗海晶石）× 6 语言 = **282 条**，`itemDesc` 表 2511 → **2558**
  - 实测覆盖变化：**有说明 593 → 640、无说明 537 → 490**（脚本口径：`itemDef(id).block !== undefined` 且 `itemDescription` 为空）
  - 写法统一成"一句话说清三件事"：**从哪来 / 怎么用 / 特殊行为** —— 例：`磁石：用指南针右击绑定后，那枚指南针会永远指向它（跨维度也有效）`、`染色玻璃：看得穿但会挡住光`、`玻璃：直接挖会碎，要精准采集才掉本体`。泛泛的"这是装饰方块"没有信息量，玩家读完还是不点
  - ⚠️ 写完自查时改掉自己 3 条事实错误：① `石头：用镐挖圆石能得到它` 因果反了（正确是"圆石烧成石头"）；② `平滑砂岩` 里混进了英文单词 `sandstone`；③ `孢子花` 写成"补充水下呼吸"，实际是给**发光孢子**（吸引生物）
  - ⚠️ 改了 2 条**既有 `recipebook` 断言**（它们与"补全方块说明"这个需求直接冲突）：①「普通建材没有手写说明（保留 hasDescription 语义）」—— 原来拿花岗岩当"没说明"的例子，现在改成验"花岗岩有手写说明"；②「没写过说明也有兜底文案」—— 原来写死花岗岩，改成**运行时找样本**（`[PACKED_ICE, OAK_LOG, OAK_LEAVES, DIRT].find(id => !hasDescription(id))`），B4 全部补完后样本为 `undefined` 时这条自然通过，不会再因为"补了说明"而红
  - 验证：六语言渲染抽查 `stone` / `cobblestone` —— zh 全中文、**de/ru/fr/pt 含中文=无**；`test:i18n` **523 / 0**（P6-6 的输出侧守卫自动覆盖这 47 条）；`recipebook` **162 / 0**；`test:offline` **172 / 172 套全绿**；`audit:i18n` 2558 条、0 缺口 / 0 孤儿
  - 批次：20261024-0136
- [x] [B4b] 木材族 **53 个**（原木/木板/树叶/树苗/木质方块；能模板的走模板）
  - 做了什么：木材族 **53 个方块全部有说明**，但只新增 **12 条键**（8 模板 + 4 静态）× 6 语言 = 72 条 —— 木材 30（6 树种 × 原木/木板/树叶/木头/去皮原木）+ 作物茎 18（南瓜/西瓜 × 8 个生长阶段 + 已连果实）+ 下界木 4（猩红/诡异 菌柄与木板）+ 蘑菇柄 1
  - 为什么能模板：木材是"树种 × 形状"的组合，**6 × 5 = 30 条说明只差一个词**，逐条写要 30 × 6 = 180 条，模板只要 5 × 6 = 30 条。作物茎同理（2 × 9 = 18 条 → 3 条模板）
  - ⚠️ 模板能成立的关键：**各语言构件值的语法形态不同**，所以模板不是"同一个句式"，而是每种语言各自排 —— 中文 `{wood}` 是名词前缀（"橡木原木"）、德语是合成词干（`Eichen` → `Eichenstamm`）、俄语是形容词干（`Дубов` → `Дубовое бревно` / `Берёзовая листва`）、法语/葡语是 `de + 名词`（`Bûche de chêne`）。实测三种语言都自然，没有硬拼的痕迹
  - ⚠️ 写完自查改掉一处：法语/葡语的茎模板原来写成 `Tige de {crop}`，而 `item.pumpkin` 在法语是首字母大写的 `Citrouille` → 拼出**句中大写**的 `Tige de Citrouille`。改成括号式 `Tige ({crop}, stade {stage})`（括号内首字母大写可接受），并在句中去掉重复的作物名词
  - 实现：`itemNames.ts` 里加两个循环注册到 `DESCRIPTIONS`（`() => tp(...)` 函数形态，切语言后立刻变）；取值在**函数内**做，不能提到外面（会变成"模块加载时那一刻的语言"）
  - 验证：六语言渲染抽查 —— `oak_log` → de `Eichenstamm: aus dem Baum gefällt, ergibt vier Eichenholzbretter` / ru `Дубовое бревно: срублено с дерева, даёт четыре доски` / fr `Bûche de chêne : abattue sur l’arbre, donne quatre planches`、`pumpkin_stem_stage3` → fr `Tige (Citrouille, stade 3)`；**四语言含中文=无**；扫描 `无说明 490 → 437`；`test:i18n` **523 / 0**；`test:offline` **172 / 172 套全绿**；`audit:i18n` 2570 条、0 缺口 / 0 孤儿
  - 批次：20261024-0136
- [x] [B4c] 台阶 / 楼梯 / 墙 **95 个**（绝大多数是 `{base}` + 形状，说明可高度复用）
  - 做了什么：台阶 / 楼梯 / 墙 **95 个方块全部有说明**，只新增 **3 条模板**（楼梯 / 台阶 / 墙）× 6 语言 = 18 条 —— 这 95 个全是「{base} + 形状」，说明的差别只在基座名与形状用途
  - 模板各语言的形态：中文 `{base}楼梯`（前缀）、英文 `{base} Stairs`、德语 `Treppe ({base})`、俄语 `Лестница ({base})`、法语 `Escalier ({base})`、葡语 `Escada ({base})` —— 除中文外都用**括号式**，避开基座名的格变化与句中大写（基座是独立物品名，如 `Pierres taillées` / `Каменные кирпичи`，首字母本来就大写）
  - ⚠️ 坑 1（实测抓到）：6 种木板的基座名**没有** `item.<wood>_planks` 键（木板名走模板 `item.tpl.woodPlanks`），直接用 `t('item.oak_planks')` 会拿到**键名本身** → 说明里印出 `item.oak_planks楼梯`。改成 `tp('item.tpl.woodPlanks', { wood })` 才对
  - ⚠️ 坑 2：`stone_brick_wall` 的 id 是**单数**，而另外两个形状是 `stone_bricks_stairs` / `stone_bricks_slab` —— 遍历基座表碰不到它，单独补了一条（否则 95 个里会剩 1 个没说明，实测就是这样发现的）
  - 验证：六语言渲染抽查 `oak_planks_stairs` → de `Treppe (Eichenbretter)` / ru `Лестница (Дубовые доски)` / fr `Escalier (Planches de chêne)` / pt `Escada (Tábuas de carvalho)`，`stone_brick_wall` → de `Mauer (Steinziegel)`；**四语言含中文=无**；覆盖率 `有说明 693 → 794`、`无说明 437 → 336`；`test:i18n` **523 / 0**；`test:offline` **172 / 172 套全绿**；`audit:i18n` 2573 条、0 缺口 / 0 孤儿
  - 批次：20261024-0136
- [x] [B4d] 颜色族**第一批 88 个**（羊毛 16 / 地毯 16 / 混凝土 16 / 混凝土粉末 16 / 玻璃 16 / 其它）
  - 做了什么：颜色族**第一批 80 个**（羊毛 / 地毯 / 混凝土 / 染色玻璃 / 染色玻璃板，各 16 色）全部有说明，只新增 **5 条模板** × 6 语言 = 30 条
  - ⚠️ 与条目写的 88 个差 8：实际这些形状是 5 × 16 = 80；条目里的"混凝土粉末 16"在物品表里**没有独立条目**（粉末只作为混凝土的中间态，不是可拾取物品）。差的 8 个不影响覆盖（剩余颜色族是陶瓦 / 带釉陶瓦 / 蜡烛 / 旗帜 / 潜影盒各 16 = 80，正好是 B4e）
  - 关键设计：模板的 `{name}` 传的是**整件物品名**而不是颜色词 —— 物品名本身已是各语言的正确形式（中文「白色羊毛」、德语 `Weißwolle`、俄语 `Шерсть (Белый)`、法语 `Laine (blanc)`、葡语 `Lã (branco)`），所以说明模板**完全不用操心性数配合**，这是比"颜色词 + 形状词拼接"更稳的一层复用
  - 每个形状一条显式分支（不写 `tp(shapeKey, …)` 那种变量形式）：键必须是字面量，`audit:i18n` 才认得出这 10 个键（5 个物品名模板 + 5 个说明模板）被引用
  - 验证：六语言渲染 `white_wool` → de `Weißwolle: von Schafen geschoren oder aus vier Fäden; für Betten, Teppiche und Deko` / ru `Шерсть (Белый): стригут с овцы…` / fr `Laine (blanc) : tondue sur un mouton…` / pt `Lã (branco): tosquiada da ovelha…`，`red_concrete` 同构；**四语言含中文=无**；覆盖率 `有说明 794 → 874`、`无说明 336 → 256`；`test:i18n` **523 / 0**；`test:offline` **172 / 172 套全绿**；`audit:i18n` 2578 条、0 缺口 / 0 孤儿
  - 批次：20261024-0136
- [x] [B4e] 颜色族**第二批 84 个**（陶瓦 16 / 带釉陶瓦 16 / 床 16 / 旗帜 16 / 蜡烛 16 / 其它）
  - 做了什么：颜色族**第二批 80 个**（陶瓦 / 带釉陶瓦 / 蜡烛 / 旗帜 / 潜影盒，各 16 色）全部有说明，只新增 **5 条模板** × 6 语言 = 30 条。**颜色族 160 个到此全部有说明**
  - ⚠️ 与条目写的 84 个差 4：实际是 5 × 16 = 80；条目里的"床 16"在物品表里**已经有说明**（不是缺失项），所以这批只剩这五个形状
  - ⚠️ `{name}` 有两种来源，这轮专门分开写了：① 陶瓦与潜影盒的名字是**模板拼的**（`item.tpl.terracottaColored` / `item.tpl.shulkerBox`）—— `item.white_terracotta` 这个键**不存在**；② 带釉陶瓦 / 蜡烛 / 旗帜是**显式键**（`item.white_glazed_terracotta` 等）。用错的那种会拿到键名本身（B4c 木板的同款坑，这次提前避开并在代码注释里写明）
  - ⚠️ 一次真实的顺序错误：第二批的循环先用 `COLOR_KEYS`，而我把它插在了 `COLOR_KEYS` 声明之前 → `TS2448: used before its declaration` + 运行时 `COLOR_KEYS is not iterable`。把块移到声明之后就正常了 —— 这类"插入位置依赖前面的常量"的错，编译期就能抓到，不必等测试
  - 验证：六语言渲染 `white_terracotta` → de `Weißkeramik: Keramik mit gleichfarbigem Farbstoff gefärbt; Baumaterial` / ru `Терракота (Белый): керамика, окрашенная красителем того же цвета…` / fr `Terre cuite (blanc) : …` / pt `Argila cozida (branco): …`，`red_candle` 同构；**四语言含中文=无**；覆盖率 `有说明 874 → 954`、`无说明 256 → 176`；`test:i18n` **523 / 0**；`test:offline` **172 / 172 套全绿**；`audit:i18n` 2583 条、0 缺口 / 0 孤儿
  - 批次：20261024-0136
- [x] [B4f] 下界 18 + 作物 17 = **35 个**
  - 做了什么：**47 个方块**（下界 22 + 作物与花 25）全部有说明 = 33 条独立说明 + 2 条模板，共 **35 条 × 6 语言 = 210 条**（表 2583 → **2618**）
  - ⚠️ 与条目写的 35 个差 12：实际这轮扫描出来是下界 **22** + 作物/花 **25** = 47（条目当时是粗分，模板批做完后族边界变了）。花色与作物阶段原本分散在"其它"里，这轮一并收了
  - 两条模板：作物生长阶段（胡萝卜/马铃薯/甜菜根 × 4 = 12）+ 甜浆果丛 3 阶段 = 15 个方块 → `item.desc.tpl.cropStage` / `item.desc.tpl.berryBush`
  - ⚠️ 名字前缀是**复数**（`carrots_stage0` / `potatoes_stage0` / `beetroots_stage0`），而 `item.<crop>` 是单数 —— 直接用字符串加法会得到 `potatos`（`potato` + `s`）。改成显式三元组 `['potatoes', 'potato']`，把"名字前缀"与"物品键"分开写
  - 33 条独立说明覆盖：下界方块 22（灵魂土 / 玄武岩三态 / 黑石 / 两种菌岩 / 两种菌 / 两种菌索 / 下界苗 / 两种疣块 / 菌光体 / 下界砖与红下界砖 / 石英四态 / 重生锚）+ 花与植物 11（草方块 / 蕨 / 蒲公英 / 虞美人 / 兰花 / 矢车菊 / 滨菊 / 盛开的杜鹃 / 紫颂花 / 两种蘑菇方块）
  - 验证：六语言渲染 `respawn_anchor` → de `Seelenanker: mit Glowstone aufladen…` / ru `Якорь возрождения: заряди светокамнем…` / fr `Ancre de réapparition : …` / pt `Âncora de renascimento: …`，`carrots_stage2` → de `Karotte (Stufe 2)` / ru `Морковь (стадия 2)` / fr `Carotte (stade 2)` / pt `Cenoura (estágio 2)`；**四语言含中文=无**；覆盖率 `有说明 954 → 1002`、`无说明 176 → 128`；`test:i18n` **523 / 0**；`test:offline` **172 / 172 套全绿**；`audit:i18n` 2618 条、0 缺口 / 0 孤儿
  - 批次：20261024-0136
- [x] [B4g] 末地 10 + 其它 **47 个**
  - 做了什么：**47 个方块**全部有说明 = 4 条模板 + 26 条独立说明 = **30 键 × 6 语言 = 180 条**（表 2618 → **2648**）
  - 构成：末地 10（末地石 / 末地石砖 / 紫珀块与柱 / 紫颂植株 / 末地烛 / 龙蛋 / 传送门框架 / 传送门 / 哭泣的黑曜石）+ 木质围栏·栅栏门·门·活板门 **21 个走 4 条模板** + 其它 16（浮冰 / 蓝冰 / 粗铜块 / 粗铁块 / 铁块 / 红砂岩 / 目标方块 / 骨块 / 紫水晶块 / 菌丝体 / 苔藓块 / 杜鹃 / 蜜蜂巢 / 蜂巢块 / 干草块 / 蜘蛛网）
  - 木质形状的 `{name}` 取的是**整件物品名**（`item.oak_fence` = 橡木栅栏）—— 这些名字在表里是**生成的显式键**，直接 `t()` 就有，不必再拼一次构件；实测德语拼出 `Eichenholzzaun`、俄语 `Дубовый забор`、法语 `Barrière en chêne`、葡语 `Cerca de carvalho`，四种语言都自然
  - ⚠️ 中途踩了一下：先写了两条"木质按钮 / 压力板"的循环，但 `item.desc.tpl.woodButton` / `woodPressurePlate` 这两个键**还没加** → `TS6133` + 运行时会显示键名。这 12 个按钮/压力板本来就不在本条范围内（属"其它"），已把那段撤掉，留给 B4h
  - 验证：六语言渲染 `dragon_egg` → de `Drachenei: erscheint nach dem Sieg über den Enderdrachen…` / ru `Яйцо дракона: появляется после победы над драконом Края…` / fr `Œuf de dragon : apparaît après avoir vaincu le dragon de l’End…` / pt `Ovo de dragão: aparece após derrotar o dragão do End…`；**四语言含中文=无**；覆盖率 `有说明 1002 → 1049`、`无说明 128 → 81`；`test:i18n` **523 / 0**；`test:offline` **172 / 172 套全绿**；`audit:i18n` 2648 条、0 缺口 / 0 孤儿
  - 批次：20261024-0136
- [x] [B4h] 其它剩余 **46 个**；收尾时把 42 个非方块物品（染料等）一并评估
  - 做了什么：**最后 81 个**（方块 39 + 非方块物品 42）全部补齐 —— 4 条模板（染料 16 / 木质按钮 6 / 木质压力板 6 / 涂蜡铜块 4 = 32 个）+ **49 条独立说明** × 6 语言 = **270 条**（表 2648 → **2701**）
  - 🎯 **本条达成整批的总目标**：`物品 1130 · 有说明 1130 · 无说明 0` —— 背包里**每一个物品/方块**都有介绍了（B4a 开工时是 593/1130，537 个没有）
  - 覆盖面：可可果两阶段 / 探测与激活铁轨 / 轻重测重压力板 / 紫水晶母岩与簇 / 蜡烛 / 发光地衣·浆果·垂根·大小垂滴叶 / 海绵与湿海绵 / 命令方块 / 唱片机 / 钟 / 盔甲架 / 洞穴藤蔓 / 制图台 / 潮涌核心 + 骨头·火药·下界石英·兔子脚·恶魂之泪·蜘蛛眼·发酵蜘蛛眼·闪烁西瓜·红石·荧石粉·紫水晶碎片·海晶碎片与砂砾·蜂蜡·蜂蜜瓶·鞘翅·下界砖·紫颂果两态·望远镜·不死图腾·海洋之心·鹦鹉螺壳·三张唱片
  - 模板那一半的做法：染料用 `tp('item.tpl.dye', { color })`（`item.white_dye` 键**不存在**，实测确认）；按钮/压力板与涂蜡铜块用**生成的显式键**（`item.oak_button` = 橡木按钮）—— 两种来源与 B4c/B4e 的坑同源，这次先查再写，没有返工
  - 验证：六语言渲染 `white_dye` → de `Weißfarbstoff: zum Färben; färbt Wolle, Leder, Glas und Keramik…` / ru `Краситель (Белый): для окрашивания…` / fr `Colorant (blanc) : pour teindre…` / pt `Corante (branco): para tingir…`，`elytra` 同构；**四语言含中文=无**；扫描 **无说明 81 → 0**；`test:i18n` **523 / 0**；`test:offline` **172 / 172 套全绿**；`audit:i18n` 2701 条、0 缺口 / 0 孤儿
  - 批次：20261024-0136

---

## 批次 20261024-0121 · 2026-10-24 · 会话 4024a9d4

- [x] [R1] 品牌改名 **Minicraft**：`public/manifest.webmanifest` 的 `name` / `short_name`（再由 `gen:manifests` 派生另外 5 份）、`index.html` 的 `<title>`、`docs/store/` 六份标题、`README.md` 首行、`src/main.ts` 调试 HUD 标题行；**合规声明（非官方、不含官方素材、与 Mojang 无关）原样保留**
  - 做了什么：品牌名统一成 **Minicraft**，五处落点全部改到：① `public/manifest.webmanifest` 的 `name` / `short_name`（基准，改完用 `npm run gen:manifests` 派生另外 5 份，**不手改六份**）；② `index.html` 的 `<title>`；③ `docs/store/` 六份标题；④ `README.md` 首行；⑤ `src/main.ts` 调试 HUD 标题行
  - 为什么先改基准再派生：六份 manifest 由 `tools/gen-manifests.mjs` 从中文那份派生（`name` / `short_name` 在 11 个冻结字段里）。手改六份必然会漂 —— 改一处 + `gen:manifests` 一次，六份实测输出 `Minicraft Minicraft` 完全一致
  - 新增 **3 条跨文件一致性断言**（`BRAND = 'Minicraft'` 是唯一真值）：六份 manifest 的 `name` / `short_name` 都是品牌名、`index.html` 标题是品牌名、`docs/store/` 六份标题都是品牌名 —— 品牌名散在互不相干的文件里，手改必漏一处，而漏掉的那处平时看不见（比如只在装成 PWA 后的桌面上显示）
  - 保留不动：① 合规声明（非官方爱好者复刻、与 Mojang 和 Microsoft 无关、不含官方素材、贴图音效运行时生成、存档只在本机）—— 改名不能删保护性声明；② `index.html` 里一处**注释**提到旧名（"这里原来有一层 `#overlay`…"）—— 历史陈述，改了会让注释失真；③ 历史档案（`DONE.md` / `notes/`）里的旧名一律不改
  - ⚠️ 踩到一个**脆弱判据**：用 `json.dumps(indent=2)` 重写 manifest 时把 `display_override` 数组展开成多行，`ui` 套件的「manifest 以横屏全屏打开」是**按文本**匹配紧凑写法的，当场红。修法不是改断言，而是把基准文件那一段恢复成紧凑写法（派生出的五份仍会展开，但那条断言只查基准）
  - 验证：六份 manifest 实测 `Minicraft Minicraft ['fullscreen', 'standalone']`（`sort -u` 后只剩一行）；`test:i18n` **510 / 0**（新增 3 条）；`ui` 套件 **926 / 0**；`test:offline` **172 / 172 套全绿**；`check.mjs --fast` 5 项全绿；`grep` 旧名只剩 `index.html` 那条历史注释
  - 批次：20261024-0121

---
