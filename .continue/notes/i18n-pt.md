# 葡语（巴西，pt-BR）翻译进度

> 多语言 P4-4 的台账：**哪些分组已经真翻、哪些还是英文占位**。
> `npm run audit:i18n` 的「覆盖率」段按"值是否逐字等于英文"算同一份数字。

## 现在是什么状态

| 分组 | 条数 | 状态 |
| --- | --- | --- |
| `menu` | 33 | ✅ 葡语（含 `world.*` 新建/编辑世界） |
| `misc` | 46 | ✅ 葡语（暂停 / 全屏 / 安装提示 / 死亡 / 睡觉 / 触摸 / 时间 / 载入） |
| `chat` | 18 | ✅ 葡语（含 `command.*` 六条报错） |
| `progress` | 26 | ✅ 葡语（统计 / 成就 / 地图） |
| `settings` | 80 | ✅ 葡语（含两条跨行的桌面/触摸帮助） |
| `editor` | 54 | ✅ 葡语（书与笔 / 告示牌 / 名字牌 / 命令方块 / 建造工具） |
| `minigame` | 37 | ✅ 葡语（含 10 步新手引导） |
| `station` | 106 | ✅ 葡语（工作站 / 容器 / 回执） |
| `inventory` | 122 | ✅ 葡语 |
| `label` | 226 | ✅ 葡语 |
| `item` | 644 | ⬜ 英文占位 |
| `entity` | 75 | ⬜ 英文占位 |
| `cmd` | 243 | ⬜ 英文占位 |
| `cmdMessages` | 170 | ⬜ 英文占位 |
| `itemDesc` | 288 | ⬜ 英文占位 |

合计 **2168 条**：已翻 **748**（审计报 745 —— `audit:i18n` 按"值是否逐字等于英文"判，`Normal` / `TNT` 这类会被算成未翻）。

## 条目点名的三件事，都已坐实

1. **`htmlLang` 是 `pt-BR`，不是 `pt`** —— `locale.ts:30` 就写着 `htmlLang: 'pt-BR'` / `intlLocale: 'pt-BR'`，
   `applyLanguageSetting()` 会把它写进 `<html lang>`。断言在 `test:i18n`（"localeMeta 能取回元数据（含带地区的 htmlLang）"）。
2. **连接词交给 CLDR**：`Intl.ListFormat('pt-BR', { type:'conjunction' })` 给的是 **`A, B e C`**（最后一项用 `e`），
   不用手写。断言：「葡语用 e → `A, B e C`」。
3. **0 算单数**：`Intl.PluralRules('pt-BR').select(0) === 'one'` → **`0 bloco`**，与法语同构、与英语相反。
   `locales/pt/plural.ts` 登记了 6 条，断言盯具体数字：`0 bloco | 1 bloco | 2 blocos | 5 blocos`。

## 还差的批次（按顺序）

1. **`item` + `entity`**（719 条，先构件与模板再逐条过显式名）—— P4-4c
2. **`cmd` + `cmdMessages`**（413 条，⚠️ 必须保留 `<>` `[]` `|`）—— P4-4d
3. **`itemDesc`**（288 条长文，分两批过）—— P4-4e

## 葡语拼名的预判（照前三门语言的结论）

| 族 | 葡语写法 | 理由 |
| --- | --- | --- |
| 颜色 10 族 | `Lã branca` / `Cama laranja` | 形容词要与名词的性数配合（`lã` 阴、`tapete` 阳），一个 `{color}` 服务不了 10 个名词 |
| 木材 / 珊瑚 / 工具 / 盔甲 | 模板可拼（`Tábuas de carvalho`、`Picareta de diamante`） | 介词结构天然成立 |
| 台阶/楼梯/墙 | `Laje de pedra` / `Escada de pedra` / `Muro de pedra` | 同上 |

⚠️ 到 P4-4c 落地时以实际渲染结果为准，与德语/俄语/法语那三份台账对照。

## 加一种语言的完整步骤（pt 已照此走完前 4 步）

1. `locales/<code>/` 建齐 15 个分组（`satisfies Messages` 卡住键集）+ `index.ts`（`satisfies Messages`）
2. 有复数变格的语言加 `locales/<code>/plural.ts`，并在 `I18n.ts` 的 `PLURAL_TABLES` 登记
3. `I18n.ts` 的 `LOADERS` 加一行（按需加载）
4. `notes/i18n-<code>.md` 建台账，逐组标 ✅/⬜
5. 分批翻译 + 每批加抽查断言（**期望值逐字抄自表里的值**，不要凭记忆写）
6. 收尾时按组统计「值等于英文」的条数：**一个组整组相等 = 整组漏了**（法语 `label` 就是这么漏的）
7. 每加一种真实语言，`test:i18n` 里"没装表的语言"的例子要往后挪一格；六种语言都有表之后
   只能造一个码（`'xx' as LocaleCode`），并断言**它不会漏进语言选择器**
