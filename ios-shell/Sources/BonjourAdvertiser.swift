import Foundation

/// 用 `NetService` 把这一局广播出去（Apple 原生发现：iPhone / iPad / Mac 的"附近房间"）。
///
/// **与 Android 的关系**：Android 认的是 UDP 组播报文（`rust-server/src/beacon.rs`），
/// 不是 Bonjour。Rust 那份组播在 iOS 上同样会发（socket 与平台无关），所以
/// Android → iOS 的发现已经通了；这里补的是 Apple 生态内部那一半（Bonjour 面板），
/// 两种记录**字段同名**，N6 做互通时只需映射名字。
///
/// 需要 Info.plist：
/// ```xml
/// <key>NSBonjourServices</key>
/// <array><string>_minicraft._tcp</string></array>
/// <key>NSLocalNetworkUsageDescription</key>
/// <string>用来在局域网里发现同一房间的玩家</string>
/// ```
/// 少第一条 → 发布静默失败（没有报错，只是没人看得见），是本条最容易踩的坑。
public final class BonjourAdvertiser: NSObject, NetServiceDelegate {

    /// Bonjour 服务类型（与 `Android` 侧组播报文的 `mc: minicraft` 对应）
    public static let serviceType = "_minicraft._tcp."

    private var service: NetService?

    /// 开始广播。`txt` 的键与组播报文同名（`port` / `seed` / `players` / `host` / `pw`）。
    @discardableResult
    public func start(name: String, port: Int, txt: [String: String]) -> Bool {
        stop()
        guard port > 0 else { return false }
        let service = NetService(domain: "local.", type: Self.serviceType, name: name, port: Int32(port))
        service.delegate = self
        let record = txt.reduce(into: [String: Data]()) { result, entry in
            result[entry.key] = Data(entry.value.utf8)
        }
        service.setTXTRecord(NetService.data(fromTXTRecord: record))
        service.publish()
        self.service = service
        return true
    }

    /// 停止广播（停服务之前调，否则别人会看到一个连不上的房间）。
    public func stop() {
        service?.stop()
        service = nil
    }

    // MARK: - NetServiceDelegate

    public func netServiceDidPublish(_ sender: NetService) {
        NSLog("[minicraft] Bonjour 已发布：\(sender.name)\(Self.serviceType) → \(sender.port)")
    }

    public func netService(_ sender: NetService, didNotPublish errorDict: [String: NSNumber]) {
        // 最常见的原因是 Info.plist 缺 `NSBonjourServices`（静默失败）
        NSLog("[minicraft] Bonjour 发布失败：\(errorDict)")
    }
}
