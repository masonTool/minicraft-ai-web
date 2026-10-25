# 决策记录 · 会话 12afd06a599745d78ae8d88cedd715eb

> 批次：20261025-2000（接管自 20261025-1946 的队列）
> 只记**有取舍**的地方；纯实现细节不占条目。

## D1 · 从属端直发 `block`/`blocks`/`sign`/`frame`/`container`/`tnt` 改为**静默丢弃**
- 决定：有房主的房里，从属端走这些老路一律静默丢弃（只记限频日志），不再回 `error{code:'not-host'}`。
- 为什么：JS 版（`server/index.mjs` 的 `rejectEdit`）就是"计数 + 限频打日志"，不回包；`tools/net-test.mjs` 是行为契约，它断言的是"房主收不到"，不是"从属端收到错误"。N2 阶段我加的回执会让从属端每改一次方块就多一条错误，界面会被刷屏——对齐 JS 才是对的，冒烟脚本那条断言同步改成"房主收不到"。
- 影响：行为变化只影响"从属端能否看到一句错误提示"；要回滚只需在 `follower_blocked` 分支补一条 `send_error`。不是数据/接口级改动。

## D2 · 全部运行时状态收进**一把** `tokio::sync::Mutex`
- 决定：`players/hosts/worlds/graces/edits/containers/signs/frames/items` 全部放进 `State`，由 `Hub.state` 一把锁保护；出站一律走每连接的无界 channel（`send` 是同步的）。
- 为什么：第一阶段每张表一把锁，踩到"持 `players` 锁时调一个内部再锁 `players` 的函数 → tokio Mutex 不可重入 → 永久死锁"。单锁之后不存在锁顺序，也不可能自死锁；而本项目所有临界区都只是查表 + push，串行几微秒。代价是写操作全串行——对一个局域网房间（几十人）完全够用，换成 `RwLock` 或分表锁是以后有 profiling 数据再说的事。
- 影响：锁粒度变粗，万人大厅会成瓶颈（本项目不是那类服务）；结构上删掉了 `senders` 表（发送端挂在 `Player` 上），改不回去也不需要改回去。

## D3 · 64KB 载荷上限**自己判**并回 close 1009，不用 tungstenite 的 `max_message_size`
- 决定：`max_message_size` 设 4MB 兜底（防"先分配再解析"），业务线 64KB 在读循环里自己比，超了主动发 `Close(1009)`。
- 为什么：`tools/net-test.mjs` 断言"80KB 消息 → 客户端收到 1009"。而 tungstenite 在协议层报 `Capacity` 时是把连接拆掉（客户端看到 1006），不会替我们发 1009——靠它就得改断言，那等于为了通过而改契约。自己判还能保证写队列先把 close 帧冲出去。
- 影响：略多一次长度比较；4MB 以上的消息仍由 tungstenite 直接断（不回 1009），实测与 JS 版（`ws` 的 100MB 上限）不同但更严。

## D4 · `tools/net-test.mjs` 加 `NET_SERVER_BIN` / `NET_SERVER_ARGS`
- 决定：加两个环境变量选择"被验收的服务端进程"，默认仍是 `node server/index.mjs`；断言一条不改。
- 为什么：Rust 版的对齐判据必须就是这套 1871 行黑盒断言，复制一份会立刻漂。默认路径不变，JS 侧 `npm run test:net` 行为与改动前一致（已实测 195/0）。
- 影响：只是启动方式多了一条分支；`NET_SERVER_ARGS` 不给时，换了二进制就按"那个程序自己就是服务端"处理（Rust 版读环境变量，不收位置参数）。退得回去：删掉这几行即恢复。

## D5 · 把原 `N3` 拆成 `N3a`~`N3f` 六条
- 决定：按"基础设施 / 生命周期 / 消息族 / 范围与限频 / 落盘 / 全量验收"拆成六条独立可验的条目，仍然是同一个批次号。
- 为什么：原 N3 一句话里塞了 13 类消息 + 两个 HTTP 端点 + 宽限重连 + AOI + 限频 + 落盘，任何一段卡住都无法单独交付，也无法说清"哪一半好了"。拆分后每条都能用 net-test 的对应段落验收。
- 影响：只改队列的粒度，不改需求内容（没有新增需求）；每条下方仍写完成说明，收尾时原样进 `DONE.md`。

## D6 · 天气随机数用自带的 xorshift，不新增 `rand` 依赖
- 决定：`state.rs` 里用 thread-local xorshift64* 生成 `[0,1)`，天气状态机的阈值（480~960s 晴、120~300s 雨、55% 转雨、30% 雷暴）与 `server/weather.mjs` 逐条相同。
- 为什么：Rust 侧只编一个 `.so`，依赖越少越好（`cargo ndk` 交叉编译每多一个 crate 就多一份不确定性）；而天气的随机质量只影响"看起来有没有变化"，不需要密码学强度，也不可复现断言。
- 影响：与 JS 版不共享随机序列（本来也不要求：两边的天气由各自的权威端掷骰子，客户端只是跟随广播）。要换成可播种的 PRNG 只动一个函数。

## D7 · 宽限期条目加"代次"（`Grace{id, seq}`）
- 决定：`graces` 存 `(id, seq)`，每次断线取新 `seq`，到期任务必须 id 和 seq 都匹配才动手。
- 为什么：同一个人"断 → 连 → 再断"会留下两个计时任务，只比 id 的话前一个任务会在旧截止点把刚连回来的人广播成 `leave`（还会清掉他名下的掉落物）。这个问题 net-test 覆盖不到（它的重连用例只断一次），属于自己 review 时发现的。
- 影响：多一个自增计数器；不改变协议。退得回去（把 map 的值换回 `u64`），但没必要。

## D8 · 拆 `lib` + `bin`（启动逻辑只写一份）
- 决定：把 `Config` / `Server` / `start()` / HTTP 分流 / 定时任务搬进 `src/lib.rs`，`main.rs` 变成"读环境变量 → 起 → 等信号 → 补存"的薄壳；`crate-type = ["cdylib", "staticlib", "rlib"]`。
- 为什么：Android 的 ForegroundService 只能经 JNI 起停服务，如果启动逻辑留在 `main()` 里，Kotlin 那条路就得复制一遍（端口、存档目录、读档顺序、定时任务），必然漂——最典型的是"有一端忘了退出前补存"。`cdylib` 给 Android、`staticlib` 给 iOS、`rlib` 给桌面与单测。
- 影响：包内路径全变（`mod` 从 `main.rs` 移到 `lib.rs`），但二进制行为与日志一字未改（195 条 net-test 与 20 条冒烟复跑仍全绿）。退得回去，代价是把这段搬回 `main.rs` 并删掉 `jni.rs`。

## D9 · 局域网发现用**组播**（`239.255.42.99:25188`）+ 广播兜底
- 决定：主通道是 IPv4 组播，另发一份广播兜底；监听 socket 按平台绑不同地址（macOS 绑组地址 + `SO_REUSEADDR`，Linux/Android 绑 `0.0.0.0` + `REUSEPORT`）；发和收用**两个** socket。
- 为什么：最初写的是纯 UDP 广播，在 macOS 上两个实例只有一个收得到（`SO_REUSEPORT` 对广播是按 4 元组哈希挑 socket，不是"都投一份"），症状是"A 看得见 B、B 看不见 A"——这种单向行为会让"发现"功能看起来随机可用。组播是"加入组就都收得到"（Bonjour 也这么做，Android 侧需要的 `MulticastLock` 正是为它准备的）。
- 影响：端口/组地址成了两端契约，改要一起改；网络若禁组播，广播兜底仍在。退得回去但没必要：单向发现的坑会回来。

## D10 · 留 `BEACON_IF`（发现走哪块网卡），验收脚本显式用回环
- 决定：`BEACON_IF` 环境变量指定 `IP_MULTICAST_IF` 与加入组用的接口地址，默认 `0.0.0.0`（系统默认）；`run-beacon-smoke.sh` 传 `127.0.0.1`。
- 为什么：这台开发机的默认路由下组播**连本机都收不到**（用 Python 最小复现确认过，不是 Rust 代码的问题）；不指接口的话"两个进程互发现"这条验收在本机永远红。手机上默认接口（Wi-Fi）是通的，所以默认值不改。
- 影响：多一个可选环境变量，不影响任何既有行为；iOS/Android 壳不需要传它。

## D11 · 用 Capacitor 6 套壳（不自写 WebView 工程）
- 决定：加 `@capacitor/core` + `@capacitor/android`（运行期）与 `@capacitor/cli`（开发期），用 `npx cap add android` 生成 `android/`；`capacitor.config.json` 里 `androidScheme: "http"` + `allowMixedContent: true`。
- 为什么：`notes/ops.md` 里既定的方案就是 Capacitor——它把"WebView + 资源打包 + 插件桥"这三件最容易写错的事做完了，我们只需要加一个插件；自写 WebView 工程等于把这三件重做一遍。`androidScheme: http` 是因为页面若是 https，客户端 `defaultServerUrl()` 会挑 `wss://`（要证书），而局域网联机是明文 `ws://`。
- 影响：新增 3 个依赖 + 一个约 40 文件的 `android/` 工程（`node_modules` 之外）；退回只需删依赖与目录，web 端不受影响。

## D12 · `core.bin` 放 APK assets，不写 `shouldInterceptRequest`
- 决定：Gradle 任务 `copyHostCore` 把 `host/core-baseline.bin` 拷成 `assets/public/__host/core.bin`；WebView 直接按 `http://localhost/__host/core.bin` 读。
- 为什么：`src/core/hostCore.ts` 的原设计是"宿主在 `shouldInterceptRequest` 里拦 `__host/core.bin`、从 assets 读"。Capacitor 的资源本来就以 http 提供，把同一份文件放进 assets 即等价，还少一层容易写错的拦截（拦错路径的表现是白屏或一直停在安装引导）。
- 影响：724 个方块的明文随 APK 走（这正是 `build:app` 的形态），**不进 JS 主包**；浏览器那条路仍是 404 → "去 Google Play 下载"落地页，形态没变。

## D13 · 壳子用 Java 写，不引 Kotlin 工具链
- 决定：`MainActivity` / `NativeServerPlugin` / `ServerService` 全用 Java。
- 为什么：Capacitor 生成的模板本身就是 Java + Gradle；引 Kotlin 还要把 `kotlin-gradle-plugin` 与 AGP 版本对齐（多一处会坏的地方），而这一层总共约 200 行胶水，没有一处用得上 Kotlin 的表达力。
- 影响：以后想用 Kotlin/协程要另加插件；Java 与 Kotlin 可共存，退得回去。

## D14 · 设备级验收用 3 条 instrumented test；"两台互发现并进房"留给 N6
- 决定：写 `connectedDebugAndroidTest` 三条——包名、JNI 起服务 + `/healthz` + 停止、前台服务 + 多播锁 + `/rooms`；在 `Pixel_3a_API_34` 模拟器上跑。**没有**做两台设备互相发现。
- 为什么：那一条要第二台设备 + 客户端接线（网页得调 `NativeServer.start`、把端口与 `peers` 用起来），后者正是 N6 的范围；只有一台模拟器、客户端还没接时硬凑"两台互相发现"，验的是我自己造的假路径。
- 影响：N4b 的"能互相发现并进房"这半条**未验证**，已如实写进完成说明；N6 的验收会覆盖它。

## D15 · C ABI 与 JNI 共用同一份"实例生命周期"
- 决定：把"独立线程 + 独立 runtime + 停前补存"抽成 `src/instance.rs`，`jni.rs` 与 `capi.rs` 都只是薄包装；`capi.rs` 只暴露 `minicraft_start_server` / `minicraft_stop_server` / `minicraft_server_port` 三个 C 函数。
- 为什么：两端的生命周期一字不差，写在两处最容易分叉的是"停止时补存快照"（一端有、一端忘），而那个 bug 的表现是"手机上玩了一下午，回来还是早上的存档"。C ABI 一旦发布很难改，所以只透出这三个函数，内部（tokio / serde）随便重构。
- 影响：Android 的 `.so` 行为不变（三个 JNI 符号仍在，`.so` 已重编确认）；新增 1 条 `cargo test`（起服务 → `/healthz` → 停 → 端口归零），覆盖两端共用的那段。

## D16 · iOS 的"只有前台能当房主"做成状态机，用户可见文案只给 key
- 决定：`ForegroundSession` 在 `didEnterBackground` 主动停服务并回 `.suspendedBySystem`，同时给一个 i18n key（`net.host.foregroundOnly`）；原生代码里**不写**任何用户可见文本。
- 为什么：iOS 不允许普通应用后台长期持有监听 socket，硬撑会被系统杀掉（"房间还在、没人连得上"比直接停更糟）。而用户可见文本写在 Swift 里会绕过游戏的六语言表（`audit:i18n` 管不到原生代码）。
- 影响：网页那边要在 N6 里按这个 key 显示提示；在此之前 iOS 只是"进后台就停"，没有文案。

## D17 · iOS 的验收用 `simctl spawn` 真跑，而不是只 typecheck
- 决定：把 Swift + Rust 静态库链接成一个模拟器可执行（`Tests/main.swift`），用 `xcrun simctl spawn` 在真 iOS 模拟器里跑"起服务 → `/healthz` → `/rooms` → 停"；脚本是 `ios-shell/check-sim.sh`。
- 为什么：`xcframework` 存在 ≠ 能链接（Rust 静态库常缺系统库符号），Swift typecheck 通过 ≠ 在 iOS 上跑得起来（`System.loadLibrary` 那类问题在 iOS 上是 dylib/符号问题）。这两件事只有"编成可执行 + 真跑"才暴露，Android 那边同理（用的是 instrumented test）。
- 影响：验收从"编译通过"升级成"在模拟器里真的起了一个服务端并答了 HTTP"；代价是脚本要拉起模拟器（约 1 分钟）。

## D18 · 不生成 Capacitor 的 `ios/` 工程（CocoaPods 缺失），交付手工接入步骤
- 决定：`ios-shell/` 只放 xcframework 构建脚本、Swift 源码、设备级冒烟与接入文档；**不**执行 `npx cap add ios`。
- 为什么：Capacitor 6 的 iOS 模板走 CocoaPods，本机 `pod: command not found`；硬装 CocoaPods（gem + 首次 `pod install` 下载）会引入一个和本任务无关的全局依赖，而且装完还要改工程配置才能接 xcframework。相比之下，"把 xcframework + 4 个 Swift 文件加进 target + 3 个 Info.plist 键"是 5 分钟的手工步骤，写在 `ios-shell/README.md` 里可复核。
- 影响：**"iOS 上点一下开房"没跑过**（如实记在队列完成说明里）；等装好 CocoaPods 或 Capacitor 支持 SPM 时再补一条命令即可，Rust/Swift 两侧都已验证过。

## D19 · 局域网发现的数据**借道服务端** `/healthz`，并为它加 CORS
- 决定：面板刷新房间时同时读 `/healthz`，把 `peers` 当成"附近设备"；给 `/healthz` 加 `access-control-allow-origin: *`（**Rust 与 JS 两套服务端同时改**）。
- 为什么：浏览器发不出也收不到 UDP 组播，唯一的耳朵是每台手机上的 Rust 服务端（它一直在听）。`/rooms` 早就有 CORS，`/healthz` 没有——不加的话浏览器直接拦掉，功能等于不存在。两套实现必须一起改，否则 N3 建立的"行为一致"当场破。
- 影响：`/healthz` 从此可被任意来源读（本来也是公开信息：人数/房间数/吞吐）；多一个响应头，net-test 无断言变化（两套各 195/0）。

## D20 · 发现报文加 `room`，Bonjour TXT 用同名键 + `from_txt` 单测
- 决定：组播报文与 `/healthz.peers` 都带 `room`；iOS 的 Bonjour TXT 也用 `room` 这个键；`beacon::from_txt(service_name, txt)` 把 Bonjour 记录转成与组播**同一个结构**，并有单测。
- 为什么：没有房间名，面板只能拼 `ws://host:port`，"点一下进房"会进默认房间——玩家看到的世界跟列表里写的不一样。而"Android 组播 ↔ iOS Bonjour 互通"如果没有一个共同的中间结构，就只能靠两边的字符串约定；`from_txt` 把这条约定变成可断言的东西（键名一致 + 转换正确）。
- 影响：报文多一个字段（老客户端忽略未知字段即可）；`PeerBook` 里 Bonjour 来的 peer 身份是 `bonjour:<服务名>`，与组播的 8 位 id 不会撞。

## D21 · "自己"的过滤：客户端只按"正对着的地址"，不枚举自身 IP
- 决定：客户端用 `filterSelfPeers(peers, [base])`，`base` 是面板里填的那台服务器；服务端侧仍然按**实例 id**过滤自己的回声（D7 那套没动）。
- 为什么：一台手机可能有 Wi-Fi/热点/多个网卡地址，"把自身所有 IP 列出来"既不可靠（拿不到、还可能误伤同段别人的机器）也没必要。真正会误显示的只有"我在 A 上、又去看 A 的 peers 里有没有我"这种情况——按 `base` 就够了。真正的"自己发自己收"在服务端就挡住了。
- 影响：从**别人**的 `/healthz` 里仍可能看到自己那一间（那一栏显示的是"他那台听得见谁"），点进去只是连自己的服务器，不会出错。

## D22 · 附近房间的行**复用现有 i18n 键**，不新增文案
- 决定：行的文字由数据（世界名 / `host:port` / `{n} 人`）与现有键（`mp.roomsPlayers`、`mp.password`）拼成，延迟显示成 `12 ms` / `— ms`（单位不翻译）。
- 为什么：新增 6 条文案要改六语言表并过 `audit:i18n`（2947 键/语言），而这一版要表达的东西全都能用已有键凑出来；等真要写"另一台设备"这类句子时再一起加，避免为了一个标签动六份语言表。
- 影响：附近房间与同服务器房间**外观一致**（同一个 `mp-room-row`），只在 meta 里多一个 `host:port` 与延迟；以后要区分视觉风格再加 class 即可。
