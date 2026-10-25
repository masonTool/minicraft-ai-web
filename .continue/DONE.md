# 完成档案 · DONE

> 本文件是**已完成工作的唯一档案**，只回答"这批做了什么、怎么验的"——时间线，最近的在最上面。
> 按模块看现状与坑 → `OVERVIEW.md`；下次怎么避开 → `TIPS.md`；机制与格式 → `README.md`。
> **一条内容只写一个地方**，别在三份文档里各抄一遍。
>
> 收尾时**整份队列原样搬进来**（含每条任务下方的完成说明与 `[阻塞]`），标题格式
> `## 批次 <号> · 日期 · 会话 <前 8 位>`。

---

## 批次 20261025-2240 · 2026-10-25 · 会话 12afd06a

> 纯重构：把"服务端相关的四份"收拢到一个 `server/` 下。没有新能力，只有位置与路径。
> 判据是"改完之后所有既有的门禁仍然全绿"——181 套离线 + 195×2 条联机断言 + 出包。

- [x] [S1] 目录收拢：`server/*.mjs` → `server/node/`、`rust-server/` → `server/rust/`、`android/` → `server/android/`、`ios-shell/` → `server/ios/`；`capacitor.config.json` 补 `android.path` → `npx cap sync android` 仍能找到工程
  - 做了什么：四次 `git mv`（`server/node/` 是新建后 `git mv` 七个 `.mjs` 进去）；`capacitor.config.json` 补 `"android": { "path": "server/android", "allowMixedContent": true }`。
  - 为什么：Capacitor 6 的 CLI **支持自定义平台路径**（`node_modules/@capacitor/cli/dist/config.js` 读 `extConfig.android.path`），所以不需要软链、也不需要自写 sync 脚本——一条配置就让它认 `server/android`。之所以把 JS 服务端也挪进 `node/`（而不是留在 `server/` 根）：这样四个子目录对称，`server/` 才是真正的"总目录"而不是"Node 服务端 + 三个挂件"；代价只是 `index.mjs` 的路径变了，一次性改掉。
  - 验证：`npx cap sync android` 成功（45s，`copy android` + `update android` 都过）；`cd server/android && ./gradlew assembleDebug` 出包，APK 内含 2 个 ABI 的 `.so` 与 `assets/public/__host/core.bin`。
  - 批次：20261025-2240
- [x] [S2] 修所有引用：`package.json`（`server` / `android:*` 脚本）、`tools/`（net-peer / net-test / run-tests 的 `net: ['server/node/']` / ui-test / net-check.sh）、5 个 `tests/net-*.test.ts` 的 import、`Dockerfile`、`.gitignore`、`android/app/build.gradle` 的 `copyHostCore` 与 `copyRustLibs`、`ios/check*.sh`、`rust/run-net-test.sh`、`rust/build-ios.sh` → `npm run check` 与 rust 四套脚本全绿
  - 做了什么：批量改 20 处功能性路径 + 15 处注释/文档路径；重点几处：`Dockerfile`（`COPY server/node`、`CMD node server/node/index.mjs`）、`.gitignore`（`server/node/.data/`）、`app/build.gradle`（`repoRoot` 现在要多剥一层父目录，`copyRustLibs` 的产物路径也改成 `server/rust/target/...`）、`rust/run-net-test.sh` 与 `rust/build-ios.sh` 的 `ROOT`（`cd ../..`）、`tools/run-tests.mjs` 的 `net: ['server/node/']`（决定改到 `server/node` 时哪套离线测试算"命中"）。
  - 为什么：这些是"一改目录就静默失效"的地方。最典型的是 Gradle 的 `copyRustLibs`：路径没跟上时它只报一句"缺少 Rust 产物"，看起来像"忘了编 `.so`"，而不是"路径错了"——实测就踩到过（第一次 `assembleDebug` 报 `/rust-server/target/...` 不存在）。
  - 验证：`npm run typecheck` + `typecheck:tools` 通过；`vitest tests/net-* tests/nearby-rooms.test.ts` **24 文件 / 243 断言**全过；`npm run test:net` **195/0**；`cargo test` **28/0**、`run-smoke` **20/0**、`run-beacon-smoke` **13/0**、`bash server/rust/run-net-test.sh` **195/0**。
  - 批次：20261025-2240
- [x] [S3] 文档同步 + 全量验证：新增 `server/README.md`、根 `README.md` 目录树、`.continue/HANDOFF.md` 命令、`docs/NET-PROTOCOL.md`、三个子目录 README 的路径 → `npm run check` 全绿 + rust 四套全绿 + `npx cap sync android` 成功
  - 做了什么：新增 `server/README.md`（四个子目录表 + 一张"客户端→服务端→宿主→局域网"的关系图 + 两条不能忘的约定 + 常见操作）；根 `README.md` 的目录树把 `server/` 那行改成"服务端（node/ · rust/ · android/ios/ = 手机宿主示例）"；`.continue/HANDOFF.md` 命令区加 `npm run server` 并指路 `server/README.md`；`docs/NET-PROTOCOL.md` 顶部标注"Node 版在 `server/node/`、Rust 版在 `server/rust/`，同一份契约"；`notes/multiplayer-ops.md`、`notes/net-host-authority.md` 的路径同步。
  - 为什么：这些文档写着"怎么起服务端"。路径改了却不同步，下一个人照旧命令敲就会 file not found，而且会怀疑是代码坏了。子目录 README 尤其要改——它们是各平台的入口文档。
  - 验证：`npm run check` 全绿（typecheck + 181 套离线 + 三张台账 + 文档门禁）；`node .continue/hooks/check.mjs` 6 项全绿；`git status` 里 120+ 条全是 `R`（rename）与少量 `M`，没有内容丢失。
  - 批次：20261025-2240

## 批次 20261025-2050 · 2026-10-25 · 会话 12afd06a

> 里程碑 MS1 验收后继续：Rust 服务端的**两颗平台壳**（Android Capacitor / iOS xcframework）
> 与局域网发现的双端联调。一个"手机自己当房主、别人在附近房间列表里点一下进来"的最小闭环。

## 里程碑 MS1 · Rust 服务端与 JS 版行为一致
- 验收：`cd rust-server && cargo test && bash run-smoke.sh`，再 `bash run-net-test.sh` 全部 0 失败；`npm run test:net`（JS 路径）也仍绿
- 确认：已验收 · 批次 20261025-2000（用户 2026-10-25 看到验收输出后答复"再继续"）

- [x] [N4a] Android 集成的 Rust 半边：`crate-type` 加 `cdylib`/`staticlib` + JNI 入口（`start/stop/port`，供 Kotlin 的 ForegroundService 调）+ 纯 Rust 的 UDP beacon（广播/监听/自回声过滤，Android 侧只差一个 `MulticastLock`）→ `cargo test` 新增单测 + 两个进程互发现的本机脚本 + `cargo ndk`/`cargo build --target aarch64-linux-android` 出 `.so`
  - 做了什么：拆成 **lib + bin**（`src/lib.rs` 装 `Config`/`Server`/`start()`，`main.rs` 只剩"读环境变量 → 起 → 等信号 → 补存"），新增 `src/jni.rs`（`startServer(dataDir, port, seed) -> 实际端口` / `stopServer` / `serverPort`，每个服务跑在独立线程 + 独立 runtime 里，停之前补存一次快照）与 `src/beacon.rs`（报文编解码 + peer 表含自回声过滤/12s TTL + 组播 socket）。`/healthz` 多 `beacon` 与 `peers`。`build-android.sh` 用 NDK 的 linker 直接编，不装 `cargo-ndk`。
  - 为什么：Android 的 `ForegroundService` 只能通过 JNI 起停服务，而启动逻辑在 `main()` 里就必然要复制一份（端口、存档目录、读档顺序各写一遍，然后有一端漏补存）——所以把它抽成库；发现层放 Rust 是因为报文/端口必须与客户端一致，Kotlin 与 Swift 各写一份必然漂。
  - 验证：`cargo test` **26/0**（新增 beacon 编解码、自回声、TTL、实例 id 唯一性、真 socket 组播往返，共 6 条）；`bash run-beacon-smoke.sh` **12/0**（两个真进程互相发现、广播内容跟着"有人进房/世界名/种子"变、自己的回声不进列表）；`bash build-android.sh` 出 `arm64-v8a` 与 `x86_64` 两个 `.so`（`file` 显示 ELF aarch64 / x86-64，`nm -D` 能看到三个 `Java_com_minicraft_server_NativeServer_*` 符号）；既有 195 条 net-test 与 20 条冒烟仍全绿。
  - 踩到并修掉的：① **macOS 的 `SO_REUSEPORT` 对广播是"哈希挑一个 socket"**——两个实例只有一个收得到，症状是"A 看得见 B、B 看不见 A"，改走组播 + 按平台绑不同地址；② **收发不能用同一个 socket**（macOS 上监听 socket 绑的是组播地址，从它 `send_to` 直接 `EADDRNOTAVAIL`）；③ 这台开发机的**默认可组播网卡不在**（连自己都收不到），所以留了 `BEACON_IF`，验收脚本显式指回环；④ 实例 id 只混"时间 + pid"时，同一毫秒内两次启动会撞 → 两个实例把对方当自己的回声过滤掉（单测抓到的）。
  - 批次：20261025-2050
- [x] [N4b] Android 壳：Capacitor 工程（`npx cap add android`）+ Kotlin 插件加载 `.so` + `ForegroundService`（常驻通知）+ `MulticastLock` → `./gradlew assembleDebug` 出 APK，模拟器/真机装两台上能互相发现并进房
  - 前置（开这条之前先确认）：`npm i -D @capacitor/cli @capacitor/core @capacitor/android` 会新增依赖，
    Gradle 首次同步要联网下载几百 MB；`.so` 已能编（`bash rust-server/build-android.sh`），
    `jni.rs` 的三个入口签名见 `rust-server/src/jni.rs`
  - 做了什么：`npx cap add android` 生出 `android/`（Capacitor 6）；壳里加 `NativeServer.java`（JNI 声明）、`NativeServerPlugin.java`（网页可调的 `start/port/stop`）、`ServerService.java`（前台服务 + 常驻通知 + `MulticastLock`/`WifiLock`，JNI 丢工作线程避免 ANR）、`MainActivity` 注册插件；`app/build.gradle` 两个任务 `copyRustLibs`（`.so` → `jniLibs`）与 `copyHostCore`（`host/core-baseline.bin` → `assets/public/__host/core.bin`）；Manifest 补多播/唤醒/前台服务/通知/明文流量权限；根目录加 `capacitor.config.json`（`androidScheme: http` 让客户端挑 `ws://` 而不是 `wss://`），并补 `npm run android:sync` / `android:apk` / `android:test`（Gradle 那条不能叫 `test:*`：离线 runner 把它当套件解析，会因为它不是 esbuild/node 入口而报"认不出"）。
  - 为什么：手机当房主必须有"进程不被回收"的载体——前台服务 + 常驻通知是唯一稳的做法；`MulticastLock`/`WifiLock` 不给的话息屏一会儿组播就被系统丢掉（别人再也发现不了这个房间）。`core.bin` 放 assets 而不是写 `shouldInterceptRequest`：Capacitor 的资源本来就以 http 提供，同一个文件放 assets 即等价，少一层会写错的拦截。
  - 验证：`./gradlew assembleDebug` 出 `app-debug.apk`（内含两个 ABI 的 `libminicraft_server.so` 与 `assets/public/__host/core.bin`）；模拟器 `Pixel_3a_API_34` 上 `./gradlew connectedDebugAndroidTest` **3 条全过**（包名 / JNI 起服务 + `/healthz` 回 `ok` + 停后端口归零 / 前台服务拉起来 + `/rooms` 200）；装 APK 启动后**截图确认已进主菜单**（Play / Settings / Mini-games 正常渲染，只剩一条 SW 注册警告，WebView 里本就该失败）。
  - **未验证（如实记）**："装两台上能互相发现并进房"——需要第二台设备 + 客户端接线（网页调 `NativeServer.start`、用 `peers` 出列表），那正是 N6 的范围；单台模拟器上硬凑只能验到假路径，所以没做。另：Gradle 8.2.1 不支持 JDK 21，构建要 `JAVA_HOME` 指 17（已写进 `android/README.md`）。
  - 批次：20261025-2050
- [x] [N5] iOS 集成：`staticlib` → `.xcframework` + 前台会话（锁屏即断，需提示）+ `NSNetService` Bonjour 广播 → 前台当房主、Android 能被发现
  - 做了什么：Rust 侧加 **C ABI**（`src/capi.rs` 三个函数）+ 把两端共用的生命周期抽成 `src/instance.rs`（`jni.rs` 改成薄包装）；`rust-server/build-ios.sh` 编真机 arm64 + 模拟器 arm64/x86_64 → `ios-shell/MinicraftServer.xcframework`（带头文件）；`ios-shell/` 里 `NativeServer.swift`（三个 C 函数包装）、`ForegroundSession.swift`（进后台就停 + 提示 key `net.host.foregroundOnly`）、`BonjourAdvertiser.swift`（`NetService` 广播，TXT 字段与组播报文同名）、`Tests/main.swift`（设备级冒烟）；`check.sh` / `check-sim.sh` 两条验收脚本 + README（接入 Xcode 的手工步骤与 Info.plist 三个键）。
  - 为什么：iOS 端只能走 C ABI（没有 JVM），而生命周期与 Android 一字不差——写在两处最容易分叉的是"停止时补存"，所以抽成一份；"只有前台能当房主"是系统规则（后台不允许长期持监听 socket，硬撑会被杀掉、表现是"房间还在但连不上"），所以做成"进后台主动停 + 回一个状态给 UI"，用户可见文案只给 i18n key（原生写文案会绕过六语言表）。
  - 验证：`bash ios-shell/check.sh` 全过（xcframework 两个切片架构正确、Swift 在**真机 SDK 与模拟器 SDK 下各 typecheck 通过**、静态库里三个 C 符号齐全）；`bash ios-shell/check-sim.sh` **在真的 iOS 模拟器里跑通**——`simctl spawn` 起服务得到端口 50924、`/healthz` 回 `{"ok":true,…,"protocol":2}`、`/rooms` 有响应、停后端口归零且快照已补存；Rust 侧回归 `cargo test 27/0`（新增"起服务→HTTP→停"一条）、`run-smoke 20/0`、`run-beacon-smoke 12/0`、`run-net-test 195/0`；Android `.so` 重编后三个 JNI 符号仍在。
  - **未验证（如实记）**：① 没生成 Capacitor 的 `ios/` 工程（`npx cap add ios` 走 CocoaPods，本机 `pod: command not found`），所以"iOS 上点一下开房"这条路没跑过——接入步骤写在 `ios-shell/README.md`，是 5 分钟手工；② "iOS 前台当房主、Android 能被发现"要两台真机 + N6 的客户端接线，没验；已知桥接点：Rust 组播两端同协议（Android 已验），Bonjour 只服务 Apple 生态内部，字段同名供 N6 映射。
  - 批次：20261025-2050
- [x] [N6] 发现层双端联调：Android UDP beacon ↔ iOS Bonjour 互通、房间里显示"世界名 / 人数 / 有无口令 / 延迟"，点一下进房；并处理"自己发自己收"的回声过滤
  - 做了什么：① 发现报文与 `/healthz.peers` 都带上 `room`，`/healthz` 加 `access-control-allow-origin: *`（**Rust 与 JS 两套服务端同时改**）；② Rust 侧新增 `beacon::from_txt(service_name, txt)`——把 iOS 的 Bonjour TXT 记录转成与组播**同一个结构**（键名两边刻意相同），这条就是"Android 组播 ↔ iOS Bonjour"的互通点；③ 客户端新增 `src/core/net/NearbyRooms.ts`（解析 `peers`、过滤自己、拼 `ws://host:port/room`、探延迟）与 `healthEndpoint()`；④ 联机面板把附近设备并进房间列表：`世界名 · host:port · {n} 人 · 口令 · 12 ms`，点一下直接进房（地址带房间名，口令房先聚焦口令框）。
  - 为什么：浏览器发不出也收不到 UDP，唯一的耳朵是每台手机上的 Rust 服务端，所以面板读它的 `/healthz.peers`；"点一下进房"必须知道房间名（否则进默认房间，看到的世界跟列表写的不一样），所以报文补 `room`；"自己发自己收"在服务端早已按实例 id 挡住，客户端只需再按"面板里正对着的那台地址"过滤一次（一台手机有多个网卡地址，枚举自身 IP 既不可靠也没必要）。
  - 验证：`npx vitest run tests/nearby-rooms.test.ts` **12/12**（脏地址/越界端口逐行丢、自己那间被过滤、地址带房间名、延迟探测失败返回 null）；`cargo test` **28/0**（新增 Bonjour TXT → 组播结构的互转断言，含脏字段回落）；`bash run-beacon-smoke.sh` **13/0**（新增"广播带房间名"）；两套服务端行为仍一致（`run-net-test.sh` 与 `npm run test:net` 各 **195/0**）；`npm run check:fast` 全绿（命中 `net` 与 `ui` 两套离线套件）；实测 `curl -i /healthz` 带 `access-control-allow-origin: *`，且 B 的 `peers` 里确实有 A（世界名/种子/端口/房主标记/房间名）。
  - **未验证（如实记）**：① 浏览器里真的点一下"附近房间"进房——要同时开两个服务端并手动点，本轮只做了类型检查 + 纯函数断言，没有浏览器自动化；② 真机 Android ↔ iOS 互相发现仍未验（要两台设备，且 iOS 侧还要把 Capacitor 工程接起来，见 N5 的未验证项）。
  - 批次：20261025-2050

## 批次 20261025-2000 · 2026-10-25 · 会话 12afd06a

> 里程碑 MS1 收口：Rust 版联机服务端与 JS 版**行为一致**——`tools/net-test.mjs` 195 条断言
> 0 失败（`bash rust-server/run-net-test.sh`），`cargo test` 20 / 冒烟 20 也全绿。
> 这一段是"能不能用同一份黑盒断言验收另一套实现"的答案。

# 队列 · 会话 12afd06a599745d78ae8d88cedd715eb（本段 N3a~N3f）

- [x] [N3a] 与 `tools/net-test.mjs` 对齐·基础设施：`PORT=0` 打印实际端口、`/healthz` + `/rooms` + 404（同端口 HTTP 分流 + CORS）、`ALLOWED_ORIGINS` 来源白名单、`ROOM_PASSWORD`、`join.world`（按房种子）、64KB 载荷上限（超了回 1009 而不是无声断）→ `cargo test` + `bash run-smoke.sh` 全绿，且 net-test 里健康检查/来源/口令/世界四段通过
  - 做了什么：`main.rs` 先自己读请求头再分流——普通 GET 就地答 `/healthz`（在线人数 / 房间数 / 吞吐速率）、`/rooms`（人数 + `hasHost` + 世界名与种子 + CORS，**不下发口令**）、其余 404；升级请求把已读的字节用 `Prefixed` 流接回 tungstenite 完成握手（所以来源白名单能在**握手之后**回 `error{code:'origin'}` + close 4004，与 JS 版同形）。`PORT=0` 时打印 `local_addr()` 的实际端口。`protocol.rs` 补 `sanitize_world_meta`（种子必须是 32 位整数，脏数据保留房间原有那份）、`ROOM_PASSWORD` 校验、`MAX_PAYLOAD_BYTES`。
  - 为什么：HTTP 与 WS 共用一个端口是"容器/反代只暴露一个口"的前提；而来源拒绝必须发生在握手之后——在握手阶段拒（tungstenite 的 ErrorResponse）客户端只会看到 HTTP 错误，拿不到 `error.code`，浏览器端无从判断"该不该重连"。
  - 验证：net-test 的 `[启动服务端]` 四段（healthz 三段 + 404 一段）、`[房间的世界]` 的 `/rooms` 四段、`[房间与来源校验]` 的 origin 两段、`[房间口令]` 两段全绿；`cargo test` 20 通过。
  - 批次：20261025-2000
- [x] [N3b] 与 `tools/net-test.mjs` 对齐·玩家生命周期：`GRACE_MS` 断线宽限重连（复用原 id、房主位宽限、到期 `room-closed`/`host-left`/清掉落物）、心跳 ping 5s、`sleep` 跳夜、时间状态机（黎明 0.12 / 按房广播）→ net-test 的"断线重连 / 睡眠跳夜 / 房主掉线"三段通过
  - 做了什么：`on_close` 把玩家移出在线表但不广播 leave，只记一条 `Grace{id, seq}` 并起计时；`join` 在宽限期内认回原 id（房主位也留给他）。到期才广播 `leave`、清他名下掉落物、释放房主位；房主到期没回来 → 同房其他人各收 `error{code:'host-left'}` + close 4007。心跳按连接起 5s 的 ping 任务，20s 没回 pong 主动断。时间状态机改成 `day_start_ms + start_time_of_day`（默认 0.12），`sleep` 与房主改时间都走"重置起点 + 广播 `snap`"。
  - 为什么：手机切后台/断 wifi 不会触发 close 语义上的"人走了"；立刻广播 leave 会让队友眼里你"消失又出现"，你名下的掉落物也没人有权删（owner 就是 id）。宽限期条目带 `seq` 是为了修一个 net-test 覆盖不到的坑：连断两次会留下两个计时器，只比 id 的话前一个会把刚连回来的人广播成离开。
  - 验证：net-test 的 `[断线重连]` 三段、`[睡眠跳夜]` 三段、`[房主掉线：先提示、宽限到期关房]` 三段、`[时间权威]` 三段全绿；`[房主：一房一名]` 里"原房主宽限期过后房主位释放"也绿。
  - 批次：20261025-2000
- [x] [N3c] 与 `tools/net-test.mjs` 对齐·消息族：`item-spawn/item-remove/item-take`、`mob-hit`、`player-hit`、`container`(+progress)、`sign`、`frame`、`arrow`、`tnt`、`entity-snap`、`entity-remove`、外观白名单（`look` 形状）→ net-test 的掉落物/命中/PvP/容器/牌子/箭与 TNT/实体快照各段通过
  - 做了什么：`handlers.rs` 补齐 13 类消息，每条都带形状收口（掉落物数量 1~64、坐标 ±3e7、容器 ≤27 格且序列化 ≤8192 字节、牌子 4 行 × 64 字、展示框 `item=null` 表示空框、箭速 ≤200、伤害夹到 0~50、着火 0~16、`entity-snap` 截到 256 条、`entity-remove` 只留 1~32 字符的键）；`welcome` 补齐 `items/containers/signs/frames`；`item-take` 用单锁做"查还在 → 删 → 回 ok"的原子仲裁；`read_appearance` 按白名单收口（`look` 必须正好 10 个整数才下发）。
  - 为什么：这些"事件 + 坐标"的消息（箭/TNT/命中）服务端没有世界也没有实体表，能做且只该做两件事——形状收口与转发；一旦它开始判"这只怪该不该在这"，就得同步整个生物注册表，那是客户端的事。掉落物的 owner 一律由服务端填，所以"删别人的掉落物"在协议层就不成立。
  - 验证：net-test 的 `[掉落物镜像]` 七段、`[掉落物维度]` 三段、`[拾取仲裁]` 五段、`[生物命中]` 四段、`[PvP 转发]` 四段、`[容器同步]` 四段、`[牌子与展示框]` 四段、`[箭与 TNT]` 四段、`[实体快照只由房主推]` 九段、`[命中带全局键]` 四段、`[容器进度只认房主]` 四段、`[玩家外观（皮肤）随 move 转发]` 两段全绿。
  - 批次：20261025-2000
- [x] [N3d] 与 `tools/net-test.mjs` 对齐·范围与限频：AOI 裁剪（8 区块 + 同维度，快照与广播两条路）+ 令牌桶（block 200/s·400、container 20/s、chat 5/s）+ 拒收日志限频 → net-test 的"广播范围 / 快照裁剪 / 限频与体积"三段通过
  - 做了什么：新增 `aoi.rs`（切比雪夫距离按区块算，`>> 4` 与 JS 的负数取整一致）与 `ratelimit.rs`（令牌桶 + "1 秒窗口计数"两套）；`broadcast` 多一个 `Aoi` 参数，坐标类消息（方块/容器/牌子/展示框/TNT/掉落物/命中/箭/实体快照）按"同维度 + 8 区块"过滤，聊天与时间不过滤；`welcome.edits` 同样按玩家位置裁剪；`move` 的转发中心用发起者坐标。
  - 为什么：不过滤时"出生点改一格"会发给 5000 格外的观察者（人多时是 O(n²) 的纯浪费）；而聊天是文字、时间全局，过滤它们只会让远处的人变聋/时间错乱。方块用令牌桶**按条数**计费（红石连锁一次几十格是正常的，持续每帧几百格不是），比固定窗口少了"边界双倍流量"的漏洞。
  - 验证：net-test 的 `[广播范围]` 四段、`[快照裁剪]` 两段、`[限频与体积]` 四段（含"第一批 256 格放行、紧接着的第二批被限"）、以及 `[脏消息校验]` 里"隔空改容器被拒"全绿；`ratelimit`/`aoi` 单测 5 条通过。
  - 批次：20261025-2000
- [x] [N3e] 与 `tools/net-test.mjs` 对齐·存档落盘：`DATA_DIR/world.json` 原子写（tmp+rename）+ 30s 定时 + SIGTERM 补存 + 损坏备份 `world.json.broken-*`，重启后 edits/containers/signs/frames/时间/天气都在 → net-test 的"持久化"两段通过
  - 做了什么：新增 `store.rs`（原子写 + 损坏改名备份 + 读档版本校验）；`State::world_snapshot` 把 edits/containers/signs/frames 按 `[x,y,z,…,room]` 摊平（房间名从 key 前缀取回），`State::apply_snapshot` 反向灌回并走 `sanitize_room`/`sanitize_dimension` 收口；时间用"存档那一刻"当新起点（停机那段不走），天气接着存档那档跑。SIGINT/SIGTERM 走"补存一次再 exit(0)"。
  - 为什么：不做落盘时，重启后箱子里东西对新玩家完全不可见（只有打开过它的老玩家本地还记得），队友搭的东西也全没了；损坏时**备份而不是删掉**，是因为里面可能还有人工能救的部分，而"删掉 + 下轮保存"会让现场彻底消失。
  - 验证：net-test 的 `[持久化：重启后快照仍在]` 四段（真的 SIGTERM 杀一次再起，断言方块与容器都还在）、`[持久化：损坏快照被备份而不是覆盖]` 四段（先写坏文件，断言 `world.json.broken-*` 存在且从空世界开始）全绿。
  - 批次：20261025-2000
- [x] [N3f] 让 net-test 能指向 Rust 服务端并全量跑绿：`tools/net-test.mjs` 加 `NET_SERVER_BIN`/`NET_SERVER_ARGS`（默认仍是 `node server/index.mjs`，JS 路径行为不变）+ `rust-server/run-net-test.sh` → `bash rust-server/run-net-test.sh` 0 失败
  - 做了什么：`tools/net-test.mjs` 的 `spawn('node', ['server/index.mjs'])` 抽成 `SERVER_BIN`/`SERVER_ARGS`（默认值保持原样；换了二进制又没给参数时按"那个程序自己就是服务端"处理）；新增 `rust-server/run-net-test.sh`（build → 用 Rust 二进制跑同一套断言）。断言一条未改。
  - 为什么：Rust 版的对齐判据必须**就是**这套 1871 行黑盒断言——复制一份会立刻漂，改断言更是把契约改没了。把"起哪个进程"做成环境变量，是让两套实现共用同一份验收脚本的最小改动。
  - 验证：`bash rust-server/run-net-test.sh` → **195 通过 / 0 失败**（连跑 3 次都全绿，排除偶发）；`npm run test:net`（JS 路径）同样 195/0；把 `NET_SERVER_BIN` 指到 `/usr/bin/false` 时启动段立刻红，证明变量确实生效。
  - 批次：20261025-2000

## 批次 20261025-1946 · 2026-10-25 · 会话 abbdd915

> Rust 版联机服务端第一阶段：协议层 + 核心 10 类消息跑通（本段在 20261025-2000 的
> 里程碑 MS1 里一起收口，因为那时它还没走过收尾）。

# 队列 · 会话 abbdd9159d0b4bf084c8a8a9fdcf439b（本段 N1~N2）

- [x] [N1] Rust 工程 + 协议层（常量 / 清洗 / 校验，逐条对齐 `server/protocol.mjs`）→ `cargo test` 9 条全绿
  - 做了什么：新建 `rust-server/`（tokio + tokio-tungstenite + serde）；`protocol.rs` 落协议版本 2、关闭码 4001~4008、`WORLD_MIN_Y/-MAX`、`MAX_BLOCK_ID/STATE`、`MAX_EDIT_DISTANCE`、名字清洗（去控制字符与 `<>`、压缩空白、按**字符**截 16、空则"玩家"）、房间名回落、clientId 形状、方块改动的 y/id/state/距离校验（**房主豁免距离闸**）、`scoped_key`。
  - 为什么：这些清洗规则是"两个人进了两个房""名字被切成半个 emoji""房主代发的远处改动被丢"这三类老 bug 的防线，重写时**必须逐条等价**；用单测钉住比人眼比对可靠。
  - 验证：`cargo test` 9 通过 / 0 失败（含 emoji 不被切开、`<b>坏</b>` 的斜杠保留、房主豁免距离闸、非房主仍被挡）。
  - 批次：20261025-1946
- [x] [N2] 核心消息链路跑通（join / welcome / move+player / block+blocks / edit-request / chat / room-config / leave / time 广播）→ `bash run-smoke.sh` 20 条全绿
  - 做了什么：`state.rs` 的 Hub（玩家表 / 出站队列 / 房主表 / 方块增量表 / 时间与天气）；`main.rs` 的连接任务与消息分发；冒烟脚本 `smoke.mjs` 用 Node 23 内置 `WebSocket`（不需要 `npm ci`），`run-smoke.sh` 起临时服务端（25199）跑完自动关。
  - 为什么：先用"核心 21 类里的 10 类"验证架构（读写分离 + Hub 锁边界 + 房主语义），再决定是否为剩余 11 类继续投入；这一步能暴露 Rust 侧独有的两类坑（见下）。
  - 验证：`bash run-smoke.sh` **20 通过 / 0 失败**——覆盖 welcome 字段、房主/从属身份、move 转发与队伍、方块 `authority` 重标、从属直发被拒（not-host）、edit-request 转发、同房重名被拒（duplicate-name）、房主改天气、从属改配置被拒、聊天不回给自己、断线 leave 带 id。
  - 踩到并修掉的：① **tokio Mutex 不可重入**——持 `players` 锁时调 `player_broadcast_of`（内部再锁一次）会永久死锁，锁边界收进块内；② **拒绝帧被丢**——读循环 break 后立即 abort 写任务，客户端收不到 `error`+"close"，表现是"点加入没反应"，改成先 `drop(tx)` 排空再收尾。
  - 批次：20261025-1946

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
