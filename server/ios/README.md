# iOS 半边（xcframework + 前台会话 + Bonjour）

> 目标与 Android 相同：**这台 iPhone 自己当房主**——游戏跑在 WKWebView 里，联机服务端跑在
> 同一个进程的 Rust 里（`MinicraftServer.xcframework`），房间靠组播 + Bonjour 广播出去。
>
> 与 Android 的区别只有一个，而且不是实现问题而是系统规则：**iOS 只有前台能当房主**。

## 产物与验收

```bash
bash server/rust/build-ios.sh    # → server/ios/MinicraftServer.xcframework
bash server/ios/check.sh         # 静态验收：xcframework 架构 + Swift typecheck + C 符号
bash server/ios/check-sim.sh     # 设备级验收：链接成模拟器可执行并真的跑起来
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
| `include/minicraft_server.h` | C 接口声明（与 `server/rust/src/capi.rs` 一一对应） |
| `Sources/NativeServer.swift` | 三个 C 函数的 Swift 包装（`start` / `stop` / `port`） |
| `Sources/ForegroundSession.swift` | 前台会话状态机：进后台就停、回前台由玩家再开，并给出提示 key |
| `Sources/BonjourAdvertiser.swift` | `NetService` 广播（Apple 原生发现；TXT 字段与组播报文同名） |
| `Tests/main.swift` | 设备级冒烟的可执行入口（起服务 → `/healthz` → `/rooms` → 停） |

Android 与 iOS 共用同一份生命周期（`server/rust/src/instance.rs`）：独立线程 + 独立 runtime、
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
   `["port": ..., "room": "red", "seed": ..., "players": ..., "host": "1", "pw": "0"]`
   ——键与 Android 的组播报文同名，`server/rust` 的 `beacon::from_txt` 负责互转（有单测）。

## 只有前台能当房主（这是系统规则，不是取舍）

iOS 不允许普通应用在后台长期持有监听 socket；硬撑会被系统杀掉，表现是"房间还在、没人连得上"。
所以 `ForegroundSession` 在 `didEnterBackground` 时**主动停服务**并回一个
`.suspendedBySystem` 状态，网页据此提示玩家（文案在游戏自己的六语言表里，
原生代码只给 key：`net.host.foregroundOnly`——把用户可见文本写在原生里会绕过翻译）。

## 还没做 / 没验的

- **没有生成 Capacitor 的 `ios/` 工程**：`npx cap add ios` 走 CocoaPods，本机没装 `pod`
  （`pod: command not found`）。上面的"接进 Xcode 工程"是手工步骤，等装好 CocoaPods
  或改用 SPM 时再补一条命令。**所以"iOS 上点一下开房"这条路没有跑过。**
- **iOS 只**发布** Bonjour、没**浏览**：`BonjourAdvertiser.swift` 里只有 `NetService`（publish），
  没有 `NetServiceBrowser`。所以"iOS 之间靠 Bonjour 互相发现"还不成立——现在能看到邻居，
  是因为对方也发了 UDP 组播（`beacon.rs` 两端同协议）。补浏览器约 60 行 Swift，
  模拟器里可以用 Mac 的 `dns-sd -R` 发布一条假记录来验（`check-sim.sh` 可以加一条）。
- **"Android 能被 iOS 发现、iOS 能被 Android 发现"没验**：要两台真机 + N6 的客户端接线。
  已知的桥接点：Rust 的组播（两端同协议，Android 已验）覆盖了"互相找到"，
  Bonjour 只服务 Apple 生态内部；两种记录的字段同名，N6 映射一次即可。

## 上机验收清单（真机，2026-10-27）

> iOS 专属的五条。**通用的进房/同步/发现步骤见
> `server/android/README.md` 的「上机验收清单」**（D 段那些两端通用）。

### 1. 本地网络权限（第一次开房）

- **看**：首次点「开房」时系统弹「允许「xx」查找并连接本地网络中的设备？」→ 必须点允许。
- **不对查**：点了拒绝之后**不会**再弹，也没有任何报错——只能在
  「设置 → 隐私与安全性 → 本地网络」里手动打开。表现为：服务端起来了、`/healthz` 也通，
  但**别的设备永远看不到这台**（Bonjour 发布被系统静默拦掉）。

### 2. Bonjour 真的发出去了

在 Mac 上（与手机同一个 Wi-Fi）用系统自带的工具看：

```bash
dns-sd -B _minicraft._tcp local.        # 应该列出这台 iPhone 的实例名
```

- **看**：能列出实例名，且 `dns-sd -L <名字> _minicraft._tcp local.` 里能读到 `port=8887`。
- **不对查**：`Info.plist` 的 `NSBonjourServices` 是否写了 `_minicraft._tcp`
  （与 `BonjourAdvertiser.serviceType` 一致；少这一条是静默失败）。

### 3. iOS ↔ iOS 互发现

- **看**：两台都开房时，双方「选择服务器」里能看到对方。
- **注意**：这一条依赖 **`NetServiceBrowser`**，目前**只做了发布、没做浏览**
  （`server/ios/Sources/BonjourAdvertiser.swift` 只有 publish）。所以现在 iOS 侧看不到
  纯 Bonjour 的邻居——能看到的是"对方也发了 UDP 组播"的情况。这是已知缺口，不是配置错。

### 4. 前台限制（系统规则，不是取舍）

- 房主切到后台 / 锁屏 30 秒后，另一台设备看：
- **看**：对方收到「房主暂时不在房间」或页面上出现 `net.host.foregroundOnly` 的文案，
  并且**继续等下去能重连**（宽限期）。
- **不对查**：`ForegroundSession` 的 `suspendedBySystem` 回调有没有接上；
  没接的话网页端只会静默掉线，玩家不知道是"手机锁屏"。

### 5. 明文 `ws://` 要放行

- **看**：局域网直连能用（`ws://192.168.x.x:8887`）。
- **不对查**：`Info.plist` 的 `NSAppTransportSecurity` → 只开 `NSAllowsLocalNetworking = true`，
  **不要**用 `NSAllowsArbitraryLoads`（会被上架审核问）。
