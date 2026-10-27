import Foundation

/// Bonjour **浏览**（用户 2026-10-27）：补上"只发布不浏览"那一半。
///
/// 为什么需要它：`BonjourAdvertiser` 只让我们被别人看见；要"iOS 之间互相发现"就必须
/// 有一个浏览器。组播（`beacon.rs`）两端都有，但有些 Wi-Fi 会挡组播
/// （AP 隔离 / IGMP snooping），Bonjour 走 mDNS 能把这一段补上。
///
/// 两个实现细节：
///  - **每 8 秒重新 resolve 一次**已发现的服务：Rust 侧 peer 表是 12 秒 TTL，
///    不刷新的话邻居会在房间列表里闪一下就消失；顺带也能拿到最新的 TXT（人数/房名会变）。
///  - **只要 IPv4**：Rust 的 `minicraft_add_bonjour_peer` 只 parse `Ipv4Addr`，
///    把 IPv6 地址递过去只会被判成非法参数。
public final class BonjourBrowser: NSObject, NetServiceBrowserDelegate, NetServiceDelegate {

    /// 与 `BonjourAdvertiser.serviceType` 同一个服务类型（尾点必须留）
    public static let serviceType = "_minicraft._tcp."

    /// 服务名 → 已发现的服务（`NetService` 要自己持有，否则会被释放掉）
    private var services: [String: NetService] = [:]
    private let browser = NetServiceBrowser()
    private var refreshTimer: Timer?
    private var running = false

    /// 发现/刷新了一条邻居：`(服务名, IPv4, TXT 字典)`
    public var onChange: ((String, String, [String: String]) -> Void)?

    public override init() {
        super.init()
        browser.delegate = self
    }

    /// 开始浏览（幂等）
    public func start() {
        guard !running else { return }
        running = true
        browser.searchForServices(ofType: Self.serviceType, inDomain: "local.")
        let timer = Timer.scheduledTimer(withTimeInterval: 8, repeats: true) { [weak self] _ in
            self?.refreshKnown()
        }
        // `.common`：列表滚动 / 弹窗时 RunLoop 会切模式，默认模式下的定时器会被饿死
        RunLoop.main.add(timer, forMode: .common)
        refreshTimer = timer
    }

    /// 停止浏览（幂等）
    public func stop() {
        guard running else { return }
        running = false
        refreshTimer?.invalidate()
        refreshTimer = nil
        browser.stop()
        for service in services.values {
            service.stop()
        }
        services.removeAll()
    }

    // MARK: - 内部

    /// 重新解析已发现的服务（刷新 Rust 侧的 TTL 与 TXT）
    private func refreshKnown() {
        for service in services.values {
            service.resolve(withTimeout: 4)
        }
    }

    /// 从 `service.addresses` 里取第一个 IPv4 的点分十进制
    private static func ipv4(of service: NetService) -> String? {
        for data in service.addresses ?? [] {
            let text: String? = data.withUnsafeBytes { raw -> String? in
                guard let base = raw.bindMemory(to: sockaddr.self).baseAddress else { return nil }
                var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
                let size = socklen_t(host.count)
                guard getnameinfo(base, socklen_t(data.count), &host, size, nil, 0, NI_NUMERICHOST) == 0 else {
                    return nil
                }
                return String(cString: host)
            }
            // IPv6 会带冒号：Rust 侧只认 Ipv4Addr
            if let text, !text.contains(":") {
                return text
            }
        }
        return nil
    }

    /// `NetService` 的 TXT 记录 → `[String: String]`
    private static func txt(of service: NetService) -> [String: String] {
        guard let data = service.txtRecordData() else { return [:] }
        var out: [String: String] = [:]
        for (key, value) in NetService.dictionary(fromTXTRecord: data) {
            out[key] = String(data: value, encoding: .utf8) ?? ""
        }
        return out
    }

    // MARK: - NetServiceBrowserDelegate

    public func netServiceBrowser(
        _ browser: NetServiceBrowser,
        didFind service: NetService,
        moreComing: Bool
    ) {
        services[service.name] = service
        service.delegate = self
        service.resolve(withTimeout: 5)
    }

    public func netServiceBrowser(
        _ browser: NetServiceBrowser,
        didRemove service: NetService,
        moreComing: Bool
    ) {
        // 对方下线：不主动通知 Rust——peer 表 12 秒后自然过期，
        // 而"刚下线又回来"在手机上很常见（锁屏/解锁），立刻删反而会闪。
        services.removeValue(forKey: service.name)
    }

    public func netServiceBrowser(
        _ browser: NetServiceBrowser,
        didNotSearch errorDict: [String: NSNumber]
    ) {
        NSLog("[minicraft] Bonjour 浏览失败：\(errorDict)")
    }

    // MARK: - NetServiceDelegate

    public func netServiceDidResolveAddress(_ sender: NetService) {
        guard let ip = Self.ipv4(of: sender) else { return }
        onChange?(sender.name, ip, Self.txt(of: sender))
    }

    public func netService(_ sender: NetService, didNotResolve errorDict: [String: NSNumber]) {
        // 解析失败（对方下线 / 换了网络）：留在表里等下一轮刷新。Bonjour 在 Wi-Fi 抖动时
        // 偶尔会解析失败一次，删掉再发现会让列表闪。
    }
}
