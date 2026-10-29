import UIKit
import WebKit

/// iOS 壳：起一个只监听回环的 HTTP 服务，把**内存里解密出来的**游戏内容喂给 WKWebView。
///
/// 三端一致的部分：内容都是整包加密的 `libmcrt.so`，解密后才交给 WebView，
/// 磁盘上没有明文；页面 origin 都是 `localhost` 类可信来源。
/// 不一致的部分只有实现手段：Android 用 `shouldInterceptRequest` 拦截，
/// iOS 拦不了 http(s)（WebKit 保留），只能起回环服务。
final class MinicraftViewController: UIViewController {

    /// 固定端口：换端口 = 换 origin，IndexedDB 里就是一份全新的存档
    private static let preferredPort: UInt16 = 18765
    /// 与 Android 的 `MainActivity` 同一个标记，网页据此走触屏界面
    private static let touchMarker = "MinicraftTouch/1"

    private var webView: WKWebView?
    private var server: LocalServer?

    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .landscape }

    override func viewDidLoad() {
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
