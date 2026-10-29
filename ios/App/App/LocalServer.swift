import Foundation
import Network

/// 只监听 127.0.0.1 的极简 HTTP 服务：把内存里的游戏内容喂给 WKWebView。
///
/// ## 为什么 iOS 必须起服务，而不是像 Android 那样拦截
///
/// `WKURLSchemeHandler` 只能接管**自定义 scheme**，`http`/`https` 被 WebKit 保留。
/// 而自定义 scheme 的页面在 WebKit 里是 opaque origin，IndexedDB 行为不稳——
/// 存档全在那里，不敢赌。起一个回环服务之后，页面的 origin 就是正常的
/// `http://127.0.0.1:<port>`，存储、剪贴板、`ws://` 联机都和"真网站"一致。
///
/// 端口用 `.any`（系统分配）而不是写死：iOS 上写死端口容易和别的 App 撞，
/// 而这里的 origin 本来就只对本机这一次运行有意义（跨版本存档由 WebView 的
/// 站点数据目录承载，换端口等于换 origin，所以**端口必须稳定**——
/// 因此固定一个高位端口，失败再退回系统分配）。
final class LocalServer {

    private let listener: NWListener
    private let files: [String: Data]
    private let queue = DispatchQueue(label: "minicraft.local-server")
    private(set) var port: UInt16 = 0

    init(files: [String: Data], preferredPort: UInt16) throws {
        self.files = files
        let parameters = NWParameters.tcp
        // 只绑回环：不对局域网暴露
        parameters.requiredLocalEndpoint = NWEndpoint.hostPort(host: "127.0.0.1", port: .init(rawValue: preferredPort)!)
        parameters.allowLocalEndpointReuse = true
        listener = try NWListener(using: parameters)
    }

    /// 启动并等端口就绪
    func start() async throws -> UInt16 {
        try await withCheckedThrowingContinuation { continuation in
            var resumed = false
            listener.stateUpdateHandler = { [weak self] state in
                guard let self, !resumed else { return }
                switch state {
                case .ready:
                    resumed = true
                    self.port = self.listener.port?.rawValue ?? 0
                    continuation.resume(returning: self.port)
                case .failed(let error):
                    resumed = true
                    continuation.resume(throwing: error)
                default:
                    break
                }
            }
            listener.newConnectionHandler = { [weak self] connection in
                self?.handle(connection)
            }
            listener.start(queue: queue)
        }
    }

    private func handle(_ connection: NWConnection) {
        connection.start(queue: queue)
        connection.receive(minimumIncompleteLength: 1, maximumLength: 8192) { [weak self] data, _, _, error in
            guard let self, let data, error == nil else {
                connection.cancel()
                return
            }
            let response = self.respond(to: data)
            connection.send(content: response, completion: .contentProcessed { _ in
                connection.cancel()
            })
        }
    }

    /// 只认 `GET <path> HTTP/1.1` 这一行；不实现 keep-alive，每个请求一个连接
    private func respond(to request: Data) -> Data {
        guard let text = String(data: request, encoding: .utf8),
              let requestLine = text.split(separator: "\r\n").first
        else { return notFound() }

        let parts = requestLine.split(separator: " ")
        guard parts.count >= 2 else { return notFound() }
        var path = String(parts[1])
        if let query = path.firstIndex(of: "?") { path = String(path[path.startIndex..<query]) }
        path = path.removingPercentEncoding ?? path
        while path.hasPrefix("/") { path.removeFirst() }
        if path.isEmpty { path = "index.html" }

        guard let body = files[path] else { return notFound() }
        var head = "HTTP/1.1 200 OK\r\n"
        head += "Content-Type: \(mime(for: path))\r\n"
        head += "Content-Length: \(body.count)\r\n"
        head += "Cache-Control: no-store\r\n"
        head += "Connection: close\r\n\r\n"
        return Data(head.utf8) + body
    }

    private func notFound() -> Data {
        let body = Data("not found".utf8)
        var head = "HTTP/1.1 404 Not Found\r\n"
        head += "Content-Type: text/plain\r\n"
        head += "Content-Length: \(body.count)\r\n"
        head += "Connection: close\r\n\r\n"
        return Data(head.utf8) + body
    }

    private func mime(for path: String) -> String {
        switch (path as NSString).pathExtension.lowercased() {
        case "html": return "text/html; charset=utf-8"
        case "js", "mjs": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json": return "application/json; charset=utf-8"
        case "webmanifest": return "application/manifest+json"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "jpg": return "image/jpeg"
        case "webp": return "image/webp"
        case "woff2": return "font/woff2"
        default: return "application/octet-stream"
        }
    }
}
