import UIKit
import WebKit

/// iOS 壳：起一个只监听回环的 HTTP 服务，把**内存里解密出来的**游戏内容喂给 WKWebView。
///
/// 三端一致的部分：内容都是整包加密的 `libmcrt.so`，解密后才交给 WebView，
/// 磁盘上没有明文；页面 origin 都是 `localhost` 类可信来源。
/// 不一致的部分只有实现手段：Android 用 `shouldInterceptRequest` 拦截，
/// iOS 拦不了 http(s)（WebKit 保留），只能起回环服务。
final class MinicraftViewController: UIViewController, WKUIDelegate, WKNavigationDelegate {

    /// 固定端口：换端口 = 换 origin，IndexedDB 里就是一份全新的存档
    private static let preferredPort: UInt16 = 18765
    /// 与 Android 的 `MainActivity` 同一个标记，网页据此走触屏界面
    private static let touchMarker = "MinicraftTouch/1"

    private var webView: WKWebView?
    private var server: LocalServer?

    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .landscape }

    deinit {
        // 页面被销毁（正常退出）时停服；进程被杀时服务端随进程一起消失（它是进程内的静态库）
        NotificationCenter.default.removeObserver(self)
    }

    override func viewDidLoad() {
        // 只有**真正终止**才停；切后台保留（否则看一眼消息就把队友断了）
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(stopHostServer),
            name: UIApplication.willTerminateNotification,
            object: nil
        )
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.043, green: 0.059, blue: 0.078, alpha: 1)

        guard let files = BundleVault.open() else {
            // 解不开 = 不是我们的包（或包被动过）。没有降级分支。
            showFatal()
            return
        }

        do {
            let server = try LocalServer(files: files, preferredPort: Self.preferredPort)
            self.server = server
            Task { @MainActor in
                do {
                    let port = try await server.start()
                    self.startWebView(port: port)
                } catch {
                    self.showFatal()
                }
            }
        } catch {
            showFatal()
        }
    }

    private func startWebView(port: UInt16) {
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        // 存档全靠 WebView 的站点数据目录
        configuration.websiteDataStore = .default()

        let webView = WKWebView(frame: view.bounds, configuration: configuration)
        // 用约束而不是 autoresizing：旋转后 autoresizing 有时不会把 frame 重新撑满，
        // 表现是横屏下内容只占一部分、旁边留黑边
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.bounces = false
        // 预设 UA：设备默认 UA 在模拟器/不同机型上差异大，预设更稳；末尾带触屏标记
        webView.customUserAgent =
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
            + "AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 \(Self.touchMarker)"
        if #available(iOS 16.4, *) {
            webView.isInspectable = false
        }

        /*
         * 宿主桥（2026-10-30）：iOS 没有 `addJavascriptInterface`，WKWebView 也不能同步调原生。
         * 但 `prompt()` 在 WebKit 里是**同步**的——JS 会一直等到代理返回。
         * 于是用 `prompt('minicraft-bridge', '<命令>')` 当同步通道，注入一个与 Android
         * `window.MinicraftAndroid` **同形状**的对象，网页侧一行都不用改。
         */
        webView.uiDelegate = self
        // 只在 debug 构建里打一次桥的自检日志：release 不需要，也不该把局域网 IP 写进系统日志
        #if DEBUG
        webView.navigationDelegate = self
        #endif
        let bridge = WKUserScript(source: Self.bridgeScript, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        webView.configuration.userContentController.addUserScript(bridge)

        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
        self.webView = webView

        guard let url = URL(string: "http://127.0.0.1:\(port)/index.html") else {
            showFatal()
            return
        }
        webView.load(URLRequest(url: url))
    }

    #if DEBUG
    /// 调试自检：页面加载完确认桥真的注入了（iOS 没有 CDP，只能靠日志看）
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        webView.evaluateJavaScript(
            "typeof window.MinicraftAndroid + '|' + (window.MinicraftAndroid ? window.MinicraftAndroid.localIp() : '-')"
        ) { value, error in
            NSLog("[bridge] 自检：%@ %@", String(describing: value), String(describing: error))
        }

        /*
         * 开房链路自检：只有在启动时显式给了 `MINICRAFT_SELFTEST=1` 才跑，
         * 免得每次 debug 启动都白起一个服务端。
         *   xcrun simctl launch --setenv MINICRAFT_SELFTEST=1 booted com.minicraft.app
         */
        guard ProcessInfo.processInfo.environment["MINICRAFT_SELFTEST"] == "1" else { return }
        webView.evaluateJavaScript("window.MinicraftAndroid.startServer()") { _, _ in }
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
            webView.evaluateJavaScript("window.MinicraftAndroid.serverPort()") { value, _ in
                NSLog("[bridge] 开房自检 端口=%@", String(describing: value))
                webView.evaluateJavaScript("window.MinicraftAndroid.stopServer()") { _, _ in }
            }
        }
    }
    #endif

    // MARK: - 宿主桥（与 Android 的 JsHostBridge 一一对应）

    /// 注入到网页的桥。必须 ES5：老 iOS 上也要能解析
    private static let bridgeScript = """
    (function () {
      if (window.MinicraftAndroid) return;
      function call(cmd) {
        try { return window.prompt('minicraft-bridge', cmd); } catch (e) { return null; }
      }
      window.MinicraftAndroid = {
        localIp: function () { return call('mc:localIp'); },
        serverPort: function () { return call('mc:serverPort'); },
        startServer: function () { return call('mc:startServer'); },
        stopServer: function () { return call('mc:stopServer'); }
      };
    })();
    """

    /// 联机服务端的存档目录（与 Android 的 `filesDir/world` 同语义）
    private var worldDirectory: URL {
        let base = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("world", isDirectory: true)
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptTextInputPanelWithPrompt prompt: String,
        defaultText: String?,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (String?) -> Void
    ) {
        // 不是我们的桥调用（页面自己弹的 prompt）就原样放行
        guard prompt == "minicraft-bridge" else {
            completionHandler(nil)
            return
        }
        completionHandler(handleBridge(defaultText ?? ""))
    }

    private func handleBridge(_ command: String) -> String {
        switch command {
        case "mc:localIp":
            guard let ip = Self.localIPv4() else { return "{\"ip\":null}" }
            return "{\"ip\":\"\(ip)\"}"
        case "mc:serverPort":
            return "{\"port\":\(NativeServer.port)}"
        case "mc:startServer":
            /*
             * 立刻返回、后台绑端口：`minicraft_start_server` 最多阻塞 3 秒，
             * 而这是 JS 线程的同步调用——在这里等就是把整页卡死。
             * 网页侧本来就在轮询 `serverPort()`，时序与 Android 完全一致。
             */
            let dir = worldDirectory
            DispatchQueue.global(qos: .userInitiated).async {
                let port = NativeServer.start(dataDirectory: dir, port: 0, seed: 0, beacon: true)
                NSLog("[host] 服务端启动，端口 %d", port)
            }
            return "{\"started\":true}"
        case "mc:stopServer":
            DispatchQueue.global(qos: .userInitiated).async {
                NativeServer.stop()
            }
            return "{\"stopped\":true}"
        default:
            return "{\"error\":\"unknown\"}"
        }
    }

    /// 本机局域网 IPv4（跳过回环与链路本地），拿不到返回 nil
    private static func localIPv4() -> String? {
        var head: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&head) == 0, let first = head else { return nil }
        defer { freeifaddrs(head) }
        var result: String?
        for pointer in sequence(first: first, next: { $0.pointee.ifa_next }) {
            let flags = Int32(pointer.pointee.ifa_flags)
            guard flags & IFF_UP != 0, flags & IFF_LOOPBACK == 0 else { continue }
            guard let addr = pointer.pointee.ifa_addr, addr.pointee.sa_family == UInt8(AF_INET) else { continue }
            var buffer = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            let length = socklen_t(addr.pointee.sa_len)
            if getnameinfo(addr, length, &buffer, socklen_t(buffer.count), nil, 0, NI_NUMERICHOST) == 0 {
                let ip = String(cString: buffer)
                if !ip.hasPrefix("169.254.") { result = ip; break }
            }
        }
        return result
    }

    @objc private func stopHostServer() {
        NativeServer.stop()
    }

    private func showFatal() {
        let label = UILabel()
        label.text = "游戏内容校验失败\n请从 App Store 重新安装"
        label.numberOfLines = 0
        label.textAlignment = .center
        label.textColor = .white
        label.font = .systemFont(ofSize: 16)
        label.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(label)
        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            label.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            label.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 24),
        ])
    }
}
