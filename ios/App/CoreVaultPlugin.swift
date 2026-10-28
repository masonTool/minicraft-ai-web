import Capacitor
import Foundation

/// 把解封后的核心数据交给网页：`Capacitor.Plugins.CoreVault.read()`。
///
/// 与 Android 的 `CoreVaultPlugin.java` 一一对应：签名不符时直接 reject，
/// 页面落到"请从 App Store 安装"的路径。返回值用 base64，避免跨桥传二进制数组。
@objc(CoreVaultPlugin)
public class CoreVaultPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "CoreVaultPlugin"
    public let jsName = "CoreVault"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise)
    ]

    @objc func read(_ call: CAPPluginCall) {
        guard let data = CoreVault.unseal(), !data.isEmpty else {
            // 不区分"签名不符 / 数据坏了 / 没打包"
            call.reject("core unavailable")
            return
        }
        call.resolve(["data": data.base64EncodedString()])
    }
}
