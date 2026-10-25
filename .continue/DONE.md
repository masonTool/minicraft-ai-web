# 完成档案 · DONE

> 本文件是**已完成工作的唯一档案**，只回答"这批做了什么、怎么验的"——时间线，最近的在最上面。
> 按模块看现状与坑 → `OVERVIEW.md`；下次怎么避开 → `TIPS.md`；机制与格式 → `README.md`。
> **一条内容只写一个地方**，别在三份文档里各抄一遍。
>
> 收尾时**整份队列原样搬进来**（含每条任务下方的完成说明与 `[阻塞]`），标题格式
> `## 批次 <号> · 日期 · 会话 <前 8 位>`。

---

## 批次 20261026-0030 · 2026-10-26 · 会话 0a9f5045

> 用户 2026-10-26：PC 端有些设置项本来就无效，不该出现在设置里——「手指跟随」（摇杆跟随手指）、
> 「瞄准方式」（手指落点 / 屏幕中心）。PC 靠键鼠，没有摇杆、瞄准永远是屏幕中心。

# 队列 · 会话 0a9f50455e4c4bc9beab90e5c768d9b8

> 状态：执行中
> 创建：2026-10-26
> 批次：20261026-0030

目标（用户 2026-10-26 反馈）：PC 端有些设置项本来就无效，不该出现在设置里——
「手指跟随」（摇杆跟随手指）、「瞄准方式」（手指落点 / 屏幕中心）。PC 靠键盘鼠标，
没有摇杆、瞄准永远是屏幕中心。

- [x] [PC设置1] PC 端不再显示触摸专属的三个控制项（惯用手 / 瞄准 / 摇杆）：`src/ui/SettingsScreen.ts` 的 `controls` 块把这三行包进 `isTouchUi()` → 验收：`npm run test:ui` 断言三行都在触摸判据里 + 桌面截图设置页控制组只剩视角/反转/自动跳跃/快速进食/按钮大小与滑杆
  - 做了什么：`SettingsScreen` 控制页里「惯用手 / 瞄准 / 摇杆」三行包进 `if (isTouchUi())`（不创建，不是 disabled），并写明为什么它们对键鼠无效
  - 为什么：三项都是触摸控制器的输入（`handedness`/`touchStick` 只喂 `TouchControls` 的布局与死区，`aimMode` 的两处消费都带 `this.touch !== null`）。摆在 PC 设置里只会让人以为"设错了"
  - 验证：桌面 1280×720 打开主菜单设置 → 控制页行名 `视野/按钮大小/灵敏度/视角/反转视角/自动跳跃/快速进食`（**无**惯用手/瞄准/摇杆，20 行）；手机 792×360 仍有这三行（23 行）；截图 `.tmp/shots/settings-pc.png` 两列布局正常；`npm run test:ui` **1145/0**
  - 批次：20261026-0030
- [x] [PC设置2] 把「瞄准恒为中心点」从"只是没显示"变成"钉住"：`main.ts` 三处 `aimMode` 消费点都带 `this.touch !== null`，补断言防以后有人把它用到键鼠上 → 验收：`npm run test:ui` 通过
  - 做了什么：`tools/ui-test.ts` 补三条断言——三行确实在 `isTouchUi()` 块里、`usesCenterAim()` 与 `aim-center` body class 两处消费都带 `this.touch !== null`、键鼠分支走 `PlayerPhysics.lookDirection` 的视线射线
  - 为什么：PC 的"中心点"是既有行为（没有手指落点这回事），但代码里它表现为"`touch === null` 时落到 else 分支"，属于**隐式**保证；一旦有人给 PC 接上 `touchTapPoint`，取物就会变成跟着鼠标位置走。断言把这条隐式契约写死
  - 验证：`npm run test:ui` **1145/0**（+3 条）；`npx tsc --noEmit` 干净
  - 批次：20261026-0030

## 批次 20261026-0000 · 2026-10-25 · 会话 0a9f5045

> 用户实测进房间的六条反馈：① 加入后卡在生成页、刷新才进得去；② 天数/时间对不齐；③ 地址框被填成 `ws://` 长串；
> ④ 开房也要能填服务器地址 + 房名必填 + 重名拒绝；⑤ 提示「clientId 已在线」却能进世界、看不到别人；
> ⑥ 退出/刷新仍算在线、重连后名字还是旧的、所有人都标「房主」、名字牌被压扁。

# 队列 · 会话 0a9f50455e4c4bc9beab90e5c768d9b8

> 状态：执行中
> 创建：2026-10-25
> 批次：20261026-0000

目标（用户 2026-10-25 实测进房间，六条反馈）：① 加入后卡在生成页、刷新才进得去；② 天数/时间对不齐；
③ 加入面板的地址框被填成 `ws://…` 长串（应该只填 IP）；④ 开房时也要能填服务器地址、房名必填、重名要拒；
⑤ 提示「clientId 已在线」却能进世界、且看不到别人；⑥ 退出/刷新后仍算在线、重连后名字还是旧的、
所有人名字牌都标「房主」、名字牌被压扁。

- [x] [联机60] 加入时被**致命拒绝**不再进入世界、也不再卡在生成页（用户 ①⑤）：`src/main.ts` 的 `onStatus(false)` 按 `net.sessionState`/致命码分流，未 playable 就退回主菜单并给出理由 → 验收：`tools/net-test.mjs` 新增「重复 clientId 被拒后不会进入世界」+ 本地双浏览器复现脚本（第二个人加入必须停在一句明确提示）
  - 做了什么：`NetClient` 加 `get closeIsFatal()`；`main.ts` 的 `onStatus(false)` 里，致命断开 → `abortJoin()`——只对 `mpjoin-` 加入来的临时世界生效，`hideLoading()` + `returnToMenu(false)`（不落盘）+ 回菜单后 `multiplayerScreen.open('join')` 把原因摆在面板上；`refreshLoadingState()` 加 30s 看门狗（`JOIN_LOAD_TIMEOUT_MS`，超时打一行 `[JOIN_DBG]` 关键量再走同一条中止）；`onStatus(false)` 开头加 `if (this.disposed) return`（拆到一半不再重载世界）；新增文案 `mp.joinTimeout` 六语言
  - 为什么：加入来的世界是房主种子的临时副本，**连不上就没意义**——让玩家"进得去但看不到人"比停在明确提示更糟；而"卡在生成页"是同一件事的另一半：`leaveMultiplayerSave()` 会重载世界，遮罩只等 `spawnResolved`，永远等不到就卡死。用 `worldConfig.id.startsWith('mpjoin-')` 当判据比另加一个"这次是加入"的字段可靠（存档 id 就是事实）
  - 验证：`npx tsc --noEmit` 干净；`npm run test:ui` 1122/0（新增 6 条：致命标记存在、主程序接上、只对 mpjoin 生效、不落盘、回菜单开面板、超时兜底）；`npm run audit:i18n` 通过；`npm run check:fast` 161/161 全绿
  - 未验：双浏览器真机复现（要真实走一遍"世界卡片开房 → 第二个标签页加入"，留给用户实测；若仍卡，`[JOIN_DBG]` 那行日志会打出 spawnResolved / mesh / pending / net 状态）
  - 批次：20261026-0000
- [x] [联机61] 天数与时间点一起对齐（用户 ②）：服务端维护权威 `day`，`welcome` 与 `time` 广播都带上，客户端直接采用（不再各算各的）→ 验收：`tests/net-time.test.ts` 新增天数断言；`npm run test:net` 通过
  - 做了什么：`NetTime` 加纯函数 `dayAt(now, startMs, dayLength, startTime, startDay)`；服务端 `startDay` + `currentDay()`，`welcome` / `time` / 存档快照都带 `day`，睡满跳黎明时 `startDay+1`、房主改时间前先结算当天；房主 `join` 带 `day`（`NetClient.localDay`），服务端**只在某房间第一次开房**时采纳；客户端 `onTime` 收下 `day` → `netDay`，每帧 `applyAuthoritativeDay()` 归位天数与月相（不触发村民补货）；断开时清 `netDay`
  - 为什么：天数原来只在各端本地累加（跨午夜 +1 / 睡满 +1），晚加入的人从第 0 天开始——月相、`hud.moonDay`、村民补货必然错开；时间已经是服务端权威，天数跟它共用同一套起点参数最省事。房主的天数要带进房间，但重连时客户端那份可能落后，所以只认第一次开房（`doing/0a9f50-decision.md` D1~D3）
  - 验证：`npx vitest run tests/net-time.test.ts` 16/16（新增 4 组 `dayAt`：起点、跨午夜才 +1、起点时间参与判据、脏参数）；`npm run test:net` **199/0**（+4：welcome 带天数、时间广播带天数、房主 day=42 起算、后加入的人拿到同一天）；`npm run test:ui` 1127/0（+5 结构断言）；`npx tsc --noEmit` 干净；`npm run check:fast` 全绿
  - 批次：20261026-0000
- [x] [联机62] 加入面板的地址框只显示 IP（用户 ③）：`ServerUrl` 加 `displayServerAddress()`（去 `ws://`、默认端口不显示），三处回填（打开面板、最近连接、拆解粘贴地址）都用它 → 验收：`tests/net-server-url.test.ts` 往返断言；浏览器里打开面板默认值形如 `192.168.1.5`
  - 做了什么：`ServerUrl` 加 `displayServerAddress()`（`ws://host:25187` → `host`；显式非默认端口保留；`wss://` 连协议头一起保留——裸域名会被地址栏补成 `ws://`，等于把 https 部署悄悄改成明文）；`MultiplayerScreen` 四处回填（构造时读存储、`show(intent)`、`splitAddress()`、最近连接 chip）全部走它，存储与连接仍用完整 URL
  - 为什么：占位文案写着"只填 IP，端口已固定"，回填却塞 `ws://…:25187`，两处口径打架；地址栏该回答的是"那台机器在哪"，协议头与固定端口是实现细节
  - 验证：`npx vitest run tests/net-server-url.test.ts` 25/25（新增 4 组：默认端口不显示、显式端口保留、`wss` 保留协议头、`normalizeServerUrl(displayServerAddress(u)) === u` 往返）；`npm run test:ui` 断言三处回填都过 `displayServerAddress`
  - 批次：20261026-0000
- [x] [联机63] 开房也要填服务器地址、房名必填、重名拒绝（用户 ④）：`WorldScreen` 的开房对话框加地址（默认回填当前 IP）+ 房名必填；`main.ts` 用填的地址而非 `defaultServerUrl()`；服务端房间已被占用时拒绝并提示 → 验收：`npm run test:net`（重名开房被拒）+ 浏览器手点一次
  - 做了什么：开房对话框加「服务器地址」一行（默认 `defaultHostAddress()` 回填当前地址，口径与加入面板一致：只 IP）；房名空 → 「给房间起个名字」、地址归一化失败 → 「填一下服务器地址」，两句复用同一条 hint 只换颜色（`.world-edit-hint.error`）；`onHostWorld(world, room, password, baseUrl)`，`pendingHostRoom` 带上 `baseUrl`，`startWorld` 里改用 `intent.baseUrl`（不再写死 `defaultServerUrl()`）；`normalizeServerUrl` 从 `ui/MultiplayerScreen` 搬进 `core/net/ServerUrl.ts`（开房与加入共用，UI 之间不必互相 import）；`host-taken` 走 i18n（`say.net.hostTaken`）；新增 4 条文案六语言
  - 为什么：开房地址以前写死且不可见，服务器在另一台机器时必然连错；房名留空会静默退回默认房间，两拨人各自开房就撞在同一个默认房名上、第二个人只看到服务端的 `host-taken` 中文。重名拒绝本身服务端已有（`tools/net-test.mjs:1303`），这里补的是"玩家能看懂 + 能改"
  - 验证：`npx tsc --noEmit` 干净；`npm run test:ui` **1134/0**（+7 条：地址输入框、房名必填、地址必填、回调带地址、主程序用 `intent.baseUrl`、host-taken 走 i18n、错误样式；另修了三条因归一化搬家而失效的旧断言）；`npm run test:net` 199/0（含既有「第二个房主被拒 host-taken」）；`npm run test:screenshot` 14/0；`npm run audit:i18n` 通过；`npm run check:fast` 161/161 全绿
  - 未验：浏览器手点开房对话框（看不到世界卡片需要先建世界；版式与「编辑世界」同一套 row，风险低）
  - 批次：20261026-0000
- [x] [联机64] 退出/刷新立刻离线（用户 ⑥前半）：页面卸载时发 `bye`，服务端收到即广播 `leave` 并清掉落物，不再留 30s 影子 → 验收：`npm run test:net` 新增「bye 之后同房立刻收到 leave」
  - 做了什么：`NetClient.sendBye()` + `pagehide`（capture）钩子，`disconnect()` 也先发 bye；服务端新增 `case 'bye'`——收到立刻 `broadcast({t:'leave'})`、标记 `player.farewell`、然后 `socket.close()` 走既有清理路径（玩家表 / 房主提示 / 宽限期登记），宽限期到点检查 `farewell` 不再重复广播
  - 为什么：光靠 close 分不清"主动退出/刷新"和"网断了"，一律等 30 秒宽限期才广播 leave，队友名单里就挂着幽灵。**掉落物故意不清**：刷新回来还是同一个 id（宽限期还在），清掉等于"刷新一次把自己的东西弄丢"——宽限期到点若真没回来，既有逻辑会清（见 D6）
  - 验证：`npm run test:net` **203/0**（+4：bye 后同房立刻收到 leave、「没等 400ms 宽限期」`elapsed<300ms`、宽限期到点不重复广播）；`npm run test:ui` 1138/0（+4 结构断言）；`npx tsc --noEmit` 干净；`npm run check:fast` 全绿（net 25.9s + ui）
  - 批次：20261026-0000
- [x] [联机65] 重连改名同步 + 房主标识唯一 + 名字牌不再压扁（用户 ⑥后半）：服务端 `player` 广播带 `isHost`、客户端 `hostId` 跟着更新；`MobNameTag` 的 sprite 宽度改为**按实际绘制尺寸**算（不再用估算宽度，长名字不再被横向拉扁）→ 验收：`npm run test:nametag` + `npm run test:net` + 截图对比
  - 做了什么：服务端 `player` 广播（join 与 move 两条）都带 `isHost: hosts.get(room)?.id === player.id`；`NetPlayerState` 加 `isHost?: boolean`，`NetClient` 在 `player` 事件里跟随（`true` 就记、**只有明确 `false` 且正好是当前那位**才清）、`leave` 与 `room-closed` 时清空、welcome 里 `hostId` 缺失时从玩家表 `isHost` 兜一次；名字牌宽度改成按**实际画出来的背景条像素**换算——`NameTag` 新增 `NAME_TAG_CANVAS_*` 与纯函数 `nameTagWorldWidth(boxPx)`，`MobNameTag.drawName` 记下 `drawnBoxPx`，`show()` 用 `nameTagWorldWidth(this.drawnBoxPx)` 定 scale（不再用按字数估算的 `nameTagWidthFor`）
  - 为什么：`hostId` 只在 welcome 里下发一次，房主离开/换人之后永远停在旧值——名字牌"该标的没标、不该标的还标着"；而宽度估算（按字数）与字号缩放（按 `measureText` 实测）是两套算法，长名字时字被缩到 12px 而 Sprite 仍横向撑开 → 字被压扁（越长越扁）。现在只保留一个"像素 → 世界"比例，横竖同倍。改名重连那条本来就广播新名字（`player` 带 name），补了断言钉住
  - 验证：`npm run test:nametag` **153/0**（+4：方形条→方形牌、线性、宽/像素与高/画布高同比例、兜底正宽度；另修 1 条过时断言）；`npm run test:net` **207/0**（+4：房主那条 player 带 isHost=true、从属那条 false、改名重连复用 id、改名后同房收到新名字）；`npm run test:ui` 1141/0（+3 结构断言）；`npm run test:screenshot` 14/0；`npx tsc --noEmit` 干净；`npm run check:fast` 5/5 全绿
  - 未验：真机肉眼看名字牌比例（无浏览器截图手段直接拍到名字牌，靠"横竖同倍"的比例断言兜住）
  - 批次：20261026-0000

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

