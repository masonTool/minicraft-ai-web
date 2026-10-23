# 法语（fr）翻译进度

> 多语言 P4-3 的台账：**哪些分组已经真翻、哪些还是英文占位**。
> `npm run audit:i18n` 的「覆盖率」段按"值是否逐字等于英文"算同一份数字。

## 现在是什么状态

| 分组 | 条数 | 状态 |
| --- | --- | --- |
| `menu` | 33 | ✅ 法语（含 `world.*` 新建/编辑世界） |
| `misc` | 46 | ✅ 法语（暂停 / 全屏 / 安装提示 / 死亡 / 睡觉 / 触摸 / 时间 / 载入） |
| `chat` | 18 | ✅ 法语（含 `command.*` 六条报错） |
| `progress` | 26 | ✅ 法语（统计 / 成就 / 地图） |
| `settings` | 80 | ✅ 法语 |
| `inventory` | 122 | ✅ 法语 |
| `station` | 106 | ✅ 法语 |
| `editor` | 54 | ✅ 法语 |
| `minigame` | 37 | ✅ 法语 |
| `label` | 226 | ⬜ 英文占位 |
| `item` | 644 | ✅ 法语（构件 128 + 显式名 516） |
| `entity` | 75 | ✅ 法语 |
| `cmd` | 243 | ✅ 法语 |
| `cmdMessages` | 170 | ✅ 法语 |
| `itemDesc` | 288 | 🟡 部分：模板 57 + 材料/方块/工具/食物 145 条已翻，**86 条仍是英文** |

合计 **2168 条**：已翻 **1856**（审计报 1783，少 73 条是"法语写法恰好与英文相同"的，如 `Normal`、`Creeper`、`Blaze`、`TNT`，以及 86 条还没翻的物品说明）。

## 法语的三处特殊处理

1. **0 算单数**：`Intl.PluralRules('fr').select(0) === 'one'` —— `0 bloc` 而不是 `0 blocs`。
   这与英语相反，照英语写复数表必然错。`locales/fr/plural.ts` 登记了 6 条
   （`statistics.blocks` / 四条 `buildtools.*.done` / `station.brewLeft`），
   断言盯具体数字：`0 bloc | 1 bloc | 2 blocs | 5 blocs`。
2. **撇号**：法语里 `l’` / `d’` / `qu’` 极多。值里统一用**排版撇号 `’`**（生成脚本 `esc()` 里统一替换），
   既不用转义，也符合排版惯例；`test:i18n` 有一条"已翻的键里不许出现 ASCII 撇号"的断言。
3. **过去分词要配合**：`1 bloc rempli` / `3 blocs remplis`。所以四条 `buildtools.*.done` 的两种形式是
   **整句写出来的**，不是拼名词 —— 与俄语那批同一个理由。

## 还差的批次

**`itemDesc` 剩下的 86 条**（作物阶段 / 海洋 / 下界 / 末地 / 药水材料）—— 前半已翻，最后一批。

## 提取原文时的一个坑（P4-3b 撞到的）

中文表里有几条**值写在下一行**（跨行定义）：

```ts
'settings.helpDesktop':
  '<kbd>WASD</kbd> 移动 · …',
```

用"`键: 值` 一行一个"的正则去列原文，**这三条会被静默漏掉**（`settings.helpDesktop` / `settings.helpTouch` /
`station.dropperCycle`），直到生成脚本的 `satisfies` 或"缺 N 条"断言才暴露。列原文时只用正则抓**键名**
（`^\s+'([^']+)':`），值另取——键名永远在行首，值可能在下一行。

## 法语拼名的第四个处理：颜色用"名词（颜色）"，木材用 `de/en + 名词`

| 族 | 法语写法 | 为什么 |
| --- | --- | --- |
| 颜色 10 族 | `Laine (blanc)` / `Lit (orange)` | 法语形容词要与名词的性数配合（`laine blanche` / `lit orange`），一个 `{color}` 服务不了 10 个名词 |
| 木材 8 形态 | `Planches de chêne` / `Barrière en chêne` / `Bûche de chêne` | 名词 + `de/en` 结构天然成立，不需要变格 |
| 珊瑚 3 形态 | `Bloc de corail tubulaire` / `Corail tubulaire mort` | 五个珊瑚形容词都是规则形式，成立 |
| 工具 / 盔甲 | `Pioche en diamant` / `Plastron en netherite` | `en + 材质`，成立 |
| 台阶/楼梯/墙 | `Dalle de roche lisse` / `Escalier en roche lisse` | 基名是小写名词短语，成立 |

⚠️ **已知外观瑕疵**：木板类基名（`planches de chêne`）本身是**独立物品名**、首字母大写，
所以拼出来是 `Dalle de Planches de chêne noir`、`Escalier en Planches de chêne` —— 句中大写。
受影响 6 种木材 × 3 变体 = **18 个名字**。要修得让"独立名"与"构件名"分开存（键空间由中文表决定，
`satisfies` 要求键集一致），代价大于收益，**接受**（与俄语那批括号内大写同一个处置）。

## 命令域那条守卫（P4-3e）

三种语言各有一条独立断言，盯的是同一件事：**用法串里的 `<>` `[]` `|` 个数与中文一致**。
帮助面板靠这些符号拆变体 —— 少一个括号**不会报错，只是表单变空**。
德语（P4-1d）、俄语（P4-2d）、法语（P4-3e）各一条；加葡语时照抄即可。
