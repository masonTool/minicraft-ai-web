# 完成档案 · DONE

> 本文件是**已完成工作的唯一档案**，只回答"这批做了什么、怎么验的"——时间线，最近的在最上面。
> 按模块看现状与坑 → `OVERVIEW.md`；下次怎么避开 → `TIPS.md`；机制与格式 → `README.md`。
> **一条内容只写一个地方**，别在三份文档里各抄一遍。
>
> 收尾时**整份队列原样搬进来**（含每条任务下方的完成说明与 `[阻塞]`），标题格式
> `## 批次 <号> · 日期 · 会话 <前 8 位>`。

---

## 批次 20261027-3200 · 2026-10-27 · 会话 12c62c

> 用户：两个弹窗标题要白，深色底上发灰

# 队列 · 会话 12c62cf015444720a2a57c257f80c045

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-3200

- [x] [L25] 两个弹窗标题改白：`index.html`
  - 做了什么：`.mp-full-title` / `.mp-port-title` 显式 `color:#fff`。
  - 为什么：它们挂在 `#multiplayer-screen` 下、不在 `.mp-panel` 里，拿不到面板的文字色变量。
  - 验证：computed color = rgb(255,255,255)；截图 V/W。
  - 批次：20261027-3200

---

## 批次 20261027-3100 · 2026-10-27 · 会话 12c62c

> 用户：手机端输入框不许自动弹键盘，只有点击才出浮层

# 队列 · 会话 12c62cf015444720a2a57c257f80c045

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-3100

- [x] [L24] 手机端输入框不再自动弹键盘：`InputOverlay.ts` → playwright
  - 做了什么：`focusin` 里用"最近 600ms 有没有 pointerdown/touchstart"区分用户点击与代码 focus，后者直接 blur 且不弹浮层。
  - 为什么：打开面板/切换表单时代码调 focus() 会把键盘顶起来；逐个删十几处调用不现实。
  - 验证：打开面板 active=BUTTON 无浮层；程序 focus → active=BODY；真点击 → layer=true/active=inp-field。
  - 批次：20261027-3100

---

## 批次 20261027-3000 · 2026-10-27 · 会话 12c62c

> 用户：不猜网段，改从 native 拿；非完整版禁止联机

# 队列 · 会话 12c62cf015444720a2a57c257f80c045

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-3000

- [x] [L23] 局域网 IP 只从 native 桥拿：`core/net/LanIp.ts`（新）、`ServerListPanel.ts` → playwright
  - 做了什么：`hasNativeLanBridge()`/`getLanIp()` 只问 `Capacitor.Plugins.NativeServer.localIp()`；删掉候选网段猜测，`scanBase()` 拿不到就不扫。
  - 为什么：hostname 在 webview 里是 localhost、地址框是上次的服务器、WebRTC 被 mDNS 混淆——都不成立。
  - 验证：`?lanip=192.168.1.20` 时不弹提示、按该网段扫。
  - 批次：20261027-3000
- [x] [L23] 非完整版禁止联机：`MultiplayerScreen.ts`、`NativeServerPlugin.java`、iOS README
  - 做了什么：join/host 打开先 `ensureFullVersion()`；没桥弹「需要完整版」，关闭/前往下载都同时关掉提示与界面；安卓补 `localIp()`。
  - 验证：无桥 → 提示 + 按钮[关闭,前往下载]，点关闭后两者同关；有桥 → 正常。
  - 批次：20261027-3000

---

## 批次 20261027-2900 · 2026-10-27 · 会话 12c62c

> 用户：浮层挡不住触摸、世界页三按钮、⋯下拉、缩略图、.mc 包

# 队列 · 会话 12c62cf015444720a2a57c257f80c045

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-2900

- [x] [L22] 浮层遮罩真正拦截：`InputOverlay.ts` → playwright
  - 做了什么：window 捕获阶段吞掉 pointer/touch/mouse/click/wheel（输入框放行），pointerdown 收起浮层。
  - 为什么：遮罩只挡视觉，事件仍冒泡到 document；页面大量交互是 document 委托，点遮罩会被当成点下层。
  - 验证：点下层按钮位置 → lowerClicks=0、浮层收起。
  - 批次：20261027-2900
- [x] [L22] 世界页三按钮一排：`WorldScreen.ts` + CSS
  - 做了什么：去掉「世界 N」标题行；新建/加入等宽并排（317px），导入存档小一号靠右（72px）。
  - 验证：截图 + 实测宽度。
  - 批次：20261027-2900
- [x] [L22] 「⋯」下拉菜单：`WorldScreen.ts` + CSS
  - 做了什么：导出/编辑/删除竖排浮层，点别处 `pointerdown` 收起。
  - 验证：items=[导出,编辑,删除]，点别处 hidden=true。
  - 批次：20261027-2900
- [x] [L22] 世界缩略图存真实画面：`WorldRegistry.ts`、`WorldScreen.ts`、`main.ts`
  - 做了什么：`thumbnail` 存清单；`onSaved` 抓 160×90 jpeg（10 秒限频）；renderer 开 `preserveDrawingBuffer`。
  - 为什么：原来按世界类型画 CSS 渐变，所有同类世界看起来一样。
  - 验证：min=2/max=255/颜色丰富（非空白），截图能看到天空与草地。
  - 批次：20261027-2900
- [x] [L22] 导出/导入改 `.mc`（zip）：`McPack.ts`（新）、`SaveTransfer.ts`、`main.ts`、`tests/mc-pack.test.ts`
  - 做了什么：手写 store zip；包内 `world.json` + `thumbnail.jpg`；包名空格→中划线，导入优先用包内真名。
  - 验证：导出 `新的世界-1.mc`，python zipfile 解出两个条目；3 条往返单测。
  - 批次：20261027-2900

---

## 批次 20261027-2600 · 2026-10-27 · 会话 12c62c

> 用户：开房界面复用加入房间，只加「选择本机」；另外扫描坏了，先分析原因

# 队列 · 会话 12c62cf015444720a2a57c257f80c045

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-2600

- [x] [L21] 局域网扫描修复：`ServerListPanel.subnets()` → `npm run check`
  - 做了什么：候选网段列表按可能性排序（hostname 私网 IP → 地址框私网 IP → localhost 加回环 → 常见私网段兜底），`refresh()` 分批扫（一次 2 段、找到就停）。
  - 为什么：上一版只认 `location.hostname`，App webview 里它是 `localhost` → 兜底成回环 → 只扫本机；再上一版用地址框 IP 所以能扫到。WebRTC 也不可用（mDNS 混淆成 `xxx.local`）。
  - 验证：右栏扫到 `127.0.0.1(newplayer)` 与 `192.168.1.72(cookroom)` 两台。
  - 批次：20261027-2600
- [x] [L21] 开房复用「加入房间」界面 + 右栏「选择本机」：`MultiplayerScreen.ts`、`ServerListPanel.ts`、`WorldScreen.ts`、`main.ts` → playwright
  - 做了什么：`open('host', world)` 模式（标题/房名/按钮差异）、右栏「选择本机 127.0.0.1」、`onHostOpen` 接线、`hostWorldFlow` 抽成两入口共用。
  - 为什么：两套界面字段完全一样，各写一套只会分叉。
  - 验证：`mode=host` / 标题「开房：新的世界 1」/ 按钮「确定并进入」/ `localVisible=true` / 旧对话框 0。
  - 批次：20261027-2600
- [x] [L21] 修 `.hidden` 静默失效：`index.html`
  - 做了什么：补 `#mp-host.hidden` / `#mp-join.hidden` / `#mp-disconnect.hidden` 三条规则。
  - 为什么：项目里没有通用 `.hidden{display:none}`，`classList.add('hidden')` 对这三颗按钮一直无效——host 模式下「开房」按钮还在，玩家看到两个"开房"。
  - 验证：截图只剩「确定并进入」一颗。
  - 批次：20261027-2600

---

## 批次 20261027-2500 · 2026-10-27 · 会话 12c62c

> 用户：整理文档太花时间，做成一条命令

# 队列 · 会话 12c62cf015444720a2a57c257f80c045

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-2500

- [x] [L20] 台账收尾一条命令：`tools/ledger.mjs`（新）、`tools/audit-tasks.mjs`、`AGENTS.md` → `npm run check`
  - 做了什么：`ledger.mjs` 读队列文件 → 插 DONE（正则找第一条真实批次）→ archive-done → `audit-tasks --fix` 修 HANDOFF 数字 → archive-queue 归档 → 打印"还要手写什么、下一条用哪个编号"；`audit-tasks` 加 `--fix` 直接写回进度口径。
  - 为什么：上一批功能提交 20:39、台账 20:56，**整理文档 17 分钟**——猜编号、猜锚点、手改数字再重跑 check，全是机械劳动。
  - 验证：`npm run check` exit=0；自测时发现并修掉两个 bug（插入位置匹配到文档模板行、编号统计混入 D/O/P 前缀）。
  - 批次：20261027-2500

---

## 批次 20261027-2400 · 2026-10-27 · 会话 12c62cf0

> 用户 2026-10-27：回退了之前"挪原框"那版，重新按他的口径做——整层黑遮罩 + 左上角输入区，
> 无边框、只留下方一条线；PC 端不要这套逻辑。

# 队列 · 会话 12c62cf015444720a2a57c257f80c045

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-2400

- [x] [L19] 手机端输入浮层按定稿重做：`src/ui/InputOverlay.ts`、`index.html` → playwright
  - 做了什么：新增 `.inp-layer`（全屏 `rgba(0,0,0,.75)`、`z-index: 9999`、`touch-action: none`）作为遮罩层，输入框 `.inp-field` 是它的子元素、绝对定位到左上角（`(12,12)`，宽 `min(62vw,340px)`）；输入区**无边框**，只有 `border-bottom: 2px` 主色线，透明底白字 17px；点原框 → 层出现 + `focus()` + `select()` 全选；`input` 事件**边打边写回**原框并派发 `input`；点遮罩（`pointerdown` on layer）→ `blur()` → 走统一的 `finish()`：落值 + 派发 `change` + 收层。
  - 为什么：用户明确"左上角那个输入框不是单独的输入框，而是整个界面加一层黑色半透明遮罩，输入框在遮罩的左上角"。这样才能同时做到"看得见输入"和"拦住下面所有触摸"。
  - 验证：触屏 → `layer.visible`、`bg rgba(0,0,0,.75)`、`z 9999`、输入区 `(12,12,340)`、`borderTop 0px` + `borderBottom 2px rgb(127,168,111)`、`focused: true`、`elementFromPoint(600,400)` 返回 `.inp-layer`；输入 `192.168.1.88` 实时写回 `#mp-url`，点遮罩后层消失、值保留。桌面（不带参数）→ `.inp-layer` 完全不创建。截图 `N-final.png`。
  - 批次：20261027-2400
- [x] [L19] PC 端完全不启用 + 桌面自检开关
  - 做了什么：`shouldLift()` 取三项并集（`maxTouchPoints` / `ontouchstart` / `pointer: coarse`），全假时再排除"有鼠标精确指针的桌面"；`?lift=1` 强制启用。
  - 为什么：只依赖 `maxTouchPoints` 会漏（部分手机浏览器报 0，这正是之前"手机上没效果"的隐患之一）；而三项全假的明确桌面才该让路。
  - 验证：桌面不带参数 → `layer: false`；加 `?lift=1` → 正常出现。
  - 批次：20261027-2400
- [x] [L19] 修 `maxLength = -1` 的静默异常
  - 做了什么：`element.maxLength >= 0` 才赋值，否则 `removeAttribute('maxlength')`。
  - 为什么：`maxLength` 在没设上限时是 **-1**，直接赋给 input 会抛 `IndexSizeError`，异常打断 `open()` 在"显示遮罩"之前——表现是"点了输入框什么都不发生"（第一版就是这个症状）。
  - 验证：修前 `layer: false`，修后 `layer: true`。
  - 批次：20261027-2400

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

