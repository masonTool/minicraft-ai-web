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

## 批次 20261027-1200 · 2026-10-27 · 会话 12c62cf0

> 用户 2026-10-27："继续" —— 把 R2（iOS 只发布不浏览 Bonjour）补完，并在模拟器里验通桥接链路。

# 队列 · 会话 12c62cf015444720a2a57c257f80c045

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-1200

- [x] [R2] `NetServiceBrowser` + C 桥接：`server/ios/Sources/BonjourBrowser.swift`（新）、`ForegroundSession.swift`、`server/rust/src/{instance,capi}.rs`、`minicraft_server.h` → `check.sh` + `check-sim.sh`
  - 做了什么：① Swift 侧搜 `_minicraft._tcp`、解析 IPv4 + TXT、**每 8 秒重 resolve**（刷新 Rust 侧 12 秒 TTL，否则邻居会闪一下就没）、只认 IPv4（Rust 只 parse `Ipv4Addr`）；② `ForegroundSession` 在服务起来时 start、停止/进后台时 stop；③ Rust 侧 `instance` 加 `HUB` 槽 + `with_hub`，`capi` 新增 `minicraft_add_bonjour_peer(name, ip, txt_json)`：`beacon::from_txt` → `PeerBook::observe`。
  - 为什么：`BonjourAdvertiser` 只发布，我们能被人看见、看不见别人；组播在部分 Wi-Fi 上会被挡（AP 隔离 / IGMP snooping），mDNS 能补这一段。
  - 验证：`check.sh` 的 C 入口检查三个 → 四个全过；`check-sim.sh` 在模拟器里注入一条记录 → `/healthz.peers` 出现该邻居（C 入口 → peer 表 → healthz 链路通）；`npm run check` exit=0。
  - 边界：**真实 mDNS 发现未验**（要两台真机或可用 mDNS 域），已写进 `server/ios/README.md` 上机清单第 3 条。
  - 批次：20261027-1200

---

## 批次 20261027-1120 · 2026-10-27 · 会话 12c62cf0

> 用户 2026-10-27："请继续" —— 把两份原生壳的上机验收清单写下来，顺手跑通了 iOS 的模拟器级验收。

# 队列 · 会话 12c62cf015444720a2a57c257f80c045

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-1120

- [x] [R1] 修 `build-ios.sh` 的变量边界 bug：`server/rust/build-ios.sh` → `bash server/ios/check.sh`
  - 做了什么：`echo "编真机（$DEVICE）"` 里全角右括号紧贴变量名，bash 把多字节首字节并进变量名（`DEVICE\xef: unbound variable`），整个 iOS 构建断在第一行。改成 `${DEVICE}`；同类的 `${SIM_ARM} / ${SIM_X86}` 一起改。
  - 为什么：这不是"环境问题"，是脚本自己的错——`$VAR` 后面接中文/全角符号必须加花括号。
  - 验证：`bash server/ios/check.sh` 全部通过（两架构 xcframework + 两 SDK typecheck + 三个 C 入口）；`check-sim.sh` 在模拟器里真跑 → **端口 8887**、`/healthz`、`/rooms`、停止后归零。
  - 批次：20261027-1120
- [x] [R1] 两份上机验收清单：`server/android/README.md`、`server/ios/README.md`
  - 做了什么：安卓 11 步（服务起没起来 / 同机 webview / 另一台设备发现含 AP 隔离与 MulticastLock 排查 / 进房后世界对不对 / 后台省电 / 离线回归）；iOS 5 步（本地网络权限"拒绝后不再弹"、`dns-sd` 验 Bonjour、iOS↔iOS 互发现、前台限制、ATS）。
  - 为什么：这几条 CI 跑不了，但每条都能写成"看什么 / 不对先查哪里"，真机时不至于重新推。
  - 验证：`npm run check` exit=0。
  - 批次：20261027-1120
- [x] [R2] 记下 iOS 只发布不浏览的缺口：`server/ios/README.md`、`.continue/TASKS.md`
  - 做了什么：README 的"还没做"补一条（`BonjourAdvertiser` 只有 `NetService`，没有 `NetServiceBrowser`）；TASKS 新增 `R2`。
  - 为什么：现在 iOS 能看到邻居是因为对方也发了 UDP 组播，"靠 Bonjour 互相发现"这条其实不成立——不写清楚，下一个人会以为已经支持。
  - 验证：`npm run check` exit=0（HANDOFF 待办 0→1）。
  - 批次：20261027-1120

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

## 批次 20261027-1900 · 2026-10-27 · 会话 12c62cf0

> 用户 2026-10-27：端口那个格子应该是个**按钮**（点开弹窗）而不是输入框；弹窗里的输入框要走浮层逻辑；
> 浮层出现时背景淡入一层模糊；默认选中的字要白色。

# 队列 · 会话 12c62cf015444720a2a57c257f80c045

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-1900

- [x] [L18] 端口格按钮化 + 浮条遮罩 + 选中白字：`index.html`、`InputOverlay.ts` → 截图 + `npm run check`
  - 做了什么：`.mp-port-readonly` 从内凹输入框改成凸起按钮（`hover` 提亮、`:active` 位移 1px、默认值暗一档）；`.inp-bar` 改成全屏遮罩 `rgba(0,0,0,.26)` + `blur(4px)` 并淡入 140ms，点遮罩收起；`.inp-bar-field::selection` 绿底白字；端口弹窗那层遮罩从 .6 调到 .42（避免与浮条叠加过暗）。
  - 为什么：端口格点开的是弹窗、不是打字，外观该是按钮（内凹的输入框框暗示"可以输入"）；浮层出现时底层信息还在动会分心。
  - 验证：截图 `G-port-row.png`（按钮态）、`E-port-dialog.png`（弹窗 + 浮条同时出现）、`B-input-bar.png`（遮罩 + 白字选中）；`npm run check` exit=0。
  - 批次：20261027-1900

---

## 批次 20261027-1800 · 2026-10-27 · 会话 12c62cf0

> 用户 2026-10-27：修改端口按钮移到重新扫描左边；服务器分「本地 / 远程」两大类、可折叠、默认展开；
> 去掉「局域网」那条线；把两个类别突出出来。

# 队列 · 会话 12c62cf015444720a2a57c257f80c045

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-1800

- [x] [L17] 右栏两类可折叠分组 + 按钮归位：`ServerListPanel.ts`、`index.html`、六语言 → playwright 实测
  - 做了什么：头部改成 `附近的房间 | [修改端口] [重新扫描]`；正文拆成 `本地服务器` / `远程服务器` 两个分组（`aria-expanded` + body 隐藏，默认展开）；标题条是整条色块 + 左侧 3px 主色竖条；删掉 `.server-list-rule` 与 `.server-list-label`；六语言的 `server.lan` / `server.public` 文案改成「本地服务器 / 远程服务器」。
  - 为什么：原来只是一条细虚线加一行小字，两类东西在视觉上完全没有分组感；而「局域网 / 公共服务器」这两个词对玩家也不准确（前者其实是本机网段，后者其实是别人机器）。
  - 验证：playwright 实测两组初始 `aria-expanded=true`、点一次变 `false` 且正文隐藏；`npm run check` exit=0；截图 `9-empty-state.png` / `C-collapsed.png`。
  - 批次：20261027-1800
- [x] [L17] 折叠箭头改用 CSS 三角
  - 做了什么：`▾` / `▸` 字符换成 `border` 三角，朝向由 `aria-expanded` + `transform: rotate(-90deg)` 控制。
  - 为什么：截图里 `▾` 被字体回退渲染成了 `•`（一个小圆点），完全看不出"能折叠"。
  - 验证：截图确认三角朝下 / 收起时朝右。
  - 批次：20261027-1800

---

## 批次 20261027-1700 · 2026-10-27 · 会话 12c62cf0

> 用户 2026-10-27 纠正上一版的输入浮层：不要居中卡片、不要标题、不要按钮——就要**左上角一条**
> 承接输入，键盘上的「完成」写回，键盘收起就消失。

# 队列 · 会话 12c62cf015444720a2a57c257f80c045

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-1700

- [x] [L16] 输入浮条按定稿重做：`src/ui/InputOverlay.ts`、`index.html` → playwright 实测
  - 做了什么：`focusin` 委托 → 焦点让给左上角那条 `input`（`top/left: 8px`），进去即 `select()` 全选；`input` 事件**边打边同步**回原框并派发 `input`，`change` 只在「完成」时补发；`visualViewport` 变矮过又恢复（键盘收起）或浮条失焦 → 收起；无标题、无按钮、无遮罩。
  - 为什么：它只是解决"键盘盖住输入框"，不是对话框——多一个标题/按钮就多一层语义、多一次点击。
  - 验证：390×844 实测——浮条在 `(8,8)`、无标题无按钮、焦点在条内、全选 `[0,11]`、输入实时同步回原框、回车写回并收起、失焦收起；截图 `B-input-bar.png`。
  - 批次：20261027-1700
- [x] [L16] 修两个让浮条"完全不出现"的 bug
  - 做了什么：① `field.maxLength = -1` 会抛 `IndexSizeError`（-1 表示没限制，但赋值非法），异常打断 `open()` 在"显示"之前 → 改成 `>= 0` 才赋、否则 `removeAttribute`；② `close()` 曾把 `field` 置空，而 `build()` 只判 `bar` 是否存在 → 第二次打开永不重建，改成 `bar && field` 都判。
  - 为什么：两条都表现为"点了输入框什么都不发生"，没有任何报错提示（一条是静默异常、一条是静默 return）。
  - 验证：修后同一套 playwright 脚本从 `visible:false` 变为 `visible:true`。
  - 批次：20261027-1700

---

