import Capacitor
import UIKit

/// 把 `CoreVaultPlugin` 注册进桥。
///
/// Capacitor 6 的自定义插件要显式注册：`CAPBridgeViewController` 默认只加载
/// `capacitor.config.json` 里列出的包，而 `CoreVault` 是本工程内的类，没有包。
/// Storyboard 里的视图控制器已经改成这个类（见 `Base.lproj/Main.storyboard`）。
final class MinicraftViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(CoreVaultPlugin())
        /*
         * 关掉 Safari Web Inspector（iOS 16.4+）。
         *
         * 这是 iOS 上最省事的内存 dump 入口：连着 Mac 就能直接看 JS 变量，
         * 而解封后的方块表必然在 JS 侧的注册表里。debug 构建保留（要能调试）。
         */
        if !isDebugBuild, #available(iOS 16.4, *) {
            webView?.isInspectable = false
        }
    }

    /// 用编译条件判 debug，不读 Info.plist：打包后 plist 可被改
    private var isDebugBuild: Bool {
        #if DEBUG
            return true
        #else
            return false
        #endif
    }
}
