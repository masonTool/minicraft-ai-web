// iOS 半边的**真机级**冒烟：在 iOS 模拟器里起服务、请求 `/healthz`、再停掉。
//
// 为什么要有它：xcframework 存在 ≠ 能链接（Rust 静态库常缺 `-lc++` / `-liconv` 这类
// 系统库的符号），Swift typecheck 通过 ≠ 能在 iOS 上跑起来。这一条把两件事一次验掉：
// 链接（`swiftc` 打包成可执行）与运行（`simctl spawn` 在模拟器里跑）。
//
// 跑法见 `server/ios/check-sim.sh`。

import Foundation

func httpGet(_ url: String, _ timeout: TimeInterval = 0.5) -> String? {
    guard let target = URL(string: url) else { return nil }
    var request = URLRequest(url: target)
    request.timeoutInterval = timeout
    let semaphore = DispatchSemaphore(value: 0)
    var body: String?
    URLSession.shared.dataTask(with: request) { data, _, _ in
        if let data { body = String(data: data, encoding: .utf8) }
        semaphore.signal()
    }.resume()
    _ = semaphore.wait(timeout: .now() + timeout + 0.5)
    return body
}

let dataDir = FileManager.default.temporaryDirectory
    .appendingPathComponent("minicraft-ios-smoke-\(Int(Date().timeIntervalSince1970))")
try? FileManager.default.createDirectory(at: dataDir, withIntermediateDirectories: true)

print("[smoke] 起服务（dataDir=\(dataDir.path)）")
let port = NativeServer.start(dataDirectory: dataDir, seed: 20261014, beacon: false)
guard port > 0 else {
    print("[smoke] ✗ 起不来（返回值 \(port)）")
    exit(1)
}
print("[smoke] ✓ 端口 \(port)，NativeServer.port=\(NativeServer.port)")

var health: String?
for _ in 0..<50 {
    if let body = httpGet("http://127.0.0.1:\(port)/healthz"), body.contains("\"ok\":true") {
        health = body
        break
    }
    Thread.sleep(forTimeInterval: 0.1)
}
guard let health else {
    print("[smoke] ✗ /healthz 没有响应")
    exit(1)
}
print("[smoke] ✓ /healthz → \(health.prefix(120))…")

let rooms = httpGet("http://127.0.0.1:\(port)/rooms")
guard rooms?.contains("\"ok\":true") == true else {
    print("[smoke] ✗ /rooms 没有响应")
    exit(1)
}
print("[smoke] ✓ /rooms 有响应")

/*
 * Bonjour 桥接（用户 2026-10-27）：**不依赖真的 mDNS**——直接注入一条记录，
 * 验"C 入口 → peer 表 → /healthz.peers"这条链路。
 *
 * 为什么这样验：`NetServiceBrowser` 在模拟器里能不能发现 Mac 上发布的服务，取决于
 * 环境（mDNS 域、本地网络权限），拿它当门禁会变成"环境问题"。而这条链路是我们自己的
 * 代码，注入一条就应该出现——它断了就是代码断了。
 */
let injected = "示例 iPhone".withCString { name in
    "192.168.1.99".withCString { ip in
        #"{"port":"8887","room":"bonjourroom","name":"Bonjour 房","seed":"42","players":"3","host":"1","pw":"0"}"#
            .withCString { txt in
                minicraft_add_bonjour_peer(name, ip, txt)
            }
    }
}
print("[smoke] \(injected == 1 ? "✓" : "✗") Bonjour 记录注入 → \(injected)")
guard injected == 1 else {
    print("[smoke] ✗ C 入口没接上（期望 1，实际 \(injected)）")
    exit(1)
}
var bonjourSeen = false
for _ in 0..<20 {
    if let body = httpGet("http://127.0.0.1:\(port)/healthz"), body.contains("bonjourroom") {
        bonjourSeen = true
        break
    }
    Thread.sleep(forTimeInterval: 0.1)
}
guard bonjourSeen else {
    print("[smoke] ✗ /healthz 的 peers 里没有 Bonjour 邻居")
    exit(1)
}
print("[smoke] ✓ /healthz 的 peers 里有 Bonjour 邻居")

NativeServer.stop()
guard NativeServer.port == 0 else {
    print("[smoke] ✗ 停掉之后端口应当归零，实际 \(NativeServer.port)")
    exit(1)
}
print("[smoke] ✓ 停止后端口归零")
print("[smoke] 全部通过")
