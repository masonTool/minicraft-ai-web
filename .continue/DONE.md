# 完成档案 · DONE

> 本文件是**已完成工作的唯一档案**，只回答"这批做了什么、怎么验的"——时间线，最近的在最上面。
> 按模块看现状与坑 → `OVERVIEW.md`；下次怎么避开 → `TIPS.md`；机制与格式 → `README.md`。
> **一条内容只写一个地方**，别在三份文档里各抄一遍。
>
> 收尾时**整份队列原样搬进来**（含每条任务下方的完成说明与 `[阻塞]`），标题格式
> `## 批次 <号> · 日期 · 会话 <前 8 位>`。

---

## 批次 20261027-0740 · 2026-10-27 · 会话 12c62cf0

> 用户 2026-10-27："请继续，不要停" —— Rust 侧继续推进时发现剩下的都是结构性改动，先把会误导人的文档修掉、把缺口记成待办。

# 队列 · 会话 12c62cf015444720a2a57c257f80c045

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-0740

- [x] [R1] 修正「Rust 已逐条对齐」的过时声明 + 记下缺口：`server/README.md`、`server/rust/README.md`、`.continue/TASKS.md` → `npm run check`
  - 做了什么：两处 README 原来都写「与 JS 版逐条对齐 / 195 条 0 失败」，改成「**对齐到 2026-10-25 那一版**」，并列出 Rust 还缺的四项（`session-sync`、`edits-request`/`edits-reply`、每房一套时钟、`join` 采纳房主时钟），已补的三项标「未编译验证」；TASKS 增 `R1`（含验收口径），HANDOFF 待办 0→1。
  - 为什么：这句话正是本次合并把我误导的地方——文档说"逐条对齐"，实际 Rust 缺 5 项、且我补的 3 项没编译过。文档比代码更该保守。
  - 验证：`npm run check` exit=0（HANDOFF 口径 / TASKS 差异台账已由脚本重写）。
  - 批次：20261027-0740

---

## 批次 20261027-0720 · 2026-10-27 · 会话 12c62cf0

> 用户 2026-10-27："继续" —— 把合并后列出的 P0（Rust 与 Node 的协议差异）能安全补齐的部分先做掉。

# 队列 · 会话 12c62cf015444720a2a57c257f80c045

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-0720

- [x] [L13] Rust `join` 补 `no-host` / `host-offline`：`server/rust/src/{handlers,protocol}.rs` → 语法自查
  - 做了什么：`protocol.rs` 补 `CLOSE_HOST_OFFLINE = 4009` / `CLOSE_NO_HOST = 4010`；`handlers.rs` 在 `wants_host` 判定之后加一段——`hosts` 里没登记房名就拒 `no-host`，登记着但人不在 `players`（宽限期断线）就拒 `host-offline`；用 `st.hosts.get(&room).copied()` 先取出 id 再判，避免 `drop(st)` 与借用打架。
  - 为什么：与 Node 版同一口径。没有房主的房间是一个**不推进的世界**（方块能放、怪不动、红石不亮），界面却一切正常。
  - 验证：**只做了语法与类型自查**——本机没有 `cargo`，`bash server/rust/run-net-test.sh` 未跑。
  - 批次：20261027-0720
- [x] [L13] Rust `/rooms` 补 `maxPlayers`、beacon 的 `has_host` 按房间判断：`server/rust/src/{lib,beacon}.rs` → 语法自查
  - 做了什么：`Config` 加 `max_players`（`MAX_PLAYERS`，默认 10，脏值/0 退回默认）→ `Hub` → `/rooms` 输出 `maxPlayers`；`beacon::announce_of` 的 `has_host` 从 `!state.hosts.is_empty()`（任意房间有房主）改成 `state.hosts.contains_key(&room)`（这一间）。
  - 为什么：前者让浮窗在手机内建服务端上也显示 `在线/容量`；后者在多房间时会对着一个没人跑模拟的房说「可以进」，客户端照它进房就踩到同一个坑。
  - 验证：同上，未经编译验证。
  - 批次：20261027-0720

---

## 批次 20261027-0700 · 2026-10-27 · 会话 12c62cf0

> 用户 2026-10-27："请继续" —— 承接合并后列的待补项：把「附近房间」在 Node 服务端上真正跑通。

# 队列 · 会话 12c62cf015444720a2a57c257f80c045

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-0700

- [x] [L12] Node 服务端补上 UDP 组播发现：`server/node/beacon.mjs` + `server/node/index.mjs` → `npm run test:net`
  - 做了什么：照 `server/rust/src/beacon.rs` 写同一份报文（`mc/v/id/port/room/name/seed/players/host/pw`、组播 `239.255.42.99:25188`、3 秒一帧、12 秒过期、按 id 过滤回声），收发分成两个 socket；`/healthz` 补 `beacon` / `beaconPort` / `peers`；监听回调里启动（端口要等 `PORT=0` 分配完才知道）；`SIGTERM` 时先停发现层；`BEACON=0` 可关。
  - 为什么：文档写着"Node 版 `/healthz` 返回 peers"，实际 body 里没有（只有 CORS 头），所以「附近房间」在 Node 服务端下永远是空的——只有手机上那份 Rust 才有数据。
  - 验证：本机双实例互相发现（8887 ↔ 9001，`addr=192.168.1.72`）；假房主进 8887 的 `newplayer` 后，9001 的 peers 变成 `name=草原小屋 / room=newplayer / players=1 / hasHost=true`；`test:net` **297 通过 / 0 失败**。
  - 批次：20261027-0700
- [x] [L12] 附近房间收尾：`src/ui/ServerPicker.ts` → `npm run check:fast`
  - 做了什么：附近设备行用它自报的 `room/players/hasHost` 直接列一行房间（不再去拉它的 `/rooms`，那台可能根本没连过来），延迟交给 `probeLatency()` 异步补；房间行支持"只知道人数不知道容量"（只写 `4`，不编 `1/0`）；空房名显示成「默认房间」。
  - 为什么：合并时只移植了"列出来"，worktree 里的 `probeLatency` 没人调用，附近设备的延迟一直是 `--`；而它自报的房间名比"进默认房"准得多。
  - 验证：`npm run check:fast` 全绿；补一条 ui-test 断言（自报房间 + 异步延迟 + `--` 兜底）。
  - 批次：20261027-0700

---

## 批次 20261027-0140 · 2026-10-27 · 会话 12c62cf0

> 用户 2026-10-27：① 设置里所有按钮 / 文字 / 输入框要统一规格，不要有大有小有高有低，弹框的位置 / 背景 /
> 关闭按钮也要统一；② 有浮层时下层不要干扰浮层信息；③ **一个房间没有房主时不允许别人进入**。

# 队列 · 会话 12c62cf015444720a2a57c257f80c045

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-0140

- [x] [L11] 没有房主的房间不许进：`server/index.mjs` + `src/core/net/Protocol.ts` + `src/util/net…` → `npm run test:net`
  - 做了什么：`join` 时 `hosts` 里没登记该房名 → `reject('no-host', CLOSE_NO_HOST)`；`ProtocolErrorCode` 与 `isFatalProtocolError` 加 `no-host`；`NetErrorText` 加映射、六语言补 `say.net.noHost`；`main.ts` 探房失败改成"按码说人话"；浮窗里 `hasHost === false` 的房间行渲染成不可点并标「无房主」。产品默认严格，测试用 `ALLOW_HOSTLESS_ROOMS=1` 放开。
  - 为什么：房间 = 房主开着世界那一局，没有他就是**不推进的世界**（方块能放、怪不动、红石不亮），而界面一切正常——比报错更难查。不做"先进空房等房主"：房名是玩家自己敲的，服务端分不清"等朋友"和"打错字"，后者会把人困死。
  - 验证：`test:net` **296 通过 / 0 失败**（新增 4 条：空房名被拒 / 房主开起来后访客能进 / 严格模式启动）。
  - 批次：20261027-0140
- [x] [L11] 控件与弹层统一规格：`index.html`（`:root` 变量 + 一段统一规则） → `npm run check`
  - 做了什么：新增 `--ctl-h(32)` / `--ctl-h-lg(40)` / `--ctl-font(13)` / `--ctl-pad-x(9)` / `--modal-w(460)` / `--modal-pad` / `--modal-bg` / `--modal-close(28)`；输入框（world / mp / settings）统一高度字号内边距，次级按钮 32、主按钮 40、标签 12；两个对话框同宽同内边距同边框，关闭按钮统一 28×28 钉右上。
  - 为什么：用户看到的"有的高有的低"来自三套各自为政的尺寸（world-row 7px padding / mp-row 6px / settings 默认），弹层也各写一套背景与关闭按钮。
  - 验证：截图 `ui-settings.png` / `ui-join-full.png` 对比，同一行控件基线一致；`npm run check` exit=0。
  - 批次：20261027-0140
- [x] [L11] 浮层降噪：`index.html` → 截图比对
  - 做了什么：`.server-picker` 加 `rgba(0,0,0,.45)` 遮罩 + `backdrop-filter: blur(2px)`；`#multiplayer-screen` 与 `.world-modal` 背后的世界列表同样轻微虚化。
  - 为什么：浮窗打开时下层「加入房间」面板的字还清晰可见，两层文字叠在一起读不出重点（用户原话"下层的信息不要对我的浮层信息造成干扰"）。
  - 验证：截图 `ui-picker-full.png`——下层压暗虚化、浮窗清晰，层级一眼可分。
  - 批次：20261027-0140

---

## 批次 20261027-0035 · 2026-10-27 · 会话 12c62cf0

> 用户 2026-10-27：上一批"没有按视觉实现"——端口要**可编辑**、局域网要按**自己 IP 段去掉最后一位自动检索**、
> 「选择」要以**浮窗**形式弹出（选择房间 / 选择服务器），要求完全照设计图。

# 队列 · 会话 12c62cf015444720a2a57c257f80c045

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-0035

- [x] [L10] 端口改成可编辑：`src/core/net/ServerUrl.ts` + `src/ui/RoomForm.ts` → `npm run check:fast`
  - 做了什么：新增 `parsePort` / `withPort` / `portOf` / `displayServerHost`；`RoomForm` 的 `portLabel`（只读后缀）换成 `portInput`（`mp-port-input`，默认 8887），`read()` 用 `withPort(normalized, port)` 拼回 URL；存储拆成 `mc.mp.url` + `mc.mp.port`；`splitAddress()` 把老地址里的端口提到端口框、地址框只留主机名。
  - 为什么：设计图是 `服务器 [IP] : [8887] [选择]`，端口是独立可改的一格；`wss://` 那一路的端口归反代 443，`withPort` 只动 `ws://`，否则会把公网地址改坏。
  - 验证：`tests/net-server-url.test.ts` 新增 11 条（parsePort 边界 / withPort 保留 query / wss 不动 / portOf / displayServerHost），全套 **43 通过**；`npm run check:fast` 全绿。
  - 批次：20261027-0035
- [x] [L10] 「选择」改成贴按钮的浮窗：`src/ui/ServerPicker.ts` 重写 → `npm run check:fast`
  - 做了什么：`open(anchor)` 用 `getBoundingClientRect()` 算坐标（右边缘对齐按钮、下方优先、放不下翻到上方、横向夹在视口内）；标题随 `mode` 变「选择房间」/「选择服务器(8887)」，副标题「所有端口 8887 的房间/服务器」；正文 `server-picker-body` 自己滚，标题与底部按钮固定；外层容器改成透明（只负责接"点外面关闭"）。
  - 为什么：以前是全屏遮罩 + 居中大卡片，不是设计图要的"浮窗"；而且列表一长「确定」会被顶出屏幕。
  - 验证：`npm run check:fast` 全绿；dev server 截图（`.tmp/shots/picker.png`）与设计图对齐：标题居中、副标题在下一行、取消/确定两颗等宽。
  - 批次：20261027-0035
- [x] [L10] 浮窗按「服务器 → 房间」两级 + 打开即扫：`ServerPicker.ts` + `src/core/net/RoomList.ts` → `npm run check:fast`
  - 做了什么：扫描发现一台就 append 一行 `IP …… 延迟 4ms`（虚线用 flex 撑开）+ 一个房间容器，随即 `loadRooms()` 拉这台机器的 `/rooms` 并渲染缩进的 `房间: xxx  1/10 在线`；`room` 模式房间行可点选中，`server` 模式渲染成 `div.readonly` 只展示；打开浮窗即 `scan()`，网段由 `suggestSubnet()` 从地址框/页面 hostname 推出。
  - 为什么：设计图里房间是服务器的子项；开房模式如果允许选别人的房名，必然撞 `host-taken`。
  - 验证：起本地服务端 + 假房主后截图，`192.168.1.72 —— 延迟 4ms / 房间: newplayer  1/10 在线` 与图一致；`check:fast` 全绿。
  - 批次：20261027-0035
- [x] [L10] 两个对话框改成单列版式（去掉右栏）：`MultiplayerScreen.ts` / `WorldScreen.ts` / `index.html` → `npm run check:fast`
  - 做了什么：`MultiplayerScreen` 重排成 `mp-head`（居中标题 + 右上 ✕）/ 四行 `mp-row`（服务器、房间、密码、昵称）/ `mp-status mp-error` 红字行 / 通栏 `mp-action.primary`；删掉 `mp-columns`、`mp-rooms`、`mp-recent`、`refreshRooms()` 与 `RecentRoom` 那一套（房间与历史都进了浮窗）。`WorldScreen` 的开房对话框同版式：标题居中 + ✕、地址行 `[本机] : [8887] [选择]`、只有一个通栏「确定并进入」。`makeRow` 的 `extra` 支持数组并加 `world-row-inline`（flex）——那个 3 列 grid 放不下 5 个元素。
  - 为什么：设计图两张图都是单列；`.world-row` 是 `grid-template-columns: 64px 1fr 44px`，多出来的元素会静默换行（第一次截图里端口和「选择」被挤到下一行）。
  - 验证：截图 `join.png` / `host.png` 与设计图逐行比对；`test:ui` 21 条断言随版式迁移（右栏/最近连接改成反向守卫）；`check:fast` 全绿（**609** 单测）。
  - 批次：20261027-0035
- [x] [L10] 台账收口：`TASKS.md` 落 L10、`OVERVIEW.md` 摘要改成最终版式、批次索引加行
  - 做了什么：TASKS 追加 L10（五条实现要点 + 验证口径）；OVERVIEW 那句"联机界面两个对话框"改写为"端口可编辑 / 选择浮窗=服务器→房间两级 / 局域网打开即扫 / 单列版式"（同时控制字节数，仍在上限内）；`notes/batches.md` 顶部加一行并记下 grid 那个坑。
  - 为什么：锚点文档只留一句摘要，细节落在 TASKS 与本文件；TIPS 已满 500 行，坑先进批次索引。
  - 验证：`node .continue/hooks/check.mjs --fast` 的 ids / docs 两项通过。
  - 批次：20261027-0035

---

## 批次 20261026-2327 · 2026-10-26 · 会话 783135b3

> 用户 2026-10-26：生存模式下野怪只咬房主、不咬房客，应该按原本的逻辑对两个人都可能下手。

# 队列 · 会话 783135b39ab64f5599ca2897f9593157

> 状态：执行中
> 创建：2026-10-26
> 批次：20261026-2327

- [x] [L8] 野怪要能追房客：`EntityContext.targetFor` + `Mob.playerTarget()`，AI 不再写死 `ctx.player`（本地玩家） → `npm run check:fast`
  - 做了什么：`Entity.ts` 新增 `PlayerTarget`（`x/y/z` + 可选 `invisible` / `hit` / `afflict`）与 `EntityContext.targetFor(mob)`；`Mob` 新增 `protected playerTarget(ctx)`（`targetFor` 优先，否则退回 `ctx.player`），用它替换 `updateAi` / `deliverMelee` / `distanceToPlayerSq` / `flyAi` 里的目标；`flyAi` 的参数类型放宽成 `PlayerTarget | null`；`Phantom`（幻翼）也改用 `playerTarget`。
  - 为什么：从属端根本不跑生物 AI（`SimMode`），整场模拟都在房主那边，而 `EntityContext.player` 只有一个（本地玩家 = 房主）——怪物自然看不见房客，这就是"只打房主"的根因。改目标选择，而不是给从属端也跑一份 AI（那会重新引入两端各算一遍的老问题）。
  - 验证：新增 `tests/mob-target.test.ts` **4 条**（没 `targetFor` 时退回本地玩家、指定远端后按远端算距离、返回 null 也退回、没有本地玩家时有远端目标也能算）；`npm run check:fast` **595 → 599 单测**全绿。
- [x] [L8] 伤害要落到房客身上：新增 `mob-attack`（房主 → 服务端 → 被打的那个人），接收方走本地 `damagePlayer` → `npm run test:net`
  - 做了什么：`NetClient.sendMobAttack()` + `mob-attack` 接收分支 + `onMobAttack` 回调；`server/index.mjs` 新增 `mob-attack` 路由（只收本房房主、`takeEffectToken` 限频、目标必须同房且不是自己、伤害夹 0~50、坐标有限、`source` 截 32 字、**只转给目标一人**）；`main.ts` 用 `pickRemotePlayerTarget()`（房主端挑"比本地玩家更近的、同维度、没死的远端玩家"）挂在 `targetFor`，`hit` 回调接 `sendMobAttack`，收到 `mob-attack` 走 `damagePlayer`。
  - 为什么：血量和护甲是**各端自己的**，房主不能直接改房客的血。房主只负责判定"谁被哪只怪打了、基础伤害多少"，护甲减免/无敌帧/难度倍率都在接收方本地算——这样"被野怪咬"与"被本地野怪咬"走同一条路，死亡与掉落也自然一致。
  - 验证：`npm run test:net` **286 → 292 通过 / 0 失败**（被打的人收到 + `fromId`；旁边的房客收不到；房客伪造被无视；伤害 0/NaN 不转发；伤害夹到 50）。
- [x] [L8] 协议与台账：`NET-PROTOCOL.md` 补 `mob-attack` 与"AI 目标可以是远端玩家"+ `TASKS.md` 的 L8 补一节 → `npm run check`
  - 做了什么：§4 上行表新增 `mob-attack`（校验口径 + "只转给被打的人"）、§5 下行表同样补一条；§2 的"服务端不跑 tick"那句补上"生物 AI 的目标可以是远端玩家"；`TASKS.md` 的 L8 补第 ⑬ 点，并把两处已知差异写进去（末影龙仍只追房主、远端挨打不会中毒）。
  - 为什么：这条链路的关键约定是"**伤害由谁结算**"——房主只判定"谁被哪只怪打了"，血量和护甲归接收方。不写清楚，下次很容易改成"房主直接改血量"（那会让两端的血量各算一遍）。
  - 验证：`npm run check` 全绿（typecheck + 181 套离线测试 + 三张台账）。⚠️ 先红了一次：`tools/chase-test.ts` 有一条结构断言钉着 `playerInvisible: ctx.playerInvisible === true`，改成跟着目标走之后按新写法更新。

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

