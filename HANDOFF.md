# 接手必读 · HANDOFF

> 这是「Minecraft 基岩版 1.18 复刻（Web / WebGL2）」的进度交接文档。
> **换电脑、换会话、换人接手，都先读这一份**（整份读完再按需展开，不用挑），
> 再读 `.codebuddy/auto-continue.md`（推进队列）和 [TASKS.md](./TASKS.md)（长期总表）。
> 会话聊天记录本身不随仓库走，能带走的关键上下文都沉淀在下面。
>
> 大块历史正文已经拆出去按需读，见 §1 的索引表（`docs/HANDOFF-ARCHIVE.md` /
> `docs/EXPERIENCE.md`）——**不要一开始就把它们全读进来**。

---

## 0. 新机器 30 秒上手

```bash
git clone <远程地址> && cd <仓库目录>
npm install
npm run agent:setup    # 恢复 AI 记忆到本机 + 自检 hooks / 环境 / 进度（有问题会直接列出来）
npm run dev            # http://localhost:5173
```

> `agent:setup` 走的是 `tools/agent-setup.mjs`。本脚本此前在 `package.json` 里**没有对应的
> script 键**（文档写着 `npm run agent:setup`、实际会报 "Missing script"），已补回；
> 首次在新机器上接手时如又报缺失，先确认这一行还在。

然后对 AI 说一句：**「读 AGENTS.md、HANDOFF.md 与 .codebuddy/auto-continue.md，按队列继续推进。」**
之后 Stop 钩子会自动按队列继续，不需要逐步确认（机制见第 3 节）。

验收门槛：`npm run check` 全过（= `typecheck` + `npm test` + 三张台账），`npm run build` 能出包。

> **改代码时的内循环别用 `check`**（那是提交前的全量），用这两条：
> `npm run check:fast`（typecheck + 单测 + **只跑被改动命中的那几套离线测试**）、
> `npm run build:fast`（关掉 sourcemap 的构建，只验"能不能出包"，产物内容与正式构建一致）。

## 1. 当前状态快照

- 时间：2026-10-20 · 提交总数 1084（每个功能点一条，可逐条回滚；`npm run audit:tasks` 会核对这一句）
- 技术栈：TypeScript（严格模式）+ Vite + Three.js / WebGL2；无第三方运行时依赖（除 three）
- 进度口径：`TASKS.md` 共 288 项 —— 已完成 **234**、进行中 **49**、待办 5 条（其中 55 条是需求审计新补的**整组**缺口，逐组明细见 `docs/HANDOFF-ARCHIVE.md` 的「需求审计」一节）；
  （`npm run audit:tasks` 会核对这一行与本表，改完条目记得跑一次）
  其中相当一部分待办是长期大项（村民与交易、织布机等功能方块、信标与地图、喷溅/滞留药水等）
  —— **进行中口径以 `.codebuddy/auto-continue.md` 队列为准**，两份文件分工不同，不要只看一份
  —— 2026-10-15 做过一次**逐条核对**（对着 src/tools 的真实实现重判 37 条），
  勾选状态与代码实况已对齐；以后每完成一项顺手改这两份文件，避免再次漂移
- ⚠️ **批次编号冲突（本轮）**：另一条会话在同一时间段占用了 **272~283**。本轮 7 条用户反馈的
  8 个提交正式编号是 **284~291**；旧 commit message 里写的 272~279 是当时撞号，
  以后引用/回滚请按下面的新号或 commit hash（历史不重写，避免动已推送的分支）。
- 批次 499（刷怪规则）：**按原版校准密度**（用户反馈"角色身边的生物非常多"）。敌对最小生成
  距离 16 → **24 格**（原版值）、每轮最多 3 只 → **1 只**（填满 24 只要 ~48 秒）；
  被动上限 16 → **8**、生成距离 8~32 → **24~48**、补刷周期 2 秒 → **10 秒**（与敌对分开计时）。
  顺带接上**难度倍率**：`Rules.ts` 的 `spawnCap` 一直没人读，所以"和平不刷敌对 / 简单 ×0.5 /
  困难 ×1.5"从未生效（TASKS I7 是文档漂移）；现在 和平 0 / 简单 12 / 普通 24 / 困难 36。
  被动名额只数 `PASSIVE_MOBS`（村民/铁傀儡不再把动物挤掉）。`test:spawn` 56 → **61 条**。
- 批次 500（性能）：**寻路节流**（真机日志里 `phases.ent` 29~35ms / 24fps 的根因）。
  `Mob.updateAi` 原条件是 `repathTimer <= 0 || path.length === 0`，于是"路径走完"与
  "找不到路"都会**下一帧立刻重算**；失败的搜索还要把 `maxNodes` 撑满。三处修：
  ① 失败退避 1.2~2.0 秒；② `EntityContext.canPathSearch` + 主程序每帧 2 次预算
  （`PATH_SEARCH_BUDGET_PER_FRAME`），拿不到预算的怪下一帧再排队；
  ③ 水平 2 格内且同高度时直线走过去（不再"贴身→清空→重算"）。
  `Pathfinder.maxNodes` 900 → 384。`test:mob` 137 → **145 条**（1 秒只搜 1 次 /
  没预算不搜 / 贴身不搜 三条）。
- ⚠️ **批次编号冲突（第四次）**：上一条里 **499 / 500 各有两个不同提交**
  （`11f8606` 刷怪密度 / `cde231c` 鞘翅；`f3226c7` 寻路 / `03ee988` 测试稳定性）。
  两组都已推送，历史不重写；引用时请按 hash。本轮取 **501**。
- 批次 501（持久化，J11 尾巴）：**村民的职业与交易进度进存档**。`VillagerSavedState`
  （职业 / 交易经验 / 每条交易的已用次数）挂到 `SavedMob.villager`，无业村民不写这个键；
  读档时 `Villager.restoreState` 按"职业 + 经验"**重建等级与交易清单**（不存派生值，
  改交易表后老存档自动跟上），`uses` 长度与重建结果对不上时**整份丢弃**——
  错位会把"这一条卖完了"落到另一条交易上，比次数重置难查得多。
  写入口在 `savedEntityOf`、读入口在 `spawnSavedEntity`（必须在 `spawn` 之前，
  否则第一帧 AI 会先重新认领）。认领的工作站坐标仍不落盘（只用于显示）。
  `test:villager` 122 → **141 条**（往返 / 脏数据 6 类 / 寄存 JSON 往返）。
  ⚠️ 仍是 `[~]`：村民不会走去上班、没有每日刷新与价格浮动（批次 507 的计划）。
- 批次 502（物品数据，E21 尾巴 / 织布机前置）：**旗帜图案跟着物品走**。
  `ItemStack.bannerPattern`（1~4，0 不写字段）补进四处链路
  （`restoreStack` / `stackExtras` / `sameExtras` / `Transfer.cloneExtras`），
  挖旗帜时写进掉落物（`breakBannerPair` 以**下半格**为准，老存档上半格没图案）、
  放置时由 `PlacementInput.bannerPattern` 写回方块状态（上下半格同一份）。
  ⚠️ 顺带修掉批次 497 的**撞位**：图案原来占 bit0-2，与朝向位（bit1-2）重叠，
  挂墙旗换一次图案会被改朝向（当时只在立地旗上验过）；现在编码为
  **bit0 / bit4 / bit6**，`test:banner` 补了"换图案不碰朝向/挂墙位"两条。
  `test:banner` 57 → **67 条**、`test:inventory` 89 → **103 条**。
  ⚠️ 差异：图案仍只有 4 种、单层；织布机界面是批次 503。
- 批次 503（J25 收口）：**织布机**。`core/container/Loom.ts` 三格（旗帜 / 染料 /
  **算出来的成品**）+ `BlockEntityStore` / `ContainerSave` / `Transfer` 三处登记
  （`loom` 种类、`[LOOM_BANNER, LOOM_DYE]` 可塞、成品进 `isComputedResultSlot`）+
  `InventoryScreen` 的 `loom` 模式（图案列表随材料置灰）+ 右键入口。
  ⚠️ 两条关键判据：**只扣一件**（整叠 64 面白旗 + 1 染料不会全变花旗）；
  **删掉 `cycleBannerPattern`**——右键免费换图案会让染料消耗形同虚设。
  差异：图案 4 种、单层；**染料只当消耗**（图案色随旗面自动取反色）。
  新套件 `test:loom` **56 条**，套数 152 → **153**（README/HANDOFF/AGENTS 三处同步）；
  **J25 勾掉**：完成 201 → **202**、进行中 79 → **78**。
- 批次 504（口径校准，**无新玩法**）：把 78 条"进行中"逐条对着代码重判，
  **19 条已经完整但一直没勾**的收口：B14 装饰实体、C7 方块实体持久化、
  D5 世界类型、D7 群系表、D15 结构生成、E16 视野效果、F2 摔落、F4 姿态、
  G6 掉落映射、G7 右键交互、H1 NBT、H3 物品栏 GUI、I6 床与重生、I9 昼夜与月相、
  J8 繁殖/驯服、K3 附魔效果、M2 世界创建、M3 五条 HUD、M7 进度 100 条。
  另修正 6 处**过期注记**：B15（只剩细雪/望远镜）、B17（蜂蜜瓶/树苗已完成）、
  B20（磁石/重生锚已完成，只剩灵魂火）、J13（末影珍珠早已落地）、
  K6（笼中迷你生物 487 已做）、D15（结构 23/23，剩的是布局深度）。
  ⚠️ 这类漂移的根因：条目从头到尾只有"加注记"、没有"回头勾"。
  以后每批收尾**必须**问一句"这条的主干是不是已经齐了"，齐了就勾。
- ⚠️ **批次编号冲突（第二次）**：并发会话占用了 **295-1~295-4**。本轮两个提交正式编号是
  **297（容器暂停）/ 298（目标框界面）**；旧 commit message 里的 295/296 是撞号。
- ⚠️ **批次编号冲突（第三次）**：并发会话占用了 **303**。本轮正式编号 **304**；
  旧 commit message 里的 303 是撞号。
- 批次 191 及更早（167~191，共 25 条）：已搬到 `docs/HANDOFF-ARCHIVE.md` 的
  「§1 批次流水」各节——那部分是"当时怎么做"的查阅材料，不再是"现在什么状态"。
  **本文件只保留最近 6 批**（由 `npm run docs:trim` 自动归档，上限 340 行），
  让每次会话的开头仍然是"现在该干什么"；更早的记录 `git log --grep="批次 NNN"` 可查。

**批次 101 做过一次上下文瘦身**：这一节后面原先挂着约 900 行的"已打通模块表 + 需求审计 +
逐批流水"，另外 §4 还挂着约 330 行的经验表——**每轮会话都要读一遍纯粹是浪费**，
已经拆到下面两份文件里（内容一字未改，只是挪了位置）：

| 想查什么 | 读哪一份 |
| --- | --- |
| 某个模块（光照 / 网格化 / 容器 / 生物 / 结构…）当时是怎么做的 | [`docs/HANDOFF-ARCHIVE.md`](./docs/HANDOFF-ARCHIVE.md) |
| "这个坑踩过了，结论是什么" | [`docs/EXPERIENCE.md`](./docs/EXPERIENCE.md) |
| 下一步做什么（**唯一的"进行中"口径**） | [`.codebuddy/auto-continue.md`](./.codebuddy/auto-continue.md) |
| 长期总表 / 覆盖率 / 与原版的差异 | [`TASKS.md`](./TASKS.md)（三张派生表都由脚本生成，不要手抄） |

**派生数字一律不要手抄**：`npm run audit:tasks` 会核对本文件的进度口径与提交总数，

> **CI 门禁（批次 199）**：`.github/workflows/check.yml` 在推送与 PR 上跑**和本地同一条**
> `npm run check` + `npm run build:fast`。它在别处跑会有两个坑，都写在那个文件头里：
> ① `checkout` 必须 `fetch-depth: 0`（台账要数提交数，浅克隆会算出 1）；
> ② 与"发布"分成两个工作流（门禁红了不该把线上卡在旧版本）。
`npm run audit:coverage` / `npm run audit:diffs` 会重写 TASKS 里的两张表——手抄过的都漂过。
## 2. 两条硬性约定（用户要求，必须遵守）

1. **每个独立改动单独提交**：review 变更 → 中文 commit message → `git add` → `git commit` → `git push`，
   全程自动、不等确认；不要攒成一个巨型提交，版本历史要能逐条回溯/回滚。
2. **不停下来等确认**：按 `.codebuddy/auto-continue.md` 队列自己推进；遇到困难自己想办法解决并记录结论，
   而不是把问题抛回给用户。

细节与动机记录在仓库内 `.codebuddy/memory/`（AI 记忆的版本化副本）。

## 3. 自动继续机制（换机器最容易坏在这）

- 钩子脚本：`.codebuddy/hooks/auto-continue.mjs`（Stop / UserPromptSubmit 两个事件）
- 配置：`.codebuddy/settings.json` —— **用相对路径**写命令，换机器才不会失效；
  若你的环境里相对路径不生效（AI 不自动继续），执行 `npm run agent:setup -- --fix-hooks` 自动改成本机绝对路径。
- 紧急刹车：`touch .codebuddy/auto-continue.off`；恢复：`rm .codebuddy/auto-continue.off`
- 单会话次数上限：环境变量 `AUTO_CONTINUE_MAX`（默认 12）
- 排查用日志：`.codebuddy/auto-continue.log`（每轮一行 JSON，能看到 `decision=block` 就说明钩子生效）

**踩过的坑（别重犯）**：Stop 钩子里输出 `{"continue": false}` 会被实现层当成"硬停止"，
表现为 AI 真的停了、不自动继续；正确写法是 `{"continue": true}` + 反馈走 **stderr** + `exit 2`。

## 3.5 本轮（J1/J2/J3）新增的硬性约定

**跨区块地物/结构必须"只依赖世界坐标"**：一棵树的树冠会伸进邻居区块，村庄会横跨好几个区块。
做法是"生成区块 C 时重放 3×3 邻域里各地物的实例，只写入落在 C 的部分"，于是每个地物只属于一个区块。
但这条机制成立的前提是**地物的每个决策都是世界坐标的纯函数**——一旦某处读了本区块的方块数据来做判断，
拥有者与邻居就会得出两种结论，接缝上的树冠只会剩半边。为此：

- `OverworldGenerator.surfaceY(x,z)` 提供"世界坐标 → 地表高度"（4 个粗网格节点求零点再双线性插值）；
- 树干用**强制写入** + 只在拥有者区块里向下补齐（估算高度差 1~3 格时不会悬空）；
- 单列地物（草花蘑菇……）不参与邻域重放，直接用本区块真实地面校准落点；
- 下界的地板高度是解析式，天然满足这条约定。

## 4. 已定论的经验（省时间，别重复踩）

**已拆到 [`docs/EXPERIENCE.md`](./docs/EXPERIENCE.md)**（约 330 行：色彩空间、天光初始化、
地形尺度、断言怎么写、生物 AI 的"该共享原语而不是策略"、掉落概率的两个掷点……）。

动到渲染 / 光照 / 地形 / 界面 / 生物 AI 之前，先去那里搜一眼相关的行再动手——
那张表里每一条都是**已经付过代价**的结论。

## 5. 待复核的悬案（下次接手优先看）

非完整方块展示平台整体偏暗，而同处探针显示天光已是 15。怀疑**网格在光照收敛前就被烘焙**了。
调试面板已输出两个数：`光照队列`（`World.lightWorkCount` → `LightEngine.pendingCells`）与 `待重刷`
（见 `src/main.ts` 调试面板一行）。复现与判据：站上平台，观察这两个数是否归零、
归零后该区块的网格有没有重新生成；若没重刷，就是队列收敛后缺少"脏区块重新入网格队列"的一步。

## 5.5 打包与发布（K8）

**PWA 已经可用**：`npm run build` 的产物里带 `manifest.webmanifest`、`sw.js`、`icon.svg`，
Service Worker 只在生产模式注册（开发时注册会把 vite 的开发资源缓存住，改代码看不到效果——
这是 PWA 开发最常见的坑）。验收：`sh tools/pwa-check.sh`。
缓存策略：导航请求网络优先、静态资源缓存优先 + 后台更新。

**GitHub Pages 已经接好**（2026-10-16）：线上地址
`https://masontool.github.io/minicraft-ai-web/`，工作流 `.github/workflows/deploy-pages.yml`
在推 `main` 时自动 `npm ci` + `npm run build` + 发布 `dist`。
仓库侧只需做**一次**设置：`Settings → Pages → Build and deployment → Source = GitHub Actions`
（不改这一步的话工作流会跑完但不生效，线上 404——这是最常踩的一处）。
三条与"能不能在子路径下跑起来"有关的约定：
`vite.config.ts` 的 `base` 必须是相对值 `'./'`（Pages 上项目位于 `/<repo>/`）、
`index.html` 与 `manifest.webmanifest` 里的路径同样全是相对的、
项目没用 `SharedArrayBuffer` 因此不需要 Pages 无法自定义的 COOP/COEP 响应头。
⚠️ **联机在 Pages 上默认不可用**：`defaultServerUrl()` 给的是 `ws://<当前域名>:8787`，
而 Pages 是 HTTPS 页面，浏览器会直接拦掉这种混合内容；要玩联机得自己跑 `npm run server`
并挂 `wss://` 反向代理，再在控制台 `mc.connect('wss://你的域名', '昵称')`。

**想套壳成 App 时**（本项目没装这些依赖，按需再加）：

- **Android（Capacitor）**：
  `npm i -D @capacitor/cli && npm i @capacitor/core @capacitor/android` →
  `npx cap init` → `npm run build` → `npx cap add android` → `npx cap sync` → `npx cap open android`。
  注意 `vite.config.ts` 用的是 `base: './'`（相对路径），套壳与 PWA 都能直接用，不必为 `file://` 另做构建。
- **桌面（Electron）**：`npm i -D electron`，主进程 `loadFile('dist/index.html')`；
  存档走 IndexedDB，默认持久化在用户数据目录。
- **手机浏览器直接用**：`npm run dev -- --host` 后用手机访问局域网地址（触控层自动启用），
  真机验收清单见 `TASKS.md` 的 M17。

## 6. 常用命令与调试接口

```bash
npm run dev                # 开发服务器
npm run check              # 【提交前】typecheck + 单测 + 158 套离线测试 + 三张台账（全过才提交）
npm run check:fast         # 【改代码时】typecheck + 单测 + 只跑被改动命中的套件（秒级）
npm run build              # 类型检查 + 生产构建（带 sourcemap，发布用）
npm run build:fast         # 只验"能不能出包"（SOURCEMAP=0，产物 hash 与正式构建一致）
npm test                   # typecheck:tools + vitest + 158 套离线测试
npm run test:offline:changed  # 只跑与本次 git 改动相关的离线套件
npm run audit:tasks        # 任务清单自检（编号重复/跳号 + 本文件进度口径是否过期）
npm run gen:stats          # 地形生成统计（耗时/洞穴占比/矿石产量）
npm run agent:setup        # 跨机器自检
```

**这些是一条链**：`npm run check` = `typecheck` + `test` + 三张台账。
`test` = `typecheck:tools` + `test:unit`（vitest）+ `test:offline`
（`tools/run-tests.mjs`：**一次 esbuild 打包全部入口 + 多进程并行**，
32s → 9s，见 TASKS A13）。单套调试仍可直接 `npm run test:reach` 这类老命令。

`npm test` 那一层共 **158 套**自建离线测试（清单的唯一来源是 `package.json` 的 `test:*` 脚本，
不在文档里另抄一份——`npm run audit:tasks` 会核对这个数）；
另有 `tools/mobile-check.sh` / `tools/ui-check.sh` / `tools/net-check.sh` 等**真浏览器验收脚本**，
它们要 dev server，不在 `npm test` 里。

浏览器控制台 `window.__mc`（`src/main.ts` 末尾挂的 App 实例）：
`connect(url,name)` / `disconnect()` / `netState` / `sendChat(text)` / `saveNow()` /
`saveStatus` / `openSettings()` / `updateSettings(patch)` / `setCameraMode()` / `cycleCameraMode()` /
`toggleRecipeBookForTest()` / `hoverHotbarForTest()` / `runCommand(text)` / `openChatForTest()` /
`blockId(name)` / `simulateFrameTime(ms)` / `bedState`（批次 79：`sleeping` / `sleepSeconds` /
`respawn`——验收脚本读重生点不必猜）/ `signState`（批次 80：`stored` / `visible` / `editing`）/
`signLinesAt(x,y,z)`（读某块牌子上的字）/
`frameState`（批次 86：`stored` / `visible`）/ `frameItemAt(x,y,z)`（读某格里展示框挂着的东西）/
`debugState.advancements`（批次 87：`open` / `rows` / `earned` / `total` / `ids`）/
`debugState.trade`（批次 88：`open` / 最近村民的 `profession` `level` `offers`）/
`villagerNearby()` / `openTradeNearbyForTest()` / `tradeNearbyForTest(i)` / `employNearbyVillagerForTest(id)`（村民验收用）/
`nearestVillageForTest()`（批次 89：最近的村庄在哪——村庄每 512 格才有一个，
手机上按它给的坐标 `/tp` 过去就能看到村民）/
`nearestStrongholdForTest()`（批次 114：最近的**要塞**在哪——末影之眼飞向的就是它，
要塞间距 96 区块 = 1536 格，靠走是走不到的）/
`summonWitherForTest()` / `witherState`（批次 116：直接放一只凋灵出来 / 它的
`health` `phase` `shielded`）/ `buildWitherAltarForTest()`（摆好 4 块灵魂沙 + 3 颗头
并**走玩家那条判定**召唤——走一遍真流程要先凑齐 3 颗头，自动化等不起）/
`buildBeaconForTest(level)` / `beaconStateAt(x,y,z)` / `beaconDebug`（批次 117：
在旁边搭一座 N 级金字塔 + 信标、读某座信标的等级与选择、看索引与光柱的现状）/
`nearestStrongholdForTest()`（批次 114，见上）/
`toggleAdvancementsForTest()` / `grantAdvancementForTest(id)` / `resetAdvancementsForTest()`（验收用）/
`fishingState`（批次 81：`phase` / `timer` / `waitFor` / `bobber`）/
`forceBite()`（把浮标直接推到咬钩，省掉 5~30 秒的等待）/
`teleport(x,y,z)` / `teleportForce` / `look(yawDeg,pitchDeg)` / `setTimeOfDay(t)` /
`setDimension('overworld'|'nether'|'end')` / `toggleDimension()` /
`__worldMenu`（主菜单：`fillNewWorldForm()` / `submitNewWorld()` / `render()` /
`setView('home'|'worlds'|'create')` —— 批次 108 起主菜单是分层的）/
`endPortalState`（批次 111：`inPortal` / `ticks`）/
`buildEndPortalForTest()`（批次 111：在**面前北边 6 格**搭一座已经点亮的末地传送门，
返回圈心坐标——走一遍真流程要"找要塞 + 翻 12 颗珍珠 + 合成 12 只眼睛"，
自动化验收等不起；这一段是唯一需要人工看的地方）/
`probe(x,y,z)`（方块 + 天光 + 方块光）/ `probeState` / `column(x,z)` / `sampleColumns(x0,z0,step)` /
`place(x,y,z,blockId,state)` / `dropItem(itemId,count,x,y,z)`，另有 info / 实体列表等。

其它：`tools/pixel-probe.mjs` 直接解码 PNG 取像素亮度，把"看起来偏暗"变成可对比数字。

## 7. 跨机器同步的边界

| 随仓库走（git 跟踪） | 只在本机（已 gitignore） |
| --- | --- |
| `TASKS.md`、`HANDOFF.md`、`AGENTS.md`、`README.md`、`docs/`、`src/`、`tools/` | `node_modules/`、`dist/`、`.tmp/`（构建与测试产物，含 `*.tsbuildinfo`） |
| `.codebuddy/auto-continue.md`（推进队列）、`.codebuddy/auto-continue-archive.md`（批次 1~95 的历史）、`.codebuddy/hooks/`、`.codebuddy/settings.json` | `.codebuddy/auto-continue.state.json`、`.codebuddy/auto-continue.log` |
| `.codebuddy/memory/`（AI 记忆的版本化副本，`npm run agent:setup` 恢复到本机） | 截图 `shot-*.png`、`.codebuddy/auto-continue.off` |

**唯一的外部依赖：git 远程仓库。** 没有远程，代码就只存在当前这台机器上，换电脑拿不到。
查看：`git remote -v`；没有就 `git remote add origin <地址>` 再 `git push -u origin main`。

## 8. 恢复一段会话的正确姿势

1. 新机器按第 0 节跑完，确认 `npm run agent:setup` 结论是「一切就绪」；
2. 打开 AI 会话，第一句给足上下文：
   「读 AGENTS.md、HANDOFF.md、.codebuddy/memory/MEMORY.md、.codebuddy/auto-continue.md，然后继续推进队列」；
3. AI 会自动：读队列 → 改 `[ ]` 为 `[~]` → 实现 → 自测（`check:fast` 内循环、`check` 提交前）→
   每步单独提交推送 → 更新队列；
4. 中途想接管：`touch .codebuddy/auto-continue.off`；想让它继续：删掉该文件。
- 批次 505（K7 收口）：**制图台**。`MapData` 增加 `scale`（0~2）与 `locked`，
  `mapCellIndex` 按 `span = 16 << scale` 定位；`zoomOutMap` 把 2×2 旧格 OR 成一格
  （**按中心对齐**：`floor((i-16)/2)+16`，否则中心线被切开、玩家位置偏半格），
  覆盖 512 → 1024 → 2048 格；`lockMap` 之后 `markExplored` 一律返回 null。
  方块 `cartography_table`（**720**，接着洞穴藤蔓 719；2 纸 + 2 木板）+ 两格容器 +
  `cartography` 界面模式（纸 = 放大 / 空地图 = 复制且不扣原件 / 玻璃板 = 锁定，
  产物直接进背包——触屏口径同切石机）；`MapScreen` 的格子换算跟着 `scale` 走。
  新套件 `test:cartography` **72 条**，套数 153 → **154**；
  **K7 与 H11 一起勾掉**：完成 221 → **223**、进行中 59 → **57**。
  ⚠️ 差异：一格 = `(scale+1)` 个区块（原版按方块像素）；没有产物格；不做"地图挂展示框"。
- 批次 506（口径校准，第二批）：又收口 3 条**一直在待办里但早已完成**的：
  **D11b 洞穴装饰**（紫晶洞 = `amethyst_geode` 结构；繁茂洞穴 = 苔藓/杜鹃/浆果 +
  洞穴藤蔓；滴水石洞 = 洞顶尖滴石/孢子花/垂根）、
  **I14 饥饿与饱和度**（隐藏饱和度与疲劳值、按食物不同的回复曲线、
  进食 1.6 秒里每 4 口挥手 + 咀嚼声）、
  **B16 数量台账**（`audit:blocks` / `audit:recipes` 都在跑，真缺口只剩机制产物）。
  待办 8 → **5**（剩 E23 悬案 / L5 局域网 / N1 / N3 / O5），完成 223 → **226**。
- 批次 507（G8 收口）：**逐武器攻击冷却 + 冷却条**。
  `core/combat/AttackSpeed.ts`：徒手 0.25 / 剑 0.625 / 镐 0.833 / 锹锄剪 1.0 /
  三叉戟 0.909 / 斧按材质 1.25·1.11·1.0（以前所有武器统一 0.5，斧头比原版快一倍多）；
  `ui/AttackCooldownHud.ts` 在准星下方画 44×3 的小条（2% 量化、满了隐藏）。
  新套件 `test:attack` **30 条**；套数 154 → **155**；**G8 勾掉**（226 → **227**、
  进行中 57 → **56**）。⚠️ 差异：不做"未满蓄力的伤害折扣"（攻击是冷却门控的）。
- 批次 508（口径校准，第三批）：收口 6 条"机制早已齐、注记停在旧状态"的——H6 熔炉经验结算、
  H7 箱子联动、H13 农业四作物、J4 六种敌对生物、J6 战斗（冷却于 507）、J9 弹射物（引雷 269）。
  完成 227 → **233**、进行中 56 → **50**。
- 批次 509（J11 尾巴）：**村民每日补货 + 价格浮动**。`demand`（成交 +1 / 跨日 -1）、
  `tradePriceDelta = floor(demand/2)`（最多 +3）加在第一样收货；`restock()` 由 `advanceDay`
  驱动；`demand` 随寄存/存档往返；界面按需求重建价格行。`test:villager` 141 → **170 条**。
- 批次 510（J11 尾巴）：**村民作息走动**。`core/world/VillagerRoutine.ts` 纯函数：
  白天（0.02~0.45）去工作站、其它时间去床边；`routineTarget` / `villagerArrived`
  决定目的地与"到了没有"；主程序每 0.5 秒下发一次 `walkToward`（`guardToward`
  只写 moveDir），到点 `standStill`。家（床脚）在村庄人口生成时设好，
  家与工作站坐标随存档与实体寄存往返（脏坐标整份丢弃）。
  `test:villager` 170 → **200 条**；顺带把 `test:spawn` 下界采样 30 → 120 轮（修偶发红灯）。
  ⚠️ 走位是直线、不绕路（村里够用，不占每帧寻路预算）。
- 批次 511（J11 收口）：**村民恐慌 + 铁傀儡联动**。`VillagerPanic.ts`：10 种威胁、8 格内最近、
  反向跑 6 格、恐慌 5 秒、速度 ×1.35；恐慌源进 `panicThreats`，**铁傀儡优先打它**。
  `test:villager` 200 → **227 条**；**J11 勾掉**（234 / 49）。⚠️ 无恐慌粒子、无 gossip。
- 批次 512（J3 第一批）：**目标选择器规则表**。铁傀儡打敌对、野狼捕猎羊兔鸡、驯服狼打敌对；
  `tickGuardians` 不再写死 `iron_golem`。`test:target` **42 条**，套数 155 → **156**。
- 批次 513（J3 第二批）：**雪傀儡远程雪球**（10 格 / 1.5 秒 / 0 伤害 + 击退，抬升 2.4）。
  `test:target` 42 → **51 条**。⚠️ J3 仍缺：开门、游泳、"被打后追玩家"并入选择器。
- 批次 514（文档对齐）：修正 12 处过期"还没做"，并把**末影箱配方换回原版**（8 黑曜石 + 1 末影之眼）。
- 批次 515（J3 第三批）：**"追玩家"判据抽成纯函数**。`ChaseRules.ts`：`isPacified`
  （记仇优先于亮处中立）+ `shouldChasePlayer`（敌对/中立/光照/记仇/隐身/距离）；`Mob.updateAi`
  只取数不拼 `&&`（行为不变，`test:mob` 146 条原样过）。`test:chase` **26 条**，套数 → **157**。
- 批次 516（J3 尾巴）：**生物开门**。`DoorRules.ts` + `PathOptions.isDoor` +
  `EntityContext.openDoor`，主程序复用 `toggleDoor`。`test:doors` **13 条**，套数 → **158**。
  ⚠️ J3 只剩游泳。
