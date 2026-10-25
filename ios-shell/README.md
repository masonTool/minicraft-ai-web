# iOS 半边（xcframework + 前台会话 + Bonjour）

> 目标与 Android 相同：**这台 iPhone 自己当房主**——游戏跑在 WKWebView 里，联机服务端跑在
> 同一个进程的 Rust 里（`MinicraftServer.xcframework`），房间靠组播 + Bonjour 广播出去。
>
> 与 Android 的区别只有一个，而且不是实现问题而是系统规则：**iOS 只有前台能当房主**。

## 产物与验收

```bash
bash rust-server/build-ios.sh    # → ios-shell/MinicraftServer.xcframework
bash ios-shell/check.sh          # 静态验收：xcframework 架构 + Swift typecheck + C 符号
bash ios-shell/check-sim.sh      # 设备级验收：链接成模拟器可执行并真的跑起来
```

`check-sim.sh` 的输出长这样（真的在 iOS 模拟器里跑）：

```
[server] 已启动，端口 50924，种子 20261014（Rust 版）
[smoke] ✓ /healthz → {"beacon":false,"ok":true,...,"protocol":2,"seed":20261014,...}
[smoke] ✓ 停止后端口归零
```

## 已经有的东西

| 文件 | 作用 |
| --- | --- |
| `include/minicraft_server.h` | C 接口声明（与 `rust-server/src/capi.rs` 一一对应） |
| `Sources/NativeServer.swift` | 三个 C 函数的 Swift 包装（`start` / `stop` / `port`） |
| `Sources/ForegroundSession.swift` | 前台会话状态机：进后台就停、回前台由玩家再开，并给出提示 key |
| `Sources/BonjourAdvertiser.swift` | `NetService` 广播（Apple 原生发现；TXT 字段与组播报文同名） |
| `Tests/main.swift` | 设备级冒烟的可执行入口（起服务 → `/healthz` → `/rooms` → 停） |

Android 与 iOS 共用同一份生命周期（`rust-server/src/instance.rs`）：独立线程 + 独立 runtime、
停之前补存一次快照。所以"停服务会丢最后几秒的存档"这个坑两边都不会踩。

## 接进 Xcode 工程要做什么

1. 把 `MinicraftServer.xcframework` 拖进 target（Embed & Sign 选 **Do Not Embed**：静态库）；
   它自带 `Headers/minicraft_server.h`，Swift 里可以直接 `import` 那些 C 函数。
2. 把 `Sources/*.swift` 加进 target（或做成内部 Swift Package）。
3. `Info.plist` 加三样（少任何一条的表现都是"静默没反应"，不报错）：

```xml
<key>NSLocalNetworkUsageDescription</key>
<string>用来在局域网里发现同一房间的玩家</string>
<key>NSBonjourServices</key>
<array><string>_minicraft._tcp</string></array>
```

4. 需要明文 `ws://`：`NSAppTransportSecurity` → `NSAllowsLocalNetworking = true`
   （只放开局域网，不要用 `NSAllowsArbitraryLoads`）。
5. 开房时：
   ```swift
   let session = ForegroundSession(dataDirectory: dir) { state in
       // .running(port) → 广播 + 告诉网页端口
       // .suspendedBySystem → 网页展示 `net.host.foregroundOnly` 的文案
   }
   session.begin()
   ```
   `BonjourAdvertiser.start(name:port:txt:)` 的 `txt` 用
   `["port": ..., "seed": ..., "players": ..., "host": "1", "pw": "0"]`。

## 只有前台能当房主（这是系统规则，不是取舍）

iOS 不允许普通应用在后台长期持有监听 socket；硬撑会被系统杀掉，表现是"房间还在、没人连得上"。
所以 `ForegroundSession` 在 `didEnterBackground` 时**主动停服务**并回一个
`.suspendedBySystem` 状态，网页据此提示玩家（文案在游戏自己的六语言表里，
原生代码只给 key：`net.host.foregroundOnly`——把用户可见文本写在原生里会绕过翻译）。

## 还没做 / 没验的

- **没有生成 Capacitor 的 `ios/` 工程**：`npx cap add ios` 走 CocoaPods，本机没装 `pod`
  （`pod: command not found`）。上面的"接进 Xcode 工程"是手工步骤，等装好 CocoaPods
  或改用 SPM 时再补一条命令。**所以"iOS 上点一下开房"这条路没有跑过。**
- **"Android 能被 iOS 发现、iOS 能被 Android 发现"没验**：要两台真机 + N6 的客户端接线。
  已知的桥接点：Rust 的组播（两端同协议，Android 已验）覆盖了"互相找到"，
  Bonjour 只服务 Apple 生态内部；两种记录的字段同名，N6 映射一次即可。
