# 完成档案 · DONE

> 本文件是**已完成工作的唯一档案**，只回答"这批做了什么、怎么验的"——时间线，最近的在最上面。
> 按模块看现状与坑 → `OVERVIEW.md`；下次怎么避开 → `TIPS.md`；机制与格式 → `README.md`。
> **一条内容只写一个地方**，别在三份文档里各抄一遍。
>
> 收尾时**整份队列原样搬进来**（含每条任务下方的完成说明与 `[阻塞]`），标题格式
> `## 批次 <号> · 日期 · 会话 <前 8 位>`。

---

## 批次 20261027-0900 · 2026-10-27 · 会话 12c62cf0

> 继续 R1：把 Rust 版缺的协议能力按组补齐，每组都跑一遍黑盒断言。

# 队列 · 会话 12c62cf015444720a2a57c257f80c045

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-0900

- [x] [R1] 快照 v2 + 关房清缓存 + bye + 外观 + 掉落物：`server/rust/src/{store,state,handlers,protocol,ratelimit}.rs` → `run-net-test.sh`
  - 做了什么：① 快照 1→2（可读 v1），落盘只留 `savedAt/timeOfDay/day/weather`，`apply_snapshot` 不再读四张房间表；② `State::clear_room`（按房名前缀清 edits/containers/signs/frames/items/worlds/hosts/clocks）+ `OrderedMap::retain`（连带清顺序队列，否则 `remember` 会以为淘汰了却没释放容量）；③ `bye`：房主当场关房踢人、其他人当场广播 `leave`；④ 外观改成"白名单 + 合并写 + 能表达 false + 补 dead/hp/food"；⑤ 掉落物固定窗口 → 令牌桶 30/s + 突发 400。
  - 为什么：这些都是 10-26 之后主线上已经定稿的行为，Rust 版缺一项队友就会看到不同的世界。
  - 验证：黑盒 233 → **261 / 297**；`cargo test` 28 通过。
  - 批次：20261027-0900

---

## 批次 20261027-0930 · 2026-10-27 · 会话 12c62cf0

# 队列 · 会话 12c62cf015444720a2a57c257f80c045

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-0930

- [x] [R1] 每房一套时钟 + 天数 + `room-config` 模式 + `sleep` 过一天：`server/rust/src/{state,handlers,lib}.rs` → `run-net-test.sh`
  - 做了什么：`RoomClock { start_ms, start_time_of_day, start_day, weather }` + `State.clocks` / `default_clock`；`welcome`/`time` 广播/`sleep`/`room-config`/天气推进全部按房；`join` 采纳房主上报的 `day`·`timeOfDay`·`weather`（宽限重连不覆盖，顺序是"先定天数与时刻、最后重置起点"）；`sleep` 先结算今天再 +1；`room-config` 累积 `applied` 并广播 `{t:room-config, by}`，`welcome.gameMode` 取当前模式。
  - 为什么：以前是全服一套时钟——房主 B 在乙房开房会把甲房的太阳一起拨过去；而房主本地继续玩之后，重开房还会被拽回"服务端此刻"。
  - 验证：黑盒 261 → **283 / 297**；`cargo test` 28 通过。
  - 批次：20261027-0930

---

## 批次 20261027-1040 · 2026-10-27 · 会话 12c62cf0

> 用户 2026-10-27："继续" —— R1 全绿之后，把原生壳（安卓/iOS）与 Rust 的接线做了一遍静态核对，并跑掉两个冒烟套件。

# 队列 · 会话 12c62cf015444720a2a57c257f80c045

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-1040

- [x] [R1] 手机壳 port=0 的语义修正：`server/rust/src/instance.rs`、`capi.rs`、`server/ios/include/minicraft_server.h` → `cargo check` + `run-smoke.sh`
  - 做了什么：`start_instance` 只在 `want_port > 0` 时覆盖 `config.port`；0 走 `Config::from_env()` 的默认（8887 或 `PORT`）。注释与 iOS 头文件同步改口径。
  - 为什么：安卓 Intent 不传 port（`wantPort=0`）、iOS `start(port: 0)` 都是默认路径，以前 `bind(0)` 会让系统随机分配——客户端与发现广播都用 8887，别人照着界面里的地址永远连不上。
  - 验证：`cargo check` 零警告；`bash server/rust/run-smoke.sh` **20 / 0**；`run-beacon-smoke.sh` **13 / 0**。
  - 批次：20261027-1040
- [x] [R1] 原生壳接线核对（静态）：`Cargo.toml` / `app/build.gradle` / `NativeServer.java` / `jni.rs` / `capi.rs` / `minicraft_server.h`
  - 做了什么：逐项确认真实名字与签名一致——`lib name = minicraft_server` ↔ gradle 拷 `libminicraft_server.so`；`Java_com_minicraft_server_NativeServer_{startServer,stopServer,serverPort}` 三对；`minicraft_{start,stop}_server` / `minicraft_server_port` 的 4/0/0 参数与 `.h` 一致；安卓的 `MulticastLock` 在位（不拿它会丢组播帧）。
  - 为什么：真机之前能静态查的接线先查掉，剩下的（前台服务类型、真机权限、Bonjour 发布）只能上机验。
  - 验证：无代码改动，只核对。
  - 批次：20261027-1040

---

## 批次 20261027-1000 · 2026-10-27 · 会话 12c62cf0

# 队列 · 会话 12c62cf015444720a2a57c257f80c045

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-1000

- [x] [R1] `session-sync` / `mob-attack` / `edits-request`·`edits-reply`：`server/rust/src/{state,handlers}.rs` → `run-net-test.sh`
  - 做了什么：① `session-sync` 房主整份上行容器/牌子/展示框（每批 200、每连接 256 条上限、不走令牌桶、不做距离闸），存表并按房广播；② `mob-attack` 只转给被打的那一个人（跨房/打自己一律丢，伤害夹 0~50，带 `fromId`）；③ 懒上行：`confirmed_chunks`/`requested_chunks`/`sent_edit_chunks`，未确认区块向房主要（8 条在飞上限、5 秒忘记以便重试），`edits-reply` 按区块校验后存缓存 + 标已确认 + 广播成普通 `blocks`，已确认或无房主时直接推缓存（每批 2048）。
  - 为什么：这三块是"房主权威"的最后一块拼图——手机当房主时队友看不到箱子、野怪打不动人、远处的方块补不上。
  - 验证：`bash server/rust/run-net-test.sh` → **297 通过 / 0 失败**（与 Node 同一份断言）；`cargo test` 28、`cargo check` 零警告。
  - 批次：20261027-1000

---

## 批次 20261027-0800 · 2026-10-27 · 会话 12c62cf0

> 用户 2026-10-27："继续" —— 发现本机其实有 cargo（只是没进 PATH），于是把之前"盲写未验证"的 Rust 改动全部编译 + 跑黑盒断言。

# 队列 · 会话 12c62cf015444720a2a57c257f80c045

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-0800

- [x] [R1] Rust 编译验证 + 修 E0382：`server/rust/src/beacon.rs` → `cargo check` / `cargo test`
  - 做了什么：`cargo check` 立刻抓到 `borrow of moved value: room`（`has_host` 在 `room` move 之后又借用），改成先算 `has_host` 再构造；`cargo test` **28 通过**。
  - 为什么：之前几批 Rust 改动是在"没有工具链"的前提下写的，只能算推测；有了编译器才第一次被真正检验。
  - 验证：`cargo check` 干净；`cargo test` 28 / 0。
  - 批次：20261027-0800
- [x] [R1] 补 Rust 的 `ALLOW_HOSTLESS_ROOMS` + `/ping` + `beaconPort` + `isHost`：`server/rust/src/{lib,handlers}.rs`、`run-net-test.sh` → `bash server/rust/run-net-test.sh`
  - 做了什么：① `ALLOW_HOSTLESS_ROOMS=1`（Config/Hub/join 判断 + 验收脚本），否则单人用例全被 `no-host` 拒（第一次跑只有 **227/297**）；② `/ping` 路由（客户端扫网段只认能回它的机器，缺了它手机端永远扫不到）；③ `/healthz` 补 `beaconPort`；④ `player` 广播（join 与每条 `move`）补 `isHost`。
  - 为什么：前两条是**产品级缺陷**（不是测试口径问题）：改名后别人扫不到手机上跑的服务端、队友的名字牌不标房主。
  - 验证：黑盒断言 **227 → 233 / 297**；`cargo test` 28 / 0。
  - 批次：20261027-0800
- [x] [R1] 把剩余 64 条按 10 组写清（TASKS R1 + 两处 README）：`server/README.md`、`server/rust/README.md`
  - 做了什么：README 的「195 条 0 失败」改成「当前基线 233/297、`cargo test` 28 绿」；缺口表扩成 10 组并标出每组的失败断言数（`day` 6 / 采纳时钟天气 6 / 快照 v2 6 / 关房清缓存 3 / `session-sync` 6 / `edits-*` 3 / `bye` 2 / 外观 1 / 掉落物 1 / 每房时钟）。
  - 为什么：这 64 条就是可执行的验收清单——每一条都对应一句断言，不需要再猜"还缺什么"。
  - 验证：`npm run check` exit=0。
  - 批次：20261027-0800

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

