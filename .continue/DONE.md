# 完成档案 · DONE

> 本文件是**已完成工作的唯一档案**，只回答"这批做了什么、怎么验的"——时间线，最近的在最上面。
> 按模块看现状与坑 → `OVERVIEW.md`；下次怎么避开 → `TIPS.md`；机制与格式 → `README.md`。
> **一条内容只写一个地方**，别在三份文档里各抄一遍。
>
> 收尾时**整份队列原样搬进来**（含每条任务下方的完成说明与 `[阻塞]`），标题格式
> `## 批次 <号> · 日期 · 会话 <前 8 位>`。

---

## 批次 20261025-0316 · 2026-10-25 · 会话 7e09a4a8

> 上架 Google Play 的版权 / 商标处置（7 条）。
> ⚠️ 本批的 **7 个代码提交**信息里写的是 `20261025-0117`（开工时钩子注入的号，与另一个会话同分钟开工撞号），
> 归档时用 `queue-init --new-batch` 换成本号以满足「批次号唯一」；
> 按批次 grep 提交请用 `20261025-0117`。

> 状态：执行中
> 创建：2026-10-25
> 批次：20261025-0316

- [x] [合规1] 清掉对外文案里的「Minecraft / 我的世界 / 基岩版」字样：`public/manifest.webmanifest` 的 description 换成与商店短描述一致的说法、`package.json` 的 description 同步 → `npm run check:manifests` 通过，且 `grep -rn "我的世界\|基岩版" public/ package.json` 零命中
  - 做了什么：manifest description 改成「浏览器里的方块世界：无限地形、生存与创造、多世界存档，无需安装」（与 `docs/store/zh.md` 的短描述同一句）；`package.json` description 改成「方块沙盒（Web / WebGL2）：无限地形、生存、合成与联机」；顺手把六语言 `itemDesc.ts` 里 `item.desc.chain` 的「基岩版里 / In Bedrock / В Bedrock…」改成不指名版本的说法
  - 为什么：真正会出现在用户设备上的只有 manifest description（安装提示/启动器），先把这一处清掉；`item.desc.chain` 是**会显示在物品说明里**的句子，直接写竞品版本名等于自己递证据。`docs/store/` 六份文案复查后确认**本来就没有**商标字样（唯一出现 Mojang / Microsoft 的地方是那句免责声明，保留），所以没动文件
  - 验证：`npm run check:manifests` 通过（5 份语言文件与基准一致）；`npm run audit:i18n` 通过（六语言 100%）；`npm run test:i18n` 550/0；`grep -rn "基岩版\|Bedrock" src/core/i18n/locales/*/itemDesc.ts` 零命中（`item.bedrock` 是方块名「基岩」，属于术语表，按 D3 不动）
  - 批次：20261025-0316
- [x] [合规2] 重写 33 条照抄原版的成就标题（6 语言共 198 条），保留 id 与触发逻辑：`src/core/progress/advancementText.data.ts` + `src/core/i18n/locales/{zh,en,de,fr,pt,ru}/advancement.ts` → `npm run test:i18n && npm run test:advancement && npm run audit:i18n`
  - 做了什么：33 条里 **30 条**换掉（`石器时代`→`第一块圆石`、`来硬的`→`第一炉铁`、`西装革履`→`穿上胸甲`、`冰桶挑战`→`水浇岩浆`、`我们需要更深入些`→`走进下界`、`资深怪物猎人`→`狩猎清单`、`村庄英雄`→`村庄救星`、`腥味十足`→`钓上来一条`、`涂蜡`→`涂上蜂蜡`…），六语言各 30 条 + `advancementText.data.ts` 的英文副本 30 条，共 210 处；另把 `story/root` 的英文从原版的 `Minecraft` 改成品牌名 `Minicraft`（中文侧本来就是品牌名）。id、parent、tab、desc、trigger 全部未动
  - 为什么：这 33 条的英文标题与原版逐字相同（中文也基本沿用官方译名），是唯一"成体系照抄官方本地化"的地方；其余 67 条是本项目自创进度，标题也是自创，按 D2 不动。**3 条刻意保留**：`story/root` 是品牌名；`nether/root`（下界）与 `end/root`（末地）是维度专名，属于 D3 判定不动的术语表，改了会与界面上其它地方不一致。改法上刻意避开原版的**双关/梗**（`Isn't It Iron Pick`、`Bring Home the Beacon`、`The Cake Is a Lie` 那类），改成陈述机制的说法，这样连"创造性表达"也不沾
  - 验证：`npm run test:i18n` **550/0**（含三条硬约束：中文标题与 `advancements.ts` 原文逐条相等、de/ru/fr/pt 不含中文且与英文相同的 ≤10 条、法语不许出现 ASCII 撇号——第一次跑就靠这条抓到 3 处 `l'` 应为 `l’`）；`npm run test:advancement` **116/0**；`npm run audit:i18n` 六语言 2894/2894 通过；`npm run typecheck` + `typecheck:tools` 清洁；30 条新标题在 zh/en 表内无重复
  - 批次：20261025-0316
- [x] [合规3] 10 幅画改名 + 按自创构图重画（去掉 Zetterstrand 原作的构图对应，`大金刚` 必删）：`src/core/registry/paintings.ts` + `src/render/TextureAtlas.ts` → `npm run test:painting && npm run test:textures`
  - 做了什么：1×1 七幅换成 `日出 / 河谷 / 远山 / 夜空 / 篝火 / 孤树 / 沙丘`（dawn / river / hill / night / campfire / tree / desert），多格三幅换成 `壁画 4×4 / 挂毯 4×3 / 旧海图 2×2`（mural / banner / chart，**大金刚直接消失**）；`TextureAtlas` 的七张 painter 与 `MULTI_PAINTING_ART` 全部按新构图重写（矩形清单，无任何一幅对应他人作品）；`atlasLayout` 的七个 tile 名同步；旧多格画名做成了**只读别名** `LEGACY_MULTI_NAMES`，老存档里的大画仍能读回来；顺手修掉六语言里已经过期的「画」物品说明（还写着"只有 7 幅、多格大画没做"）与 `TASKS` B14 的差异说明
  - 为什么：这 10 幅原来是照着 Zetterstrand 的署名画作摆的构图（名字也照抄），"认得出是哪一幅"就是改编，`大金刚` 还叠了任天堂形象。**只换画面与名字、保留尺寸档位与 1×1 的下标顺序**（D9）：尺寸是玩法，下标进方块状态，调序会让老存档里挂好的画集体换脸。多格画的名字进存档，所以用别名而不是硬改（D10）
  - 验证：`npm run test:painting` **66/0**（新增 6 条别名断言：三个旧名字各自映射正确、旧名字尺寸仍是 4×4、别名目标都在表里、现用名字不在别名键上）；`npm run test:textures` **33/0**；`npm run test:frame` **169/0**（`describeState` 的「贴北墙·炸弹」→「贴北墙·篝火」随名字改）；`npm run test:i18n` 550/0、`audit:i18n` 2894/2894 通过（物品说明改了六语言）；`typecheck` + `typecheck:tools` 清洁；`npm run audit:diffs` 重算了差异台账
  - 批次：20261025-0316
- [x] [合规4] 设置页补「非官方 · 与 Mojang / Microsoft 无关」声明 + 资源包免责（只导自己拥有的包）：`src/core/i18n/locales/*/settings.ts` + `src/ui/SettingsScreen.ts` → `npm run test:settings && npm run test:ui && npm run audit:i18n`
  - 做了什么：新增两条键 `settings.notice`（设置页底部：非官方、与 Mojang / Microsoft 无关、贴图与音效全部由代码生成）与 `settings.resourcePack.hint`（资源包行下方：只能导入你自己拥有的包，本应用不提供也不分发官方素材），六语言各一份；`SettingsScreen` 加 `makeFooterNotice()` / `makePackHint()` 两个节点（footer 用 `prepend` 插在"恢复默认"之上，不动原有组装顺序）；`index.html` 加 `.settings-notice` / `.settings-note` 两条样式（10px 灰字，触屏横屏降 9px）
  - 为什么：首页那句"非官方"页脚被用户按审美删过（批次 20261024-1152），但商店版本必须有一个**用户自己找得到**的免责位置——放设置页底部：不占首屏、六语言都有、投诉时能指出来。资源包那一行单独加免责，是因为它长期被当作"换个官方外观"的入口，法律上只能导自己的包（D6）。措辞刻意只讲"与谁无关 + 素材由代码生成"，不写"复刻的是哪个游戏"——写清对象等于自认使用了他人作品
  - 验证：`npm run test:settings` **119/0**；`npm run test:ui` **979/0**（新增 1 条断言：三条链路都得在——源里引用两个键、CSS 有两条样式、六语言表里都有这两条键，少一处就红）；`npm run audit:i18n` 六语言 2896/2896 通过；`npm run test:i18n` 550/0；`typecheck` + `typecheck:tools` 清洁
  - 批次：20261025-0316
- [x] [合规5] 读档容错：不认识的方块 / 物品 id 跳过并记日志，不再整档失败：`src/core/save/` → `npm run test:save && npm run test:migration`
  - 做了什么：新增 `src/core/save/SaveIssues.ts`（纯数据记账本：按 `种类|细节` 累加、最多 32 种、溢出只计数、可清零）；三条读档路径接上——`ChunkEdits.applyTo()` 遇到注册表里不存在的方块 id **不写世界**（保留地形）并记账、`Inventory.restoreStack()` 丢掉不认识的物品 id 时记账、`Paintings.restorePaintings()` 跳过认不出的画名时记账；`SaveGame.open()` 打开世界时清零；诊断日志的 `meta.saveIssues` 带上这份账
  - 为什么：存档里的方块与物品都是**数字 id**，所以改命名空间其实不会让老档读不回来（这条顺带纠正了我原先的判断）；真正会丢东西的是"这个 id 当前版本不存在了"。三种路径原本都是**静默**处理：方块回退成空气（那一片被挖空）、物品直接消失、画跳过——静默是对的（不能因为一个坏 id 让整档打不开），但必须留痕，否则玩家报"我的东西没了"时导出日志里查不到任何线索
  - 验证：`npm run test:save` **120/0**（新增 8 条：不认识的方块不写世界且保留地形、记账 detail 正确、不认识的物品丢掉且记账、同一 id 累加而不新增、总数含重复、清零后归零、清单为空）；`npm run test:migration` 28/0；`npm run test:diag` 89/0；`npm run test:unit` 全绿；`typecheck` 清洁
  - 批次：20261025-0316
- [x] [合规6] 内部命名空间 `minecraft:` 换成自有前缀（方块 / 物品 / 命令 / 联机协议 / 存档一起）：`src/core/registry/*`、`src/core/commands/*`、`server/` → `npm run check`（全量 177 套）
  - 做了什么：新增 `src/core/registry/ids.ts`（`NAMESPACE = 'minicraft'` + `normalizeId()` / `shortId()` / `hasNamespace()`，旧前缀只用于**读**）；全局替换 1100 处字面量（87 个 .ts + `tools/*.js` 的验收脚本）；所有"按名字查表 / 去前缀"的地方改用 `shortId()`（`itemNames` 7 处、`advancementText` 4 处、`AudioEngine` 4 处、`CommandHelp` 3 处、`StatusEffects` 1 处、`structureNames` 1 处、`food` 1 处、`main` 2 处）；命令解析入口（`resolveItemId` / `resolveBlockId`）先 `normalizeId()` 再查，所以 `/give minecraft:stone`、`/locate structure minecraft:village` 这类**老文本仍然可用**（`command-test` 里恰好就有这两条用例）；进度读档把老 id 归一化（否则达成记录整片消失）
  - 为什么：命名空间是内部标识符，但本项目是独立产品，没必要继续借用别人的前缀。**顺带发现一处真正在用户眼前的东西**：进度页第一个页签的标题原本是「我的世界」、英文是「Minecraft」，已改成「方块世界」/「Block World」（页签 id `minecraft` → `world`）——这才是这次改名前唯一会被玩家看见的商标痕迹
  - 验证：`npm run test:offline` **176/176 套全绿**（85.4s）；`npm run test:unit` 372/372；`npm run test:advancement` **120/0**（新增 4 条：旧前缀的达成记录读得回来、旧→新 id 映射、计数进度也接上）；`npm run test:i18n` 550/0；`npm run audit:i18n` 2896/2896 通过；`typecheck` + `typecheck:tools` 清洁。排查中还修了两处被漏掉的正则（`CommandHelp` 的 `replace(/^minecraft:/)`、`bastion-test` 里逗号连写的混合字符串）
  - 批次：20261025-0316
- [x] [合规7] 补 `LICENSE` + `THIRD-PARTY-NOTICES`（three / ws 的 MIT）+ 隐私政策页（Play 强制）：根目录新增文件 + `docs/privacy.md` → `npm run build` 产物内可检索到三份声明
  - 做了什么：新增 `LICENSE`（保留所有权利，含"不得改名二次上架 / 不得用于商业分发"条款）、`THIRD-PARTY-NOTICES.md`（three.js 0.186.1 与 ws 8.22.0 的完整 MIT 原文）、`public/third-party-notices.txt`（同内容纯文本，`vite build` 会复制进 `dist/`）、`public/privacy.html`（中英双语隐私政策：不收集个人数据、存档只在本地、联机的数据交换范围、第三方组件、变更与联系方式）；`README` 的「许可」节补三条指引
  - 为什么：MIT 要求"分发物中保留版权声明与许可全文"，网页版的"分发物"就是 `dist/`，所以声明必须放在 `public/`（只放仓库根目录等于没分发）；隐私政策是 Play 的**必填项**，需要一个可公开访问的 HTTPS 链接，而 `/privacy.html` 就是这个项目自己的站点路径，比外链第三方托管更不容易失效。隐私文案按**代码实际行为**写（无账号、无统计/广告 SDK、存档仅在 IndexedDB/localStorage）
  - 验证：`npm run build:fast` 后 `dist/privacy.html`（5.7KB）与 `dist/third-party-notices.txt`（3.4KB）都在；`npm run test:ui` **980/0**（新增 1 条断言：两份文件都在 `public/` 且声明里有 three.js authors / Einar Otto Stangvik）；`npm run audit:docs` 通过；`npm run check:manifests` 通过；`typecheck:tools` 清洁
  - 批次：20261025-0316

## 批次 20261025-0257 · 2026-10-25 · 会话 037060ab

> **这一批做什么（L8 · MS4 容器与收尾）**：补上最后一段权威——容器计时只由房主推进、
> 从属端只读；房主退出时先提示再关房、且不再重连；协议文档与代码逐条对齐到 v2；
> 台账写清 L8 四段状态；最后做一次 L8 自审。
>
> **L8 四段（MS1~MS4）代码与断言至此已齐**。仍然只剩两件只有人能做的：
> ① 人工双端验收（红石两端同时亮 / 同一只怪位置一致 / 打死同时消失且掉落一份 / 熔炉进度同步 / 房主退出提示）；
> ② `container`/`sign`/`frame`/`tnt` 的请求化（从属端操作仍直连上行，玩法不受影响）。
>
> ⚠️ 队列里「单测：从属端计时不前移」实际由**结构断言 + 联机断言**覆盖；要真在 node 里跑
> `tickContainers` 得先造一个 World，成本远高于收益——这一点写在条目说明里，没有假装写了单测。

- [x] [L8] 容器进度权威：熔炉 `cookProgress` / 酿造 / 漏斗冷却由房主推进并上行，从属端只读不推进 → 单测：从属端计时不前移
  - 做了什么：`tickContainers(dt)` 收进 `shouldSimulate(role,'containers')` 闸门（全文件只此一处调用）；`container` 消息加可选 `progress`（0..1），服务端**只在 `player.isHost === true` 时保留**并夹到 `[0,1]`，其余一律丢掉（内容照转）；`NetClient.sendContainer(..., progress?)` / `NetContainerState.progress` 打通；房主新增 `pushContainerProgress()`（1 秒节流，扫 64 格内 `progress > 0` 的容器入既有 80ms 防抖队列，顺带把槽位一起对齐）；从属端 `onNetContainer` 把 `progress` 写进 `cookProgress`（不 tick，所以只是"摆上去"，下一条快照覆盖）。
  - 为什么：熔炉进度是**每 tick 都在变**的量，而容器广播只挂在 `onMutate`（内容变化）上——不给它一条自己的低频上行，从属端的进度条只在"烧出一个东西"时跳一格。进度只认房主：从属端不推进计时，若允许它带 `progress`，一个假值就能把所有人的进度条改坏。写 `cookProgress` 而不是新加显示字段，是为了让既有进度条代码原样可用。
  - 验证：`npm run test:net` **165 → 168 通过 / 0 失败**（房主进度被转发、从属端进度被丢且内容照转、越界进度夹到 1）；`npm run test:ui` **1030 → 1034 通过 / 0 失败**（闸门只一处、1 秒节流、从属端只写 cookProgress、上行只由房主带 progress）；`npm run typecheck` 通过；`npm run check:fast` **6/6 套全绿**。⚠️ 队列写的"单测：从属端计时不前移"实际由**结构断言 + 联机断言**覆盖（`tickContainers` 只有一处且在闸门里），没有另写 vitest —— 要在 node 里跑 `tickContainers` 得先造一个 World，成本远高于收益。
  - 未验证：双端开着同一个熔炉看进度条是否同步，需要手测。
  - 批次：20261025-0257
- [x] [L8] 房主退出：房间关闭 + 从属端 3 秒内给出明确提示（`core/net/NetSession.ts` 状态迁移）→ 单测状态迁移 + `npm run test:net`
  - 做了什么：服务端房主 `close` 时**立刻** `broadcast({t:'room-closed', reason:'host-left', graceMs})` 给同房其他人（提示，不是关房——他可能只是切后台）；宽限期到期仍未回来则**关房**：对同房每个人 `reject(socket,'host-left','房主已退出，房间已关闭', CLOSE_HOST_LEFT=4007)`。客户端新增 `room-closed` 分支与 `onRoomClosing` 回调、`roomClosed` 标记；`Protocol.ts` 把 `host-left` 加进错误码与致命名单；`NetSession.CloseReason` 新增 `roomClosed`（与 `fatal` 分开表达，重连一律 `stop`）；`main` 把它变成一句带秒数的提示（`net.hostLeft`），六语言补齐。
  - 为什么：房主走了等于这一局没人推进世界——怪不动、红石不亮、熔炉不烧，而界面一切正常，这种"看起来还能玩"的坏状态最难排查。所以先提示（3 秒内），到期再关房，并且**明确不再重连**（重连只会被同一个理由踢回来，每 3 秒撞一次把日志刷满）。`roomClosed` 与 `fatal` 分开记：日志/提示要说人话，别把"房主退出"写成"协议错误"。
  - 验证：`npm run test:net` **168 → 171 通过 / 0 失败**（房主掉线即通知、通知带 `graceMs`、到期关房给 `host-left`）；`npx vitest run tests/net-session.test.ts` 新增 3 条（`roomClosed` → offline/stop、重连途中也停、之后显式 connect 仍可重开）；`npm run test:ui` **1034 → 1038 通过 / 0 失败**；`npm run audit:i18n` 通过（2906/2906）；`npm run check:fast` **161/161 套全绿**。
  - 批次：20261025-0257
- [x] [L8] 协议文档 v2 收口：`docs/NET-PROTOCOL.md` 与本批新增/改动的消息逐条对照（`world` / `edit-request` / `entity-snap` / `entity-remove` / `authority` / `progress`）
  - 做了什么：`join` 的 `world` 补 `worldType`；§4 `container` 补 `progress?` 并写明"只有房主带得动、服务端夹到 [0,1]"；§5 补 `room-closed`（`reason` + `graceMs`）；§5.1 错误码表补 `password 4005` / `host-taken 4006` / `host-left 4007` 三行（原来只有 version/clientId/duplicate/joined）；§8 缺口表改写 6 行（`联机5` 种子冲突改自动断开、`联机12` 模拟只由房主跑、`联机15` 容器计时由房主推进、`联机19` 实体位置/血量/死亡已同步、`联机38` 权威口径改成房主唯一、`联机26` 种子按房）。另加 11 条 UI 断言把"这批动过的消息必须在文档里"钉住，防下次文档漂移。
  - 为什么：文档漂移是这类项目最常见的债——消息加了、字段改了，文档还停在上一版，下次照文档实现就会踩空。不做"文档 == 代码"的完全比对（要解析源码，成本远高于收益），只钉这一批动过的那些关键串 + 缺口表的现状口径。
  - 验证：`npm run test:ui` **1038 → 1049 通过 / 0 失败**（11 条：world 元数据、worldType、edit-request、authority、entity-snap、entity-remove、progress、room-closed、host-left、4007、缺口表现状）；`node .continue/hooks/check.mjs docs` 通过（文档体量上限内）。
  - 批次：20261025-0257
- [x] [L8] 台账落地：`.continue/OVERVIEW.md` + `TASKS.md` 的 L8 条目写清 MS2~MS4 结果 → `npm run check`
  - 做了什么：`OVERVIEW.md` 的联机段由「房主权威（MS1+MS2）」改成「MS1~MS4」，并补两句现状（实体快照、容器进度随房主 1s 下行、房主退出即关房）——体量 24462 → **24516 字节**（上限 24576，仍留 60 字节）；`TASKS.md` 的 L8 追加 MS4 落地结果与测试账，并写清 L8 现在剩的两件事（人工双端验收、四条消息的请求化）；`HANDOFF` 提交总数同步 1788，`audit:diffs` 重算（注意 227 → 226）。
  - 为什么：L8 四段都落地了，台账必须能回答"现在到底哪段完成、哪段只差人验"——否则下一批会从头再查一遍。`OVERVIEW` 贴着 24KB 上限，所以只加现状、不铺细节（细节在 `notes/net-multiplayer.md`）。
  - 验证：`npm run audit:tasks` 全绿（口径与 README / HANDOFF 一致）；`node .continue/hooks/check.mjs docs` 通过（200 行 / 24516 字节）；`npm run check` 全绿。
  - 批次：20261025-0257
- [x] [L8] [自审] L8 的「L1 可测量 / L2 可对抗 / L3 可外部」各一句 + 证据（指向具体文件与测试）
  - **L1 可测量**：每一条都不是"看着像一致"，而是能被数出来的断言——`npm run test:net` **171** 条（其中房主/权威/实体/进度/关房 24 条是本批新增）、`npm run test:ui` **1049** 条（含"闸门只此一处""每帧不重复调用""文档里有这条消息"这类结构断言）、`vitest` **506** 条（`SimMode` 12 / `EntitySnapshot` 10 / `SimApply` 10 / `RemoteBlockWrite` 5 / `NetSession` 11）。人能验的也定成了可判定的阈值：红石两端同时亮（同一 tick 内）、打死同一只怪两端同时消失且掉落**恰好 1 份**、熔炉进度差 **≤1 秒**（1s 下行）。
  - **L2 可对抗**：所有"客户端说了算"的地方都加了服务端侧的同一条尺子——谎报 `authority` 无效（按 `isHost` 重标，`test:net` 有断言）、非房主的 `block`/`blocks` 直接丢、`edit-request` 形状收口 + 令牌桶限频、`entity-snap` 只收房主且截断 256、`entity-remove` 键过滤、`container.progress` 只认房主并夹 `[0,1]`、`world` 元数据脏种子整份丢弃、`remoteWorldWritable()` 挡"种子错位时写脏地图"。**没防住的也照实记**：`move` 无位移校验（改包可瞬移）、容器不校验目标方块、`mob-hit` 仍按邻近认。
  - **L3 可外部**：不依赖游戏客户端就能复现——协议在 `docs/NET-PROTOCOL.md`（消息表 / 错误码 4001~4007 / 缺口表 / 规矩），`tools/net-test.mjs` 用**裸 WebSocket 客户端**跑全套（可见地证明"外部实现也能接"），`npm run server` + `npm run dev` 双端可手验；另有 11 条断言把"这批动过的消息必须在文档里"钉死，防止文档漂移；取舍与坑在 `notes/net-multiplayer.md` §五/§六。
  - 验证：三句话里能核对的部分都指到了可跑的东西——`npm run test:net` **171** 条、`npm run test:ui` **1049** 条（含 11 条"文档里有这条消息"）、`npx vitest run tests/` **506** 条；`node .continue/hooks/check.mjs docs` 通过（OVERVIEW 200 行 / 24516 字节）；`npm run check` 全绿。**L2 里"没防住的"三条（move 无位移校验 / 容器不校验目标方块 / mob-hit 按邻近认）不是本批目标，写在这里是为了别让下一批以为已经防住了。**
  - 批次：20261025-0257

## 批次 20261025-0256 · 2026-10-25 · 会话 f40a1ce1

- [x] [相机1] 抽出「相机到最近实心面」的探测器与 near 映射（纯函数 + 离线断言）：新增 `src/render/cameraNear.ts`、`tools/camera-near-test.ts`，`package.json` 加 `test:cameranear` → `npm run test:cameranear` 全绿
  - 做了什么：新增 `src/render/cameraNear.ts` 两个纯函数——`cameraClearance(world,x,y,z,radius=1)` 取 3×3×3 邻域的**碰撞盒**（不是"非空气格"），返回到最近盒面的距离（盒内 0、空场 `Infinity`）；`nearPlaneFor(clearance)` = `clamp(clearance - 0.05, 0.02, CAMERA_NEAR)`。常量 `CAMERA_PROBE_RADIUS=1` / `NEAR_MARGIN=0.05` / `CAMERA_NEAR_MIN=0.02`，上限直接 `import { CAMERA_NEAR } from './Sky.ts'`（不另抄 0.25）。`tools/camera-near-test.ts` 用"只在指定格给碰撞"的假世界断言，不引真 `World`
  - 为什么：用碰撞盒而不是"非空气格"，是为了让水 / 岩浆 / 火 / 藤蔓 / 蛛网这些没有碰撞盒的方块不白压深度精度；非完整方块按**局部盒**算距离，否则半砖天花板那档会按整格盒底算出 0（误判成"埋在里面"）、按整格顶面算出 0.73（漏判）。距离取"到盒面最短距离"而不是"沿视线的命中距离"——最短距离 ≤ 任意方向的命中距离，于是不必把视线传进来就保证任何朝向都不裁
  - 验证：`npm run test:cameranear` **36/0**（三档真实间隙 0.18→0.13 / 0.23→0.18 / 0.30→0.25 都严格小于间隙且贴墙那档仍等于 0.25；半砖局部盒、无碰撞方块、埋在盒里返回 0、对角距离 √0.75、单调性逐条钉死）；`npm run check:fast` 全绿（离线 **177** 套——比原来多这一套、单测 372 条）；`typecheck` + `typecheck:tools` 清洁
  - 批次：20261025-0256
- [x] [相机2] 把自适应近裁面接进相机：`src/main.ts#updateCamera` 每帧按 `camera.position` 探间隙并写 `camera.near` → `npm run check:fast` 全绿 + `npm run dev` 手测（两格高洞里跳起来抬头不再透视、蹲半砖下不再透视）
  - 做了什么：`src/main.ts` 新增 `applyAdaptiveNear()`，在 `updateCamera` 摆完相机之后调用——探针读**刚摆好的 `camera.position`**（不是眼睛，第三人称被墙压到眼前那一档才覆盖得到），`nearPlaneFor(cameraClearance(world, …))`；旁观模式走 `hasBlockCollision(this.gameMode)` 判据直接给 `CAMERA_NEAR` 并跳过探针；`near` 变化超过 1e-4 才写 `camera.near` + `updateProjectionMatrix()`
  - 为什么：只改这一处（而不是 `applySettings` / `setViewDistance`）是因为那两处只管 `far`，把 near 写死会让每帧的收缩被覆盖；`updateProjectionMatrix()` 必须跟着写，否则改了 near 画面不变
  - 验证：`npm run typecheck` 清洁、`npm run check:fast` 全绿（离线套件里没有覆盖 `src/main.ts` 的，符合预期）；**真浏览器端到端**（临时脚本 `.tmp/camera-near-e2e.mjs`，不入库）：起 vite → 进世界 → 空场 8 帧 `near` 恒 0.25 → `/setblock ~ ~2 ~ stone` + 创造飞行顶上去（脚底 67.200、眼 68.820、天花板底 69.000，间隙 0.18）→ `near = 0.130`（18 帧全部 0.130）→ `/gamemode spectator` 回到 0.25 → 拆掉石头回到 0.25。即"贴脸收缩、旁观不收缩、离开即还原"三条都在真机跑通
  - 批次：20261025-0256
- [x] [相机3] 相机真埋进实心不透明方块时不再透视而是被方块色盖住：`src/render/ScreenEffects.ts` 加 `suffocate` 与动态取色、`src/main.ts#applyMediumEnvironment` 接优先级 → `npm run test:render` 全绿 + 手测（`/setblock` 埋自己、沙柱砸头）
  - 做了什么：`ScreenEffects` 加 `suffocate` 预设（alpha 1、vignette 0、兜底色中灰）与 `setTint(hex|null)` 动态取色入口（`update()` / `snap()` 里"有覆盖色就用覆盖色，否则用预设色"，值没变时不重建 `Color`）；`main.ts` 新增 `buriedInBlock()`（相机所在格 `blockDef(id).suffocates` **且** `cameraClearance(..., 0) === 0` 才算被埋；旁观模式按 `hasBlockCollision` 排除），`applyMediumEnvironment` 的优先级改成 `portal > suffocate > lava > blindness > darkness > water`，色罩颜色取**现成的 `blockParticleColor(id)`**（顶面+侧面贴图平均色，没有再造颜色表）
  - 为什么：相机真进了方块时眼前那面是背面、被背向剔除，near 收到多小都看不到它，几何路径是死路，只能整屏盖住（原版同理）。两个判据缺一不可：玻璃/树叶/水 `suffocates=false`（本来就该看得见外面）；`cameraClearance === 0` 保证是"在碰撞盒里面"而不是"在半砖空着那一半"。优先级把 suffocate 放在水下之前是因为"埋在石头里时水下那片青色是错的"
  - 验证：`npm run test:render` **276/0**（新增 9 条：整屏不透明 / 无边缘加深 / 兜底色 / `setTint` 立刻生效 / 过渡后是覆盖色 / `snap()` 也吃覆盖色 / 清掉覆盖色回预设）；`typecheck` 清洁；`check:fast` 全绿。**真浏览器端到端**（临时脚本 `.tmp/suffocate-e2e.mjs`，不入库）：空场无色罩 → `/fill ~-2 ~-1 ~-2 ~2 ~3 ~2 stone` 埋住 → `effect=suffocate`、色罩色 `0x7f7f7f`（石头灰）、alpha 1.000 → 换成 sandstone → 色罩跟着变 `0xd8cca6`（砂岩黄）→ 换成 glass → 不糊屏（alpha 0.000）→ 旁观模式埋在石头里也不糊 → 挖开后色罩褪去
  - 批次：20261025-0256
- [x] [相机4] 全量回归与差异台账：`npm run check` + `npm run build:fast` 全绿，并把「相机贴脸会透视」这条差异写进 `.continue/TASKS.md` 的差异台账口径（若该台账无对应段则记进 `notes/decisions.md`）
  - 做了什么：`TASKS.md` 的 F7 视角条目下补一条 `⚠️` 注记（自适应 near 的口径：正常 0.25 / 贴脸收到间隙−0.05 / 探针读相机位置 / 旁观不收缩 / 埋进不透明方块改用该方块色罩，并写明原版是固定 near ≈0.05），`npm run audit:diffs` 重算差异台账（差异 66 条 / 注意 225 条）；顺手把 `README.md` / `AGENTS.md` / `.continue/HANDOFF.md` 里"176 套"改成"177 套"（本批新增 `test:cameranear`，`audit:tasks` 会核对这个数）
  - 为什么：差异台账是**脚本从 `⚠️` 注记汇总**的（`tools/diff-ledger.mjs`），手抄必然漂，所以只写注记、让脚本重写台账；套数同理，`audit:tasks` 拿 `package.json` 现算并反查入口文档
  - 验证：`npm run check` **全量全绿**（typecheck + audit:i18n + vitest 372 条 + 离线 **177/177** 套 + audit:tasks/coverage/diffs/docs）；`npm run build:fast` 出包成功（2.51MB / gzip 717KB，与改动前同量级）
  - 批次：20261025-0256

---

