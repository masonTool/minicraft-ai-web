import Foundation
import UIKit

/// "只有前台能当房主"的那层状态机。
///
/// **为什么 iOS 必须这么做**：系统不允许普通应用在后台长期持有一个监听端口
/// （没有对应的 `UIBackgroundModes`，硬撑会被系统杀掉，表现是"房间还在、但没人连得上"）。
/// 所以口径是：进后台就停服务、回前台由玩家自己再开——并且**先把话说清楚**，
/// 而不是让他在锁屏后发现队友全掉了。
///
/// 提示文案不放在这里（原生代码里的用户可见文本会绕过游戏的六语言表）：
/// 这里只给一个 key，网页按自己的 i18n 表取文案 →
/// `net.host.foregroundOnly`（"iPhone 上只有前台能当房主：锁屏或切到别的 App 会断开"）。
public final class ForegroundSession {

    public enum State {
        case stopped
        case starting
        case running(port: Int)
        case failed
        /// 系统把 App 挪到后台，服务已按规则停掉（UI 应当提示 `foregroundOnlyHintKey`）
        case suspendedBySystem
    }

    /// 网页取文案用的 key（文案本身在游戏的 i18n 表里）
    public static let foregroundOnlyHintKey = "net.host.foregroundOnly"

    private let dataDirectory: URL
    private let onState: (State) -> Void
    private var observers: [NSObjectProtocol] = []
    private var running = false
    /// Bonjour 浏览（用户 2026-10-27）：只发布不浏览的话，"iOS 之间互相发现"其实不成立
    private let bonjour = BonjourBrowser()

    public init(dataDirectory: URL, onState: @escaping (State) -> Void = { _ in }) {
        self.dataDirectory = dataDirectory
        self.onState = onState
        bridgeBonjour()
    }

    /// 把浏览到的邻居交给 Rust 的 peer 表（`/healthz.peers` 与房间列表都读它）
    private func bridgeBonjour() {
        bonjour.onChange = { name, ip, txt in
            let payload = (try? JSONSerialization.data(withJSONObject: txt))
                .flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
            // 三个指针的有效期只到闭包结束，所以逐层 withCString 嵌套
            _ = payload.withCString { txtPtr in
                ip.withCString { ipPtr in
                    name.withCString { namePtr in
                        minicraft_add_bonjour_peer(namePtr, ipPtr, txtPtr)
                    }
                }
            }
        }
    }

    /// 开始当房主（幂等）。
    public func begin() {
        guard !running else { return }
        running = true
        observeLifecycle()
        startServer()
    }

    /// 停止当房主（幂等）。
    public func stop() {
        guard running else { return }
        running = false
        removeObservers()
        // 停服务可能花几十毫秒（补存快照），同样别占主线程
        bonjour.stop()
        DispatchQueue.global(qos: .userInitiated).async {
            NativeServer.stop()
        }
        onState(.stopped)
    }

    public var port: Int {
        NativeServer.port
    }

    // MARK: - 内部

    private func startServer() {
        onState(.starting)
        // C ABI 会阻塞到端口绑好（最多 3 秒）：必须在后台队列
        DispatchQueue.global(qos: .userInitiated).async { [dataDirectory] in
            let port = NativeServer.start(dataDirectory: dataDirectory, beacon: true)
            DispatchQueue.main.async { [weak self] in
                guard let self, self.running else { return }
                if port > 0 {
                    // 服务起来了才开浏览：没服务时找到的邻居也没地方放
                    self.bonjour.start()
                    self.onState(.running(port: port))
                } else {
                    self.onState(.failed)
                }
            }
        }
    }

    private func observeLifecycle() {
        let center = NotificationCenter.default
        observers.append(center.addObserver(
            forName: UIApplication.didEnterBackgroundNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            guard let self, self.running else { return }
            // 系统规则：后台不能长期监听 → 主动停，并把"为什么"告诉 UI
            self.running = false
            self.removeObservers()
            self.bonjour.stop()
            DispatchQueue.global(qos: .userInitiated).async { NativeServer.stop() }
            self.onState(.suspendedBySystem)
        })
        observers.append(center.addObserver(
            forName: UIApplication.willTerminateNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            // 进程要走：补存一次（`stop` 内部会写快照）
            NativeServer.stop()
            self?.running = false
        })
    }

    private func removeObservers() {
        let center = NotificationCenter.default
        for observer in observers {
            center.removeObserver(observer)
        }
        observers.removeAll()
    }
}
