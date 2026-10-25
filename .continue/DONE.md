# 完成档案 · DONE

> 本文件是**已完成工作的唯一档案**，只回答"这批做了什么、怎么验的"——时间线，最近的在最上面。
> 按模块看现状与坑 → `OVERVIEW.md`；下次怎么避开 → `TIPS.md`；机制与格式 → `README.md`。
> **一条内容只写一个地方**，别在三份文档里各抄一遍。
>
> 收尾时**整份队列原样搬进来**（含每条任务下方的完成说明与 `[阻塞]`），标题格式
> `## 批次 <号> · 日期 · 会话 <前 8 位>`。

---

## 批次 20261026-0245 · 2026-10-26 · 会话 0a9f5045

> 用户 2026-10-26 三条：① 房主改游戏模式，其他人收不到；② 访客下线，房主看不到也没有消息；
> ③ 世界界面的按钮太高，新建世界/加入房间要等宽。

# 队列 · 会话 0a9f50455e4c4bc9beab90e5c768d9b8

> 状态：执行中
> 创建：2026-10-26
> 批次：20261026-0245

目标（用户 2026-10-26）：房主改了**游戏模式**，房里的其他人也要跟着变（现在完全收不到）。

- [x] [联机73] 游戏模式随 `room-config` 同步给全房：房主 `setGameMode` 时上报，服务端记在房间上并广播（含房主），`welcome` 带上当前模式让晚进的人也一致 → 验收：`npm run test:net`（房主发 `room-config{gameMode}` → 全房收到；后加入者的 `welcome.gameMode` 是新值）+ `tools/ui-test.ts` 结构断言
  - 做了什么：房主 `setGameMode` 后调 `sendRoomConfig({ gameMode })`（两个守卫：`!applyingRemoteGameMode`、`!waitingForSaveRestore`）；服务端新增 `roomGameModes` 房间表，白名单校验后广播 `room-config{gameMode}` 并随 `welcome` 下发当前值；客户端 `onRoomConfig` 应用模式（带回声守卫）并打一行 `say.net.roomGameMode`；晚进的从属端在 `onWelcome` 后采用 `welcome.gameMode`
  - 为什么：世界元数据里的 `mode` 是房主 `join` 那一刻的快照，之后 `/gamemode` 改的从来不会回写；也从来没有一条"模式变更"的消息。现在模式和时间/天气同走 `room-config`，一份通道三种配置
  - 验证：`npm run test:net` **212/0**（+2：房主改模式 → 同房收到 `room-config{gameMode:'creative'}`；晚进的人 `welcome.gameMode` 也是 creative）；`npm run test:ui` **1166/0**（+4 结构断言）；`npm run audit:i18n` 通过（新增 `say.net.roomGameMode` 六语言）；`npx tsc --noEmit` 干净；`npm run check:fast` 全绿
  - 未验：真机双端切一次模式（读档恢复/旁观飞行这些副作用没在真机上点过）
  - 批次：20261026-0245
- [x] [联机74] 访客退世界时断开联机（用户 2026-10-26）：`App.dispose()` 以前**完全不碰 `net`** → socket 挂着 → 服务端收不到 `bye` 也等不到 `close` → 房主眼里对方永远在线、也没有"离开了"的提示 → 现在 `dispose()` 先 `net.disconnect()`（内部先发 `bye` 再关 socket）
  - 做了什么：`dispose()` 开头 `this.disposed = true` 之后立刻 `this.net.disconnect()`（`disconnect()` 的首行就是 `sendBye()`）；`tests/net-client-look.test.ts` 补两条：断开时先发 `bye` 再关 socket、没连上时不抛
  - 为什么：`bye` 分支与服务端"立刻广播 leave"上一批已经做好，缺的一环是**客户端主动断开这条链**——回主菜单/换世界走的是 `dispose()`，它以前只拆渲染与界面，网络对象直接丢掉，浏览器不保证回收，服务端就永远等不到这条连接结束
  - 验证：`npx vitest run tests/net-client-look.test.ts` **7/7**（+2）；`npm run test:net` 212/0（`bye → leave` 那侧上一批已覆盖）；`npm run test:ui` 1168/0（+2 结构断言：`dispose` 里先断开、离开有系统提示）；`npx tsc --noEmit` 干净
  - 未验：真机双端（访客点「退出到主菜单」/关标签页，房主那边应当立刻少一个人 + 聊天区一行"某某离开了房间"）
  - 批次：20261026-0245
- [x] [界面1] 世界界面入口行压矮 + 两颗按钮等宽（用户 2026-10-26）：`index.html` 的 `.world-list-top` 改成两颗 `flex: 1 1 0`（以前「新建世界」铺满、「加入房间」只有文字宽），PC 上整排压到 36px；列表标题旁的「导入存档」压到 27px
  - 做了什么：`.world-list-top > .world-primary/.world-secondary` 统一 `flex: 1 1 0; width: auto; max-width: none; text-align: center`；新增 `@media (pointer: fine)` 把这一排压到 `min-height: 36px`、`.world-import` 压到 `padding: 3px 9px; font-size: 11px`；`#world-new-button` 只留"铺满"语义（宽度/高度交给共用规则）
  - 为什么：两颗按钮是同一层（都是"开始一局"），一宽一窄看着像不同层级；52px 是"手指点得到"的下限，不是 PC 上该有的高度。**判据用 `(pointer: fine)` 而不是 `body:not(.touch-mode)`**——`touch-mode` 是进世界、建触摸层时才挂的，主菜单阶段手机上也没有这个类，拿它当判据会把手机的 52px 一起压掉
  - 验证：1280×720 实测两颗 **358×36 等宽等高**、导入存档 70×27；792×360 触屏实测两颗 **350×52**（保留可点高度）、导入存档 72×33；截图 `.tmp/shots/worlds-pc.png`；`npm run test:ui` **1170/0**（+2 条 CSS 结构断言）
  - 批次：20261026-0245

## 批次 20261026-0130 · 2026-10-26 · 会话 0a9f5045

> 用户 2026-10-26 四条反馈：① 开房失败不该进世界；② 访客第一次加入提示进入了却卡在生成页；
> ③ 房主挖开水边方块后加入方的水不流；④ 改成晴天后雨声还在。

# 队列 · 会话 0a9f50455e4c4bc9beab90e5c768d9b8

> 状态：执行中
> 创建：2026-10-26
> 批次：20261026-0130

目标（用户 2026-10-26 反馈四条）：① 开房失败不该进世界；② 访客第一次加入提示进入了却卡在生成页；
③ 房主挖开水边方块后，加入方的水不流；④ 房主把雨改成晴天后，声音还在。

- [x] [联机66] 开房失败要拦住（用户 ①）：`WorldScreen` 的开房对话框等预检结果、失败留在原地显示原因；新增 `src/net/HostPreflight.ts`（只连不发 join）→ 验收：`npx vitest run tests/host-preflight.test.ts`
  - 做了什么：新增 `preflightHost({baseUrl, room})`——只建立一次 WebSocket（3 秒超时，连上即关，**不发 join**），再 best-effort 拉 `/rooms` 看 `hasHost`；返回 `unreachable` / `taken` / `null`。`WorldScreen.onHostWorld` 改成可返回 `Promise<string | null>`，`go()` 等结果：失败 `showError()` 并留在对话框（按钮期间 disabled），成功才 `cleanup()`。`main.ts` 里的回调改成先 `await preflightHost(...)`，`unreachable` → `t('mp.hostUnreachable')`、`taken` → `t('say.net.hostTaken')`，只有通过才 `pendingHostRoom` + `startWorld`
  - 为什么：以前是"先建世界再后台连"，服务器没起/地址错/房名被占时人已经站在世界里了（建世界还要跑地形生成），失败只能看到一句看不懂的 `host-taken` 或静默断开。**关键约束**：预检不能发 `join`——发完就断会把房主位占进 30 秒宽限期，正式开房反而被 `host-taken` 拒掉
  - 验证：`npx vitest run tests/host-preflight.test.ts` **6/6**（连不上 / 超时 / 房名被占 / 同名无房主放行 / 拿不到列表放行 / URL 带房名且连上就关）；`npm run test:ui` **1155/0**（新增 3 条结构断言）；`npx tsc --noEmit` 干净；`npm run audit:i18n` 通过（新增 `mp.hostUnreachable` 六语言）
  - 批次：20261026-0130
- [x] [联机67] 雨→晴之后环境音停不下来（用户 ④）：`AudioEngine.setAmbience` 的起伏振荡器改挂独立增益；网络天气改走 `setWeather()` → 验收：`npm run test:ui` 断言
  - 做了什么：雨声节点链从 `… → out(音量) → master`（起伏 `gust` 直接接在 `out.gain` 上）改成 `… → swell(1±0.045) → out → master`，`gust` 只接 `swell.gain`；`main.ts` 的 `onWeather` 从 `weather.setKind(kind)` 改成 `this.setWeather(kind)`（与本地命令同一条路径，`applyEnvironment()` 一起跑）
  - 为什么：`AudioParam` 的输入是**加在基础值上**的——`setTargetAtTime(0)` 只把基础值推到 0，叠加的 ±0.045 仍在振，于是晴天里永远有 4.5% 的雨声底噪。而 `weather.setKind()` 只改状态与降水粒子、不跑 `applyEnvironment()`，远程改天气时环境音沿用上一档
  - 验证：`npm run test:ui` **1155/0**（断言 `gust.connect(gustDepth).connect(swell.gain)` 存在、旧的 `connect(out.gain)` 不存在、`onWeather` 里 `this.setWeather(kind)`）；`npx tsc --noEmit` 干净
  - 未验：真人耳听"雨停即静"（无头环境听不到声）
  - 批次：20261026-0130
- [x] [联机68] 访客第一次加入卡在生成页（用户 ②）：`refreshLoadingState` 加 8 秒"就地认可落点"自愈 → 验收：`npm run test:ui` 断言
  - 做了什么：新增 `JOIN_FORCE_SPAWN_MS = 8000` 与 `forceJoinSpawn()`——加入来的世界若"已经有区块网格、但 8 秒还没落点"，就地认可当前坐标（`spawnPoint` + `spawnResolved = true`）并补一次 `requestGroundSettle('join')`，只做一次；30 秒那条 `abortJoin` 兜底保持不变；日志统一打 `[JOIN_DBG]`
  - 为什么：30 秒兜底是"彻底放弃退回菜单"，而玩家看到的是"提示进入了却卡在生成页"。**不能**用 `prepareNewWorldSpawn()` 兜——加入方的人已经在房主身边，重新规划出生点会把人瞬移到几百格外
  - 验证：`npm run test:ui` **1155/0**（断言常量与 `forceJoinSpawn()` 存在、且自愈里**不**调用 `prepareNewWorldSpawn()`）；`npx tsc --noEmit` 干净
  - 未验：真机双端加入（没有自动化双端环境；若仍卡，控制台会打 `[JOIN_DBG] 8 秒没有落点，就地认可：…` 带 chunks/mesh/net 三个量）
  - 批次：20261026-0130
- [x] [联机69] 加入方的水不流动（用户 ③）：房主挖开水边方块后，房主端水流、加入方水不动。静态读代码已确认"任何方块写入都经 `World.events.onBlockChanged → queueBlockChange → BlockFunnel.sendBlocks`"，但没找到加入方收不到/不生效的确证点 → 需要一次带日志的复现，再加 `[FLUID_DBG]` 计数（房主每秒发出的水方块数 / 加入方每秒应用的水方块数）后定位
  - 做了什么：真服务端 + 两个真浏览器复现（房主开房、加入方走真实的「加入房间」面板），发现**加入方根本没站在那片地形上**——`loadSaveState()` 是异步的，它用**上一局**存档里的坐标 `teleport` 覆盖了 `alignSpawnToHost()` 刚放好的"房主身边"落点；人不在那片区块里，房主的流体改动只会走 `planRemoteBlock` 的 `buffer` 分支进 `world.edits` 而不落地，画面上就是"他那边水一直不动"。修：`loadSaveState` 对 `mpjoin-` 世界**跳过位置/维度/朝向恢复**（房间里的位置与维度由房主/服务端说了算），背包/进度/规则照旧恢复。另保留 `[FLUID_DBG]` 计数（房主"发出"、加入方"应用"，附 role/net/可写）作为后续自查入口
  - 为什么：这不是"水"独有的问题——同一个原因会让加入方看不到房主的红石、火焰、作物生长等一切"房主算出来的方块变化"，而画面看上去完全正常。相比"给水加一条专门同步"，把落点改对是唯一的正解；顺带也解释了之前"加入方在奇怪的位置""看不到别人"的零散反馈
  - 验证：双浏览器对比同一坐标周围 13×9×13 的水方块数——修前 guest 恒为 2、host 从 2 涨到 114（完全不跟）；修后 guest 与 host 同步跟随（1→53 逐拍对齐，滞后约 0.7 秒），`guest 距房主: 0.0 格`；`[FLUID_DBG]` 两侧数字一致（发出 7 / 应用 7）。`npm run test:ui` **1157/0**（+2 条结构断言：`joinWorld` 分支跳过位置恢复、`[FLUID_DBG]` 计数在位）；`npm run test:net` 208/0；`npx tsc --noEmit` 干净；`npm run check:fast` 全绿
  - 未验：用户当时的原始场面（若仍出现，`[FLUID_DBG]` 那行的 `可写` 与两端"发出/应用"数字能直接区分是没发、被闸挡住、还是距离太远只 buffered）
  - 批次：20261026-0130

## 批次 20261026-0110 · 2026-10-26 · 会话 0a9f5045

> 用户 2026-10-26：加入房间与开房，地址栏只收 **IP 或域名**，前后缀自动派生——
> IP 走局域网明文 ws + 固定端口，域名走 `wss://域名/ws`。

# 队列 · 会话 0a9f50455e4c4bc9beab90e5c768d9b8

> 状态：执行中
> 创建：2026-10-26
> 批次：20261026-0110

目标（用户 2026-10-26）：加入房间与开房，地址栏只收 **IP 或域名**，
前缀/后缀自动派生——IP 走局域网明文 ws + 固定端口，域名走 `wss://域名/ws`。

- [x] [地址1] 地址栏只收 IP 或域名，前后缀自动派生：`src/core/net/ServerUrl.ts` 新增 `isLanHost` / `deriveFromBare`，`normalizeServerUrl` 与 `displayServerAddress` 按地址类型收放 → 验收：`npx vitest run tests/net-server-url.test.ts`
  - 做了什么：新增 `DEFAULT_WS_PATH='/ws'`、`isLanHost()`（IPv4 / `[IPv6]` / `localhost` / `*.local`，域名不算）、`deriveFromBare()`（IP → `ws://host:25187`、域名 → `wss://host/ws`，显式端口/路径保留）；`normalizeServerUrl` 对**裸输入**走派生、对显式协议仍原样尊重；`displayServerAddress` 改成只显示 `host[:端口][/非默认路径]`（wss 不再保留协议头、默认 `/ws` 不显示）
  - 为什么：用户的两句原话是"局域网直接填 IP""是域名就自动用 wss 前后缀"。派生规则必须与 `resolveDefaultServerUrl()` 给 https 页面的那条**同一个**路径常量，否则会出现"默认能连、手填连不上"
  - 验证：`npx vitest run tests/net-server-url.test.ts` **35/35**（新增 6 组派生：IP/localhost、IP+显式端口、域名、域名+端口、域名+自定义路径、显式协议；`displayServerAddress` 与往返各 1 组）；`npx tsc --noEmit` 干净
  - 批次：20261026-0110
- [x] [地址2] 房间与口令改走 query、`/rooms` 保留反代端点前缀、占位文案改成"IP 或域名"：`formatServerUrl` / `parseServerUrl` / `roomsEndpoint` + 六语言 `mp.serverHint` → 验收：`npm run test:ui` + `npm run audit:i18n`
  - 做了什么：`formatServerUrl` 从 `/red?pw=1` 改成 `?room=red&pw=1`（path 留给 `/ws`）；`parseServerUrl` 优先读 query，老格式仍按 path 解析但**跳过 `/ws` 端点段**，且 `url` 现在保留端点路径；`roomsEndpoint` 保留 WS 的路径前缀（`wss://d/ws` → `https://d/ws/rooms`），老格式的房名段仍去掉；`mp.serverHint` 六语言改为"IP 或域名"
  - 为什么：`wss://domain/ws` 的 path 已经被反代端点占住，再往后拼房名会变成 `/ws/red`——`parseServerUrl` 会把 `ws` 当房名、反代也可能按 `handle_path /ws*` 剥错前缀。房间/口令走 query 后两条地址形态共用一套解析
  - 验证：`npm run test:ui` **1147/0**（+2 结构断言：派生规则在 core 且面板共用、提示六语言都有且中文含"域名"）；`npm run audit:i18n` 通过；`npm run check:fast` 全绿（顺带修两条跟着改口径的旧断言：`tests/room-probe.test.ts` 的地址形态、`tests/net-server-url.test.ts` 的显示与 `/rooms`）
  - 未验：连一台真实公网服务器（手头没有 `wss://…/ws` 的部署；派生结果由单测钉住）
  - 批次：20261026-0110

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

