# Android 壳（Capacitor + Rust 服务端）

> 目标：**这台手机自己当房主**——游戏跑在 WebView 里，联机服务端跑在同一进程的
> Rust 里（`server/rust/` 编出的 `libminicraft_server.so`），房间靠 UDP 组播广播出去。
> 这份工程是 `npx cap add android` 生成的，改过的地方都在下面"我们加了什么"里。

## 怎么出包

```bash
# 0) 前置：JDK 17（Gradle 8.2.1 不支持 JDK 21，本机默认是 21）
export JAVA_HOME=$(/usr/libexec/java_home -v 17)

# 1) Rust 侧交叉编译（arm64-v8a + x86_64）
bash server/rust/build-android.sh

# 2) 封存核心数据 + app 形态产物 + 同步（一条命令）
npm run android:sync
#    = gen:sealed → build:app → npx cap sync android

# 3) 出 APK
cd android && ./gradlew assembleDebug
#    → app/build/outputs/apk/debug/app-debug.apk
```

### 上架用的 AAB

Play 只收 **已签名** 的 AAB，签名密钥不进仓库、走环境变量：

```bash
export MINICRAFT_KEYSTORE=~/.keys/minicraft-upload.jks
export MINICRAFT_KEYSTORE_PASSWORD='…'
export MINICRAFT_KEY_ALIAS=upload
export MINICRAFT_KEY_PASSWORD='…'
npm run android:aab        # → android/app/build/outputs/bundle/release/app-release.aab
```

没配这四个变量时 `bundleRelease` 仍会成功，但产物**没有签名**（Play 会拒收）——
这是有意的失败方式：不签名时不能假装可上架。

> 方块表**不以明文进包**：`gen:sealed` 产出 `assets/sealed/core.sealed`，
> 运行时由 `CoreVault` 先验签名再解封。详见 [`docs/CODE-PROTECTION.md`](../docs/CODE-PROTECTION.md)。

设备级断言（需要一台连着的设备 / 已启动的模拟器）：

```bash
cd android && ./gradlew connectedDebugAndroidTest   # 3 条：包名 / JNI+HTTP / 前台服务
```

`npm run android:sync` / `npm run android:apk` 是上面 2、3 步的简写（Capacitor 的工程路径由
`capacitor.config.json` 的 `android.path` 指到这里，所以 `npx cap sync android` 照常用）。

## 我们加了什么（相对 Capacitor 模板）

| 文件 | 作用 |
| --- | --- |
| `app/src/main/java/com/minicraft/server/NativeServer.java` | JNI 声明（`startServer` / `stopServer` / `serverPort`），名字必须与 `server/rust/src/jni.rs` 逐字对应 |
| `app/src/main/java/com/minicraft/app/ServerService.java` | 前台服务（常驻通知）+ `MulticastLock` / `WifiLock`；JNI 调用丢在工作线程（主线程会 ANR） |
| `app/src/main/java/com/minicraft/app/ServerControl.java` | 起/停/查端口/查 IP，插件与同步桥共用 |
| `app/src/main/java/com/minicraft/app/JsHostBridge.java` | 注入 `window.MinicraftAndroid`（网页用它判断能不能开房） |
| `app/src/main/java/com/minicraft/app/NativeServerPlugin.java` | Capacitor 插件 `NativeServer.start/port/stop`（异步版，保留给以后带参数的场景） |
| `app/src/main/java/com/minicraft/app/MainActivity.java` | 注册插件（必须在 `super.onCreate()` 之前） |
| `app/src/main/java/com/minicraft/app/SealedCore.java` | 封存体的解析与解密（纯 Java，可被 JVM 直接验证） |
| `app/src/main/java/com/minicraft/app/CoreVault.java` | 读 assets + 取安装包签名 + 比白名单，失败一律 `null` |
| `app/src/main/java/com/minicraft/app/CoreVaultPlugin.java` | 给网页用的 Capacitor 插件 `CoreVault.read()` |
| `app/build.gradle` | 两个任务：`copyRustLibs`（把 `.so` 拷进 `jniLibs`）、`checkSealedCore`（缺封存体 / 残留明文都直接报错） |
| `app/src/androidTest/...` | 3 条设备级断言，见上 |

`AndroidManifest.xml` 里补的权限都有具体理由：

- `CHANGE_WIFI_MULTICAST_STATE` + `ACCESS_WIFI_STATE`：`MulticastLock`（息屏时组播会被系统丢掉，
  不拿锁就是"锁屏一会儿别人就找不到这个房间"）
- `WAKE_LOCK`：`WifiLock`（同上，Wi-Fi 芯片打盹会让 TCP 也断）
- `FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_DATA_SYNC` + `POST_NOTIFICATIONS`：常驻通知
- `usesCleartextTraffic="true"`：联机走明文 `ws://`（局域网自建，没有证书）
- `allowBackup="false"`：`adb backup` 拖不走存档与设置

## 核心数据：从哪来、怎么进游戏

`web/src/core/hostCore.ts` 启动时要取方块表（724 块，41 KB）。`build:app` 会把
`blockSpecs.ts` 换成空桩——**明文根本不进主包**，浏览器打开也因此显示"去 Google Play 下载"。

这份数据在 APK 里的形态是**封存体**，不是明文：

1. `npm run gen:sealed` 把 `host/core-baseline.bin` 封成 `assets/sealed/core.sealed`；
2. 网页调 `Capacitor.Plugins.CoreVault.read()`；
3. `CoreVault` 比对安装包签名 → 派生 KEK → 解封 → 交回字节；
4. 签名不符或解封失败 → `reject`，网页停在落地页。

放在 `assets/sealed/`（不是 `assets/public/`）是刻意的：WebView 的静态根是 `public/`，
放进去等于谁都能 `fetch` 到。

## 已知坑

- **Gradle 8.2.1 不支持 JDK 21**（报错很像语法错，其实是 Gradle 不认 class 文件版本）：
  构建时 `JAVA_HOME` 指到 17。要长期用 21，把 `gradle/wrapper` 升到 8.7+。
- **`cap sync` 很慢**（本项目实测 5 分钟）：它要逐个小文件拷 12MB 的 `assets/public`。
  改网页只为了看一眼效果时，直接改 `assets/public` 里的文件更快，出包前再 sync。
- **`.so` 与 `jniLibs/` 不进 git**：二进制产物，构建时由 `copyRustLibs` 拷。缺产物时
  Gradle 会在配置阶段报一句明确的话，而不是编出一个没有 JNI 的 APK。
- **WebView 里 Service Worker 注册会失败**（`http://localhost` + Capacitor 的 scheme）：
  APK 里的资源本来就是本地的，不需要 SW 缓存，这条警告可以忽略。

## 上机验收清单（真机，2026-10-27）

> 这几条 CI 跑不了（要真机、要么要两台设备）。每条给「看什么」和「不对先查哪里」。

### A. 服务起没起来

1. `adb install -r app-debug.apk` → 打开 App → 点「开房」。
   - **看**：通知栏出现「联机服务已启动 · 端口 8887」。
   - 不对查：`adb logcat -s MinicraftServer`；端口不是 8887 说明宿主传了非 0 端口
     （`instance.rs` 里 `want_port > 0` 才覆盖，0 必须落回默认 8887）。
2. 手机浏览器开 `http://localhost:8887/healthz`。
   - **看**：`{"ok":true,…,"beacon":true,…}`，`peers` 是数组（此时可能为空）。
   - 不对查：`beacon:false` → 组播没起来（`MulticastLock` 没拿到 / 没连 Wi-Fi）。

### B. 同机 webview 连得上

3. App 里「加入房间」→ 地址 `127.0.0.1`、端口 8887 → 加入。
   - **看**：进得去，自己是房主/从属。
   - 不对查：Capacitor 的 `server.hostname` 是否改过（webview 的 `localhost` 与 App 的
     不一定同一个网络命名空间）；`adb logcat` 里找 `ERR_CONNECTION_REFUSED`。

### C. 另一台设备能不能发现

4. 两台手机连**同一个 Wi-Fi**，都开房，各自「加入房间」→「选择」。
   - **看**：局域网区块里出现对方 IP + 房间行。
   - 不对查：只有一个方向看得到 → 典型是**组播**问题（路由器开了「AP 隔离」/ IGMP snooping；
     安卓要确认 `MulticastLock` 真的持有）。两边都看不到 → 先确认
     `http://<对方IP>:8887/ping` 通（不通就是网络隔离，不是发现层）。
5. Android ↔ iOS 混测。
   - **看**：安卓能看到 iOS（iOS 发 Bonjour，安卓靠 `beacon::from_txt` 互转）；
     反过来 iOS **目前只做了发布没做浏览**，看不到安卓是已知缺口。
   - 不对查：先看 iOS 的 `Info.plist` 三件套（少了是**静默失败**，不报错）。

### D. 进房之后世界对不对

6. 房主在 A 机放方块，B 机看；B 走远再走回来。
   - **看**：立刻出现；走回来还在（懒上行 `edits-reply`）。
   - 不对查：B 走过去时 A 的 log 里有没有 `edits-request`；没有说明 B 认为那块已确认，
     或者 B 自己就是房主（房主不向自己发请求）。
7. 房主打开箱子放东西，B 机开同一个箱子。
   - **看**：内容一致（`session-sync` 整份上行）。
   - 不对查：A 进房时有没有发 `session-sync`。
8. 房主点「断开」→ B 机。
   - **看**：立刻收到「房主已退出，房间已关闭」并被踢回，**不是**等 30 秒。
   - 不对查：A 的客户端有没有发 `bye`（缺失时走宽限期，表现就是"过一会儿才断"）。

### E. 后台与省电

9. 房主切后台 / 息屏 2 分钟，B 机看。
   - **看**：B 那边房主仍在线（前台服务 + 心跳）。
   - 不对查：`adb shell dumpsys activity services | grep minicraft`；被系统杀了会在 log 里留 `onDestroy`。

### F. 改动之后的离线回归（不需要真机）

```bash
npm run check
bash server/rust/run-net-test.sh    # 297 / 0
bash server/rust/run-smoke.sh       # 20 / 0
bash server/rust/run-beacon-smoke.sh # 13 / 0
```
