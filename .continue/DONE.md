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

## 批次 20261027-1300 · 2026-10-27 · 会话 12c62cf0

> 用户 2026-10-27：进房/开房功能可用了，但"界面不够整齐、UI 不够美观、层级过高（弹窗上又弹窗）、
> 界面没有居中"，要按专业交互/UI 设计师的角度重做一版，自己测试到满意。

# 队列 · 会话 12c62cf015444720a2a57c257f80c045

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-1300

- [x] [L14] 消掉"弹窗上弹窗"：`src/ui/ServerPicker.ts` + `src/ui/RoomForm.ts` → `npm run check`
  - 做了什么：`open(anchor)` → `open()`，删掉 `position()` 与 `getBoundingClientRect()` 定位；标题区改成「‹ 返回 + 居中标题 + 一行副标题」，面板宽度取 `var(--modal-w)`（与主面板同宽）。
  - 为什么：浮窗贴在按钮下方会盖住表单、尺寸又比主面板小一圈，两个不同大小的卡片叠在一起就是"层级过高"的观感来源。
  - 验证：截图 3-picker / 5-host-picker——两张卡片与主面板同宽同位，切页像翻页。
  - 批次：20261027-1300
- [x] [L14] 三层改不透明全屏页 + 卡片视觉重做：`index.html` → 截图比对
  - 做了什么：`#multiplayer-screen` / `.server-picker` / `.world-modal` 从 `rgba(0,0,0,.55~.68)` 改成**不透明底**（径向暖光 + 四周压暗 + 3px 一条的极淡扫描线），层次用明度表达（联机 `#232323`、选择 `#1b1b1b`）；卡片 `linear-gradient(#3a3a3a,#2c2c2c)` + 斜角 bevel + 投影 + 顶部 3px 主色高光条；输入框反过来**内凹**（上暗下亮）+ 焦点环。
  - 为什么：半透明遮罩会把底下的世界列表糊进来，"一个窗口压另一个窗口"永远显乱；纯灰卡片+纯灰输入框则完全没有"能点/能输入"的暗示。
  - 验证：截图 2-join 与改前对比——底层彻底消失、卡片浮起、输入框边界清晰。
  - 批次：20261027-1300
- [x] [L14] 控件对齐：`index.html` + `src/ui/WorldScreen.ts` + `src/ui/MultiplayerScreen.ts` → `npm run check`
  - 做了什么：世界表单原固定三列 `64/1fr/44`（第三列只有"重新掷色子"用得上），改成按"有没有尾巴"分档：`.world-row`（2 列）/ `.world-row-inline`（3 列）/ `.world-row-address`（5 列）；联机地址行改 5 列 grid；三页统一 `min-height: 300px`、底部按钮 `margin-top: auto`。
  - 为什么：空着的第三列让"房间名/密码/昵称"三行的输入框比地址行短 44px，整片表单看着参差；切页时高度不同，居中卡片会上下跳。
  - 验证：截图 4-host——地址行与下面三行右边缘对齐。
  - 批次：20261027-1300
- [x] [L14] 窄屏适配：`index.html`（`@media (max-width: 520px)`）→ 竖屏截图
  - 做了什么：地址行拆两行——标签跨两行居左、地址吃满第一行、"`: 端口 选择`"贴右占第二行；窄屏取消 `min-height`。
  - 为什么：390px 宽下五格并排，地址框只剩 ~90px，`IP 或域名` 占位都被截断，而地址正是玩家要手打的那一格。
  - 验证：截图 6-portrait-join / 7-portrait-picker（390×844）。
  - 批次：20261027-1300
- [x] [L14] 空状态与文案：`src/ui/ServerPicker.ts` + 六语言 → `npm run check`
  - 做了什么：加「重新扫描」按钮（原来扫不到只能关掉面板重开）；`server.publicSoon` 从"接口还没提供，先留个入口"改成"暂时没有可用的公共服务器"；副标题从"所有端口 8887 的房间"简化成"端口 8887"；`server.titleServer` 去掉重复的 `({port})`；禁用态按钮从半透明绿改成明确的灰。
  - 为什么：前两条是开发者的口吻，玩家读到的是"这东西坏了"。
  - 验证：截图 3-picker；`npm run check` exit=0（621 单测）。
  - 批次：20261027-1300

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

