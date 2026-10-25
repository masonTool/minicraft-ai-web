// iOS 半边的**真机级**冒烟：在 iOS 模拟器里起服务、请求 `/healthz`、再停掉。
//
// 为什么要有它：xcframework 存在 ≠ 能链接（Rust 静态库常缺 `-lc++` / `-liconv` 这类
// 系统库的符号），Swift typecheck 通过 ≠ 能在 iOS 上跑起来。这一条把两件事一次验掉：
// 链接（`swiftc` 打包成可执行）与运行（`simctl spawn` 在模拟器里跑）。
//
// 跑法见 `ios-shell/check-sim.sh`。

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

NativeServer.stop()
guard NativeServer.port == 0 else {
    print("[smoke] ✗ 停掉之后端口应当归零，实际 \(NativeServer.port)")
    exit(1)
}
print("[smoke] ✓ 停止后端口归零")
print("[smoke] 全部通过")
