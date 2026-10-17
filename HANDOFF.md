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

- 时间：2026-10-17 · 提交总数 504（每个功能点一条，可逐条回滚；`npm run audit:tasks` 会核对这一句）
- 技术栈：TypeScript（严格模式）+ Vite + Three.js / WebGL2；无第三方运行时依赖（除 three）
- 进度口径：`TASKS.md` 共 287 项 —— 已完成 **171**、进行中 **71**、待办 45 条（其中 55 条是需求审计新补的**整组**缺口，逐组明细见 `docs/HANDOFF-ARCHIVE.md` 的「需求审计」一节）；
  （`npm run audit:tasks` 会核对这一行与本表，改完条目记得跑一次）
  其中相当一部分待办是长期大项（村民与交易、织布机等功能方块、信标与地图、喷溅/滞留药水等）
  —— **进行中口径以 `.codebuddy/auto-continue.md` 队列为准**，两份文件分工不同，不要只看一份
  —— 2026-10-15 做过一次**逐条核对**（对着 src/tools 的真实实现重判 37 条），
  勾选状态与代码实况已对齐；以后每完成一项顺手改这两份文件，避免再次漂移
- 最新批次 158（手机画质与帧率）：掉帧时的降级顺序反转成 **视距 → 装饰层 → 分辨率**
  （分辨率是全局的、会把近处一起糊掉，所以排到最后一档）；手机视距独立封顶 8、
  分辨率兜底只到 0.75、开局不再预折。雾改成**滞后于**视距的连续量（收缩快、扩张要等远处画好），
  地形于是"从雾里浮出来"而不是逐块弹出；新增装饰层档位（云 / 粒子 / 雨量）与音效并发节流
- 批次 156：携带版生存 / 创造背包统一为“左物品或配方、右合成或装备”的双栏；
  左侧五个分类/搜索入口和左下箱子独立控制左栏，右下工作台/人物键只切右栏。
  生存缺料配方改红底；不可放置槽与面板内空白会取消选中并安全退回，窗口外仍丢弃。
  844×390 实测了生存、配方、装备与物品移动/拒绝/取消路径。
- 批次 155：手机打开即横屏全屏（manifest / 微信 X5 / 第一次点击锁方向）；
  视距没涨完时不再按桌面的 12 万步光照走，手机背板上限 1.5、开局分辨率 0.8、视距 6。
  否则帧时间过不了 22ms，渐进视距停住，启动期预算就永远不停。
- 批次 154：手机渲染稳定性收口——区块异步重建改为新旧网格原子替换；动态分辨率改为
  设备 DPR 的相对倍率（DPR=3 的 0.9 档实际为 1.8，不再骤降到 0.9）；启动雾墙随渐进视距
  外推，物品图标统一按 CSS 实际显示尺寸分配像素背板，转屏也复用同一套 DPR 同步。
  高 DPR 手机模拟与 110 套离线门禁均通过。

### 历史详情（**按需读**，不要一开始就全读）

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
npm run check              # 【提交前】typecheck + 单测 + 110 套离线测试 + 三张台账（全过才提交）
npm run check:fast         # 【改代码时】typecheck + 单测 + 只跑被改动命中的套件（秒级）
npm run build              # 类型检查 + 生产构建（带 sourcemap，发布用）
npm run build:fast         # 只验"能不能出包"（SOURCEMAP=0，产物 hash 与正式构建一致）
npm test                   # typecheck:tools + vitest + 110 套离线测试
npm run test:offline:changed  # 只跑与本次 git 改动相关的离线套件
npm run audit:tasks        # 任务清单自检（编号重复/跳号 + 本文件进度口径是否过期）
npm run gen:stats          # 地形生成统计（耗时/洞穴占比/矿石产量）
npm run agent:setup        # 跨机器自检
```

**这些是一条链**：`npm run check` = `typecheck` + `test` + 三张台账。
`test` = `typecheck:tools` + `test:unit`（vitest）+ `test:offline`
（`tools/run-tests.mjs`：**一次 esbuild 打包全部入口 + 多进程并行**，
32s → 9s，见 TASKS A13）。单套调试仍可直接 `npm run test:reach` 这类老命令。

`npm test` 那一层共 **110 套**自建离线测试（清单的唯一来源是 `package.json` 的 `test:*` 脚本，
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
