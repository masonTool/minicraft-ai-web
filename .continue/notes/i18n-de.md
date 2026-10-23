# 德语（de）翻译进度

> 多语言 P4 阶段的台账：**哪些分组已经真翻、哪些还是英文占位**。
> `npm run audit:i18n` 的「覆盖率」段会按"值是否逐字等于英文"算出同一份数字（`已翻 / 疑似未翻`），
> 两者是同一口径 —— 别只看 100%（那只说明"键齐了"）。

## 现在是什么状态

| 分组 | 条数 | 状态 |
| --- | --- | --- |
| `menu` | 33 | ✅ 德语 |
| `settings` | 80 | ✅ 德语 |
| `misc` | 46 | ✅ 德语 |
| `progress` | 26 | ✅ 德语 |
| `editor` | 54 | ✅ 德语 |
| `chat` | 18 | ✅ 德语 |
| `minigame` | 37 | ✅ 德语（含 10 步新手引导） |
| `station` | 106 | ✅ 德语（工作站 / 容器 / 信标） |
| `inventory` | 122 | ✅ 德语 |
| `cmd` | 243 | ✅ 德语 |
| `cmdMessages` | 170 | ✅ 德语 |
| `item` | 644 | ✅ 德语（构件 128 + 显式名 516） |
| `itemDesc` | 288 | ⬜ 英文占位 |
| `label` | 226 | ✅ 德语 |
| `entity` | 75 | ✅ 德语 |

合计 **2168 条**：已翻 **1819**、占位 349（`audit:i18n` 的「已翻 / 疑似未翻」就是这个口径 ——
它按"值是否逐字等于英文"判，所以个别中英德本来就相同的键（`Bob`、`Normal`、`Diagonal`…）
会被算进"疑似未翻"，742 条已翻里实测报 741 就是这个原因）。

## 为什么分批

一条德语行看着短，但**物品名与物品说明是 932 条专名与长文**（`item` 644 + `itemDesc` 288），
外加 `cmd` / `cmdMessages` 那 413 条命令文案 —— 一次做完必然质量崩。

分批的顺序按"玩家第一眼看到什么"排：菜单 → 设置 → 背包/工作站 → 物品名 → 物品说明 → 命令。当前做完的是前两档。

## 还差的一批

**`itemDesc`**（288 条长文）：最贵的一批，建议单独一个批次，按方块 / 工具 / 食物 / 药水分四份过。

⚠️ 命令域那批留下了一条**给后续语言复用**的守卫：`test:i18n` 里
「德语用法串的 `<>` / `[]` / `|` 与中文一致」—— 帮助面板靠这些符号拆变体，
少一个括号**不会报错、只是表单变空**。加 pt / fr / ru 时照抄这条（把 de 换成新语言码）。

## 加一种语言的完整步骤（留给 pt / fr / ru 照抄）

1. 复制 `src/core/i18n/locales/zh/`（或 `de/`）到 `locales/<code>/`，逐组改值 —— 键**不要动**；
   每个分组文件都用 `satisfies Pick<Messages, keyof typeof zhXxx>` 收口，漏一条编译不过。
2. `locales/<code>/index.ts` 合成并 `satisfies Messages`。
3. `I18n.ts` 的 `LOADERS` 加一行：`<code>: () => import('./locales/<code>/index.ts'),`。
4. 如果这种语言要进设置页下拉，`LOCALES` 里本来就有它（6 种已登记），无需再改。
5. `public/manifest.<code>.webmanifest`（目前只有 zh / en；其余语言回落英文那份）。
6. `npm run audit:i18n` 看「已翻 / 疑似未翻」；`npm run test:i18n` 有 30+ 条语言相关断言会兜底。

## 德语的三个已知限制（都是"模板拼名"带来的，不是漏翻）

1. **颜色族用复合词、不用形容词**：`Weißwolle` / `Orangebett` 而不是 `Weiße Wolle`。
   理由：形容词要按名词的性与格变格（weiß/weiße/weißes/weißer），而我们的模板对 16 色 × 10 族只放一个
   `{color}`。复合词在德语里**永远不算错**，变格一旦拼错反而更糟。
2. **`{base}stufe` / `{base}treppe` / `{base}mauer` 的形容词不跟着变**：
   `Polierter Granitstufe`（应为 `Polierte Granitstufe`）、`Glatter roter Sandsteinstufe`（应为 `Glatte rote`）。
   受影响的是 base 里**带形容词的那 17 个**（polished / smooth / cut / mossy / dark / red 等）× 3 种变体 ≈ 51 个名字。
   要从根上修，得给这 51 个 id 单独写德语全名 —— 但键空间由中文表决定（`satisfies` 要求键集一致），
   所以要么中文表也加这些键（等于承认"模板拼不出来"），要么接受。
3. **工具与盔甲反而是对的**：`Holzspitzhacke` / `Eisenbrustplatte` / `Netheritstiefel` 都是标准德语复合词，
   因为它们的构件（材质 + 种类）都不带形容词。
4. **16 色的旗帜 / 带釉陶瓦 / 蜡烛用"名词（颜色）"形式**（`Banner (Weiß)` / `Keramikfliese (Weiß)` /
   `Kerze (Weiß)`），而羊毛/床/混凝土那几族是复合词（`Weißwolle`）。前者是**显式名**、可以手写；
   后者是**模板生成**、只能复合。两套写法在界面上会挨着出现，这是已知的不一致，接受它的理由是
   语法正确 > 风格统一 —— `Weißes Banner` 这类形容词变格手写 16×3 次容易错，而复合词对它们是错的。
