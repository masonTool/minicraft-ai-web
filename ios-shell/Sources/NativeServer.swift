import Foundation

/// 手机当房主时的联机服务端（Rust 编出来的静态库，入口见 `rust-server/src/capi.rs`）。
///
/// 用法：
/// ```swift
/// let port = NativeServer.start(dataDirectory: dir)   // 会阻塞，别在主线程调
/// NativeServer.port                                    // 0 = 没在跑
/// NativeServer.stop()                                  // 停之前会自动补存一次快照
/// ```
///
/// 为什么不在 Swift 里再包一层异步：宿主（`ForegroundSession` / Capacitor 插件）本来
/// 就要自己决定"丢到哪个队列"，这里再包一层只会让取消语义变复杂。
public enum NativeServer {

    /// 起服务。
    /// - Parameters:
    ///   - dataDirectory: 存档目录（`world.json` 落在它下面）
    ///   - port: 0 = 让系统挑端口
    ///   - seed: 0 = 服务端默认种子
    ///   - beacon: 是否开局域网发现（手机当房主时的主线功能）
    /// - Returns: 实际监听端口；-1 = 启动失败
    @discardableResult
    public static func start(
        dataDirectory: URL,
        port: Int = 0,
        seed: Int = 0,
        beacon: Bool = true
    ) -> Int {
        Int(minicraft_start_server(dataDirectory.path, Int32(port), Int64(seed), beacon ? 1 : 0))
    }

    /// 停服务（内部会先补存一次快照）。
    public static func stop() {
        minicraft_stop_server()
    }

    /// 当前端口；0 = 没在跑。
    public static var port: Int {
        Int(minicraft_server_port())
    }
}
