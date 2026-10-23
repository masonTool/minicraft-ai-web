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
| `item` | 644 | ✅ 葡语（构件 128 + 显式名 516） |
| `entity` | 75 | ✅ 葡语 |
| `cmd` | 243 | ✅ 葡语 |
| `cmdMessages` | 170 | ✅ 葡语 |
| `itemDesc` | 288 | 🟡 部分：模板 57 + 材料/方块/工具/食物 145 条已翻，**86 条仍是英文** |

合计 **2168 条**：已翻 **2082**（审计报 2035 —— `audit:i18n` 按"值是否逐字等于英文"判，`Normal` / `TNT` 这类会被算成未翻）。

## 条目点名的三件事，都已坐实

1. **`htmlLang` 是 `pt-BR`，不是 `pt`** —— `locale.ts:30` 就写着 `htmlLang: 'pt-BR'` / `intlLocale: 'pt-BR'`，
   `applyLanguageSetting()` 会把它写进 `<html lang>`。断言在 `test:i18n`（"localeMeta 能取回元数据（含带地区的 htmlLang）"）。
2. **连接词交给 CLDR**：`Intl.ListFormat('pt-BR', { type:'conjunction' })` 给的是 **`A, B e C`**（最后一项用 `e`），
   不用手写。断言：「葡语用 e → `A, B e C`」。
3. **0 算单数**：`Intl.PluralRules('pt-BR').select(0) === 'one'` → **`0 bloco`**，与法语同构、与英语相反。
   `locales/pt/plural.ts` 登记了 6 条，断言盯具体数字：`0 bloco | 1 bloco | 2 blocos | 5 blocos`。

## 还差的批次

**`itemDesc` 剩下的 86 条**（作物阶段 / 海洋 / 下界 / 末地 / 药水材料）—— P4-4e2

## 葡语拼名：预判与实测一致（P4-4c1 已落地）

| 族 | 葡语写法 | 结论 |
| --- | --- | --- |
| 颜色 10 族 | `Lã (branco)` / `Cama (laranja)` | ❌ 不能用 `Lã branca`：形容词要与名词性数配合，模板对 16×10 只放一个 `{color}` → **括号归属式**（与俄语同） |
| 木材 / 珊瑚 / 工具 / 盔甲 | `Tábuas de carvalho` / `Bloco de coral tubular` / `Picareta de diamante` / `Peitoral de netherita` | ✅ `de + 名词` 天然成立 |
| 台阶/楼梯/墙 | `Laje de pedra` / `Escada de pedra` / `Muro de pedra` | ✅ 同上 |
| 深层矿石 / 失活珊瑚 | `Minério de ferro (ardósia profunda)` / `Coral tubular morto` | 深层用括号（避免句中大写），失活用**后置** `morto` |

⚠️ 已知外观瑕疵（与法语同一个）：木板类基名是独立物品名、首字母大写，所以拼出来是
`Escada de Tábuas de carvalho`（句中大写），受影响 6 木材 × 3 变体 = 18 个名字。键空间由中文表决定，
要修得让"独立名"与"构件名"分开存，代价大于收益 —— 接受。

## 加一种语言的完整步骤（pt 已照此走完前 4 步）

1. `locales/<code>/` 建齐 15 个分组（`satisfies Messages` 卡住键集）+ `index.ts`（`satisfies Messages`）
2. 有复数变格的语言加 `locales/<code>/plural.ts`，并在 `I18n.ts` 的 `PLURAL_TABLES` 登记
3. `I18n.ts` 的 `LOADERS` 加一行（按需加载）
4. `notes/i18n-<code>.md` 建台账，逐组标 ✅/⬜
5. 分批翻译 + 每批加抽查断言（**期望值逐字抄自表里的值**，不要凭记忆写）
6. 收尾时按组统计「值等于英文」的条数：**一个组整组相等 = 整组漏了**（法语 `label` 就是这么漏的）
7. 每加一种真实语言，`test:i18n` 里"没装表的语言"的例子要往后挪一格；六种语言都有表之后
   只能造一个码（`'xx' as LocaleCode`），并断言**它不会漏进语言选择器**

## 16 色三族按名词性别手写（P4-4c2）

三族都是**显式名**，可以逐条写对，所以没走括号归属式：

| 族 | 名词性别 | 写法 |
| --- | --- | --- |
| 旗帜 | `estandarte` 阳性 | `Estandarte branco` / `Estandarte azul-claro` / `Estandarte roxo` |
| 带釉陶瓦 | `argila (cozida)` 阴性 | `Argila cozida esmaltada branca` / `… azul-clara` / `… vermelha` |
| 蜡烛 | `vela` 阴性 | `Vela branca` / `Vela amarela` / `Vela preta` |

对比：模板生成的族（羊毛/床/混凝土…）只能给 `Lã (branco)` —— 一个 `{color}` 服务不了 10 个名词。
这是"显式名手写、模板名括号"这条既有结论的第四次应用。

## 命令域的括号守卫（P4-4d）

四种语言现在**各有一条**同样的断言，盯的都是：**用法串里的 `<>` `[]` `|` 个数与中文一致**。
帮助面板靠这些符号拆变体 —— 少一个括号**不会报错，只是表单变空**。
德语（P4-1d）、俄语（P4-2d）、法语（P4-3e）、葡语（P4-4d）各一条；加新语言时照抄即可。
