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

- 时间：2026-10-20 · 提交总数 1014（每个功能点一条，可逐条回滚；`npm run audit:tasks` 会核对这一句）
- 技术栈：TypeScript（严格模式）+ Vite + Three.js / WebGL2；无第三方运行时依赖（除 three）
- 进度口径：`TASKS.md` 共 288 项 —— 已完成 **190**、进行中 **80**、待办 18 条（其中 55 条是需求审计新补的**整组**缺口，逐组明细见 `docs/HANDOFF-ARCHIVE.md` 的「需求审计」一节）；
  （`npm run audit:tasks` 会核对这一行与本表，改完条目记得跑一次）
  其中相当一部分待办是长期大项（村民与交易、织布机等功能方块、信标与地图、喷溅/滞留药水等）
  —— **进行中口径以 `.codebuddy/auto-continue.md` 队列为准**，两份文件分工不同，不要只看一份
  —— 2026-10-15 做过一次**逐条核对**（对着 src/tools 的真实实现重判 37 条），
  勾选状态与代码实况已对齐；以后每完成一项顺手改这两份文件，避免再次漂移
- ⚠️ **批次编号冲突（本轮）**：另一条会话在同一时间段占用了 **272~283**。本轮 7 条用户反馈的
  8 个提交正式编号是 **284~291**；旧 commit message 里写的 272~279 是当时撞号，
  以后引用/回滚请按下面的新号或 commit hash（历史不重写，避免动已推送的分支）。
- 批次 439（内容）：**磨制玄武岩 + 蓝冰**（复用玄武岩/浮冰贴图，不新画）。
  方块 **671 → 673（96%）**、配方 **700 → 702（70%）**；`test:crafting` 95 → **100 条**。
- 批次 440（内容）：**蜜脾块**（4 蜜脾 2×2 → 1，纯装饰，无行为）。
  方块 **673 → 674（96%）**、配方 **702 → 703（70%）**；`test:crafting` 100 → **103 条**。
- 批次 441（内容）：**蛛网**（能穿过、水平速度 ×0.25）。`PhysicsWorld` 新增可选钩子
  `isCobweb`，`World.isCobweb` 一次查表；拆了掉**线**（原版用剪刀掉蛛网本身，
  本项目没有剪刀）；矿井还没撒蛛网，所以它进了可达性白名单（缺口 17 → 18 条）。
  方块 **674 → 675（96%）**；`test:physics` 69 → **73 条**。
- 批次 442（内容）：**矿井里挂蛛网**，蛛网因此从可达性白名单里**删掉**（缺口 18 → 17）。
  生成来源表同步补 `Block.COBWEB`（审计靠这张表）；`test:structure` 44 → **46 条**。
- 批次 443（内容）：**六种剥皮原木 + 斧头剥皮交互**（`stripResult` 映射 + `stripLog`）。
  可达性闭包**新增一条交互型来源**（拿到原木就等于拿到剥皮原木）——
  不然六块只能塞白名单，那是给"审计没建模的东西"记黑账。
  方块 **675 → 681（97%）**；`test:reach` 61 → **62 条**（闭包 904 → 910）。
- 批次 444（内容）：**五种木材的按钮 / 压力板（10 块）**。前置是**重构**
  `RedstoneEngine`：5 处 `case Block.OAK_BUTTON` 收敛成 `isButtonId` / `isPlateId`；
  "电源强度"那段改成**先判后 switch**（写成 case 会让新方块落进 default，
  表现是"压力板通电了但旁边电路没反应"）。
  方块 **681 → 691（99%）**、物品 **1067（97%）**、配方 **713（71%）**；
  `test:crafting` **114 条**、`test:redstone` **135 条**。
  ⚠️ 清单里剩下六个（海绵/蜜块/蛛网/磁石/重生锚/湿海绵）**都要行为**，不是加方块。
- 批次 445（持久化）：**实体寄存补齐幼体 / 状态效果 / 掉落物附加数据**（J2 第三刀）。
  `EntityParking` 的记录新增 `baby` / `growSeconds` / `effects[]` / `extras`；
  `Mob.makeBaby()` 可接剩余成长秒数（否则快长大的幼体读档后从头再等 20 分钟）；
  写存档时白板物品不写 `extras` 键，避免每条记录都挂一个空对象。
  `test:entity` 169 → **178 条**（9 条：三类字段往返、JSON 往返、脏数据清洗）。
  仍未做：繁殖/求爱计时、马鞍、羊驼的箱子、**跨维度转移**（下一批）。
- 批次 446（联机）：**掉落物可见同步**（L7 第一刀）。本地每 100ms 扫实体表，
  新增/消失各发一条；服务端用 `owner + localId` 当键、owner 由连接身份拼装
  （客户端伪造删不掉别人的），离线时清掉他名下那一批；新玩家 `welcome` 带 `items` 快照。
  镜像标 `ItemEntity.ghost`：不跑物理、不拾取、不合并、不写存档。
  ⚠️ 远端那一堆**拿不到**——拾取仲裁留给下一刀。`test:net` 21 → **28 条**。
- 批次 447（物理）：**水流推动**（F9 收口）。新模块 `core/world/FluidFlow.ts`（纯函数）：
  从液面等级推流向（朝更薄的水格），水柱额外向下按；静水不推。
  接进 `PlayerPhysics` 时折进**目标速度**（每帧加增量会被 `approach` 拉回去）。
  只接玩家；`waterlogged` 仍未做。`test:physics` 73 → **81 条**。F5/F9 勾掉（188 → 190）。
- 批次 448（红石）：**投掷器 / 发射器的 4 tick 延迟**（0.2 秒）。上升沿只登记
  `dispenserTimers`，到点在 `tick` 里才调 `onDispense`；延迟期间方块被拆掉则取消。
  这是 B33 差异台账里"立即吐"那一条的收口。`test:dropper` 108 / `test:dispenser` 130 条。
- 批次 449（内容）：**海绵 + 湿海绵**（B54 里"要行为"的四件之一）。
  `core/world/Sponge.ts` 纯函数：半径 3 的 7×7×7、上限 **65 格**、按距离近到远吸；
  放下时吸到水就变湿海绵（`main.absorbWithSponge`），湿海绵只能熔炉烤干（Smelting +1 条）；
  海底神殿加了 6 块湿海绵（唯一来源，`GenerationSources` 已登记）。
  方块 **691 → 693（99%）**；新增 `test:sponge` 18 条，套数 **133 → 134**。
- 批次 450（内容）：**蜂蜜块**（B54 里"要行为"的第二件）。三条行为都挂在
  `PhysicsWorld.isHoney` 上：站在上面**跳不起来**（连自动跳跃一起取消）、
  贴着侧面下滑限速 **1.2 格/秒**；摔落减伤走 `PlayerStats.honeyFallDistance`
  （缩的是门槛以上那一段：`3 + (d-3)×0.2`，不缩会把 3 格免伤一起吃掉）。
  配方 4 蜂蜜瓶 2×2（蜂蜜瓶来自 J21 的蜂巢）。`test:physics` 81 → **85**、
  `test:survival` **83 条**、配方 **670**。
- 批次 451（内容）：**16 色潜影盒**（B54 的"16 色族"缺口）。无色 482 保持原 id
  （存档里存着它），16 色接 **697~712**；每色三张贴图（顶/底/侧，48 张，基色取
  `DYE_COLORS` 与羊毛同色）；容器/掉落带内容/活塞推不动三处特判收敛成
  `isShulkerBox(id)`；配方 16 条（无色 + 染料）。方块 **694 → 710**、配方 **686**，
  `test:crafting` 114 → **124**。
- 批次 452（口径）：`npm run audit:blocks` 的两处**假缺口**修正——
  ① `wall_sign` 6 种：本仓库用 `sign` + `wallMounted` 状态位表达（火把同一套路），
  `blockShapes` / `Placement` 都已支持挂墙牌，不需要独立 id，已移出缺口表；
  ② `stripped_log` 6 种：已有，审计只认 `oak_stripped_log` 而实际叫
  `stripped_oak_log`（这就是 B54 记的命名坑）。修完审计只剩
  `mud`（1.19 不做）+ `lodestone` + `respawn_anchor`。
- 批次 453（内容）：**磁石**。绑定坐标记在**物品**上（`ItemStack.lodestone`，
  四处数据链路一起补：`restoreStack` / `stackExtras` / `sameExtras` / 深拷），
  手持指南针右键磁石即绑定，HUD 改指磁石（跨维度按"指不到"处理）。
  配方 8 雕纹石砖 + 1 下界合金锭。方块 **710 → 711**、配方 **687**，
  `test:inventory` 77 → **89**。
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
npm run check              # 【提交前】typecheck + 单测 + 134 套离线测试 + 三张台账（全过才提交）
npm run check:fast         # 【改代码时】typecheck + 单测 + 只跑被改动命中的套件（秒级）
npm run build              # 类型检查 + 生产构建（带 sourcemap，发布用）
npm run build:fast         # 只验"能不能出包"（SOURCEMAP=0，产物 hash 与正式构建一致）
npm test                   # typecheck:tools + vitest + 134 套离线测试
npm run test:offline:changed  # 只跑与本次 git 改动相关的离线套件
npm run audit:tasks        # 任务清单自检（编号重复/跳号 + 本文件进度口径是否过期）
npm run gen:stats          # 地形生成统计（耗时/洞穴占比/矿石产量）
npm run agent:setup        # 跨机器自检
```

**这些是一条链**：`npm run check` = `typecheck` + `test` + 三张台账。
`test` = `typecheck:tools` + `test:unit`（vitest）+ `test:offline`
（`tools/run-tests.mjs`：**一次 esbuild 打包全部入口 + 多进程并行**，
32s → 9s，见 TASKS A13）。单套调试仍可直接 `npm run test:reach` 这类老命令。

`npm test` 那一层共 **134 套**自建离线测试（清单的唯一来源是 `package.json` 的 `test:*` 脚本，
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
