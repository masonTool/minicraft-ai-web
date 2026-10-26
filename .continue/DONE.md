# 完成档案 · DONE

> 本文件是**已完成工作的唯一档案**，只回答"这批做了什么、怎么验的"——时间线，最近的在最上面。
> 按模块看现状与坑 → `OVERVIEW.md`；下次怎么避开 → `TIPS.md`；机制与格式 → `README.md`。
> **一条内容只写一个地方**，别在三份文档里各抄一遍。
>
> 收尾时**整份队列原样搬进来**（含每条任务下方的完成说明与 `[阻塞]`），标题格式
> `## 批次 <号> · 日期 · 会话 <前 8 位>`。

---

## 批次 20261026-2259 · 2026-10-26 · 会话 783135b3

> 用户 2026-10-26 报的五件事：① 对方形象每隔几秒闪一次；② 队友死了对方还站着；
> ③ 名字要像网游那样一直看得到、正面朝向；④ 生存模式瞄准队友要看到生命/饥饿；
> ⑤ 野怪血条小一点细一点。

# 队列 · 会话 783135b39ab64f5599ca2897f9593157

> 状态：执行中
> 创建：2026-10-26
> 批次：20261026-2259

- [x] [L8] 修"对方形象每隔几秒闪一次"：`move` 每条带全量外观 + 服务端 `player.appearance` 改成合并 + 接收端"没带就不动" → `npm run test:net`
  - 做了什么：`NetClient.tick()` 不再按 `lookDue` 节流，`held/offhand/armor/look/sneak/swing/hurt/fire/ride/sleep/dead/hp/food` **每条都带**（0/false 也带）；`server/index.mjs` 的 `readAppearance()` 改成"只返回消息里真的带了的键"，`move` 分支用 `player.appearance = { ...player.appearance, ...readAppearance(message) }` 合并；`RemoteAppearance.update()` 每个字段 `!== undefined` 才覆盖；删掉 `LOOK_RESEND_MS`/`lastSentLookKey`/`lastLookSentAt`。
  - 为什么：根因是"整份覆盖 + 客户端只在变化/每 2 秒带 look"——不带 look 的那 99% 消息把服务端的 appearance 清成空，对端回退到"按昵称派生"的外观，2 秒后再纠正回来，周期正好 2 秒。三层都改是为了老服务端/老客户端混着用也不闪。
  - 验证：`npm run test:net` **278 → 286 通过 / 0 失败**（新增 8 条：带 look/held/hp/food 转发、**不带 look 的 move 不清空皮肤**、不带 held 不清空手持、dead 1/0 都能覆盖、死亡时 hp=0 能表达、hp/food 夹到 0~20）；两条旧断言按新语义改写（"非正 id 被丢掉" → "规整成 0"、"长度不足的 look 不下发" → "不被采纳、保持上一次"）；`tests/net-client-look.test.ts` 重写 4 条为"每条都带"；`npm run check:fast` 595 单测。
- [x] [L8] 队友死亡：上行 `dead` + 对端当场收掉模型 + 消息栏说一句 → `npm run test:net`
  - 做了什么：`localAppearance()` 补 `dead/hp/food/fire`；服务端白名单加 `dead/hp/food`（`clampPoints` 夹 0~20）；`updateRemotePlayers()` 的可见性改成 `visible && !dead`；`updateNameTags()` 跳过死者；`onNetPlayer` 在 `dead` 的**边沿**推一句 `say.net.playerDied`（六语言新增）。
  - 为什么：以前死亡没有任何上行，服务端只看到"他在原位不动"，尸体就一直站着，直到复活后位置变了才更新；模型凭空消失也得有一句解释。
  - 验证：`npm run test:net` 见上（dead 的两条）；`npm run audit:i18n` 2973 键 × 6 语言通过。
- [x] [L8] 队友名字牌：范围 64 → **视距尽头 128 格**、去掉距离渐隐 → `npm run check:fast`
  - 做了什么：`REMOTE_NAME_TAG_RANGE` 64 → 128；删掉 `REMOTE_NAME_TAG_FADE_FROM` 与 `remoteNameTagOpacity()`，`updateNameTags` 固定传 1；`tools/nametag-test.ts` 的四条渐隐断言换成两条范围断言；`tools/render-test.ts` 无关。
  - 为什么：用户要的是"像常见网游那样，视野里就一直能看到"——64 格 + 32 格起变淡 + 固定 16 个牌子池，观感就是"名字时有时无"。
  - 验证：`npm run check:fast` 全绿（`nametag` 套件通过）。
- [x] [L8] 生存模式下准星锁定队友 → 显示一红（生命）一黄（饥饿）两条细条 → `npm run check:fast`
  - 做了什么：`index.html` 加 `#target-vitals`（96×两条 3px，在准星与冷却条下方）+ 样式；`main.ts` 新增 `aimRemotePlayer()`（12 格、8° 锥、跳过死者/他维度）与 `updateTargetVitals()`（只在 `gameMode === 'survival' && !uiOpen && !dead` 且对方报过血量时显示，宽度按 `hp/20`、`food/20`），每帧跟着 `updateNameTags()` 调。
  - 为什么：`player` 消息以前完全不带血量/饥饿，所以这次先把数据补上（随每条 `move` 发 0~20 的整数），再画 UI；"对方没报过就不画"是为了不显示一根恒满的假条。
  - 验证：`npm run check:fast` 全绿（typecheck + 595 单测）；`npm run test:ui` 1199 通过。
- [x] [L8] 野怪血条变小变细 → `npm run check:fast`（`render` 套件）
  - 做了什么：`MobHealthBar` 世界宽度 `1.1~2.4` → **`0.7~1.4`**、画布 `256×40` → **`256×16`**（条 24px → 12px、描边 2 → 1、内边距 3 → 2）、离头顶 `0.12` → `0.06`；`tools/render-test.ts` 三条尺寸断言按新值改写。
  - 为什么：画布原来 40px 高、条只占 24px（60%），世界高度被画布比例稀释，看起来既粗又占地；画布贴紧条（12/16 = 75%）之后同样是"细条"但分辨率没浪费。
  - 验证：`npm run check:fast` 全绿（`render` 套件通过）。
- [x] [L8] 协议与台账：`NET-PROTOCOL.md` 的 `move` 行补 `dead/hp/food` 与"外观每条全量、服务端合并" + `TASKS.md` 的 L8 补一节 → `npm run check`
  - 做了什么：§4 的 `move` 行字段补 `dead / hp / food`，备注写清"每条带全量 + 服务端合并"以及闪烁的来龙去脉与 2 秒周期；§7 的 `player` 行补"没带的字段保持原值""dead 为真时模型与名字牌一起收掉并提示"；`TASKS.md` 的 L8 补第 ⑫ 点（观感四件套）。
  - 为什么：这几条都是"看起来像 bug 的行为其实是约定"（外观必须每条全量、`dead` 会随每条 move 重复到达），不写进协议表下次又会按"变化才发"改回去。
  - 验证：`npm run check` 全绿（typecheck + 181 套离线测试 + 三张台账）。

## 批次 20261026-2242 · 2026-10-26 · 会话 783135b3

> 用户 2026-10-26：① 房主**主动退出**就立刻把访客全部踢出；② 服务器上那个房间还在、
> 但房主不在线时，访客不许进来。

# 队列 · 会话 783135b39ab64f5599ca2897f9593157

> 状态：执行中
> 创建：2026-10-26
> 批次：20261026-2242

- [x] [L8] 房主**主动退出**（`bye`）→ 当场关房并踢掉所有访客（不等 30 秒宽限期）：`server/index.mjs` 的 `bye` 分支 + 新增 `closeRoomNow()`；客户端按 `graceMs === 0` 说"房主已退出，房间已关闭" → `npm run test:net`
  - 做了什么：新增 `closeRoomNow(host)`：删 `hosts` → 广播 `room-closed{reason:'host-out', graceMs:0}` → 对同房其他人逐个 `reject('host-left', 4007)` → `clearRoom`，日志带"踢出 N 人 / 丢弃 N 条缓存"；`bye` 分支先判"我是不是本房房主"，是就走这条路（并置 `farewell`，避免宽限期到点再广播一次 `leave`）；客户端 `onRoomClosing` 按 `graceMs > 0 ? 倒计时 : net.roomClosed` 分两种文案。
  - 为什么：主动退出是玩家说"我不玩了"，没有留重连窗口的必要，房间里剩下的也不是"暂时没人模拟"而是"这一局结束了"。继续挂着只会让访客对着一个不推进的世界发呆。**注意**：页面卸载（刷新/关标签）也会发 `bye`，所以房主刷新页面同样会关房——这是"主动退出"的应有语义，数据在房主本地，重开即可。
  - 验证：`npm run test:net` **269 → 278 通过 / 0 失败**（新增 9 条：两个访客同时建房 → 房主 `bye` → 两人都立刻收到 `host-left` 且连接关闭 → 用时 < 900ms → 同名房可**马上**重开 → 新房主的 welcome 里没有上一局那格方块（缓存当场清了）→ 房主掉线后访客被拒 → 宽限期过后房主位释放）。
- [x] [L8] 房主不在线时访客进不来：`join` 里判"有房主登记但人不在 `players`" → `error{code:'host-offline'}` + 关闭 4009；探房（`RoomProbe`）把这句翻成人话 → `npm run test:net`
  - 做了什么：服务端新增关闭码 `CLOSE_HOST_OFFLINE = 4009` 与 `join` 里的检查（`!wantsHost && host && !players.has(host.id)`）；`Protocol.ts` 把 `host-offline` 加进错误码联合与**致命名单**（自动重连只会空转：30 秒内一直被同一句挡住，之后房间就没了）；`main.ts` 的 `onError` 按 code 翻成 `say.net.hostOffline`（六语言补齐）；`RoomProbe` 的 `RoomProbeResult` 增 `error?`，`joinRoomFromMenu` 遇到 `host-offline` 说"房主暂时不在房间"而不是"连不上服务器"。
  - 为什么：房里登记着房主、但人不在线时，访客进来看到的是一个**不推进的世界**（怪物不动、红石不亮），而界面一切正常——这正是最难查的坏状态。探房那句必须区分开，否则会把玩家送去改 IP/换端口，方向完全错了。
  - 验证：`npm run test:net` 含"房主不在线时访客被拒（host-offline）+ 连接关闭"；`npm run test:ui` **1198 通过 / 0 失败**（原有 1 条钉着旧文案的结构断言改成新写法，另加一条"graceMs=0 说房间已关闭"）；`npm run audit:i18n` 通过（2972 键 × 6 语言）。
- [x] [L8] 协议与台账：`NET-PROTOCOL.md` 的 `bye` / `room-closed` / 错误码表补这三处 + `TASKS.md` 的 L8 补两点 → `npm run check`
  - 做了什么：§4 上行表**新增 `bye` 行**（原来表里根本没有这条消息，只在代码里），并顺手修正 `sleep` 的说明（现在只拨本房）；§5 下行表 `room-closed` 补 `host-out` 与 `graceMs: 0`；§5.1 错误码表补 `host-offline` / 4009；§3 生命周期加"房主的两条额外规则"（主动退出即关房 + 房主不在线访客进不来）；`TASKS.md` 的 L8 补第 ⑩⑪ 点。
  - 为什么：`bye` 这条消息在协议表里缺席很久了（代码里一直有），这次它变成"能关一整间房"的关键消息，必须进表；两条新规则都是可被误判的行为（"为什么我一刷新队友就被踢了"、"为什么我进不去"），文档要能回答。
  - 验证：`npm run check` 全绿（typecheck + 181 套离线测试 + 三张台账）；`node .continue/hooks/check.mjs docs` 通过。

## 批次 20261026-2150 · 2026-10-26 · 会话 783135b3

> 用户 2026-10-26 复核后追加两条：① 掉落物也是世界的一部分，房主进房要能把它带进来；
> ② 时钟/天气改成**每房一套**（两间房同时开时互不影响）。

# 队列 · 会话 783135b39ab64f5599ca2897f9593157

> 状态：执行中
> 创建：2026-10-26
> 批次：20261026-2150

- [x] [L8] 掉落物进房重播要能一次吐完：服务端 `item-spawn` 改成令牌桶（30/s、突发 400）+ 单测断言突发额度 → `npm run test:net`
  - 做了什么：`server/ratelimit.mjs` 的 `RATE_LIMITS` 增 `item: {perSecond:30, capacity:400}`，`createBuckets()` 加 `item` 桶；`item-spawn` 分支把手写的"1 秒窗口 + 计数"换成 `player.buckets.item.take()`，删掉 `ITEM_RATE_LIMIT` / `itemWindow` / `itemCount` 三个已无用的东西。
  - 为什么：房主进房间时客户端本来就会把世界里已有的掉落物重播一遍（`syncNetItems` 每 100ms 扫实体表，`localNetItems` 断线时被清空），机制一直在，卡点只有服务端的 30/秒——一个住过的世界地上可能上百堆，超出的被丢掉**且不重试**，队友那边就凭空少一地东西。所以修法不是新加一条上行协议，而是给这个已有通道一个够用的突发额度。
  - 验证：`tests/net-ratelimit.test.ts` 新增 1 条（一次取满 capacity 通过、连取两次失败、1 秒后恢复 30/s）；`npm run test:net` 新增"100 堆一次性上行全部收下"（`welcome.items` 恰好 100）。
- [x] [L8] 每房一套时钟：服务端 `room → clock`（时间/天数/天气），`sleep` 与 `room-config` 只动本房，`clearRoom` 删掉 → `npm run test:net`
  - 做了什么：`createClock()` + `defaultClock` + `clocks: Map<room, clock>` + `clockOf(room)`；`currentDay/currentTimeOfDay` 改成收一个 clock；`clockTimer`/`weatherTimer` 按房各推一份（兜底时钟给没有房主的房）；`snapshotFor`、`room-config`、`sleep` 全部改成本房那份；`worldSnapshot`/读档只回填 `defaultClock`；`clearRoom` 增 `clocks.delete(room)`。
  - 为什么：以前是全服一套，房主 B 在另一个房开房会把握着 A 那个房间的太阳一起拨过去；`sleep` 更狠——遍历所有房间，甲房有人睡觉会把乙房的天翻过去。房间本来就是各是各的世界，时钟没有共享的理由。
  - 验证：`npm run test:net` **260 → 269 通过 / 0 失败**（新增 9 条：甲房 0.2/第 20 天、乙房 0.85/雨、天数与天气互不干扰、甲房睡满跳到黎明且天+1、乙房完全不受影响；另含掉落物 1 条）。
- [x] [L8] 协议与台账：`NET-PROTOCOL.md` 记「每房一套时钟」与掉落物突发额度 + `TASKS.md` 的 L8 补两点 → `npm run check`
  - 做了什么：`join` 行第 ⑪ 条的备注从"对所有在用房间广播"改成"只对**本房**广播"；§6 的「时钟与天气」整行改写成每房一套（`room → clock` + `defaultClock` 落盘 + `sleep`/`room-config` 只动本房）；§6 的「掉落物广播」改成令牌桶 30/s + 突发 400 并写明理由；`TASKS.md` 的 L8 补第 ⑧（每房时钟）与第 ⑨（掉落物重播 + 纠正"两端都不落盘"的错说法）两点。
  - 为什么：协议表是两端共同的契约；这次改的是"谁说了算"的边界（共享 → 每房），不写进表里下次照旧实现会再踩一遍。掉落物那条顺手把上一轮我说错的话在台账里更正，避免以后被人当成事实引用。
  - 验证：`npm run check` 全绿（typecheck + 181 套离线测试 + 三张台账）。⚠️ 先红了 4 条 `tools/ui-test.ts` 的结构断言（它们钉着旧的 `currentDay()` / `startTimeOfDay = …` 字面串）——改成按新结构断言（`currentDay(clockOf(player.room))` / `clock.startTimeOfDay` / `clocks.set(room, clock)` / `const clock = createClock()`），`test:ui` **1197 通过 / 0 失败**。

## 批次 20261026-2131 · 2026-10-26 · 会话 783135b3

> 用户 2026-10-26 复核："服务器上所有变更都写回房主本地"这条之前漏了**时间与天气**（只有天数跟房主）。
> 定稿：时间/天数/天气**全部以房主本地为准**；旧 @mp: 存档不做迁移；清场仍等宽限期结束。

# 队列 · 会话 783135b39ab64f5599ca2897f9593157

> 状态：执行中
> 创建：2026-10-26
> 批次：20261026-2131

- [x] [L8] 时间/天数/天气也以房主本地为准：客户端 `join` 带上 `timeOfDay` / `weather`，服务端开房时三个量一起采纳 → `npm run check:fast`
  - 做了什么：`NetClient` 新增 `localTimeOfDay` / `localWeather`（与 `localDay` 同组，只有 `wantsHost` 才带）；`App.connect()` 在连之前把 `this.timeOfDay` 与 `this.weather.current` 填进去。协议 `join` 从此带三个可选字段。
  - 为什么：房主离线期间时钟/天气在他存档里走，重开房若服务端不接住，他一进来就被拽到"服务端此刻"——看起来什么都没发生，但那不是他的世界了。
  - 验证：`npm run check:fast` 全绿（typecheck + 593 单测）。
- [x] [L8] 采纳后按房广播对齐（`time{snap}` / `weather`），宽限期内重连的房主不覆盖 → `npm run test:net`
  - 做了什么：服务端 `join` 的 `wantsHost` 分支把 `freshRoom` 判据统一成 `sameHostReturning`（与清场同一个谓词），三个量一次采纳：`startDay` / `startTimeOfDay`（脏值保留当前）/ `weather`（`isWeatherKind` 过滤），最后才重置 `serverStartMs`；随后对**所有在用的房间**广播 `time{snap:true}` 与 `weather`。
  - 为什么：`snap` 是"立刻对齐"——不带的要按 4 倍速收敛，房主会看到太阳爬一段；广播到所有房间是因为时钟本来就全服共享，只发本房会让别的房停在旧值直到下次切换。重连不采纳是因为那时客户端带的是过期值（他断线前那一刻），采纳会把房间拽回去。
  - 验证：`npm run test:net` **252 → 260 通过 / 0 失败**（新增 8 条：房主带 `day=12` / `timeOfDay=0.75` / `weather=thunder` → 自己的 welcome 三个都对上 → 后来者的 welcome 也对上 → 宽限期内带 `day=3` / `0.05` / `clear` 重连，三个都**不**覆盖）。
- [x] [L8] 协议与台账：`NET-PROTOCOL.md` 的 `join` 行补三个可选字段与"谁说了算" + `TASKS.md` 的 L8 补一句 → `npm run check`
  - 做了什么：`join` 行的字段列加 `day?/timeOfDay?/weather?`，校验列加第 ⑪ 条（三样各自兜底脏值、**只有房主带得动**、宽限期内重连不采纳），备注列写清"采纳后对所有在用房间广播"；§6 新增"时钟与天气"一行（全服共享 + 代价）；`TASKS.md` 的 L8 补第 ⑦ 点。
  - 为什么：协议表是两端共同的契约，字段加在代码里而表里没有，下次照表实现就会漏。全文一致地把"时间也以房主为准"写进 §2 之外的地方。
  - 验证：`npm run check` 全绿（typecheck + 181 套离线测试 + 三张台账）。⚠️ 先红了一次：`tools/ui-test.ts` 有条结构断言钉着旧报文 `...(this.wantsHost ? { day: this.localDay } : {})`，改报文体后它当场报错——改成断言三个字段，并补两条（服务端采纳、重连不覆盖）。`test:ui` **1197 通过 / 0 失败**。

## 批次 20261026-2011 · 2026-10-26 · 会话 783135b3

> 用户 2026-10-26：**联机期间创建的所有东西都写回房主本地**；房主离开后服务器把这个房间的信息清掉；
> 房主离线期间的改动也只存本地；再次开房时服务器以**房主本地**为准重建——一句话：
> **服务器上的一切变更都回到房主本地，两边始终以房主为准**。
> 两个已拍板的取舍：① 服务端**不保留**"只读救援副本"（房主设备丢 = 这一局全丢）；
> ② 方块增量走**按区块懒上行**（不是开房全量推）。

# 队列 · 会话 783135b39ab64f5599ca2897f9593157

> 状态：执行中
> 创建：2026-10-26
> 批次：20261026-2011

- [x] [L8] 房主联机不切 `@mp:` 库（改动直接落单机存档）+ 联机期保存压到 10 秒、断开前强制落盘：`src/main.ts` 的 `enterMultiplayerSave` / `tickAutoSave` / `onStatus(false)` → `npm run check:fast`
  - 做了什么：`enterMultiplayerSave()` 开头按 `this.net.role === 'host'` 早退（房主全程用 `world.id` 那个单机库），`leaveMultiplayerSave()` 因此对房主自动 no-op、也不再原地重载；新增 `hostSession`（在 `onNetWelcome` 里记一份，断开善后里用掉并清掉，因为那时 `role` 已经回 `solo`）；`tickAutoSave()` 取 `min(设置值, 10s)`；`onStatus(false)` 里房主先 `saveNow('mp-host-leave')` 再做其它善后。
  - 为什么：房间数据只存房主本地之后，"最后 30 秒"没有任何备份，而原先房主的改动写进 `@mp:` 库（只写不读）等于退出即丢。取 `min` 而不是直接赋值是为了不和玩家自己设的 5 秒打架。
  - 验证：`npm run check:fast` 全绿（typecheck + i18n 审计 + 586 条单测；离线套件不覆盖 `src/main.ts`，脚本自己提示了这一点）。
  - 待人工：双端手测"联机盖房 → 退出房间 → 单机进同一个世界，房子还在"（需要浏览器 + 两个客户端）。
- [x] [L8] 服务端清场：新增 `clearRoom()`，房主新上位与关房时各清一次 → `npm run test:net`
  - 做了什么：`clearRoom(room)` 按房名前缀清 edits/containers/signs/frames，顺手清同房玩家的掉落物、`roomWorlds`/`roomGameModes`、两张区块追踪表；三处调用——① 关房（房主宽限期结束）② `join` 里 `wantsHost` 分支（`send(welcome)` 之前）③ 由 ② 兜住"服务端崩溃重启后的残留"。
  - 为什么：房间数据以房主本地为准，残留会在下一局被 `welcome` 发出去，等于服务端把房主的世界改回去。判据用 `sameHostReturning = grace && hosts.get(room)?.id === player.id`：**宽限期内重连的房主不清**（他切后台回来还是同一局）。原先想用 `host.id !== player.id`，但那条件实际上是死代码——新 host 在 `host-taken` 那道闸就被拒了，能进来的只有"本人重连"。
  - 验证：`npm run test:net` **217 → 226 通过 / 0 失败**（新增 9 条：房主写方块+容器 → 队友能看到 → 断开 120ms 内同 clientId 重连仍是房主且缓存不清（新队友仍收到那 9 条）→ 宽限期过后进同房名 welcome 全空、新房主上位也不继承）。
- [x] [L8] 服务端不再持有世界存档：`worldSnapshot()` 只留时间/天数/天气，`SNAPSHOT_VERSION` 升 2 并兼容读 v1（旧房间数据静默丢弃）→ `npm run test:net`
  - 做了什么：`worldSnapshot()` 删掉 edits/containers/signs/frames 与 `seed`，只剩 `version/savedAt/timeOfDay/day/weather`；读档块删掉四张表的还原循环，只回填天气/时间/天数，并在版本不符时打一行说明；`roomOfDataKey()`（只为落盘拼房名）与它的 `DEFAULT_ROOM` 导入一并删掉；`store.mjs` 的 `SNAPSHOT_VERSION` 1 → 2，新增 `READABLE_VERSIONS`（v1 仍可读，不当损坏）。
  - 为什么：房间数据以房主本地为准之后，"服务端还存着一份世界"会立刻变成第二份事实——重启后被 `welcome` 发出去就是把房主的世界改回上次的样子。v1 不当损坏是因为内容完好、只是格式旧，时间/天数/天气仍然有效。
  - 验证：`npm run test:net` **226 → 236 通过 / 0 失败**（改写原"重启后方块还在/容器还在"两条为"不再复活"；新增直接读 `world.json` 断言 v2 + 四张表不存在 + 时间仍在；新增 v1 升级用例：手写 v1 文件 → 不被改名成 `.broken` → 方块/容器/牌子/展示框全丢弃、时间 0.5 与天气 rain 被沿用）。
- [x] [L8] 方块增量懒上行（服务端侧）：`edits-request` 下发给房主、`edits-reply` 收下并广播 `blocks`，`pushChunkEdits` 改成"已确认直接推、未确认向房主要" → `npm run test:net`
  - 做了什么：新增 `confirmedChunks`/`requestedChunks`（按房一份，上限 4096 / 在飞 8）+ `trackedChunks`/`rememberTracked`；`pushChunkEdits` 拆成"直接推缓存"（`sendChunkEdits`）与"向房主要"（`requestChunkFromHost`，5 秒后忘掉这次在飞，回包丢了下次 move 会重试）；新增 `edits-reply` 分支（只收本房房主、复用 `blockEditRejection`、坐标必须落在声称的那一块里、收下后按房广播 `blocks`）；`snapshotFor` 对房主不再下发 edits/容器/牌子/展示框（双保险）。
  - 为什么：`edits-reply` 不复用 `blocks` 是因为**空区块必须能回"没改过"**——`blocks` 的空列表在现有逻辑里直接 return，而 `requested` 不清就会被无限请求。**没有房主的房**（有人直接 join）没有权威可问，退回老行为"服务端缓存就是共用那份"，否则那类房间的跨区块补发会整条失效。
  - 验证：`npm run test:net` **236 → 243 通过 / 0 失败**（新增 7 条：队友跨进未确认区块 → 房主收到 `edits-request{dimension,cx,cz}` → 回包后队友收到 `blocks` → 另一块再要一次 → 空块确认后不再重复询问 → 确认过的块会进后来者的 welcome）。踩到一次 `move` 50ms 限频（第二次 move 被直接丢），用例里补了 `sleep(80)`。
- [x] [L8] 房主响应 `edits-request`：`src/net/NetClient.ts` 加收发、`src/main.ts` 从 `world.edits` 取整块回包 → `npm run check:fast && npm run test:net`
  - 做了什么：`NetClient` 加 `onEditsRequest` 回调 + `edits-request` 分支 + `sendEditsReply()`（空块也发；超过 4096 条拆包）；解包抽成纯函数 `core/net/ChunkSnapshot.ts#chunkSnapshotBlocks()`，`main.ts` 的 `replyChunkEdits()` 只负责"取快照 → 交给它 → 发出去"。
  - 为什么：解包是最容易错的一步，抽出来才能离线断言。**实际抓到两个 bug**：① `Chunk.coordsAt()` 返回的是**区块内** x/z（y 是世界坐标），原来忘了加 `cx*16 / cz*16`，所有补发的方块会堆在区块西北角——而原点附近的房间看起来完全正常；② 返回类型写成 `number[][]` 装不下末位的维度名。第一个由新增用例 `区块坐标必须加到局部坐标上` 直接钉住（含负区块坐标 `z = -33`）。
  - 验证：`npm run check:fast` 全绿（typecheck + **593** 单测，较基线 586 增 7 条：空快照/空表/坐标与状态位/区块偏移含负坐标/条目形状/相邻区块不混/位运算往返）；`npm run test:net` **243 通过 / 0 失败**（服务端那条链上一批已覆盖）。
- [x] [L8] 房主开局整份上行容器/牌子/展示框（`session-sync`）：服务端按房广播、客户端在 `welcome` 之后发 → `npm run test:net`
  - 做了什么：服务端新增 `session-sync` 分支（只收本房房主、`kind` 分 container/sign/frame、形状校验与各自的单向消息同口径但**不设距离闸**、按条数上限 `SESSION_SYNC_MAX_MESSAGES=256`，收下后按房广播）；客户端 `NetClient.sendSessionSync()`（200 条一包，空集合也发）+ `App.flushSessionSync()` 在 `welcome` 后触发，**读档没回来就先挂起**（`waitingForSaveRestore`），在 `start()` 的读档 `.then/.catch` 里补推。
  - 为什么：这三种不能像方块那样懒补——队友打开一个空箱子就会往里放东西，然后被服务端那份覆盖。挂起是因为时机：`welcome` 往往早于读档完成，那时容器表还是空的，直接推等于告诉服务端"这人没有箱子"。
  - 验证：`npm run check:fast` 全绿（typecheck + 593 单测）；`npm run test:net` **243 → 252 通过 / 0 失败**（新增 9 条：清场后 welcome 无箱子 / 房主推完后**先进来的**队友当场收到 container+sign+frame 三条广播 / **后进来的**队友从 welcome 拿到三样 / 从属端伪造 `session-sync` 被无视）。
- [x] [L8] 协议文档与台账收口：`docs/NET-PROTOCOL.md` 补两条消息与"服务端不持有存档"口径 + `TASKS.md` 落 L8 → `npm run check`
  - 做了什么：`NET-PROTOCOL.md` —— §2 补"世界以房主本地为唯一真相 + 服务端只是会话缓存"的完整口径与代价；§4 新增 `edits-reply` / `session-sync` 两行（含校验与"空块必须回"）；§5 新增 `edits-request` 行、改写 `welcome`（房主不带世界数据）；§6 改正三处过期数字（增量上限 20 万→50 万、世界种子不落盘、快照内容 v2）并补"房间清场/懒上行在飞上限/session-sync 上限"四行；§7 新增 `edits-request` 的客户端行为；§8 改写 `联机13`/`联机14`/`联机26` 三条。`TASKS.md` 的 L 段新增 L8 条目（口径 6 点 + 两条 ⚠️ 取舍/坑 + 待人工）。`OVERVIEW.md` 的联机条目与坑各补一句（压在 200 行 / 28672 字节上限内）。`HANDOFF.md` 进度口径 303/295 → 304/296。
  - 为什么：文档漂移是这项目最常见的债，数字更是一抄就漂——`audit:tasks` 当场抓住了 HANDOFF 的 295 与 README 的路线图状态列，按"数字只由脚本生成"的口径重写。
  - 验证：`npm run check` 全绿（typecheck + 181 套离线测试 + 三张台账；`audit:tasks` 报"共 304 项（296/5/0/3）、编号无重复、各段连续"）；`node .continue/hooks/check.mjs docs` 通过（OVERVIEW 恰好 200 行 / 27874 字节）。

## 批次 20261026-0620 · 2026-10-26 · 会话 0a9f5045

> 用户 2026-10-26：https 访问局域网设备是**浏览器权限**层面的开关（Chrome 本地网络访问 / Firefox 对应开关），
> 不需要我们提前拒绝——把上一批那两处「硬拦」改成「先试、再提示」。

# 队列 · 会话 0a9f50455e4c4bc9beab90e5c768d9b8

> 状态：执行中
> 创建：2026-10-26
> 批次：20261026-0620

目标（用户 2026-10-26）：https 页面能不能访问局域网设备，是**浏览器权限**层面的开关
（Chrome「本地网络访问」/ Firefox 对应开关），不该由我们提前拒绝——把上一批的两处"硬拦"改成"先试、再提示"。

- [x] [授权1] 「选择服务器」面板 https 页面不再禁用扫描：照样扫，扫不到才提示去开权限 → 验收：`npm run test:ui`
  - 做什么：`ServerPicker.open()` 不再 `disabled = true`，只在状态行放一句 `server.httpsHint`；扫描结束仍为空且页面是 https 时，把"没找到 · 去授权"合并成一行提示；`server.scanBlocked` 文案换成 `server.httpsHint`（六语言，内容改为"允许本站访问本地网络"的具体路径）
  - 为什么：Chrome 的 Local Network Access 权限开通后，https 页面可以访问 `http://` / `ws://` 局域网设备（Firefox 也有开关）。禁用按钮等于把一条其实可用的路堵死
  - 验证：`npm run test:ui` **1195/0**（断言改成"不再禁用 + 有授权提示"）；`npx tsc --noEmit` 干净；`audit:i18n` 通过
  - 批次：20261026-0620
- [x] [授权2] 开房预检先尝试、连不上才归因「https 需要授权」→ 验收：`npx vitest run tests/host-preflight.test.ts`
  - 做什么：`preflightHost` 取消提前 return，照常 `canOpen`；失败**且**（页面 https + 目标 ws://）才回 `https-blocked`；该原因的文案改成同时给两条办法（去授权 / 换 http 打开）
  - 为什么：上一批我把它写成"连尝试都不尝试"，同样是替玩家做了决定。授权过的浏览器本来就该能开房
  - 验证：`npx vitest run tests/host-preflight.test.ts` **9/9**（+2：https+ws 连不上 → https-blocked 且**确实尝试过**；https+ws **连得上 → 放行**）
  - 未验：真机在授权后开房（要 Chrome 的 LNA 权限，无头环境造不出来）
  - 批次：20261026-0620

## 批次 20261026-0600 · 2026-10-26 · 会话 0a9f5045

> 用户 2026-10-26：服务器跑在电脑上、手机在同一局域网里开房失败（之前能成功）。

# 队列 · 会话 0a9f50455e4c4bc9beab90e5c768d9b8

> 状态：执行中
> 创建：2026-10-26
> 批次：20261026-0600

目标（用户 2026-10-26）：服务器跑在电脑上、手机在同一局域网里**开房失败**（之前能成功）。

- [x] [开房1] 预检把「连不上」与「被浏览器拦（https 页面连 ws://）」分开：`HostPreflight` 新增 `https-blocked`，开房对话框给专门文案 → 验收：`npx vitest run tests/host-preflight.test.ts`
  - 做什么：`HostPreflightDeps` 加 `pageProtocol`（默认真实 `location.protocol`）；`pageProtocol === 'https:' && /^ws:\/\//` 时**不建 socket**直接返回 `https-blocked`；`main.ts` 映射成 `mp.hostHttpsBlocked`（六语言）；两条失败分支都补 `console.warn`（带目标 URL）
  - 为什么：混合内容跟网络无关——https 页面连 `ws://192.168.x.x` 会被浏览器直接拒，玩家改 IP、换端口、重启服务器全都没用。以前两种情况都回 `unreachable`，于是手机（页面在 https 上）开房失败看到的是一句"连不上服务器"，方向从一开始就错了
  - 验证：`npx vitest run tests/host-preflight.test.ts` **8/8**（+2：https+ws → https-blocked 且**不建 socket**；http+ws 正常放行）；`npx tsc --noEmit` 干净；`npm run audit:i18n` 通过
  - 批次：20261026-0600
- [x] [开房2] 服务端启动打印**局域网地址**（不再只打 localhost）→ 验收：真机启动输出
  - 做什么：`server/index.mjs` 用 `os.networkInterfaces()` 列出所有非 internal 的 IPv4，逐条打 `ws://<ip>:<port>`，并把原来那句"玩家把游戏指向 ws://localhost 即可联机"改成"本机自连（只有这台机器能用）"
  - 为什么：`localhost` 只对跑服务端那台机器成立，手机填它指的是手机自己——这正是"手机上不知道填什么/填了连不上"的常见起点
  - 验证：实测启动输出 `192.168.66.187 → ws://192.168.66.187:25190`（本机真实网卡）
  - 批次：20261026-0600
- [x] [开房3] 断言：ui-test 三条（预检分支 / 文案 / 启动打印）→ 验收：`npm run check:fast`
  - 做什么：`tools/ui-test.ts` 加三条结构断言
  - 验证：`npm run test:ui` **1195/0**（+3）；`npm run check:fast` 全绿
  - 未验：手机真机开房（无头复现不出"跨设备 + https 页面"这两个条件；已按最可能的原因把错误提示改准，并给出验证办法）
  - 批次：20261026-0600

## 批次 20261026-0500 · 2026-10-26 · 会话 0a9f5045

> 用户 2026-10-26：「服务器地址除了手输，右侧加一个选择按钮 → 服务器选择界面（局域网扫描 / 公开服务器）」，
> 服务器要能被探测来测响应时间，选中自动回填；开房与加入两处都要。

# 队列 · 会话 0a9f50455e4c4bc9beab90e5c768d9b8

> 状态：执行中
> 创建：2026-10-26
> 批次：20261026-0500

目标（用户 2026-10-26）：服务器地址除了手输，还要能「选」——地址框右侧一个按钮，点开进服务器选择界面；
界面里两个区域：**局域网扫描**（扫当前网段找可用服务器）与**公开服务器**（接口下发，先留入口）；
服务器要提供探测接口（发一个包、回一个包），用来测响应时间；选中后自动把地址填回；
**开房**与**加入房间**两处都要这个入口。

- [x] [服务器1] 服务端提供无状态探测接口 `GET /ping`（禁缓存、几十字节）→ 验收：`npm run test:net`
  - 做什么：`server/index.mjs` 在 `/healthz` 前加 `/ping`，返回 `{ok:true,t:Date.now(),v:PROTOCOL_VERSION}`，头里 `cache-control: no-store`
  - 为什么：局域网扫描要并发打 254 个地址，只能靠「谁能最快回一个字节」判断；不能复用 `/healthz`（要算吞吐与房间数），也不能用 WebSocket 握手（每条都要完整握手+关闭，浏览器同源并发还有上限）
  - 验证：`npm run test:net` **217/0**（+4：`/ping` 返回 ok、带协议版本、`no-store`、本机 RTT < 200ms）
  - 批次：20261026-0500
- [x] [服务器2] 发现逻辑收成纯模块 `core/net/ServerDiscovery.ts`（网段枚举 / 单点探测 / 并发扫描 / 可取消 / https 判定）→ 验收：`npx vitest run tests/server-discovery.test.ts`
  - 做什么：`subnetOf`（只认 10/8、192.168/16、172.16~31/12）→ `subnetHosts`（254 个）→ `probeHost`（量 RTT）→ `scanSubnet`（并发 32、边扫边回调、可取消、按 RTT 排序）；`canScanLan(protocol)` 判 https；浏览器实现 `browserReach` 用 `fetch(mode:'no-cors') + AbortController`
  - 为什么：这一段决定「能不能用」，必须能离线测（注入 `reach`/`now`，不打真网络）；`no-cors` 是因为局域网服务端不会给每个来源加 CORS 头，而我们要的只是「这地址有人在听」
  - 验证：`npx vitest run tests/server-discovery.test.ts` **15/15**（网段识别/公网拒绝、254 枚举、RTT 升序、边扫边回调、取消、https 判定 + 公开列表解析 3 条）
  - 批次：20261026-0500
- [x] [服务器3] 新增「选择服务器」面板 `ui/ServerPicker.ts`（局域网扫描区 + 公开服务器区 + 选中回填）→ 验收：`npm run test:ui` 结构断言
  - 做什么：标题行（关闭）、局域网区（网段输入默认从当前地址/页面地址推导 + 扫描按钮 + 状态行 + 逐条结果带 RTT）、公开区（`publicServersUrl()` 为空显示「接口还没提供」；有 URL 就拉 `{servers:[{name,address,region?}]}` 并列出）；点遮罩关闭；https 页面禁用扫描并说明原因
  - 为什么：做成「看一眼点一下」的浮层（挂 `<body>`、点遮罩即关），它夹在「填地址」这一步中间，做成第三个视图要多两次返回
  - 验证：`npm run test:ui` **1192/0**（+13 条结构断言）；样式 `.server-picker*` 与 `.world-pick` 落 `index.html`
  - 批次：20261026-0500
- [x] [服务器4] 两处入口接上：开房对话框地址行右侧 ▾（第三列）+ 加入面板地址行 ▾ → 验收：`npm run check:fast`
  - 做什么：`WorldScreen` 用现有 `makeRow(label, control, extra)` 第三参数放按钮，面板按对话框生命周期建/拆（`cleanup()` 里 `dispose`）；`MultiplayerScreen` 在地址行插到「找房间」左边，面板按需创建后常驻（该界面只建一次）
  - 为什么：两处填的是同一个东西，必须同一套面板；用 ▾ 而不是「选择」两个字——六语言长度差太多，`.world-row` 第三列只有 44px
  - 验证：`npx tsc --noEmit` 干净；`npm run test:ui` 1192/0；`npm run check:fast` 全绿
  - 未验：真机在局域网里扫一次（本机开发页面是 http 可以扫；部署在 GitHub Pages 的 https 页面会被浏览器拦住，面板会直接说明原因）
  - 批次：20261026-0500

