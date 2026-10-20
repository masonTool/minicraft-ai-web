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

- 时间：2026-10-20 · 提交总数 1107（每个功能点一条，可逐条回滚；`npm run audit:tasks` 会核对这一句）
- 技术栈：TypeScript（严格模式）+ Vite + Three.js / WebGL2；无第三方运行时依赖（除 three）
- 进度口径：`TASKS.md` 共 288 项 —— 已完成 **235**、进行中 **48**、待办 5 条（其中 55 条是需求审计新补的**整组**缺口，逐组明细见 `docs/HANDOFF-ARCHIVE.md` 的「需求审计」一节）；
  （`npm run audit:tasks` 会核对这一行与本表，改完条目记得跑一次）
  其中相当一部分待办是长期大项（村民与交易、织布机等功能方块、信标与地图、喷溅/滞留药水等）
  —— **进行中口径以 `.codebuddy/auto-continue.md` 队列为准**，两份文件分工不同，不要只看一份
  —— 2026-10-15 对着 src/tools 真实实现逐条核对过 37 条；以后每完成一项顺手改这两份文件
- ⚠️ **批次号撞过四次**（272~283 / 295-x / 303 / 499~500；其中 499/500 各有两个提交：`11f8606`
  刷怪密度 / `cde231c` 鞘翅、`f3226c7` 寻路 / `03ee988` 测试）：引用旧提交一律按 **hash**，本批取 **521**。
- 批次 523（真机"压后台回来**世界全白 + 只剩黑色动物**、重进/换世界都白、只有刷新才好"；
  日志 `T08-51-19`/`T10-26-43`）：两次都是 `resume.background` 后 15~35ms `gl.context.lost`、
  1 秒后 restored，而 `ui.canvas.recover` 始终报 `atlas: "intact"`（帧号/触摸全程 60fps）。
  根因：图集有**两张**画布，探针只测源画布；这次"源还在、上传画布 `uploadCanvas`（4 倍大）空了"
  → 报 intact → three 恢复上下文后从空画布重传 → 地形全被 `covered < 0.5` discard，只剩天空/云/雨
  （白），动物不采样图集（`instanceColor`）→ 深色剪影；`atlas` 是 `boot()` 级单例，空图集被带进
  下一局（这就是"重进也白"）。修法：两张画布都挂事件、`repaint()` 双上下文检查、`ensureUploaded()`、
  恢复时强制 `repaint()`、回前台补两刀、`App` 构造兜底。埋点带 `uploadBefore/uploadAfter/sourcePixels`。
  门禁：`canvas-probe` 13→17、`test:ui` 875→883、160 套全绿。⚠️ `Sky` 的云/日月纹理仍无重画入口。
- 批次 525（草尖细线，续）：**十字面四边回绕**画出的那条"极细的十字线"。
  薄面 UV 是 0~1，着色器用 `fract(平铺坐标)` 映射回贴图 —— **整数处 fract 从 1 掉回 0**，
  于是落在面顶边/侧边上的像素采到的是贴图**另一头**（草根、边缘叶片，不透明），
  两条面各画一条线，合起来就是一个极细的十字。修法：十字植物的贴图**四边各留 1 纹素透明**
  （`PLANT_MIN/MAX`），叶片列范围收进 1~13、秆/茎/枝上下留空；这样回绕、各向异性越界、
  薄面底边与地面共面读到的都是空。新增 `paintedEdgeOpaque()` 断言（草/蕨/花/甘蔗/竹子/蘑菇=0）。
- 批次 524（体感收尾：草尖细线 / 草尖抖动 / 方块太"轻"；**本号是撞号后改的** —— 另一条会话的
  523 是 `71c5ed8`（压后台白屏），本批原写成 523，按 hash 区分）：
  ① 植物贴图**不许有 1 像素宽的竖条**：叶尖原本收成 1 像素（花的茎与叶同理）——屏幕上就是
     "极细的线"，且 mipmap 第一个把它平均掉（覆盖率 0.25~0.5）→ 时有时无=抖。现在叶片
     全高 2 像素、花茎 2 像素；新增 `paintedThinColumns()` 断言（草/蕨/花/甘蔗/竹子=0）。
  ② alphaTest 阈值按**屏幕空间 4×4 Bayer** 打散 ±0.03（`ALPHA_DITHER_BAND`）：骑在阈值上的
     草尖不再整片翻转；近处（mip0 的 alpha 只有 0/1）完全不受影响。
  ③ 面明暗加深（用户："方块不够沉重、偏亮"）：侧 0.8/0.6 → **0.72/0.54**、底 0.5 → **0.42**，
     顶面仍 1.0。`atlasMesh.FACE_SHADE` 与 `ChunkMesher.RAW_FACES` 必须一起改；生物那套
     `BOX_FACE_SHADE` 同步压 10%（否则站在墙边会显得比墙亮）。
- 批次 521（画质收尾 + 触屏默认值；用户反馈"斜线有毛刺 / 动物建模略糙"）：
  ① 描边改**屏幕空间 ribbon**：`LineSegments` 的 `linewidth` 在 WebGL 里不生效（1px 硬边、
     斜棱成阶梯），现在按像素算宽 + 两侧渐隐 = 自带抗锯齿，12 棱 × 2 三角形一次提交。
  ② 生物/玩家/盔甲架加**逐面顶点色**（`boxShading.ts`：顶 1.0 / 底 0.62 / 侧居中）：六面原本
     一样亮 → 纯色剪影；与 `instanceColor` 相乘，零 draw call、零贴图。
  ③ `antialias: true`（MSAA）：硬边只有超采样能治；⚠️ context 属性（改完要重载），掉帧改回 false。
  ④ 默认值（用户逐条指定）：视野 **60°**（范围 **45~90**）、摇杆**跟随手指**、瞄准=手指；
     灵敏度重定标 **1~8 档、4 档 = 上一版最快档 4×、每档等比 ×1.25**（8 档 9.77×，代价是
     最慢也 2.05×）。`SETTINGS_VERSION` 2 → 3，迁移只改"还停在旧默认值"的项；灵敏度走
     "旧档位 → 旧倍率 → 新档位"（直接搬数字会让 4 档从 1× 跳到 4×）。
  ⑤ 手指瞄准取点挪到**白圈边缘**（右手左上 / 左手右上，r/√2），白圈仍跟手；纯函数 `fingerAimPoint`。
- 批次 520（画质：边缘 / 平滑 / 帧率；由用户反馈"草的颗粒感"起）：
  ① 十字植物贴图重画（草/蕨/甘蔗/竹子/花）：覆盖率 20%（甘蔗 17%）→ **42~44%**、叶片 1px →
     2px（叶尖 1px）、逐像素噪声 ±15% → ±6%，细节交给 **4×4 簇色相**（与树叶同一套）；
     新增 `paintedCoverage()`（跑画笔算覆盖率，不要 canvas）+ `test:render` 上下限断言。
  ② 镂空层 **LOD→alpha 覆盖率补偿**（`alphaCoverage.ts`）：mipmap 的 alpha 是覆盖率平均，
     43% 的草到 mip2 掉到 0.2~0.4，被 `alphaTest 0.5` 整片啃掉（剪影随距离消失 + 闪）；
     按 LOD 每级 +40%（LOD3 封顶）乘法抬回，alpha=0/1 恒等（空白不长绿雾、实心块不用新材质）。
  ③ 图集 **8 纹素边距 + 各向异性**（手机 4× / 桌面 8×）：斜视时 LOD 由**长轴**决定，地面/墙
     糊成一块色；边距让足迹跨出去看到自己的外扩而不是邻居贴图（否则砖缝出彩色细线）。
  ④ 零成本：`Math.round(1000/60)=17ms` 把 60 帧压成 **30 帧**（120Hz 变 40 帧且不均）；
     near 0.1 → **0.25**；水面起伏按距离渐隐 + 云层各向异性；天空/雾加 **±0.5/255 Bayer 抖色**。
  （MSAA 当批没做，521 补上并留了回退开关。）
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
npm run check              # 【提交前】typecheck + 单测 + 160 套离线测试 + 三张台账（全过才提交）
npm run check:fast         # 【改代码时】typecheck + 单测 + 只跑被改动命中的套件（秒级）
npm run build              # 类型检查 + 生产构建（带 sourcemap，发布用）
npm run build:fast         # 只验"能不能出包"（SOURCEMAP=0，产物 hash 与正式构建一致）
npm test                   # typecheck:tools + vitest + 160 套离线测试
npm run test:offline:changed  # 只跑与本次 git 改动相关的离线套件
npm run audit:tasks        # 任务清单自检（编号重复/跳号 + 本文件进度口径是否过期）
npm run gen:stats          # 地形生成统计（耗时/洞穴占比/矿石产量）
npm run agent:setup        # 跨机器自检
```

**这些是一条链**：`npm run check` = `typecheck` + `test` + 三张台账。
`test` = `typecheck:tools` + `test:unit`（vitest）+ `test:offline`
（`tools/run-tests.mjs`：**一次 esbuild 打包全部入口 + 多进程并行**，
32s → 9s，见 TASKS A13）。单套调试仍可直接 `npm run test:reach` 这类老命令。

`npm test` 那一层共 **160 套**自建离线测试（清单的唯一来源是 `package.json` 的 `test:*` 脚本，
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
- 批次 513（J3 第二批）：**雪傀儡远程雪球**（10 格 / 1.5 秒 / 0 伤害 + 击退）。`test:target` → **51 条**。
- 批次 514（文档对齐）：修正 12 处过期"还没做"，并把**末影箱配方换回原版**（8 黑曜石 + 1 末影之眼）。
- 批次 515/516（J3）：**追玩家判据纯函数** + **生物开门**。`test:chase` 26 / `test:doors` 13 条。
- 批次 517（J3 收口）/ 518（B15 尾巴）：**生物游泳**（`test:swim` 16 条）/ **望远镜**
  （FOV × 0.12，`test:spyglass` 22 条；B15 只剩细雪）。
- 批次 519/521（结构深度第一、二批）：**府邸 17~25 间** + **要塞上下两层**（梯子井）。
  `test:structure` → **153 条**。
- 批次 522（结构深度收口）：**堡垒第二种形制**（桥 + 宝库 / 两层居住区，坐标哈希各半）。
  `test:bastion` 106 → **110 条**。
