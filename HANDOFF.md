# 接手必读 · HANDOFF

> 这是「Minecraft 基岩版 1.18 复刻（Web / WebGL2）」的进度交接文档。
> **换电脑、换会话、换人接手，都先读这一份**（整份读完再按需展开，不用挑），
> 再读 `.codebuddy/hooks/process/auto-continue.md`（推进队列）和 [TASKS.md](./TASKS.md)（长期总表）。
> 会话聊天记录本身不随仓库走，能带走的关键上下文都沉淀在下面。
> 大块历史正文已经拆出去按需读，见 §1 的索引表（`docs/HANDOFF-ARCHIVE.md` / `docs/EXPERIENCE.md`）——**不要一开始就把它们全读进来**。

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

然后对 AI 说一句：**「读 AGENTS.md、HANDOFF.md 与 .codebuddy/hooks/process/auto-continue.md，按队列继续推进。」**
之后 Stop 钩子会自动按队列继续，不需要逐步确认（机制见第 3 节）。

验收门槛：`npm run check` 全过（= `typecheck` + `npm test` + 三张台账），`npm run build` 能出包；失败时先跑 `npm run audit:tasks`（直接指出三处锚点哪处漂了：本文件 / TASKS 顶部 / README 路线图）。

> **改代码时的内循环别用 `check`**（那是提交前的全量），用这两条：
> `npm run check:fast`（typecheck + 单测 + **只跑被改动命中的那几套离线测试**）、
> `npm run build:fast`（关掉 sourcemap 的构建，只验"能不能出包"，产物内容与正式构建一致）。

## 1. 当前状态快照

- 时间：2026-10-21 · 提交总数 1318（每个功能点一条，可逐条回滚；`npm run audit:tasks` 会核对这一句）
- 技术栈：TypeScript（严格模式）+ Vite + Three.js / WebGL2；无第三方运行时依赖（除 three）
- 进度口径：`TASKS.md` 共 293 项 —— 已完成 **283**、进行中 **8**、待办 0 条（另有 3 条主动放弃：D22 预设、L5 局域网发现、O5 原版对照截图）（其中 55 条是需求审计新补的**整组**缺口，逐组明细见 `docs/HANDOFF-ARCHIVE.md` 的「需求审计」一节）；
  （`npm run audit:tasks` 会核对这一行与本表，改完条目记得跑一次）
  其中相当一部分待办是长期大项（村民与交易、织布机等功能方块、信标与地图、喷溅/滞留药水等）
  —— **进行中口径以 `.codebuddy/hooks/process/auto-continue.md` 队列为准**，两份文件分工不同，不要只看一份
  —— 2026-10-15 对着 src/tools 真实实现逐条核对过 37 条；以后每完成一项顺手改这两份文件
- ⚠️ **批次号撞过四次**（272~283 / 295-x / 303 / 499~500；其中 499/500 各有两个提交：`11f8606`
  刷怪密度 / `cde231c` 鞘翅、`f3226c7` 寻路 / `03ee988` 测试）：引用旧提交一律按 **hash**，本批取 **521**。
- 批次 620（用户"PC 端的背包物品不能滑动、不能翻页，搜索框位置也不对"）：三条都出在
  **"只对触摸端成立"的规则没带 `body.touch-mode`**——携带版窄壳三端统一，PC 一起吃了：翻页条被
  `display:none !important` 藏掉、`scrollbar-width:none` 让"还能滚"看不出来、左栏 7~8 列 + 174px 窗口
  使一页 60 件只露四行。修法：隐藏只留给触摸端，另加 `body:not(.touch-mode)` 一段只改 PC 的尺寸/滚动/
  翻页条（`--pc-inv-cell` + `auto-fill`、物品格与搜索框同 574px 中轴、原生细滚动条、主背包 9 列 × 52px）；
  页大小仍是 `PAGE_SIZE_WIDE` = 12 × 5，移动端未动；`test:ui` 加 3 条守卫（926 通过）。
- 批次 619（用户"进世界会弹一下世界统计"）：**`#statistics` 在 CSS 里根本不存在**——
  `index.html` 只给 `#advancements` 写了 `fixed; inset:0; z-index:55` 与 `.hidden{display:none}`，
  而 `StatisticsScreen` 的根节点是 `#statistics`：`hidden` 不命中，面板从 App 构造起就是
  `position:static` 的普通块、占满视口，被 canvas 盖住、进世界瞬间闪一下。修法：并进同组。
- 批次 618（真机"方块表面纯黑"的**真正根因**）：**N4 跨 section 合并的属性步长笔误**——
  `mergeSectionLayer` 把 `aTile` / `aLight` 按每顶点 **3** 分量分配与写入，而
  `createGeometry` 里两者都是 **2** 分量。单 section 时 `vertexOffset = 0`、前 2N 个元素
  恰好正确（离线测试的假数据也按 3 造，正好掩护），一旦区块有 2 个以上非空 section
  （山地/洞穴/带树），第二个 section 起贴图起点与光照整段错位、顶点读到 0 →
  "天空正常、方块表面纯黑"。已实测：修复前整屏发黑，修复后草地/树木/水面正常。
  617 里那条 `ENTER_GUARD_MS` 守卫因无证据已整段回退，只保留 `NameTagEditor.dispose()`。
- 批次 616（真机"方块表面纯黑"）：用户在洞里截图——天空正常、方块纯黑。根因两条：
  ① `World.getSkyLight/getBlockLight` 对**不在内存的区块返回 0**，而平滑光照要读跨界一格的
  4 个采样格，先加载的区块在邻居未到时被网格化 → 边界顶点两个采样是 0 → 黑；
  ② 批次 565 的补刷**只做一次**，而已渲染区块持续增长（真机 62 → 182 块），
  后加载的 120 块永远等不到第二次补刷，黑边永久烧进网格。
  修法：`onChunkLoaded` 置 `remeshPending`，主循环在光照排空后清标记并全量重排（1 秒节流）。
  不用"每 N 秒兜底刷"：182 块全量重排要重建 182 份几何，手机会持续掉帧；
  只在真加载新地形时刷，稳态游玩一次不触发。`test:render` 4 → **12 条**。
- ⚠️ 295-1~295-4 被并发会话占用，那两个提交正式编号是 297 / 298；303 同理（正式 304）。
- 批次 191 及更早（167~191，共 25 条）：已搬到 `docs/HANDOFF-ARCHIVE.md` 的「§1 批次流水」
  ——那部分是"当时怎么做"的查阅材料，不再是"现在什么状态"。**本文件只保留最近 6 批**
  （`npm run docs:trim` 自动归档，上限 340 行）；更早的记录 `git log --grep="批次 NNN"` 可查。

**批次 101 做过一次上下文瘦身**：这一节后面原先挂着约 900 行的"已打通模块表 + 需求审计 +
逐批流水"，另外 §4 还挂着约 330 行的经验表——**每轮会话都要读一遍纯粹是浪费**，
已经拆到下面两份文件里（内容一字未改，只是挪了位置）：

| 想查什么 | 读哪一份 |
| --- | --- |
| 某个模块（光照 / 网格化 / 容器 / 生物 / 结构…）当时是怎么做的 | [`docs/HANDOFF-ARCHIVE.md`](./docs/HANDOFF-ARCHIVE.md) |
| "这个坑踩过了，结论是什么" | [`docs/EXPERIENCE.md`](./docs/EXPERIENCE.md) |
| 下一步做什么（**唯一的"进行中"口径**） | [`.codebuddy/hooks/process/auto-continue.md`](./.codebuddy/hooks/process/auto-continue.md) |
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
2. **不停下来等确认**：按 `.codebuddy/hooks/process/auto-continue.md` 队列自己推进；遇到困难自己想办法解决并记录结论，
   而不是把问题抛回给用户。

细节与动机记录在仓库内 `.codebuddy/memory/`（AI 记忆的版本化副本）。

## 3. 自动继续机制（换机器最容易坏在这）

- 钩子脚本：`.codebuddy/hooks/auto-continue.mjs`（按队列继续）+ `auto-commit.mjs`（拦住"没提交就想停"），
  挂在 Stop / UserPromptSubmit 上，配置 `.codebuddy/settings.json`，**相对路径**写命令
  （不生效时 `npm run agent:setup -- --fix-hooks`）。
- **目录分工**：`.codebuddy/hooks/process/`（队列 + 归档 + `batch-seq`，进仓库）/
  `.codebuddy/hooks/logs/`（日志 + 计数状态，gitignore，超 512KB 转存 `.1`）/ `.codebuddy/*.off`（刹车）。
- **脚本自己认路**：两个脚本都用 `import.meta.url` 上退 2 层算项目根，不依赖 cwd 与
  `CODEBUDDY_PROJECT_DIR`（条件注入）——**目录改名也不用改配置**。
- 刹车：`touch .codebuddy/{auto-continue,auto-commit}.off`；**没有轮次上限**，队列不空就一直跑。
- **AI 可插任务**：`- [ ] [发现] …`（须带证据，最多 5 条）；**卡死保护**：同一条连续 5 轮做不完 → 标 `[阻塞]` 跳过并要求 AI 上报等你决策。
- **上下文水位 150k**（`AUTO_CONTINUE_CONTEXT_LIMIT`）：每轮从 `transcript_path` 读
  `input_tokens`，过阈值就转为"收干净 + 写清下一步 + 给交接摘要"再停。
  钩子**开不了新会话**（`Stop` 只能返回 `additionalContext`），所以它生成"新会话第一句话"
  写进 `hooks/logs/handoff-prompt.txt`；手动收尾用 `AUTO_CONTINUE_FORCE_HANDOFF=1`。

**auto-commit 只当守卫，不替 AI 提交**：脚本里**没有任何 git 写操作**，只负责发现未提交改动
就阻止停止，把清单和规矩交回 AI 自己 review + 提交。理由：message 质量取决于"知不知道自己
为什么这么改"，脚本拼出来只能是 `update files`。五道放行：`.off`、非 git 仓库、
merge/rebase/cherry-pick 中、detached HEAD、未解决冲突——后四种是危险 git 状态，拦人反而掩盖问题。

**踩过的坑（别重犯）**：`{"continue": false}` 可能被当成"硬停止"（本仓库 `41be0e12` 踩过）。
`auto-continue.mjs` 因此用 `{"continue": true}` + 反馈走 **stderr** + `exit 2`；
`auto-commit.mjs` 默认走文档写法（`continue:false` + `reason`），
**若发现 AI 不理会拦截、直接停了，设 `AUTO_COMMIT_STYLE=exit2` 切到实测那套。**

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

~~非完整方块展示平台整体偏暗~~ → **批次 565 补了"光照首次收敛后全量重刷"**；
**批次 616 真机查出更严重的"方块表面纯黑"并修掉**（两次根因见 `TASKS.md` E23：
越界光照返回 0 + 补刷只做一次）。现在改成"新区块加载后置脏标记、光照排空时补刷"。
真机若仍偏暗，才查顶点光照/材质本身。
**剩余 9 项"哪些能自己做、各自卡在哪" + 命名牌 `name_tag` 真缺口** → `.codebuddy/hooks/process/auto-continue.md` 的《剩余 9 项与阻塞》（原 `PENDING.md` 已并入，不再单独维护）。⚠️ **钩子不再按上下文停**（2026-10-21 删掉交接模式，改"发现风险才弹窗"，见 `TASKS.md` O16）。

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
npm run check              # 【提交前】typecheck + 单测 + 169 套离线测试 + 三张台账（末尾 check:browser 默认跳过；BROWSER_CHECK=1 才真跑浏览器）
npm run check:fast         # 【改代码时】typecheck + 单测 + 只跑被改动命中的套件（秒级）
npm run shot               # 截图到 .tmp/shots/（没浏览器就跳过）；npm run guard = 控制台零错误门禁
npm run build              # 类型检查 + 生产构建（带 sourcemap，发布用）
npm run build:fast         # 只验"能不能出包"（SOURCEMAP=0，产物 hash 与正式构建一致）
npm test                   # typecheck:tools + vitest + 169 套离线测试
npm run test:offline:changed  # 只跑与本次 git 改动相关的离线套件
npm run audit:tasks        # 任务清单自检（编号重复/跳号 + 本文件进度口径是否过期）
npm run gen:stats          # 地形生成统计（耗时/洞穴占比/矿石产量）
npm run agent:setup        # 跨机器自检
```

**这些是一条链**：`npm run check` = `typecheck` + `test` + 三张台账。
`test` = `typecheck:tools` + `test:unit`（vitest）+ `test:offline`
（`tools/run-tests.mjs`：**一次 esbuild 打包全部入口 + 多进程并行**，
32s → 9s，见 TASKS A13）。单套调试仍可直接 `npm run test:reach` 这类老命令。

`npm test` 那一层共 **169 套**自建离线测试（清单的唯一来源是 `package.json` 的 `test:*` 脚本，
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
| `.codebuddy/hooks/process/`（队列 + 归档 + `batch-seq`）、`.codebuddy/hooks/*.mjs`、`.codebuddy/settings.json` | `.codebuddy/hooks/logs/`（日志 + 计数状态，每轮都变） |
| `.codebuddy/memory/`（AI 记忆的版本化副本，`npm run agent:setup` 恢复到本机） | 截图 `shot-*.png`、`.codebuddy/*.off`（刹车开关） |

> 长跑任务列表怎么排、`process/` 与 `logs/` 为什么分开 → `.codebuddy/hooks/process/auto-continue.md` 开头。

**唯一的外部依赖：git 远程仓库**（没有远程 = 代码只在本机）。查看 `git remote -v`，
没有就 `git remote add origin <地址>` 再 `git push -u origin main`。

## 8. 恢复一段会话的正确姿势

1. 新机器按第 0 节跑完，确认 `npm run agent:setup` 结论是「一切就绪」；
2. 打开 AI 会话，第一句给足上下文：
   「读 AGENTS.md、HANDOFF.md、.codebuddy/memory/MEMORY.md、.codebuddy/hooks/process/auto-continue.md，然后继续推进队列」；
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
- 批次 513（J3 第二批）：**雪傀儡远程雪球**（10 格 / 1.5 秒 / 0 伤害 + 击退）。`test:target` → **51 条**。
- 批次 514（文档对齐）：修正 12 处过期"还没做"，并把**末影箱配方换回原版**（8 黑曜石 + 1 末影之眼）。
- 批次 515/516（J3）：**追玩家判据纯函数** + **生物开门**。`test:chase` 26 / `test:doors` 13 条。
- 批次 517（J3 收口）/ 518（B15 尾巴）：**生物游泳**（`test:swim` 16 条）/ **望远镜**
  （FOV × 0.12，`test:spyglass` 22 条；B15 只剩细雪）。
- 批次 519/521（结构深度第一、二批）：**府邸 17~25 间** + **要塞上下两层**（梯子井）。
  `test:structure` → **153 条**。
- 批次 522（结构深度收口）：**堡垒第二种形制**（桥 + 宝库 / 两层居住区，坐标哈希各半）。
  `test:bastion` 106 → **110 条**。
- 批次 529（世界创建验收）：`test:worldmatrix` **21 条**——60 组组合创建/字段/持久化、
  10 组出生点与出生区块、四档难度语义、UI 三项传参守卫；`WorldRegistry.create` 对
  type/mode/difficulty 一律先规范化。套数 160 → **161**。
- 批次 530（显示修复）：**"骨块/蓝色旗帜等方块没有着色"的根因是图集超出纹理上限**。
  1234 张贴图 × 16 列 = 78 行，上传画布高 **2496px > 2048**，第 64 行（下标 1024）之后
  整批不上传——骨块正好从第 64 行开始，所以"一批方块同时白掉"。
  列数 16 → **32**（39 行、1024×1248），新增 `test:textures` **22 条**：
  尺寸上限 / 画笔齐全 / 方块贴图名存在 / 越界区行号 / 骨块与旗帜机制完整。套数 161 → **162**；结论：**这些方块是显示问题，不是机制缺失**（骨块 9 骨粉互转、旗帜 4 图案与织布机都在）。
- 批次 531（白块真正根因）：`noisy(0xRRGGBB)` 把 24 位色当亮度 → **95 张**彩色贴图全白；
  按 `>255` 拆三通道修复，`test:textures` 22 → **29 条**。Node/浏览器/游戏截图三层验证。
- 批次 532：删除非原版 caves / floating_islands（旧存档回落 default）；**旁观穿地**
  （`startsFlying` 三处保证起飞）与**正面相机**（`y = -dir.y`，射线同向）修复。套数 162 → **161**。
- 批次 533：新增 **large_biomes**（群系 /4、面积 ×4）与 **single_biome**（创建时选群系，
  贯通 Worker）。`test:world` 82 条；浏览器实测单一沙漠表层一致、大型群系可加载。
- 批次 534（旁观者口径对齐）：**穿墙是原版行为，保留**；修掉四处偏离——原来会掉岩浆/
  虚空血、会捡东西、会被怪追、会掉饥饿/氧气。现在 `canTakeDamage` / `canPickUpItems` /
  `playerInvisible: 旁观` / 生存环境 `creative + spectator`，HUD 隐藏。
  浏览器实测：旁观者 y=-100 时生命/饱食/氧气都不变。
- 批次 540~613（J27 装备 + J12 攻击/远程动画 + B8 水流/下落方块 + K2 比较器 + K4 药水 + B20 灵魂火 + B18 潮涌核心/盾牌 + B15 细雪 + B55 冒险模式 + B57 极限模式 + B58 统计）：15%/件盔甲与主手武器、武器伤害按工具表、1.9 公式减伤、8.5% 掉落（带 0~60% 耐久损耗）；近战 0.35 秒挥臂、远程双臂抬向前；水流推力扩到生物/掉落物；沙/沙砾/混凝土粉末/脚手架失去支撑时下落；比较器读容器 + 减法模式 + 中继器侧向锁存；水肺/跳跃药水；灵魂火；潮涌核心；细雪；冒险模式；极限模式；盾牌减速/挡爆炸/斧头破防；世界统计面板；漏斗灌堆肥桶；床顶遮挡；黏液块整组推拉；羊吃草长毛；细雪锅；信标次级主效果；雷击转换（猪→僵尸猪灵/村民→女巫/苦力怕充能）；光照首次收敛后全量重刷（E23）；区块几何复用池（N3）；光照/明暗顶点量化（N1）；皮匠/制图师职业；四档马铠；战利品装备随机耐久与附魔；13 个村民工作站职业收口；拴绳绷紧牵引；矿车行驶音效；蜂蜜块整组推拉；活塞/发射器准连接；M20 设置项口径收口；甜浆果丛减速/扎人/右键采摘与可可豆荚失去支撑；B17/B19/B20 口径收口；音符盒红石脉冲演奏（G9 收口）；实体寄存装备/马鞍/马铠；求爱/繁殖冷却寄存；刷怪笼迷你生物靠近才转（K6 收口）；红石元件覆盖度 100%（K1 收口）；生物盔甲（E14）与物品注册表（B9）口径收口；噪声/密度黄金参考值（A6 收口）；O3/L1/N5 按代码证据收口；存档文件导出/导入（L2 收口）；下界核心链路（K8 收口）、J12 复核；牵引绳精确长度约束（J19a）；驴/骡/羊驼 15 格货舱（J19b、J19 收口）；背包交互（H19 收口）、M23 复核；炼药锅（G13 收口）、雪傀儡与被动生物（J5 收口）；爆炸抗性与方块属性（B5 收口）；成书复制（H16 收口）；生物群系采样缓存（C6 收口）；断环链（J26）与离线基准（A8）收口；远程玩家位置插值（L4）；末影龙栖息阶段（J10 收口）；跨维度实体转移（J2 收口）；网格化优先级调度（N2 收口）；噪声路由器字段口径（D3 收口）；区块生命周期状态机（C5 收口）；密度函数组合树（D2 收口）；同材质 section 合并（N4 收口）；远程拉弓蓄力（J12）；遮挡剔除按设计不做（E17 收口）；联机容器同步（L4）；实体动画按方块美术口径收口（J12）；移动端 Web 适配（N6 收口）；A9 口径校准。`test:equipment` 43、`test:mob` 168、`test:physics` 120、`test:hopper` 118、`test:bed` 117、`test:redstone` 174、`test:bucket` 62、`test:beacon` 112、`test:brewing` 2415、`test:fire` 91、`test:conduit` 19、`test:lightning` 93、`test:render` 236、`test:villager` 233、`test:loot` 100、`test:entity` 199、`test:endboss` 26、`test:audio` 91、`test:survival` 107、`test:gamemode` 64、`test:worldmatrix` 29、`test:shield` 54 条，套数 161 → **163**。
