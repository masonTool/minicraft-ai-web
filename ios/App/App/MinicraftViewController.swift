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
    }
}
