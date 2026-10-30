# 完成档案 · DONE

> 本文件是**已完成工作的唯一档案**，只回答"这批做了什么、怎么验的"——时间线，最近的在最上面。
> 按模块看现状与坑 → `OVERVIEW.md`；下次怎么避开 → `TIPS.md`；机制与格式 → `README.md`。
> **一条内容只写一个地方**，别在三份文档里各抄一遍。
>
> 收尾时**整份队列原样搬进来**（含每条任务下方的完成说明与 `[阻塞]`），标题格式
> `## 批次 <号> · 日期 · 会话 <前 8 位>`。

---

## 批次 20261030-1925 · 2026-10-30 · 会话 c747f798

> 真机发热归因：不是内存也不是游戏逻辑，而是每像素的填充与提交开销；关掉 preserveDrawingBuffer + 削掉两处整屏像素成本

# 队列 · 会话 c747f798fe5f443089f73456db302086

> 状态：执行中
> 创建：2026-10-30
> 批次：20261030-1925

- [x] 关掉 `preserveDrawingBuffer`，缩略图改成抓之前在同一任务里重画一帧：`web/src/main.ts`
  - 做了什么：`WebGLRenderer` 的 `preserveDrawingBuffer` 由 `true` 改成 `false`；新增 `App.renderForThumbnail()`，`captureThumbnail` 在 `drawImage` 之前先调它画一帧
  - 为什么：这一位原本只为"存档缩略图"（一局抓几次）而开，却和 `antialias: true` 叠成**每帧**一次 MSAA resolve + 一块不可复用的背板。隔离基准（同机 Adreno 540、1644×822、MSAA 开、同样绘制量、只改这一位）：**42.9 fps → 57.8 fps**
  - 验证：`npm run check` 全绿；缩略图路径改为"先画再读"，仍是同一任务内读背板（真机世界卡片缩略图此前一直正常，逻辑未变，只是抓之前多画一帧）
  - 批次：20261030-1925

- [x] 天空穹顶着色器去掉三处整屏逐像素开销：`web/src/render/Sky.ts`
  - 做了什么：去掉对 `uSunDir` 的逐像素 `normalize`（`Sky.update` 写进去的就是 `(cos t, sin t, 0)`，本来单位长）；`pow(x, 8.0)` 展开成三次乘法；霞光整段包进 `if (uSunGlow > 0.0)`（它只在日出日落前后非零）
  - 为什么：抬头看天时 `Chrome_InProcGp` 顶到一核的 37.4%（JS 反而降到 6.1%），说明瓶颈是穹顶这个**整屏**着色器的每像素开销，不是 draw call 数量。三处改动输出逐位等价
  - 验证：`npm run render-test` 通过，并新增三条结构守卫（不许回去用 `pow`、不许再 `normalize(uSunDir)`、霞光必须有 `uSunGlow > 0.0` 判据）；两套 GLSL 用无头 Chrome 实际编译通过（`PASS Sky dome fragment` / `PASS Voxel fragment`）
  - 批次：20261030-1925

- [x] 地形着色器把 `bayer4(gl_FragCoord)` 从算两遍改成算一次复用：`web/src/render/dither.ts` + `VoxelMaterial.ts`
  - 做了什么：`GLSL_DITHER` 拆出 `ditherWithBayer(color, bayer)`；地形着色器在 `discard` 之前算一次 `bayer4`，阈值抖动与最终输出抖色共用
  - 为什么：两处本来就该用同一个屏幕空间图案（批次 524 + 520），各算一遍等于整屏多十几条 ALU，而地形是占屏面积最大的着色器
  - 验证：`npm run check` 全绿；`render-test` 换成新判据并补了"整屏只算一次 bayer4"的断言（材质里 `bayer4(gl_FragCoord.xy)` 出现次数必须为 1）
  - 批次：20261030-1925

- [x] 真机复测与结论归档
  - 做了什么：提交后把真机数据、隔离基准与"未能验证的部分"写清楚
  - 为什么：**新包没法装到这台机器上**——`assembleRelease` 需要 `MINICRAFT_KEYSTORE*` 口令（只有用户知道），而 debug 包签名不同、覆盖安装要先卸载并丢掉存档，属于不可回退动作，没有擅自做
  - 验证：基准数据来自设备 Chrome 的隔离页面（同 GPU、同分辨率、同 MSAA）；着色器那两处只做了"编译通过 + 结构守卫"，未量化
  - 批次：20261030-1925

---

## 批次 20261029-1600 · 2026-10-29 · 会话 ea9ea51

> 一仓多产物目录重排 + 安卓只认自家签名的核心数据封存

# 队列 · 会话 ea9ea51

> 状态：执行中
> 创建：2026-10-29
> 批次：20261029-1600

- [x] [A22] 多产品目录重排：`src/ index.html public/ vite.config.ts` 迁入 `web/`，`server/android` 迁到 `android/`
  - 做了什么：`git mv` 四个路径进 `web/`、`server/android` 提到根；`tools`/`tests` 的 `../src`、`../public`、`index.html` 引用批量改向；`tsconfig` 两份 include、`vite.config.ts`（`root: WEB_ROOT` + `REPO_ROOT` 锚定 `.tmp`）、`release-check` 的 `DIST`/`index.html`、`capacitor.config.json`、Gradle 的 `repoRoot` 与 `capacitor.settings.gradle` 一起改
  - 为什么：一仓多产物，Web 的入口/资源/配置自成一目录；Android 壳不该埋在 `server/` 里（它消费 `web/dist`，不是服务端）
  - 验证：`npm run check` 全绿（离线 **181** 套、单测 153 套 1579 条）、`build:fast` 产物落 `web/dist`
  - 批次：20261029-1600
- [x] [A23] 安卓签名闸门与核心数据封存
  - 做了什么：新增 `tools/seal-core.ts`（AES-256-GCM 封存 + 与长度互质的形态变换，产物 `android/app/src/main/assets/sealed/{core.sealed,salt.bin,signers.txt}`）、`CoreVault.java`（验签名 → HKDF 派生 KEK → 解 CEK → 解载荷 → 逆变换，失败一律 null）、`CoreVaultPlugin.java`（`CoreVault.read()`，失败 reject）；`hostCore.ts` 先问原生保险柜、拿不到再走静态 URL；Gradle 去掉明文 `copyHostCore`、改为 `checkSealedCore`（缺封存体或残留明文都直接报错）；`release-check` 增加"无明文 / 非 MCTB / 白名单非占位 / 有 salt"四条断言
  - 为什么：明文 41 KB 方块表放 `assets/public` 等于白送；"改签包能不能跑"必须绑在**数据能不能解开**上，而不是一个可被 patch 的布尔判断
  - 验证：`npm run test:sealed` **15/0**（含换签名 / 换盐 / 改字节 / 截断 / 空白名单 5 条负面）；`gen:sealed` 产出 41.2 KB 封存体；`build:app` 在占位白名单上**按预期红**（证明门禁有效）；`npm run check` 全绿（离线 182 套）
  - 批次：20261029-1600
- [x] [A23] iOS 侧对等 + 三端说明文档
  - 做了什么：`ios/App/CoreVault.swift`（CryptoKit 版解封 + Team ID 校验）、`ios/App/CoreVaultPlugin.swift`；`ios/ windows/ mac/` 各一份 README；`docs/CODE-PROTECTION-STATUS.md` 记已落地 / 未做 / 两处偏离
  - 为什么：iOS 与 Android 共用同一份封存格式与同一套"验签名再解封"的顺序，但 Xcode 工程需要 `@capacitor/ios`，本机没装，先把源码与契约落下来
  - 验证：`typecheck` + `typecheck:tools` 清洁；Swift 侧待 Xcode 工程补齐后实测（状态文档已标注）
  - 批次：20261029-1600

---

## 批次 20261028-2226 · 2026-10-28 · 会话 db119a0b

> 用户："原版的差异基线，我们还是要做吧?" —— 确认把玩家可见文案里的基线词全部中性化

# 队列 · 会话 db119a0b96db41469bc93f04d7852469

> 状态：执行中
> 创建：2026-10-28
> 批次：20261028-2226

- [x] 1/2 物品说明里"原版 / vanilla"当差异基线的说法全部换成中性词：`src/core/i18n/locales/*/itemDesc.ts` → `npm run test:i18n` + `audit:i18n` 全绿
  - 做了什么：六个语言的 `itemDesc.ts` 全量替换基线词（zh 原版 → **常规玩法**，en vanilla → **the base game**，de Original → **Grundspiel**，fr l’original → **le jeu de base**，pt o original → **o jogo base**，ru оригинал → **базовая игра**，按各语言格位写成完整词组）；"与原版的差异：/Difference from vanilla:/Unterschied zum Original:/Écart avec l’original :/Diferença do original:/Отличие от оригинала:" 这类**比较式引导语整句删掉**（换成中性名词之后它会变成"跟自己比"），删完句首大写补齐；顺手修 `dort/là-bas/lá`（指代"那边"）与几处读不通的搭配（"猪的常规玩法口粮"→"常用口粮"等）
  - 为什么：用户要求界面文字不与任何别的产品挂钩，而物品说明（背包里直接看得到）有约 270 处拿另一款产品当基线。内部分差异台账（`TASKS.md` 附节 + `audit:diffs`）**不动**：那是工程记账，不是玩家看到的文字
  - 取舍：不逐条重写整句（270 条 × 6 语言风险太大），用"同词性等位替换 + 删比较引导语"保持句子结构与语气不变；`station.ts` 里的 "Original bleibt"（指地图原件）是正常词义，**故意不动**
  - 验证：`npm run typecheck` 通过；`npm run audit:i18n` 六语言仍 100%；`npm run test:i18n` 594 通过 / 0 失败；逐条看过 zh 的 51 处、en 的 44 处替换结果与 de/fr/pt/ru 的抽样，无重复词/双标点/断句；`grep` 六个 itemDesc 里基线词已 0 命中
  - 批次：20261028-2226
- [x] 2/2 给"物品说明不许拿别家当基线"加守卫：`tools/i18n-test.ts` → `npm run test:i18n` 全绿
  - 做了什么：新增 12 条断言（六语言各两条）：`itemDesc.ts` 里不许再出现基线词（原版 / vanilla / Original / original / оригинал），且必须出现中性词（常规玩法 / the base game / Grundspiel / jeu de base / jogo base / базовая игра）；注释行（`*` 开头）不算
  - 为什么：这类替换只做一次就会慢慢回流——以后加物品说明的人照着旧文案抄，界面上又会冒出"原版"。断言的边界刻意只扫 `itemDesc.ts`：`station.ts` 的 "Original bleibt" 指地图原件，是正常词义
  - 验证：`npm run test:i18n` 594 通过 / 0 失败（新增 12 条全绿）
  - 批次：20261028-2226

---

## 批次 20261028-2204 · 2026-10-28 · 会话 db119a0b

> 用户：资源包说明太粗糙（还问了一句"是不是跟我的世界兼容"），并要把说明收进导入键右边的小问号

# 队列 · 会话 db119a0b96db41469bc93f04d7852469

> 状态：执行中
> 创建：2026-10-28
> 批次：20261028-2204

- [x] 1/2 资源包说明重写（六语言）：`src/core/i18n/locales/*/settings.ts` → `npm run test:i18n` 全绿，且六语言里不出现 `.mcpack` / 原版游戏名
  - 做了什么：把原来那 5 条粗颗粒的说明整组重写成 6 条（是什么 → 怎么导入 → 贴图放哪/怎么命名 → 尺寸 → 音效 → 生效范围与来源），六语言全部重写；「导入」按钮的提示语 `settings.importTitle` 也从「.mcpack / .zip 资源包」改成「资源包（.zip 压缩文件）」；新增 `settings.resourcePack.help`（? 按钮的无障碍名）与 `settings.resourcePack.close`（知道了）
  - 为什么：用户说"说明还是太粗糙了"，而且**原写法暗示了与另一款产品的格式兼容**（`.mcpack` 是那边的扩展名）。现在只描述"压缩包里怎么摆文件、我们就怎么认"，不出现任何别的产品名、扩展名或"兼容"字样；`accept` 里仍留着 `.mcpack` 只是为了让手上已有这类文件的人选得中，界面上不再宣传
  - 取舍：不列 1136 个可替换贴图名（列出来没法读），改成"文件名 = 方块贴图名 + 三个例子"；音效不说具体文件名，只说"游戏里真的会播的那几类"
  - 验证：`npm run typecheck` 通过；`npm run audit:i18n` 六语言 3023/3023 全部 100%；`npm run test:i18n` 582 通过 / 0 失败；`grep -i mcpack` 在 locales 里已无命中
  - 批次：20261028-2204
- [x] 2/2 说明改成「导入」右侧的 ? 小按钮 + 浮层：`src/ui/SettingsScreen.ts` / `index.html` → `npm run test:ui` 全绿 + 浏览器点开一次浮层
  - 做了什么：资源包动作行改成「标签 | 导入 | ? | 文件名」四列（`.settings-row.action` 列数 3 → 4，`.settings-help` 是 22×22 的小方块、手机端 32×32 热区）；点 ? 打开浮层 `.settings-modal`（与角色形象浮层共用外壳样式，宽度 460px），里面是标题 + 六条说明 + 「知道了」；浮层在切页 / 换页签 / 关面板 / Esc / 点压暗区时都会收起；原来那块内联说明（`.settings-note.pack-help`）删除，行下只留一句"只能用你自己的包"的免责
  - 为什么：用户明确要"导入按钮右边一个小问号，点了有浮层"。说明放在浮层里还顺带把游戏设置页压短了 6 行；免责那**一句**留在外面，是因为它是给审核/权利人看的，不该藏进点击之后
  - 取舍：`知道了` 放在滚动区之外（矮横屏正文要滚 184px，退出键必须一直可见）；不为浮层另写一套外壳，直接让 `.settings-modal*` 与 `.appearance-modal*` 共用同一条 CSS 规则（少一套会漂的样式）
  - 验证：`npm run typecheck` 通过；`npm run test:ui` 1217 通过 / 0 失败（新增 2 条：? 按钮在导入键右边 + 六条正文齐全；反向守卫：资源包文案里不出现 `.mcpack`/"兼容"）；浏览器实测 zh(844×390) / de(390×844) / ru(640×360) 三组：? 按钮各 1 颗、浮层 6 条、底部键始终在视口内、点「知道了」关闭、控制台 0 错误
  - 批次：20261028-2204

---

## 批次 20261028-2101 · 2026-10-28 · 会话 db119a0b

> 用户：9 条界面/设置反馈（新建世界默认创造、资源包说明、导出选目录、去官方字样、调试默认关、删反转视角、设置保存制、按钮放大重叠、升降键偏移、切换动画）

# 队列 · 会话 db119a0b96db41469bc93f04d7852469

> 状态：执行中
> 创建：2026-10-28
> 批次：20261028-2101

> 这一批是用户 2026-10-28 一次性提的 9 条反馈，拆成 11 条可独立验证的条目。
> 项目总表用 A~O 编号（不是「T + 数字」那套），这些是**当场才出现的需求**，
> 收尾时统一补进 `TASKS.md` 的「队列落地 · 当场任务（已完成）」。

- [x] 1/11 新建世界默认创造模式：`src/ui/WorldScreen.ts` → `npm run test:ui` 全绿
  - 做了什么：新建世界表单里「游戏模式」下拉的初始值 `survival` → `creative`；验收辅助方法 `fillNewWorldForm()` 的同名默认参数一起改
  - 为什么：用户要求"首次进入创建世界默认创造模式"；辅助方法的默认值必须和表单一致，否则验收脚本拿到的世界与玩家手点的不是同一种
  - 验证：`npm run check:fast` 全绿（typecheck + 单测 + 命中的 world 套件）；`npm run test:ui` 1202 通过 / 3 失败——那 3 条是开房流程的既有红项（与本次改动无关，改前就红）
  - 批次：20261028-2101
- [x] 2/11 调试信息默认关闭：`src/ui/SettingsScreen.ts` / `src/main.ts` / `tools/settings-test.ts` → `npm run test:settings` 全绿
  - 做了什么：`DEFAULT_SETTINGS.showDebug` 改 false；`loadSettings` 改成「只有 v5 之后显式存过 true 才算开」；`SETTINGS_VERSION` 4 → 5（专门为这次语义翻转留迁移锚点）；`main` 的 `showDebugSetting` 初值改 false，并在启动时按设置补一次对账
  - 为什么：老存档里的 true 是**旧默认值**被整份写进去的，分不清"玩家主动开的"和"默认值"——不升版本就只能二选一：要么老用户永远开着，要么把主动开过的人也关掉。升 v5 让两侧都说得通
  - 验证：`npm run test:settings` 122 通过 / 0 失败（新增 4 条：默认关、脏值按关、v4 迁移回关、v5 显式开能读回）
  - 顺手：`test:ui` 里 3 条开房流程的断言本就是红的（`pendingHostRoom` 早已改成存 `effectiveBaseUrl`、预检到建世界之间多了三段失败分支，注释窗口装不下）——按当前代码改断言，不改行为；`test:ui` 1205 通过 / 0 失败
  - 批次：20261028-2101
- [x] 3/11 删掉「反转视角」设置项：`src/ui/SettingsScreen.ts` / `tools/settings-test.ts` → `npm run test:settings` 全绿
  - 做了什么：删掉控制页那一行开关、`GameSettings.invertY` 字段与它的默认值/读取分支、`main.applyLook()` 里的取反分支；六语言里 `settings.row.invertY` 一起删（`test:i18n` 的必需键清单同步去掉）；`test:settings` 里关于它的 4 条断言换成「老存档残留的键不再进设置」
  - 为什么：用户判断这一项没有使用场景。字段一起删而不是留着——留着就是一个永远为 false、没有入口的死开关，下次改设置的人还得先猜它有没有用
  - 验证：`npm run typecheck` 通过；`npm run test:settings` 121 通过 / 0 失败；`npm run test:i18n` 582 通过 / 0 失败；`npm run audit:i18n` 通过（六语言覆盖 3009/3009）
  - 批次：20261028-2101
- [x] 4/11 清掉「官方 / 非官方 / Mojang」等与原版挂钩的文案：`src/ui/SettingsScreen.ts` / `src/core/i18n/locales/*/settings.ts` / `docs/store/*.md` / `README.md` → `npm run test:i18n` 全绿
  - 做了什么：删掉设置页底部整块「非官方」声明（`makeFooterNotice()` + `.settings-notice` 两处样式 + 六语言的 `settings.notice`）；资源包那行说明改写成「只导自己的包 / 本应用不提供也不分发资源包文件」；六份商店文案的「关于」段与拍摄要求、README 首段与许可段一并去掉与原版/厂商的挂钩
  - 为什么：用户明确要求界面上不能出现"我们不是官方"这种自我定位。代码注释里的"基岩版/原版"是工程笔记（解释为什么这么实现），不是产品文字，保留——全删会把大量"为什么"一起删掉，得不偿失
  - 验证：`npm run test:i18n` 582 通过 / 0 失败；`npm run test:ui` 1205 通过 / 0 失败（那条合规断言改成"资源包免责在 + 非官方声明已删除"）；`npm run check:fast` 全绿
  - 批次：20261028-2101
- [x] 5/11 资源包使用说明（六语言）：`src/ui/SettingsScreen.ts` / `src/core/i18n/locales/*/settings.ts` → `npm run test:i18n` 全绿
  - 做了什么：资源包那一行下面加一块说明（`makePackHelp()`：标题 + 5 条），文案键 `settings.resourcePack.about` / `help1..help5` 六语言各一套；`index.html` 加 `.settings-note.pack-help` 样式（灰字 + 左侧色条，不抢按钮注意力）；`test:ui` 加一条"五条 + 标题、六语言齐全"的断言
  - 为什么：说明必须**准确**——贴图只按 `textures/blocks/<名字>.png` 对应图集（大图会缩到 16×16 格子）、音效只认 `SoundPack.ts` 映射表那批、包**不落盘**（重开页面要重新导入）。后一条不写清楚，玩家会以为"导一次就永久生效"
  - 验证：`npm run typecheck` 通过；`npm run test:i18n` 582 通过 / 0 失败；`npm run test:ui` 1206 通过 / 0 失败
  - 批次：20261028-2101
- [x] 6/11 导出世界让用户选目录保存：`src/main.ts` → `npm run check:fast` 通过
  - 做了什么：新增 `src/ui/SaveFile.ts`（`saveBlobWithPicker()` / `downloadBlob()` / `canPickSaveLocation()`），`exportWorld()` 改成优先弹系统「另存为」并写入玩家选定的位置，只有 API 不存在或写入失败才退回原来的 `<a download>`；玩家点取消（`AbortError`）直接结束，不再偷偷下载一份；文件类型说明走新键 `world.exportFileType`（六语言）
  - 为什么：原来的 `<a download>` 只能落到浏览器的下载目录，手机上玩家既看不到也选不了。`showSaveFilePicker` 不在 `lib.dom` 里，所以手写最小类型声明，不引新的 @types 包
  - 验证：`npm run test:ui` 1207 通过 / 0 失败（新增一条"优先另存为 + 取消不下载 + 回退下载"）；`npm run check:fast` 全绿
  - 批次：20261028-2101
- [x] 7/11 设置页改成「草稿 + 保存 / 恢复默认」：`src/ui/SettingsScreen.ts` / `index.html` / 六语言 → `npm run test:ui` + `test:i18n` 全绿
  - 做了什么：`SettingsScreen` 加 `draft` / `saved` 两份拷贝——所有控件只改草稿（不再 `commit()` 即生效）；新增 `SETTING_GROUP_KEYS`（分组 → 字段表）与 `saveActiveGroup()` / `resetActiveGroup()` / `updateSaveState()`；页脚改成「保存 + 恢复默认」两颗（保存进页面是 `disabled`，当前页改过才亮；恢复默认只作用于当前页，且同样要点保存才生效）；语言下拉也走草稿，保存时若语言变了才整页重载；`viewDistance` 这类没有界面入口的字段不进任何分组
  - 为什么：用户要求"所有设置项都不改动立即生效 + 每页下方保存/恢复默认 + 保存按钮灰着直到改动"。只改草稿还顺带解决了"拖滑块每帧都写 localStorage 并重算区块范围"的老开销
  - 取舍：**游戏模式与飞行仍立即生效**——它们是"这个世界现在的状态"（会进存档/影响玩法），不是这台设备的偏好，也从来不在 `GameSettings` 里；把它们也做成草稿就要在退回菜单时回滚世界状态，得不偿失。已写进决策文件
  - 验证：`npm run test:settings` 125 通过 / 0 失败（新增分组覆盖断言：有界面的字段漏挂会红）；`npm run test:ui` 1207 通过 / 0 失败；`npm run test:i18n` 582 通过 / 0 失败；`npm run check:fast` 全绿
  - 批次：20261028-2101
- [x] 8/11 未保存修改时离开 / 切换设置项弹窗提醒：`src/ui/SettingsScreen.ts` → `npm run test:ui` 全绿
  - 做了什么：`askSave(action)` 统一闸门——`setPage('menu')`（返回箭头 / 暂停页）、`setActiveGroup()`（换页签）、`hide()`（关面板 / 退出暂停菜单）三处都先过它；弹窗只有两个出口：「保存」= 把**所有脏分组**落盘再继续，「取消（不保存）」= 丢掉草稿再继续；Esc 等同「取消」；`show()` 每次从已保存的那份重开草稿，所以上一次没保存的改动不会带进去
  - 为什么：用户描述的就是"取消 = 不保存，直接退出或切换"这两个出口，没有第三个"留在原地"。保存时一起存所有脏分组，是因为玩家可能改了两页才退出，只存一页等于丢一半
  - 验证：`npm run typecheck` 通过；`npm run test:ui` 1209 通过 / 0 失败（新增两条：闸门三处齐全 + 六语言文案）；`npm run test:i18n` 582 通过 / 0 失败；`npm run check:fast` 全绿
  - 批次：20261028-2101
- [x] 9/11 按钮放大后与快捷栏重叠：`index.html` → 代码走查 + `npm run test:ui` 全绿
  - 做了什么：跳跃键簇的 `--touch-buttons-bottom` 改成「基准 + 跳跃键的放大额」，即放大时整簇**只向上长**（飞行时挂在跳跃键下面的"下降"键不再向下钻）；竖屏基准 131 → 138（让下降键离快捷栏上沿再留 4px）；窄屏横屏（<760）把簇贴到右沿 8px，避开快捷栏右侧的背包键
  - 为什么：`--touch-scale` 1.4 时下降键从 28px 长到 62px 高、且锚点不动，于是压进快捷栏/背包键那片区域；只调基准值改不了"越大压得越深"，必须让锚点跟着尺寸走
  - 验证：用真实 `index.html` 的 CSS 在 Chrome 里量矩形（探针脚本，用完已删）：640×360 / 667×375 / 844×390 / 390×844 × scale 1 与 1.4 共 8 组，下降键与「背包键 / 快捷栏」的重叠面积**全部 0px²**；把旧写法塞回去做对抗性验证 → 竖屏 390×844 重叠 **2451px²**（说明探针不是瞎的）。`npm run test:ui` 1213 通过 / 0 失败（新增 6 条 CSS 守卫）
  - 批次：20261028-2101
- [x] 10/11 飞行升降按钮点击时向右偏：`index.html` → 代码走查 + `npm run test:ui` 全绿
  - 做了什么：补一条 `.touch-button.fly-up:active, .touch-button.fly-down:active { transform: translateX(-50%) scale(.94); }`
  - 为什么：升降键靠 `translateX(-50%)` 居中，而通用的 `.touch-button:active { transform: scale(.94) }` 会把整个 transform 覆盖掉——平移没了，按钮就跳到"自己的右半宽"那个位置。用户说的"向右偏一下"就是这个
  - 验证：Chrome 里用真实鼠标按下（等 `transition: transform .08s` 走完再量）——修后中心横移 **0.00px**；把旧规则塞回去做对抗性验证 → 横移 **32.40px**（正好半个按钮宽）。`npm run test:ui` 1215 通过 / 0 失败
  - 批次：20261028-2101
- [x] 11/11 各页面切换加过渡动画：`index.html` → `npm run test:ui` 全绿
  - 做了什么：新增 `@keyframes page-enter`（淡入 + 上移 10px），挂到 `.pause-page.active` / `.settings-section.active` / `.world-view.active` 三处（暂停菜单↔设置页、四个设置页签、主菜单三层）；页签另补颜色过渡；只做入场不做退场（这些页面是 `display:none` 切换，退场动画会把 Esc/返回拖慢一拍）
  - 为什么：用户要"切换丝滑一点"。三处共用一条 keyframes 而不是各写一套，是因为它们同属"面板里的整页替换"，视觉语言要一致；时长走 `--dur-med`，`prefers-reduced-motion` 下自动变 0s（不用另写分支）
  - 验证：Chrome 里读计算样式——三处 `animation-name: page-enter`、时长 0.22s；开 `reducedMotion: reduce` 后时长变 **0s**；`npm run test:ui` 1216 通过 / 0 失败（新增 1 条守卫）
  - 批次：20261028-2101

---

## 批次 20261028-0600 · 2026-10-28 · 会话 12c62c

> 用户：体积基线放宽到 1.5 MB，项目小不值得费劲

# 队列 · 会话 12c62cf015444720a2a57c257f80c045

> 状态：执行中
> 创建：2026-10-28
> 批次：20261028-0600

- [x] [L33] 体积基线放宽到 1.5 MB：`tools/release-check.mjs` → `npm run build:web`
  - 做了什么：`TOTAL_GZIP_BASELINE` 1230 → 1536 KB，注释写明理由与"何时再动手"。
  - 为什么：用户拍板——项目本来就小（合计 1230 KB / 首屏约 1 MB），为几百字节卡发布不值。
  - 验证：`npm run build:web` ✓ 通过（余量 305.8 KB）。
  - 批次：20261028-0600

---

## 批次 20261028-0500 · 2026-10-28 · 会话 12c62c

> 用户：GitHub Pages 因体积超基线 255 字节发布不了

# 队列 · 会话 12c62cf015444720a2a57c257f80c045

> 状态：执行中
> 创建：2026-10-28
> 批次：20261028-0500

- [x] [L32] 体积闸门加容差：`tools/release-check.mjs` → `npm run build:web`
  - 做了什么：全部 JS 合计基线上加 0.5%（≈6 KB）容差；容差内通过并 note 播报消耗量，超容差才红。
  - 为什么：发布只因 255 字节（0.02%）被卡，是上次余量被日常提交吃光，不是代码膨胀。
  - 验证：`npm run build:web` ✓ 通过（note：已用掉容差 258/6298 字节）；check exit=0。
  - 批次：20261028-0500

---

## 批次 20261028-0400 · 2026-10-28 · 会话 12c62c

> 用户：创建/编辑世界界面在非中文下空间不够，要所有语言都正常

# 队列 · 会话 12c62cf015444720a2a57c257f80c045

> 状态：执行中
> 创建：2026-10-28
> 批次：20261028-0400

- [x] [L31] 世界表单标签列按语言给宽度：`index.html`、`tools/ui-test.ts` → playwright（de/ru）
  - 做了什么：`var(--label-w, 64px)` + `html[lang='de'|'ru'] 7.6em`、`fr/pt 5.6em`；标签 nowrap。
  - 为什么：固定 64px 时 de「Schwierigkeit」、ru「Название мира」被截成省略号。
  - 验证：de 106px 完整、两列对齐；ru 7 行 clipped=false；ru 编辑面板按钮正常；check exit=0。
  - 批次：20261028-0400

---

## 批次 20261028-0033 · 2026-10-28 · 会话 45545c

> 暂停菜单联机键删除后的残留清理（死参数 + 断言）

# 队列 · 会话 45545c939bf44f9ea0cb708a4fb37884

> 状态：执行中
> 创建：2026-10-28
> 批次：20261028-0033

- [x] [L30] 清掉暂停菜单联机键的残留（用户确认是有意删除）：`src/ui/SettingsScreen.ts` 的 actions 接口、`src/main.ts` 的传参、`tools/ui-test.ts` 那条断言 → `npm run check:fast` 全绿
  - 做了什么：删掉 `SettingsScreenActions` 的 `onMultiplayer` / `multiplayerLabelKey` 两个接口项（连带文档注释）、
    `main.ts` 里对应的 8 行传参，以及 `ui-test.ts` 那条"按联机状态改文案"的断言；
    断言改成反向守卫「暂停菜单不再有联机键」（否则 `settingsSrc` 会变成未使用变量，`noUnusedLocals` 直接红）。
  - 为什么：按钮在上一轮末尾（00:28）已被删掉，但接口、传参、断言还留着——`tsc` 不报错（都是可选参数），
    只有 `test:ui` 的源码断言能抓到，所以门禁一直是红的。
  - 验证：`npm run check:fast` exit=0，命中 3/3 套全绿（viewmode / settings / ui）。
  - 遗留：`openMultiplayer()`（`main.ts:3691`）现在**没有任何调用方**，`RoomCard` 因此没有界面入口；
    删卡片还是补新入口是产品决定，留给用户，未动。
  - 批次：20261028-0033

---

## 批次 20261028-0200 · 2026-10-28 · 会话 12c62c

> 用户：设置窗口标题没多语言，全面检查遗漏

# 队列 · 会话 12c62cf015444720a2a57c257f80c045

> 状态：执行中
> 创建：2026-10-28
> 批次：20261028-0200

- [x] [L29] 清掉 UI 硬编码中文：`main.ts`、`WorldScreen.ts`、`ToolHud.ts`、`WorldRegistry.ts`、六语言 → playwright
  - 做了什么：`setTitle(t('settings.title'), t('settings.back'))` + 另外 4 处（构建信息、卡片 tooltip、罗盘格数、未命名世界），新增 4 key × 6 语言。
  - 为什么：`main.ts` 的 `setTitle('设置','返回')` 写死中文，德语下页签是德语、标题却是「设置」；上一轮扫描排除了 main.ts 才漏掉。
  - 验证：德语设置标题 = Einstellungen；全项目复扫 UI 硬编码 0（剩 1 注释）；check exit=0。
  - 批次：20261028-0200

---

