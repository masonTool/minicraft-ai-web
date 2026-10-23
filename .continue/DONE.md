# 完成档案 · DONE

> 本文件是**已完成工作的唯一档案**，只回答"这批做了什么、怎么验的"——时间线，最近的在最上面。
> 按模块看现状与坑 → `OVERVIEW.md`；下次怎么避开 → `TIPS.md`；机制与格式 → `README.md`。
> **一条内容只写一个地方**，别在三份文档里各抄一遍。
>
> 收尾时**整份队列原样搬进来**（含每条任务下方的完成说明与 `[阻塞]`），标题格式
> `## 批次 <号> · 日期 · 会话 <前 8 位>`。

---
## 批次 20261023-2002 · 2026-10-23 · 会话 4024a9d4

**做了什么**：P2 数据层 + P3 界面残留 + P4 的德语与俄语两张全量表（本批 **36 个条目**，表 864 → **2168**）。

- **P2（17 条）**：物品/方块名从"600 条中文常量 + 35 个拼装循环"改成**构件表 + 模板**（`item.<id>` 481 条显式名 / `item.tpl.*` 29 个模板 / 颜色·木材·石材·矿石等构件），288 条物品说明按模板拆走，75 个生物名 → `entity.<id>`，两批标签表 15 张 → `label.*`，7 个容器类的红底原因改成返回 `ReasonRef`（逻辑层不再产出文案）。
- **P3（5 条）**：触摸控件 / 提示框 / 加载遮罩 / 四个编辑器 / 信标·不支持·统计三个屏幕的文案进表；`relativeTime` 改 `Intl.RelativeTimeFormat`；首屏与 manifest 跟语言走。**13 个文件**有"不许出现中文字面量"的断言守着。
- **P4（14 条）**：德语与俄语各 **2168 条**全量译完（各分 6~7 批：界面层 → 背包与标签 → 物品名 → 命令域 → 物品说明）。俄语是第一个真正用上 4 类复数的语言（`1 блок / 2 блока / 5 блоков / 21 блок`），也顺带修掉德语漏登记复数表导致 `1 Blöcke` 的缺陷。

**贯穿约束怎么保证的**：中文文案零变化 —— P2 的每一处搬家都用"改造前后全量 `itemDescription()` / `translateName()` 输出 diff"证明（216 / 1859 条），diff 均为零。

**条目**（原文照搬）：

# 队列 · 会话 4024a9d46e844ff98176ea9f735ec5ee
> 状态：执行中
> 创建：2026-10-23
> 批次：20261023-2002
> **本批目标（P2~P5 全量收口）**：P0 已把骨架、P1 已把命令域做完（表 864 条，zh/en 各 100%）。
> 这一批把剩下四段一次排完：
> · **P2 数据层**：物品/方块名（构件拼装）、450 条物品说明、75 个生物名、十几个标签表族、逻辑层 reason 串；
> · **P3 界面残留**：触摸控件/提示/编辑器族/其余屏幕/相对时间/静态 HTML/manifest；
> · **P4 四种语言**：德语 → 俄语 → 法语 → 葡语，每语言一批、接入 `LOADERS`、伪语言巡查；
> · **P5 发行**：商店列表文案、per-app language 透传与 `?lang=` 深链、manifest 多语言、真机逐语言过一遍。
>
> **贯穿约束**：中文文案**逐字不变**；每个条目做完都要让 `npm run audit:i18n` 保持 0 缺口，并跑 `check:fast`。
## P2 · 数据层键化
- [x] [P2-1a] 名字表改**惰性求值** + 染料族键化：`itemNames.ts` 的 `NAMES`（id → 中文字符串）改成 `id → () => string`，`translateName()` 调用时才求值；新建 `locales/{zh,en}/item.ts` 放颜色 16 条与染料族 10 个模板（`item.tpl.<family>`），该族 160 条名字由 `tp()` 拼装 → 全量 `ite…
  - 完成：`itemNames.ts` 的 `NAMES` 从 `id → 中文字符串` 改成 `id → string | (() => string)`，`translateName()` 在**取值那一刻**才求值…
- [x] [P2-1b-1] 结构性族键化：木材族（原木/木板/树叶/栅栏/栅栏门/门/活板门/告示牌）、珊瑚族（5 种 × 3 形 × 活/失活）、台阶楼梯墙（建材基 17 + 石材变体 27）、矿石与深层矿石、铜的四档 → 每族一个模板键 + 构件表，英语序按"修饰 + 名词"给 → 全量 `itemLabel()` / `blockLabel()` diff 零差异
  - 完成：`locales/{zh,en}/item.ts` 新增 **84 条键**（构件 68 + 模板 16）…
- [x] [P2-1b-2] 工具与元件族键化：工具（6 材质 × 5 种类）、盔甲（6 材质 × 4 部位）、红石元件 15 条、刷怪蛋（依赖 P2-4 的生物名，先接结构后接名） → 全量 diff 零差异
  - 完成：工具（6 材质 × 5 种类 = 30）、盔甲（6 × 4 = 24）、红石元件 **38 条**（条目里写 15，实测表里 38）、刷怪蛋（21 枚，模板先接）全部键化…
- [x] [P2-1c] 复合名与特例：`STRUCTURE_BASES_CN` 与 `STONE_VARIANT_PARENTS_CN` 两表合并去重、`失活的` 前缀、`磨制`/`平滑`/`苔` 等修饰词按语言可调（德语复合词顺序不同） → 全量 diff 零差异 + `audit:i18n` 0 缺口
  - 完成：做了什么（合并去重）：两张石材表（`STRUCTURE_BASES_CN` 17 + `STONE_VARIANT_PARENTS_CN` 28，其中 4 个 id 重复）合成**一份 `STONE_BASE_IDS`（41）+ 一份 `WALL_BASE_IDS`（28）+ 一个 `stoneBa…
- [x] [P2-2] 显式名收口：`itemNames.ts` 的 `EXPLICIT`（600 条）搬进 `item.<id>`，`translateName` / `blockLabel` / `itemLabel` 全部走查表，删掉中文常量表 → 全量 `itemLabel()` diff 零差异 + `test:i18n`（键都在表里）
  - 完成：**481 条**显式名（条目写 600，实测 481）搬进 `item.<id>`，其中 6 条与红石元件重叠、值相同直接跳过（净增 475）；删掉 `EXPLICIT` 常量表与其循环（约 490 行）…
- [x] [P2-3a] 静态物品说明（前半 114 条）搬进 `locales/{zh,en}/itemDesc.ts`（`item.desc.<id>`），`itemDescription()` 先查语言表、未搬的仍走旧表；三条"直接读表"的判断（`hasDescription` / `knownNameCount` / `missingBlockNames`）改成两处都查 → 216 条说明全量 diff 零差异
  - 完成：229 条静态说明的**前 114 条**搬进独立文件 `locales/{zh,en}/itemDesc.ts`（`item.desc.<id>`，中文逐字照搬、英文首次成文）；两个 `index.ts` 接入 `...itemDesc`…
- [x] [P2-3b] 静态物品说明（后半 115 条）搬进 `itemDesc.ts`，删掉旧表里剩下的条目 → 216 条说明全量 diff 零差异 + 旧 `DESCRIPTIONS` 表清空
  - 完成：后半 **115 条**静态说明追加进 `locales/{zh,en}/itemDesc.ts`，旧 `DESCRIPTIONS` 里这 115 条删干净（静态条目**清零**）。表 1622 → **1737**
- [x] [P2-3c1] 结构性程序说明改模板：深层矿石 / 告示牌 / 混凝土粉末 / 床 / 珊瑚六种形 / 铜四档（含"氧化到下一档""斧头刮回上一档"两句子模板）、展示框与画两条散落文案 → 全部走 `item.desc.tpl.*`，`DESCRIPTIONS` 的值改成惰性函数 → 216 条说明 diff 零差异
  - 完成：**6 个结构性族**（深层矿石 / 告示牌 / 混凝土粉末 / 床 / 珊瑚六形 / 铜四档）+ 展示框与画两条散落文案改走 `item.desc.tpl.*`（**20 条模板**）…
- [x] [P2-3c2] 工具与盔甲说明改模板：`TOOL_TIER_DESC` / `TOOL_KIND_DESC` / `ARMOR_KIND_DESC` 三张说明表 + 材质词 → 模板拼装 → 216 条 diff 零差异
  - 完成：工具 30 条与盔甲 24 条说明改走模板 —— `item.desc.tpl.tool`（材质 + 种类 + 等级 + 速度/攻击/耐久）、`item.desc.tpl.armor`（材质 + 部位 + 护甲值 + 韧性 + 耐久 + 满套合计）、5 条武器种类说明、4 条部位说明、5 档采集等级…
- [x] [P2-3c3] 药水与药箭说明：`potionDescription` / `tippedArrowDescription` 两个构建函数 + 配料清单（依赖 P2-5 的效果名键化，须排在其后） → 216 条 diff 零差异；`DESCRIPTIONS` 常量整表删除
  - 完成：**30 条效果名**进新文件 `locales/{zh,en}/label.ts`（`label.effect.*`，P2-5 的其余标签族也进这个文件）；`StatusEffects.EFFECT_LABELS` 常量表删除、`effectLabel()` 改成查表…
- [x] [P2-4] 生物名：75 个 `MobType.name` → `entity.<id>`，`MobNameTag` 的画字路径同步（canvas `fillText` 要确认西里尔/变音字形） → `test:entity` + 全量名称 diff 零差异
  - 完成：**75 条**生物名进新文件 `locales/{zh,en}/entity.ts`（键就是 `MobType.id`：`entity.zombie` / `entity.slime_big` / `entity.ender_dragon`…）…
- [x] [P2-5] 标签表族（一）：职业与等级、附魔、状态效果、群系、维度、世界类型 → `label.<kind>.<value>`；每张表改成查表函数 → `test:i18n` 断言"每张表的每个枚举值都有键"
  - 完成：**114 条**标签键进 `locales/{zh,en}/label.ts` —— 维度 3 / 世界类型 5 / 群系 50 / 附魔 38 / 村民等级 5 / 职业 13…
- [x] [P2-6] 标签表族（二）：音效组、外观 10 张、朝向、旗帜图案、配方书页签、物品类别 → 同上 → 同上
  - 完成：**78 条**标签键进 `label.ts` —— 音效组 6 / 外观 10 张共 46 / 朝向 6 / 旗帜图案 5 / 配方书页签 5 / 物品类别 10…
- [x] [P2-7] 逻辑层 reason 串：`Loom`「没有这种图案」、`StationNeed.label`、容器红底原因等，返回**键**由界面层 `t()` → `test:loom` / `test:crafting` / `test:i18n` 全绿
  - 完成：新增 `src/core/container/reason.ts`（`ReasonRef` + `reason()` + `reasonText()`）；**7 个容器类**的 **22 条**中文原因改成 `reason('station.reason.*')`（4 条带参数）…
## P3 · 界面残留
- [x] [P3-1] 触摸与提示：`TouchControls`（潜行 / 向上飞 / 向下飞）、`Tooltip`（不可堆叠 / 最多 N 个）、`LoadingOverlay`、`Fullscreen`、`InstallHint` → 各文件"无中文字面量"断言
  - 完成：**18 条键**（`touch.*` 4 + `touch.icon.*` 6 + `tooltip.*` 2 + `loading.world/failed` + `stickMode.*`/`handedness.*` 4）…
- [x] [P3-2] 编辑器族：`BookScreen`、`SignEditor`、`NameTagEditor`、`CommandBlockEditor` → 同上
  - 完成：**16 条键**进 `editor.ts`（`editor.ok/cancel/done/close/back/sign` 6 条共用按钮；`book.writingTitle/writePlaceholder/titlePlaceholder/emptyPage/pageOf` 5 条…
- [x] [P3-3] 其余屏幕：`BeaconScreen`、`UnsupportedScreen`、`StatisticsScreen` → 同上
  - 完成：**11 条键**——`beacon.*` 6 条（主效果 / 次级效果 / 次级主效果 / 两条等级门槛 / 效果等级说明）、`unsupported.*` 3 条（标题 / 刷新 / 诊断码）、`statistics.closeAria` 与 `statistics.blocks`；改 **3 …
- [x] [P3-4] 时间与静态资源：`relativeTime` 改 `Intl.RelativeTimeFormat`、`index.html` 首屏文案、`manifest.webmanifest` 的 name/description → `test:i18n`（HTML 里不许写死）+ 首屏截图
  - 完成：① `relativeTime()` 改走 **`Intl.RelativeTimeFormat`**（老 WebView 缺 API 时退成 `3 min`）；② `formatPlayTime()` 与 WorldScreen 那句"上次游玩…已玩…"的单位与语序进表（`time.*` 6 条）…
- [x] [P3-5] 伪语言巡查收口：把 P3-1~P3-4 触过的界面在 `?lang=xa` 下扫一遍，"没被 ⟦⟧ 包住"的只剩语言中性项 → 巡查清单写进完成说明
  - 完成：把 P3-1~P3-4 触过的界面在**伪语言**下逐个渲染了一遍（不开浏览器，直接调 `t()`），并把结果写成断言。**P3 自己的键共 63 条，0 条漏包**；漏包的只剩走 Intl 的两处（见下表）。顺带修掉一个真 bug：`tn()` 绕过伪语言
    | 界面 | 文案来源 | 结果 |
    | --- | --- | --- |
    | `TouchControls` / `TouchIcons` | `touch.*` 10 条 | 全包住 |
    | `Tooltip` 的 meta 行（不可堆叠 / 最多 N 格） | `tooltip.*` 2 条 | 全包住 |
    | `LoadingOverlay`（含启动失败） | `loading.*` 4 条 | 全包住 |
    | 四个编辑器（书 / 告示牌 / 名字牌 / 命令方块） | `editor.*` `book.*` `sign.*` `nameTag.*` `commandBlock.*` 共 18 条 | 全包住 |
    | `BeaconScreen`（四行标签 + 三句提示） | `beacon.*` 7 条 | 全包住 |
    | `UnsupportedScreen`（标题 / 刷新 / 诊断码） | `unsupported.*` 3 条 | 全包住 |
    | `StatisticsScreen`（含移动距离的复数） | `statistics.*` 9 条 | 全包住 |
    | `WorldScreen` 的"上次游玩 … · 已玩 …" | `time.*` 6 条 | 整句包住；内嵌的 `relativeTime()` 不包（见下） |
    | 摇杆模式 / 惯用手下拉 | `label.stickMode.*` `label.handedness.*` 4 条 | 全包住 |
    | `relativeTime()` | **Intl.RelativeTimeFormat** | **不包** —— 它不经过 `t()`，语言由 CLDR 给 |
    | `joinList()` | **Intl.ListFormat** | **不包** —— 同上（P0-6 那次改造的既有结论） |
  - 完成：🔴 **巡查当场抓到一个真 bug**：`tn()` 是"直接读表 + 替换占位符"（不走 `t()`），**伪语言包装被整个跳过了** —— `tn('statistics.blocks', 3)` 在 `?lang=xa` 下返回 `3 格` 而不是 `⟦3 格⟧`。这会让巡查把它误判成"没接 …
## P4 · 四种语言
- [x] [P4-1a] 德语表：`locales/de/` 全量（与 zh 同构分组 + `satisfies Messages`），`LOADERS` 加一行 → `test:i18n` 覆盖率 100% + `check:fast`；**最长串**截图 diff
  - 完成：建齐 `locales/de/` **15 个分组**（键集由 `satisfies` 卡在 typecheck）+ `de/index.ts` + `LOADERS` 一行；**真翻 8 个界面分组共 400 条**（menu 33 / settings 80 / misc 46 / progre…
    ① `可选语言 = 有表的那些` → 改成"**每个可选语言都能真的拿到表**（静态表或可加载）"（P0-7 起可选清单 = 有表 或 有加载器，旧关系式不再成立）
    ② ③ 两条拿 `de` 当"没装表"例子的断言 → 改用 `ru`
    ④ P0-7 那段"用假语言验证加载链"的块 → 假语言从 `de` 换成 `ru`（de 现在有真表，再拿它当假的会自相矛盾）
  - 完成：新增守卫（`test:i18n` +6 条）：德语可加载 / 进了可选清单 / 表条数与中文相同 / 6 个界面分组的代表键**真的是德语** / 德语全表不含中文
- [x] [P4-1b] 德语·界面第二批：`inventory`（122）与 `label`（226）→ 348 条真德语；`audit:i18n` 的"已翻"涨到约 750
  - 完成：`inventory`（122 条：背包/工作站槽位、提示、21 个面板标题）与 `label`（226 条：状态效果 31 / 群系 58 / 附魔 44 / 职业 13 / 外观 46 / 朝向 / 图案 / 页签 / 类别…）翻成德语；德语表的占位分组从 7 个降到 **5 个**（`cmd`…
- [x] [P4-1c1] 德语·构件与模板 + 生物名：`item` 的构件表（color 16 / wood 6 / coral 5 / base 35 / ore 8 / copper 8 / toolMaterial 6 / toolKind 5 / armorMaterial 6 / armorType 4）与 29 条模板 + `entity` 全部 75 条 → 203 条；`audit:i18n` 的"已翻"涨到 92…
  - 完成：`item` 的**构件表与模板**（颜色 16 / 木材 6 / 珊瑚 5 / 石材基 35 / 矿石 8 / 铜 8 / 工具材质 6 / 工具种类 5 / 盔甲材质 6 / 盔甲部位 4 + 29 条模板）与 **`entity` 全部 75 条**译成德语，共 **203 条**；`item…
- [x] [P4-1c2] 德语·显式物品名：`item` 里剩下的 **516 条**（`item.dirt` / `item.cobblestone` …，每个都是独立名词、没有构件可用）→ `notes/i18n-de.md` 的 item 组转 ✅、`audit:i18n` 的"已翻"到约 1440
  - 完成：`item` 里剩下的 **516 条显式物品名**全部译成德语（方块 / 物品 / 工具 / 食物 / 药水材料 / 16 色旗帜·带釉陶瓦·蜡烛 / 作物生长阶段 / 唱片…）→ `item` 组 **644/644 收口**，德语占位分组清零
- [x] [P4-1d] 德语·命令域：`cmd`（243）与 `cmdMessages`（170）→ 413 条；**必须保留 `<>` `[]` `|`**（test:i18n 有"<>/[] 个数中英一致"的断言）
  - 完成：`cmd`（243 条：72 条用法/说明 + 110 条帮助面板短语与值标签 + 14 条整屏 + 40 条回执里嵌的标签表）与 `cmdMessages`（170 条回执）全部译成德语；**德语占位分组只剩 `itemDesc` 一个**
- [x] [P4-1e1] 德语·物品说明前半：`item.desc.tpl.*` **57 条模板**（工具 / 盔甲 / 铜氧化 / 珊瑚 / 告示牌 / 床 / 药水句式 / 刷怪蛋…） + 方块与工具材料那 **144 条静态说明** → `audit:i18n` 的"已翻"涨到 2017
  - 完成：`item.desc` 里 **57 条模板** + **144 条静态说明**（材料 / 方块 / 工具 / 食物前半）译成德语 → `itemDesc` 组 201/288；表里 `item.desc.*` 共 201 条德语
- [x] [P4-1e2] 德语·物品说明后半：`item.desc` 剩下的 **87 条**（作物生长 / 海洋 / 下界 / 末地 / 药水材料那几族）→ `notes/i18n-de.md` 标 100%、`audit:i18n` 的"已翻"到约 2100
  - 完成：`item.desc` 剩下的 **87 条**静态说明译完（作物生长 / 海洋与钓鱼 / 红石元件 / 容器 / 桶与细雪 / 音符盒 / 漏斗与投掷器 / 地图·时钟·指南针 / 盾牌 / 烟花 / 书与笔 / 展示框与画）→ **`itemDesc` 288/288，德语占位分组清零**
- [x] [P4-2a] 俄语骨架 + 界面层：建齐 `locales/ru/` 15 个分组（`satisfies Messages` 卡住）+ `ru/plural.ts`（6 条三形式）+ `LOADERS` 加 `ru` + `PLURAL_TABLES` 登记；真翻 8 个界面分组共 400 条（menu 33 / settings 80 / misc 46 / progress 26 / editor 54 / chat …
  - 完成：建齐 `locales/ru/` **15 个分组** + `ru/index.ts` + `ru/plural.ts`；`LOADERS` 加 `ru`；`PLURAL_TABLES` 登记 `de` / `ru`；**真翻 8 个界面分组共 400 条**（menu 33 / settings …
- [x] [P4-2b] 俄语·界面第二批：`inventory`（122）与 `label`（226）→ 348 条
  - 完成：`inventory`（122：背包/工作站槽位、提示、23 个面板标题）与 `label`（226：效果 30 / 群系 58 / 附魔 37 / 职业 13 / 外观 46 / 朝向 / 图案 / 页签 / 类别）翻成俄语；俄语占位分组降到 5 个（cmd / cmdMessages / ite…
- [x] [P4-2c1] 俄语·构件与模板 + 生物名：`item` 的构件表（color 16 / wood 6 / coral 5 / base 35 / ore 8 / copper 8 / toolMaterial 6 / toolKind 5 / armorMaterial 6 / armorType 4）与 29 条模板 + `entity` 全部 75 条 → 203 条
  - 完成：`item` 的**构件与模板 128 条** + **`entity` 75 条**（共 203）翻成俄语；`item` 走"部分翻译"模式（128/644），剩 516 条显式名拆进 P4-2c2
- [x] [P4-2c2] 俄语·显式物品名：`item` 里剩下的 **516 条**（`item.dirt` / `item.cobblestone` …，每个都是独立名词、没有构件可用）→ `notes/i18n-ru.md` 的 item 组转 ✅
  - 完成：`item` 里剩下的 **516 条显式物品名**全部译成俄语（方块 / 红石元件 / 16 色旗帜·带釉陶瓦·蜡烛 / 作物阶段 / 食物 / 药水材料 / 唱片…）→ `item` **644/644 收口**；俄语占位只剩 `cmd` / `cmdMessages` / `itemDesc`…
- [x] [P4-2d] 俄语·命令域：`cmd`（243）与 `cmdMessages`（170）→ 413 条；**必须保留 `<>` `[]` `|`**（照抄德语那条守卫）
  - 完成：`cmd`（243：72 条用法/说明 + 110 条帮助面板短语与值标签 + 14 条整屏 + 40 条标签表）与 `cmdMessages`（170 条回执）全部译成俄语；俄语占位只剩 `itemDesc`；`audit:i18n` 的 ru 已翻 1480 → **1878**
- [x] [P4-2e1] 俄语·物品说明前半：`item.desc.tpl.*` **57 条模板**（工具/盔甲/铜氧化/珊瑚/告示牌/床/药水句式/刷怪蛋…）+ 材料与方块/工具/食物 **144 条静态说明** → `itemDesc` 201/288
  - 完成：`item.desc` 的 **57 条模板** + **144 条静态说明**（材料 / 方块 / 工具 / 食物）译成俄语 → `itemDesc` **201/288**；`itemDesc` 走"部分翻译"模式，剩 87 条拆进 P4-2e2
- [x] [P4-2e2] 俄语·物品说明后半：`itemDesc` 剩下的 **87 条**（作物生长 / 海洋 / 下界 / 末地 / 药水材料）→ 全部翻完后 `notes/i18n-ru.md` 标 100%
  - 完成：`itemDesc` 剩下的 **87 条**静态说明译完（弓与钓鱼 / 矿石 / 红石元件 / 容器 / 桶与细雪 / 音符盒 / 漏斗与投掷器 / 地图·时钟·指南针 / 盾牌 / 烟花 / 书与笔 / 展示框与画）→ **`itemDesc` 288/288，俄语 100% 译完**
## 里程碑 MS1 · 俄语（ru）100% 译完
- 验收：`npm run audit:i18n && npm run test:i18n && npm run check:fast`（期望 `ru 已翻 2163`、0 孤儿、332/0、全绿）
- 确认：已验收（2026-10-23，三条命令全绿：audit 2163 · i18n 332/0 · check:fast 全绿）

---
