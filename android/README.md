# Android 壳（Capacitor + Rust 服务端）

> 目标：**这台手机自己当房主**——游戏跑在 WebView 里，联机服务端跑在同一进程的
> Rust 里（`rust-server/` 编出的 `libminicraft_server.so`），房间靠 UDP 组播广播出去。
> 这份工程是 `npx cap add android` 生成的，改过的地方都在下面"我们加了什么"里。

## 怎么出包

```bash
# 0) 前置：JDK 17（Gradle 8.2.1 不支持 JDK 21，本机默认是 21）
export JAVA_HOME=$(/usr/libexec/java_home -v 17)

# 1) Rust 侧交叉编译（arm64-v8a + x86_64）
bash rust-server/build-android.sh

# 2) 网页产物用 **app 形态**（方块表不进主包，走 __host/core.bin）
npm run build:app && npx cap sync android

# 3) 出 APK
cd android && ./gradlew assembleDebug
#    → app/build/outputs/apk/debug/app-debug.apk
```

设备级断言（需要一台连着的设备 / 已启动的模拟器）：

```bash
cd android && ./gradlew connectedDebugAndroidTest   # 3 条：包名 / JNI+HTTP / 前台服务
```

`npm run android:sync` / `npm run android:apk` 是上面 2、3 步的简写。

## 我们加了什么（相对 Capacitor 模板）

| 文件 | 作用 |
| --- | --- |
| `app/src/main/java/com/minicraft/server/NativeServer.java` | JNI 声明（`startServer` / `stopServer` / `serverPort`），名字必须与 `rust-server/src/jni.rs` 逐字对应 |
| `app/src/main/java/com/minicraft/app/ServerService.java` | 前台服务（常驻通知）+ `MulticastLock` / `WifiLock`；JNI 调用丢在工作线程（主线程会 ANR） |
| `app/src/main/java/com/minicraft/app/NativeServerPlugin.java` | 给网页用的 Capacitor 插件 `NativeServer.start/port/stop` |
| `app/src/main/java/com/minicraft/app/MainActivity.java` | 注册插件（必须在 `super.onCreate()` 之前） |
| `app/build.gradle` | 两个任务：`copyRustLibs`（把 `.so` 拷进 `jniLibs`）、`copyHostCore`（把 `host/core-baseline.bin` 拷成 `assets/public/__host/core.bin`） |
| `app/src/androidTest/...` | 3 条设备级断言，见上 |

`AndroidManifest.xml` 里补的权限都有具体理由：

- `CHANGE_WIFI_MULTICAST_STATE` + `ACCESS_WIFI_STATE`：`MulticastLock`（息屏时组播会被系统丢掉，
  不拿锁就是"锁屏一会儿别人就找不到这个房间"）
- `WAKE_LOCK`：`WifiLock`（同上，Wi-Fi 芯片打盹会让 TCP 也断）
- `FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_DATA_SYNC` + `POST_NOTIFICATIONS`：常驻通知
- `usesCleartextTraffic="true"`：联机走明文 `ws://`（局域网自建，没有证书）

## 为什么 `core.bin` 放 assets

`src/core/hostCore.ts` 从 `./__host/core.bin` 读方块表（724 块，40 KB）。`build:app` 会把
`blockSpecs.ts` 换成空桩——**724 个方块的明文根本不进主包**，浏览器打开也因此显示
"去 Google Play 下载"的落地页。

我们把 `host/core-baseline.bin` 拷到 `assets/public/__host/core.bin`：WebView 从
`http://localhost/__host/core.bin` 直接读到，**不需要**再写一层 `shouldInterceptRequest`
（原方案的宿主拦截）。同一个文件，放哪决定形态。

## 已知坑

- **Gradle 8.2.1 不支持 JDK 21**（报错很像语法错，其实是 Gradle 不认 class 文件版本）：
  构建时 `JAVA_HOME` 指到 17。要长期用 21，把 `gradle/wrapper` 升到 8.7+。
- **`cap sync` 很慢**（本项目实测 5 分钟）：它要逐个小文件拷 12MB 的 `assets/public`。
  改网页只为了看一眼效果时，直接改 `assets/public` 里的文件更快，出包前再 sync。
- **`.so` 与 `jniLibs/` 不进 git**：二进制产物，构建时由 `copyRustLibs` 拷。缺产物时
  Gradle 会在配置阶段报一句明确的话，而不是编出一个没有 JNI 的 APK。
- **WebView 里 Service Worker 注册会失败**（`http://localhost` + Capacitor 的 scheme）：
  APK 里的资源本来就是本地的，不需要 SW 缓存，这条警告可以忽略。
