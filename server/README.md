# server/ · 服务端，以及"把服务端跑在手机上"的两个示例宿主

> 一句话：**游戏本体在 `src/`（浏览器里跑），联机靠这里的服务端；手机想自己当房主，
> 就把 Rust 那份服务端编成 `.so` / `.xcframework`，由 `android/`、`ios/` 两个示例宿主加载。**

## 四个子目录

| 目录 | 是什么 | 怎么跑 | 验收 |
| --- | --- | --- | --- |
| **`node/`** | Node 版服务端（现行 Web 端用的就是它）。纯 `.mjs`，不经过打包，`node` 直接跑 | `npm run server`（或 `node server/node/index.mjs`，端口见下） | `npm run test:net`（条数以脚本输出为准） |
| **`rust/`** | Rust 版服务端，可编成 Android `.so` / iOS `.xcframework` / 桌面可执行。**与 `node/` 逐条对齐（297 / 0）**：每房一套时钟、快照 v2、`session-sync`、区块懒上行、`bye`、`mob-attack` 都已跟上 | `cd server/rust && cargo run` | `cargo test` · `run-smoke.sh` · `run-beacon-smoke.sh` · `run-net-test.sh` |
| **`android/`** | **示例宿主**：Capacitor 6 的 Android 工程 —— WebView 跑游戏，前台服务跑 `rust` 编出来的 `.so` | `npm run android:apk` | `npm run android:test`（3 条设备断言） |
| **`ios/`** | **示例宿主**：`MinicraftServer.xcframework` + Swift 胶水（没有生成 Xcode 工程，接入步骤见它的 README） | `bash server/ios/check-sim.sh` | 在 iOS 模拟器里 `simctl spawn` 真跑 |

`android/`、`ios/` **不是产品主包的一部分**：Web 端发布用不到它们，它们存在的意义是
"验证这套服务端能被手机宿主加载起来"，以及给以后真做 App 时一份能跑的起点。

## 三者怎么接起来

```
浏览器 / WebView 里的游戏（src/）
        │  WebSocket（JSON 文本帧，协议见 docs/NET-PROTOCOL.md）
        ▼
   服务端（二选一，行为一致）
   ├─ server/node/   ← 开发机、容器、反代
   └─ server/rust/   ← 手机当房主时用这份
            │  编成 libminicraft_server.so / MinicraftServer.xcframework
            ▼
   server/android/  ·  server/ios/     （JNI / C ABI 入口，见各自 README）
            │  UDP 组播 239.255.42.99:25188 广播"我这有一间房"
            ▼
   同一局域网里的其它设备（联机面板的"附近房间"）
```

## 两条不能忘的约定

1. **`node/` 与 `rust/` 是并行实现，不共享代码**：常量（协议版本 2、端口 8887、房间名规则、
   名字清洗、距离闸、限频数值）必须逐条相等，靠**同一份黑盒断言** `tools/net-test.mjs` 兜底——
   它跑两遍，分别指向两套实现（`npm run test:net` 与 `bash server/rust/run-net-test.sh`）。
2. **改协议两头一起改**：`docs/NET-PROTOCOL.md` 是契约，`node/`、`rust/`、`src/net/NetClient.ts`
   都要跟上；只改一处时 net-test 会红在某条字段断言上，别改断言。

## 常见操作

```bash
npm run server                      # 起 Node 版（:8887）
npm run server -- --port 9000       # 换端口（也支持 --port=9000 / -p 9000）
PORT=9000 npm run server            # 等价写法；写了 --port 时以命令行为准
cd server/rust && cargo run         # 起 Rust 版（:8887，二选一；Rust 版只认 PORT 环境变量）
npm run test:net                # 195 条黑盒断言（指向 Node 版）
bash server/rust/run-net-test.sh   # 同一份断言，指向 Rust 版
bash server/rust/build-android.sh  # 出 .so（Gradle 构建时会自己拷进 jniLibs）
bash server/rust/build-ios.sh      # 出 xcframework
```
