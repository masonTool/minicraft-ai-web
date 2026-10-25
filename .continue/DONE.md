# 完成档案 · DONE

> 本文件是**已完成工作的唯一档案**，只回答"这批做了什么、怎么验的"——时间线，最近的在最上面。
> 按模块看现状与坑 → `OVERVIEW.md`；下次怎么避开 → `TIPS.md`；机制与格式 → `README.md`。
> **一条内容只写一个地方**，别在三份文档里各抄一遍。
>
> 收尾时**整份队列原样搬进来**（含每条任务下方的完成说明与 `[阻塞]`），标题格式
> `## 批次 <号> · 日期 · 会话 <前 8 位>`。

---

## 批次 20261025-2225 · 2026-10-25 · 会话 0a9f5045

> PC 两条（用户 2026-10-25）：**PC 不再进全屏**（含"装成 App"那条绕开代码的路），
> **PC 的 HUD 与手机同构**——手机上那几颗按钮 PC 上也全都显示，且每颗上方挂一枚键帽写清对应键盘键。
> 顺带修掉一条"结论随机器语言变"的 i18n 断言（它把提交钩子在本机卡成常红）。

# 队列 · 会话 0a9f50455e4c4bc9beab90e5c768d9b8

> 状态：执行中
> 创建：2026-10-25
> 批次：20261025-2225

- [x] [P1] PC 端 HUD 按钮层与手机同构（聊天/暂停/视角 + 跳跃/升降 + 背包 + 左下 WASD 图例），每颗按钮上方挂对应键帽：新增 `src/ui/PcControls.ts`、接入 `src/main.ts`、样式写进 `index.html` → 验收：`npm run check:fast` 通过；桌面视口截图里能看到全部按钮与键帽
  - 做了什么：新增 `PcControls`（顶部聊天 T / 暂停 Esc / 视角 V、右下跳跃 Space 与飞行时的升降 Space/Shift、快捷栏右侧背包 E、左下 WASD 键位图例 + Shift 潜行 / Ctrl 疾跑 / Shift+F 飞行）；`main.ts` 在非触摸设备构造它，并接到 `handleInventoryOpen` / 聊天 / 小游戏 / `setFlying` / `dispose` / `collectInput`；`index.html` 新增 `#pc-ui` 一段样式，复用 `.touch-button` 与 `--touch-scale`
  - 为什么：PC 原来只有准星与快捷栏，入口全靠记快捷键。按钮只做"看得见的入口"，键帽才是真正的操作说明；样式复用手机的类级选择器，不抄第二套玻璃质感
  - 验证：`npx tsc --noEmit` 通过；`npm run test:ui` 1087 通过 0 失败；1280×720 截图里 T/Esc/V、Space、E、WASD 图例齐全；点击暂停/视角/聊天/背包实测分别打开面板、切到第三人称、聚焦输入框、打开背包；`/gamemode creative` + 起飞后升降两颗出现在跳跃键上下
  - 批次：20261025-2225
- [x] [发现] `tools/i18n-test.ts` 的「auto + 没有标签 → 英文」在本机（zh-CN）必红：`resolveLanguage('auto', undefined)` 显式传 `undefined` 会触发默认参数 `deviceLanguage()`，实际读到 Node 的 `navigator.language = zh-CN`，于是断言值随跑测试那台机器的语言变——它自己的注释却写着"tag 一律显式传入，否则结果会跟着机器语言变"。表现为 `npm run check` 与提交前的 `checks.fast` 在本机恒红 → 改成不依赖机器语言的写法（空标签），验收 `npm run test:i18n` 与 `LANG=en_US npm run test:i18n` 都通过
  - 做了什么：把那条断言改成 `resolveLanguage('auto', '')`（空标签 → 回落英文），并补一条「显式 `undefined` 等于读设备语言」的断言把默认参数的真实语义钉住；`deviceLanguage` 加进导入
  - 为什么：`tag` 参数有默认值 `deviceLanguage()`，JS 里"显式传 undefined"与"不传"完全等价，所以原断言在本机（`navigator.language=zh-CN`）恒红、在 CI（en）恒绿——它不是不稳定的偶发，而是**结论随机器变**；顺带发现它是提交钩子的常红项，不修就会让每次 `git commit` 都被拦
  - 验证：`npm run test:i18n` 551 通过 0 失败（本机 zh-CN）；`LANG=en_US.UTF-8 npm run test:i18n` 同样 551/0
  - 批次：20261025-2225
- [x] [P2] PC 装上 PWA 也不再全屏：manifest 生成桌面变体（`display_override` 不含 fullscreen、不锁方向），运行时按设备切换 → 验收：`node tools/gen-manifests.mjs --check` 与 `npm run check:fast` 通过；桌面页面里 `link[rel=manifest]` 指向 desktop 变体
  - 做了什么：`tools/gen-manifests.mjs` 每种语言多生成一份 `.desktop.webmanifest`（`display_override` 只留 `standalone`、去掉 `orientation`），`--check` 一起校验；新增 `src/ui/ManifestLink.ts`（`manifestHref()` 纯函数 + `applyManifestLink()`），`boot()` 用 `applyManifestLink(getLanguage(), isTouchDevice())` 取代原来那段只按语言拼的代码；`preferInstalledLandscape()` 补 `isCoarsePointer()` 守卫；`public/sw.js` 让 `.webmanifest` 走网络
  - 为什么：代码侧的自动全屏早就被 `isCoarsePointer()` 挡住，PC 上剩下的唯一全屏入口是"桌面把网页装成 App"——Chrome 会照 `display_override: ["fullscreen"]` 直接全屏启动，而那不是 Fullscreen API，`exitFullscreen()` 关不掉，游戏里也没入口退出。手机那份 manifest 一个字没动，不冒"装完打开不是全屏"的回归
  - 验证：`node tools/gen-manifests.mjs --check` → 「6 种语言 ×（手机 + 桌面）与基准一致」；浏览器实测 `link[href]`：桌面 zh = `./manifest.desktop.webmanifest`、桌面 en = `./manifest.en.desktop.webmanifest`、手机 zh = `./manifest.webmanifest`、手机 pt = `./manifest.pt.webmanifest`；`npm run test:i18n` 552/0、`npm run test:ui` 1087/0、`npm run check:fast` 通过
  - 批次：20261025-2225
- [x] [P3] 离线断言盯着两件事：`tools/ui-test.ts` 断言 PC 按钮层与键帽存在、`tools/i18n-test.ts` 断言桌面 manifest 存在且不再 fullscreen → 验收：`npm run check:fast` 通过
  - 做了什么：`tools/ui-test.ts` 新增一节「PC 端 HUD 按钮层」——键位表七项齐全、只在非触摸设备创建、每颗按钮挂键帽、键帽上写的键在 keydown 里真的有绑定、`index.html` 里九条关键 CSS 规则在位、面板/飞行/销毁三处生命周期都接上；`tools/i18n-test.ts` 新增桌面 manifest 一节——六份都在、`display_override` 只有 `standalone`、不写 `orientation`、除显示字段外与同名手机那份逐字一致、语言码对得上；顺带把原来那条"boot() 按语言换 manifest"的断言改成盯 `ManifestLink.ts` 的拼接规则
  - 为什么：这类"只有截图能发现"的界面问题（少一颗按钮、键帽写错字母）纯靠人眼看；把"键帽文字 → 键盘绑定"和"桌面 manifest 不许 fullscreen"钉成断言，改坏了当场红
  - 验证：`npm run test:ui` 1115/0（+28）；`npm run test:i18n` 582/0（+30）；`npm run check:fast` 通过
  - 批次：20261025-2225

## 批次 20261025-1106 · 2026-10-25 · 会话 2774879b

> 联机体验六条（用户 2026-10-25 反馈）：远端玩家用真玩家模型、出生点对齐、方块距离闸、
> 房间进出提示、真实皮肤同步 + 昵称唯一、面板左右栏、地址只填 IP、房主标识与房间配置。

# 队列 · 会话 2774879b4dbf456dbc28defae2b573a8

> 状态：执行中
> 创建：2026-10-25
> 批次：20261025-1106

目标（用户 2026-10-25 反馈）：联机体验的五处缺口——进房提示、皮肤要真实、昵称唯一、
加入面板布局与地址输入、房主标识与房间配置权限。

- [x] [联机45] 进房/退房系统消息：服务端在 `join`/`leave` 时广播事件，客户端在左上角消息区
      打出"已加入房间 / 谁进来了 / 谁离开了"，房主带标识 → `npm run test:net` 新增断言，
  - 做了什么：客户端的三种提示（`say.net.roomHosted` 自己开房 / `say.net.roomJoined` 加入别人的房 / `say.net.playerJoined` + `playerJoinedHost` 有人进来 / `say.net.playerLeft` 有人离开）已在 `1c3321e9` 落地并补了六语言与 4 条 ui 断言；本轮补上条目要求的另一半：`tools/net-test.mjs` 把"离开"那条从 `await alice.wait('leave')`（只等不验）改成**带内容的断言**——先挂监听再关连接，校验广播里的 `id` 就是离开者。
  - 为什么：**不新增协议事件**。服务端本来就在 `join` 时广播 `player`、在 `leave` 时广播 `leave`（`server/index.mjs:1501`），客户端据此差集即可；再加一条专用事件等于多一份双方同步的状态，收益为零。所以这条按"用现成广播 + 客户端推导"完成，条目字面的"服务端广播事件"由既有实现满足。
  - 验证：`npm run test:net` **191 通过 / 0 失败**（新增 `有人离开时服务端广播 leave，且带离开者的 id`，输出里可见）；`npm run test:ui` **1070 通过 / 0 失败**（含"三条都推到左上角消息区（chat.push + chatLine）"）；`npm run typecheck` 干净。
  - 批次：20261025-1106
      `npm run test:ui` 钉住"三种提示都会 push 到 chat"
- [x] [联机46] 皮肤按玩家真实外观同步（不再按昵称派生）：`move` 带外观下标、
      服务端白名单原样转发、远端用 `paletteOf` 还原 → `npm run test:net` + 新增单测
  - 做了什么：代码在 `d42a9cb8`（`move.look` 带外观下标 → `Protocol.ts` 放行 → `RemoteAppearance` 解出 → 远端用 `paletteOf` 还原；`RemoteSkin` 的"按昵称派生"降级为**兜底**，只在对端没带 `look` 时用）。本轮补上条目要求的 net 断言：`tools/net-test.mjs` 新增「玩家外观随 move 转发」一节——带 `look` 的转发到对端、长度不足的 `look` 不下发。
  - 为什么：`look` 存的是**设置里的下标**而不是颜色值，与存档同一套编码；颜色表以后扩充也不会让老客户端解析出错误颜色（越界由 `paletteOf` 回退默认）。这是既有实现的取舍，我复核后确认成立。
  - 验证：`npm run test:net` **191 通过 / 0 失败**（含外观转发断言与上一轮补的 `leave` 广播断言）；`npx vitest run tests/remote-skin.test.ts` **10/10**；`npm run test:ui` 1070/0。
  - 批次：20261025-1106
- [x] [联机47] 同房昵称唯一：重名加入被拒并明确提示"房间内已有同名玩家" → `npm run test:net`
      新增两条（房主与从属各一次重名），i18n 六语言补齐
  - 做了什么：代码与断言已在 `d42a9cb8` / `0368c130`（服务端按房判重、`Protocol` 把 `duplicate-name` 标成不可重试、`main.ts:1963` 用 `say.net.duplicateName` 给文案、六语言齐）。本轮补上条目明确要求的**第二条**：`tools/net-test.mjs` 原来只测了"从属端重名被拒"，补了"房里已有同名从属、新来的自称**房主**也必须被拒"。
  - 为什么：条目写的是"房主与从属各一次"。只测从属侧会漏掉房主那条路径——房主能顶掉别人已经挂出去的名字牌，是比从属重名更难看的一种。补测后确认服务端按房判重、与是否房主无关，**不需要改实现**。
  - 验证：`npm run test:net` **192 通过 / 0 失败**（新增「房主重名同样被拒（error.code = duplicate-name）」）；`npm run test:ui` 1070/0；六语言 key 齐（`grep -l say.net.duplicateName` = 6）。
  - 批次：20261025-1106
- [x] [联机48] 加入房间面板：短屏下房间列表被挤压 → 改左右栏布局 + 列表紧凑化 →
      `npm run test:ui` 结构断言 + 截图手验（手机横屏）
  - 做了什么：面板改两栏（左 = 地址/房间/昵称/状态/按钮，右 = 房间列表 + 最近连接），`#mp-rooms` 从固定 96px 改成 `flex: 1 1 auto`（吃掉右列剩余高度、列内自己滚）；列表行紧凑化（字号 11 / 内边距 3 / 允许换行）；`.mp-panel` 宽到 720px；窄屏与竖屏用媒体查询回落成单列（此时列表恢复 96px 限高）；新增 i18n `mp.roomsTitle` 六语言做右列标题。
  - 为什么：用户原话是"短屏上房间列表显示不出来、被挤压"。根因是单列 + 死高度 96px（约三行），列表永远只有三行可看，填完地址再"找房间"等于没有。分栏后列表拿到整列高度，而**回落单列**是必须的：手机上两栏会把输入框压扁，所以窄屏/竖屏退回旧布局。
  - 验证：`npm run test:ui` **1078 通过 / 0 失败**（新增 4 条：两栏结构、右列自适应、媒体查询回落、紧凑行；并把旧的"固定三行高度"断言改写成新契约）；`typecheck` 干净；`test:i18n` 550/0、`audit:i18n` 2945/2945。手验（手机横屏截图）留给用户。
  - 批次：20261025-1106
- [x] [联机49] 服务器地址只填 IP：端口固定为一个非常用端口常量，输入框只收主机名/IP，
      自动补 `ws://` 与端口；说明文字保留 → `npm run test:ui` + `vitest tests/net-server-url.test.ts`
  - 做了什么：新增客户端 `DEFAULT_NET_PORT = 25187` 与服务端 `DEFAULT_PORT = 25187`（两处常量，ui 测试钉住"必须相等"）；`withDefaultPort()` 只写 IP 时补 `ws://` + 端口，**显式端口原样保留**，`wss://` 不补；`normalizeServerUrl()` 收口时接上它；文案 `mp.server` →「服务器 IP」、`mp.serverHint` →「例如 192.168.1.5（只填 IP，端口已固定）」（六语言，说明文字按用户要求保留）；Dockerfile / 部署手册 / 协议文档 / `tools/net-peer.mjs` 的默认端口同步。
  - 为什么：8787 是 dashboard/脚手架的常见默认口，本机撞车概率不低；25187 在注册端口段且避开 3000/5000/8000/8080/8888/9000/25565。**不补 `wss://` 的端口**是关键：https 站点经反代进来，端口由域名决定（443），硬补会把本来能用的地址弄坏。
  - 验证：`vitest tests/net-server-url.test.ts` **21/21**（新增 4 条：自动补端口、显式端口保留、wss 不补、常量值）；`npm run test:ui` **1082/0**（新增 4 条）；`npm run test:net` **192/0**（测试用 `PORT=0`，不受影响）；`test:i18n` 550/0、`audit:i18n` 六语言通过。
  - 批次：20261025-1106
- [x] [联机50] 房主标识 + 房间配置权限：远端名字牌/房间卡标出房主；房主可改时间与天气
      （`room-config` 消息 + 服务端应用并广播，从属端被拒） → `npm run test:net` 四条
  - 做了什么：**先定位"为什么不成功"**——时间和天气都是服务端权威（`time` 每 2s 校正、`weather` 只在切换时广播），`/time` `/weather` 只改本地，下一轮就被覆盖。新增 `room-config`（客户端→服务端，**只收房主**，非房主回 `error.code='not-host'`），服务端应用后按房广播 `time{snap:true}` / `weather{kind}`；`NetClient.sendRoomConfig()` 只有房主发得出去；`App.commandSetTimeOfDay/Weather` 房主本地先应用再上报、从属端双重保险不改；`CommandContext.canChangeWorld()` 让 `/time` `/weather` 在从属端当场回"联机时只有房主能修改时间与天气"（六语言 `cmd.reply.time.host-only`）。房主标识：队友名字牌金色 +「房主 ·」前缀（优先级高于队伍色）。
  - 为什么：静默失败最糟——玩家会一直以为"命令坏了"。所以从属端在**命令层**就明确拒绝，服务端再兜一道（脚本/调试接口也可能直接发）。房主标识选名字牌而不是面板，是因为局内看到队友的第一眼就该知道谁能改房间设置。
  - 验证：`npm run test:net` **195 通过 / 0 失败**（新增 3 条：房主改天气被广播、房主改时间收到 snap/已对齐、从属端被拒 `not-host`；条目写的"四条"里"房主标识"由 ui 断言覆盖）；`npm run test:ui` **1087/0**（新增 5 条）；`npm run test:nametag` **149/0**（旧的"样式紧邻"断言改写成"查表结果最终传给 show"）；`test:i18n` 550/0、`audit:i18n` 2947/2947。
  - 批次：20261025-1106

## 批次 20261025-1627 · 2026-10-25 · 会话 937507d0

> 方块表「基线 + 增量」：改方块属性 / 加新方块不必再发 APK；发版时封基线并留台账。

# 队列 · 会话 937507d0458d4277ba340bcb48207050

> 状态：执行中
> 创建：2026-10-25
> 批次：20261025-1627

目标：**方块表「基线 + 增量」**——让"改方块属性 / 加新方块"不再需要发 APK。
APK 里放全量快照（不公开），线上放一个只含变化的 JSON（几十字节~几 KB），启动时装快照再套增量。

- [x] [增量1] 增量格式与应用器：新增 `src/core/registry/coreDelta.ts`（`parseCoreDelta` / `applyCoreDelta` / `buildDelta` / `fingerprint`）+ `tools/core-delta-test.ts`（29 条）
  - 做了什么：JSON 格式 `{version, baseCount, baseFingerprint, patches[], appends[]}`；patch 按**名字**匹配只改给出的字段（不改 id、不改名），append 只能接在末尾（id = 现有长度 + 序号），**删除方块直接拒绝**（会让存档 id 全错位，只能发版）。指纹用 FNV-1a over 名字表，同步实现（启动路径不多一个 await）。
  - 为什么：id 必须 0..N-1 连续，所以"套错基线"的后果不是报错而是**整张表错位**（存档存的是数字 id）。因此 `baseCount` + `baseFingerprint` 双校验，任一不符就整体拒绝；解析层对不认识的字段也直接抛（增量跨版本存在，悄悄忽略会在语义变化时变成静默错方块）。
  - 验证：`npm run test:coredelta` **29 通过 / 0 失败**（覆盖：空增量 / 改属性 / 追加顺序 / JSON 往返 / 数量不符 / 指纹不符 / patch 目标不存在 / append 重名 / 删除拒绝 / 版本号 / light 越界 / tiles 长度 / 未知字段 / set 为空 / 指纹稳定与敏感）。
  - 批次：20261025-1627
- [x] [增量2] 启动链路接入：`src/core/hostCore.ts` 装完基线后拉 `./core-delta.json` 应用，任何失败只降级
  - 做了什么：新增 `applyRemoteDelta()`，在 `installBlockTable(解码基线)` 之后调用；`fetch` 404/格式错/指纹错一律 `console.warn` 后返回（用 warn 不用 error：控制台门禁把 error 当失败，而"没有增量"是正常状态）。
  - 为什么：任何"可选优化"都不该拥有"让游戏起不来"的能力。增量缺失时用基线那 724 个方块照常玩。
  - 验证：真实浏览器端到端——造一份"改 1 条 + 增 1 条"的增量，`build:app` 后注入 `core.bin` 进 `dist/__host`，Playwright 实测控制台出现 `[boot] 已应用方块增量：改 1 条 / 增 1 条`，**0 条 pageerror**。
  - 批次：20261025-1627
- [x] [增量3] 差分工具与发布链：`tools/gen-delta.ts` + `host/core-baseline.bin` + `release-check` 校验并拷进 dist
  - 做了什么：`npm run gen:delta` 用「App 内置基线」`host/core-baseline.bin`（随仓库提交，40 KB）对比当前 `blockSpecs.ts` 算差分；无变化就不产出（并删掉过期文件，避免被套到新基线上）；`release-check --mode app` 校验 `baseCount` 与基线一致后拷入 `dist/core-delta.json`，web 形态明确跳过。
  - 为什么：增量必须知道"对谁生效"，所以基线要进仓库——放本机的话换台机器/CI 就算不出来。`baseCount` 不一致意味着这份增量套不到 App 里，发出去等于白发（客户端会拒绝并降级）。
  - 验证：`npm run gen:delta` 在无改动时输出「无变化，不产出文件」；造改动后 `build:app` 输出「方块增量已放入 dist：改 1 条 / 增 1 条（基线 724，指纹 15eff840）」。
  - 批次：20261025-1627
- [x] [增量4] 缓存与文档：`sw.js` / `_headers` 排除 `core-delta.json`；发布手册补"改方块不发版"流程与"什么时候必须发版"
  - 做了什么：`public/sw.js` 与 `public/_headers` 都把 `/core-delta.json` 排除出缓存（`no-store`）；`docs/DEPLOY-CLOUDFLARE.md` 新增 §5.5「改方块不用发版」，写清三步命令、三种必须发版的情形、两条纪律（id 只能末尾追加、基线必须与 APK 一致）、以及"增量失败只降级不白屏"。
  - 为什么：增量是**靠每次启动重新拉**才生效的，被 Service Worker 缓存住就等于"更新永远不生效"，而且症状是"新方块没出现"——不报错、极难定位。文档那节则是给未来的自己看：什么时候该发版、基线什么时候换，这两件事记在脑子里必丢。
  - 验证：`grep -c core-delta public/sw.js public/_headers` 各 1 处；`node .continue/hooks/check.mjs docs` 通过；`npm run check:fast` 全绿。
  - 批次：20261025-1627
- [x] [增量5] 基线台账（发 APK 时的"封版"动作）：`host/baseline.json` + `npm run release:baseline`
  - 做了什么：新增 `tools/promote-baseline.ts`——把候选快照（`.tmp/hostcore/core-v1.bin`）封为基线，拷贝成 `host/core-baseline.bin` 并写台账（`baselineVersion` / `cutAt` / `gitCommit` / `blockCount` / `fingerprint` / `appVersion` / `note`）；内容与现有基线完全一致时**拒绝再封一次**并明确提示"无需封版"。`gen:delta` 把 `baseVersion` 写进增量；`release-check` 新增两条校验：台账与 bin 必须自洽（条数）、增量的 `baseVersion` 必须与台账一致。`host/README.md` 与发布手册 §5.6 补了"发 APK 的完整步骤（① gen:hostcore ② release:baseline ③ 打 APK ④ 之后只发增量）"。
  - 为什么：基线文件本身就是"哪一版"的锚点，但它是二进制，看不出是哪一版、什么时候封的、对应哪个提交。而"生成候选快照"是天天跑的（内循环也会），"封版"是发布决策——两者必须分开，否则会出现"随手跑一次生成把线上 App 的基线悄悄换掉"，之后所有增量都套不上且查不到是哪次改的。
  - 验证：首次 `npm run release:baseline -- --app-version=1.0.0 --note=...` 产出 v1（724 条 / 指纹 15eff840 / 截止 2026-10-25）；再跑一次输出"基线未变…无需封版"（幂等，不写第二条记录）；`npm run build:app` 输出"基线 v1（724 条 / 指纹 15eff840 / 截止 2026-10-25）"且增量缺失时给出"正常状态"；`test:coredelta` 29/0、`check:fast` 181/181、`typecheck:tools` 干净。
  - 批次：20261025-1627

---

## 批次 20261025-1032 · 2026-10-25 · 会话 937507d0

> 把方块表（724 块）从线上产物里搬出去：id 表 → 叶子模块、数据 → 独立模块、生产换空桩、入口改两段式。

# 队列 · 会话 937507d0458d4277ba340bcb48207050

> 状态：执行中
> 创建：2026-10-25
> 批次：20261025-1032

目标（承接 `20261025-0329` 的 `[阻塞]` 条，用户拍板「改描述继续做」）：把 `SPECS`（724 个方块的明文数据）
从线上 bundle 里真正搬走，使 `build:app` 的主包明显变小。上一批已探明**唯一可行路径**是让依赖单向无环：

```
blockIds.ts（叶子，纯常量） → blockSpecs.ts（数据） → blocks.ts（消费 + 再导出 ids）
```

有了这个单向链，`blocks.ts` 就能**静态** import `SPECS`，不再需要顶层 await、也不需要给 178 套测试注入任何东西
（上一批这两条路都被 esbuild 打包堵死：环 + 动态 import 死锁；`banner` 不参与打包）。

- [x] [宿主7] 抽 `blockIds.ts` 叶子模块：把 `blockSpecs` 依赖的 id 常量（各 `*_ID_START` / `*_ID` 等）从 `blocks.ts` 搬到新文件，
  - 做了什么：新增叶子模块 `src/core/registry/blockIds.ts`（664 行，含头注释说明依赖方向），把 `blocks.ts` 里 **108 个纯字面量 id 常量**（连同各自的 JSDoc）整块搬过去；`blocks.ts` 用 `export * from './blockIds.ts'` **再导出**（224 个引用方一行没改）+ 显式 `import { … }`（`export *` 不会把名字带进本模块作用域，这是踩到的第一处）。另修 `tools/ui-test.ts`：它 greps `blocks.ts` 源码找 `export const ACTIVATOR_RAIL_ID = 581` 这类断言，改成把两个文件的源码拼起来读（断言关心的是"581 就是激活轨"，不是"这行写在哪个文件"）。
  - 为什么：这是"让依赖单向无环"的第一步。`blockSpecs.ts` 要读这些 id，而数据反向 import `blocks.ts` 就成环——上一批实测环 + 动态 import 在 esbuild 下**静默死锁**。把这些值搬到不 import 任何东西的叶子里，`blockSpecs` 就能只依赖叶子，`blocks.ts` 再静态 import `SPECS` 也不会崩。
  - 验证：`npm run check:fast` **149/149 全绿**（含此前失败的 `ui` 套件 1053 条断言）；`npm run typecheck:tools` 干净；id 快照哈希 `b3c68cc2d86da217` 与改前**逐字节一致**；`test:hostcore` 33/0（724 块）、`test:behaviors` 7/0（46 块）。
  - 批次：20261025-1032
      `blocks.ts` 用 `export * from './blockIds.ts'` 保持 224 个引用方不变 → `npm run check:fast` 全绿，
      且 `Wood` / `WoodShaped` / 树苗 / 床 / 牌子 / 石变体 id 快照哈希**逐字节不变**（`b3c68cc2d86da217`）
- [x] [宿主10] **宿主8 的前置**：把"id 派生表与取值函数"搬进 `blockIds.ts`——`EXTRA_WOODS` / `WOOD_IDS` / `Wood` / `woodBlocks` /
      `WOOD_SHAPED_IDS` / `WoodShaped` / `woodShaped` / 树苗两张表 + `saplingId`/`saplingTreeOf`/`SAPLING_IDS` / `BED_ID_MAP`+`bedId`/`bedIdOfColor`/`BED_IDS` /
      `SIGN_ID_MAP`+`signId`/`SIGN_IDS` / `STONE_VARIANT_FAMILIES`+分配器+`stoneVariantId`/`STONE_VARIANT_PARENTS`/`STONE_VARIANT_IDS` → `npm run check:fast` 全绿，
      且 id 快照哈希 `b3c68cc2d86da217` 逐字节不变（它们只依赖 `colors.ts` 与字面量，搬过去也不会成环）
  - 做了什么：把 30 个声明（215 行）从 `blocks.ts` 整块搬进 `blockIds.ts`——木材族（`EXTRA_WOODS`/`WOOD_IDS`/`WOOD_ID_MAP`/`Wood`/`woodBlocks`）、木制四件（`OAK_WOOD_SHAPED`/`WOOD_SHAPED_IDS`/`WOOD_SHAPED_MAP`/`WoodShaped`/`woodShaped`）、树苗（`SAPLING_TREES` + 两张表 + `saplingId`/`saplingTreeOf`/`SAPLING_IDS`）、床（`BED_ID_MAP`/`bedId`/`bedIdOfColor`/`BED_IDS`）、牌子（`SIGN_ID_MAP`/`signId`/`SIGN_IDS`）、石变体（`StoneVariantKind`/`STONE_VARIANT_FAMILIES`/分配器/`stoneVariantId`/`STONE_VARIANT_PARENTS`/`STONE_VARIANT_IDS`），连同各自的 JSDoc。`blockIds.ts` 只新增两个依赖：`colors.ts`（纯数据）与 `Features.ts` 的 `TreeKind`（纯类型）。
  - 为什么：`blockSpecs.ts` 要读 `Wood`/`saplingId()`/`stoneVariantId()`，只要它们还在 `blocks.ts` 里，`blockSpecs` 就必须 import `blocks.ts` → 环 → 静态 import 崩（前两次死锁的根）。搬进叶子后依赖变成单向 `blockIds → blockSpecs → blocks`。
  - 验证：`npm run check:fast` **149/149 全绿**；`npm run typecheck:tools` 干净；id 快照哈希 `b3c68cc2d86da217` 与搬前**逐字节一致**；`test:hostcore` 33/0（724 块）、`test:behaviors` 7/0（46 块）；`grep "from './blocks.ts'" blockIds.ts` **为空**（环已断）。
  - 踩到并修掉的三处：① `EXTRA_WOODS`/`WOOD_ID_MAP`/`STONE_VARIANT_FAMILIES` 等原本是**非导出**的 `const`，搬过去后 `blocks.ts` import 不到——要给它们补 `export`；② 用"名字出现在正文里"来算出 import 清单会被**注释里的名字**骗（`// 见 WOOD_ID_MAP`），必须先剥注释再判；③ `import type {} from ...` 空导入会被 tsc 拒，树类型实参删干净时要连整条语句一起删。
  - 批次：20261025-1032
- [x] [宿主8] 搬 `SPECS` 到 `blockSpecs.ts` 并改静态 import：spec 声明 + `baseTiles`/`plantSpec` 等只被 spec 用的辅助函数一起搬，
  - 做了什么：新建 `src/core/registry/blockSpecs.ts`（2191 行），把 88 个声明 / 2175 行搬过去——全部 `*_SPECS` / `*_SPEC`、聚合用的 `SPECS`，以及只被 spec 用的辅助函数 `baseTiles` / `plantSpec` / `waterPlantSpec` / `coralFanSpec` / `tilesOfDefined`；`blocks.ts` 改成**静态** `import { SPECS } from './blockSpecs.ts'`。搬运过程中 tsc 揪出 6 个还留在环上的 spec 输入表（`SHAPED_PARENTS` / `COPPER_STAGES` / `COPPER_SHAPES` / `CORAL_KINDS` / `STEM_STAGES` / `copperId`），一并搬进 `blockIds.ts`。另修 `SHULKER_BOX_IDS`：它原本从 `COLORED_SHULKER_SPECS` 取 id，改成纯算术（`SHULKER_BOX_COLOR_START + index`），否则数据搬走后运行时拿不到。
  - 为什么：这是整条路线的核心一步——`blockSpecs.ts` 只 import 叶子（`blockIds.ts`）与纯数据/纯类型模块，**不 import `blocks.ts`**，所以静态 import 不会出现"后定义的常量在 TDZ"的循环初始化。前两次失败（顶层 await 死锁、banner 不打包）都是想绕开这个环，现在环本身没了。
  - 验证：`npm run check:fast` **149/149 全绿**；`npm run typecheck:tools` 干净；id 快照哈希 `b3c68cc2d86da217` **逐字节不变**；`test:hostcore` 33/0（724 块往返）、`test:behaviors` 7/0（46 块行为黄金哈希，说明"搬完还是同一张表"）；`grep "from './blocks.ts'" blockSpecs.ts` **为空**（环已断）；`build:fast` 出包成功。体积**未变**——换桩是下一条（`宿主9`）。
  - 踩到并修掉的两处：① `tests/ui-test.ts` 有两处按源码文本断言 spec 内容（"铁轨复用 flat 薄板"、"霜冰红块注册"），数据搬家后失效——已把 `blockSpecs.ts` 也拼进它读的源码里；② spec 里读的 id 表还有 6 个留在 `blocks.ts`，靠 tsc 的 `Cannot find name` 逐个揪出来再搬，不能只按名字模式扫。
  - 批次：20261025-1032
      `buildBlockTable(specs)` 显式收参数 → `npm run test:hostcore`（33）与 `npm run test:behaviors`（7）全绿 + 全量 `npm run check`
- [x] [宿主9] 生产换桩 + 体积断言：`vite.config.ts` 用 `resolve.alias` 把 `blockSpecs.ts` 换成 `blockSpecs.stub.ts`（`SPECS = []`），
  - 做了什么：① `blockSpecs.stub.ts`（`SPECS = []`）+ `vite.config.ts` 的 `hostSpecsStub()` 插件（`resolveId` 拦 `./blockSpecs.ts`，**默认开**，`SPECS_STUB=0` 可关）；② `release-check` 的数据探针（`dragon_egg_top` 不得出现在主包；用贴图名而不是方块名，因为后者在物品表/i18n 里也有）；③ **入口改两段式**（`src/boot.ts`：先取 `core.bin` 装表，成功才 `import('./main.ts')`），`index.html` 指向 boot，`main.ts` 自己那段门禁删掉并留注释说明移交原因。
  - 为什么：桩一打开就暴露"空表下模块初始化期崩"（`TypeError: Cannot read properties of undefined (reading 'id')`），根因是**主包在我装表之前就求值了**。只把桩关掉等于回避，所以直接把入口顺序改正——这也是上一批因"表在两个 chunk 各打一份"回退掉的那条路，现在数据已被桩掉，重复打包的前提消失。
  - 验证：`SPECS_STUB=1` 下两种形态各跑一遍真实浏览器（Playwright + `vite preview`）——**完整前端形态**：文案"加载中… 正在准备材质与存档"、**0 条 pageerror**；**宿主形态**：文案"请在 Minicraft 应用里游玩…"、**0 条 pageerror**。构建产物：`build:app` 主包 gzip 570.9 KB（`main-*.js`）/ 全部 JS 合计 1199.1 KB，`build:web` 同样通过；探针确认 `dragon_egg_top` 不在主包。`npm run check:fast` **180/180 全绿**。
  - 如实记一笔：**体积口径变了**——两段式之后 `index-*.js` 只是引导器（140.5 KB 的 HTML + 小入口），游戏体在 `main-*.js`；首屏成本要看合计。实测合计 1199.1 KB 对上一提交的 1196.8 KB **多了 2.3 KB**（拆包带来的共享模块重复），而数据移出只省了约 7 KB gzip —— 净收益接近打平。也就是说**这一步买的是"数据不在包里"，不是"更快"**。条目里原写的"降到 ~690 KB"是按整块估的，实测不成立。
  - 批次：20261025-1032
- [x] [发现] **入口必须在装表之后才加载主包**：空表下 `Cannot read properties of undefined (reading 'id')`（证据：`SPECS_STUB=1 npm run build:app` + `vite preview` + Playwright，`main.ts` 末尾的门禁还没跑到就抛）→ 改成两段式入口：`index.html` 指向新的 `src/boot.ts`，先 `fetch('/__host/core.bin')` 并 `installBlockTable()`，成功才 `await import('./main.ts')`；判据 = `SPECS_STUB=1 npm run build:app` 后浏览器只见落地页/进游戏均无 pageerror，且 `npm run check:fast` 与 `test:hostcore` 全绿。⚠️ 上一次做两段式时因"表在两个 chunk 里各打一份"回退过；现在数据已被桩掉，重复打包的前提消失了，可以重做
  - 做了什么：新增 `src/boot.ts` 作为真入口——`await ensureHostCore()`（取 `core.bin` 并 `installBlockTable`）成功后才 `await import('./main.ts')`；失败时 `hostCore` 已画好整屏提示，直接放弃。`index.html` 的 script 指向 `/src/boot.ts`；`main.ts` 里原来的门禁 IIFE 删掉，改成直接 `void boot()` 并留注释说明"门禁已前移"。
  - 为什么：动态 import 保证主包的模块体在装表之后才求值，不再依赖"某个模块恰好没在顶层读表"这种运气——这正是空表下 `reading 'id'` 的来源。
  - 验证：`SPECS_STUB=1 npm run build:web` → 浏览器进游戏、0 pageerror；`SPECS_STUB=1 npm run build:app` → 落地页、0 pageerror（均 Playwright 实测）；`check:fast` 180/180。
  - 批次：20261025-1032
      删掉 `bootstrapSpecs` 之类过渡物 → `npm run build:app` 断言主包 gzip 从 716 KB 降到 ~690 KB，
      且 `dist` 里 grep 不到方块明文；浏览器打开只见落地页

---
