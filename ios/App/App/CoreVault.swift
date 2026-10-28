import CryptoKit
import Foundation
import Security

/// 核心数据保险柜（iOS 侧，与 Android 的 `CoreVault.java` 同一份格式）。
///
/// 顺序与 Android 完全一致：**先验签名身份，再解封**。任何一步失败都返回 `nil`，
/// 上层据此走既有的"请从 App Store 安装"路径——不存在"提示后继续"的分支。
///
/// ⚠️ 边界与 Android 相同：`signers.txt` 里的团队标识是公开信息，KEK 不是
/// "只有 Apple 私钥才能算"的密码学锁；挡住改包重签的是这里的身份比对。
enum CoreVault {

    private static let info = Data("minicraft/core/v1".utf8)
    private static let sealedVersion: UInt8 = 2
    private static let nonceLength = 12
    private static let tagLength = 16
    private static let sealedAsset = "sealed/core.sealed"
    private static let bundleAsset = "sealed/bundle.txt"
    private static let signersAsset = "sealed/signers.txt"
    private static let saltAsset = "sealed/salt.bin"

    /// 解封核心数据；签名不符 / 文件缺失 / 校验失败一律 `nil`。
    static func unseal() -> Data? {
        guard isSignedByUs(), let sealed = readAsset(sealedAsset),
              let salt = readAsset(saltAsset), salt.count == 32,
              let signerHex = expectedSigner(), let signer = hexToData(signerHex)
        else { return nil }
        defer { /* sealed 是值类型，交给 ARC；不留全局引用 */ }
        return open(sealed: sealed, signer: signer, salt: salt)
    }

    // MARK: - 签名身份

    /// 当前安装身份是否是我们自己。
    ///
    /// ⚠️ **iOS 没有读取自身代码签名身份的公开 API**（`SecCodeCopySelf` 那套是 macOS 的，
    /// iOS SDK 里根本不存在）。所以这里能做的是"绑 bundle id"：把构建期写死的
    /// `bundle.txt` 与运行时 `Bundle.main.bundleIdentifier` 比对。
    ///
    /// 这挡住的是"改包名重新打包再分发"；挡不住"同一个 bundle id 换证书重签"——
    /// 但后者在 iOS 上只能靠越狱或企业证书安装，系统本身已经是第一道防线。
    /// 这也是纯客户端项目在 iOS 上的真实上限，别把它当成 Android 那种证书比对。
    static func isSignedByUs() -> Bool {
        guard let expected = expectedBundleId(), !expected.isEmpty else { return false }
        return Bundle.main.bundleIdentifier == expected
    }

    private static func expectedBundleId() -> String? {
        guard let data = readAsset(bundleAsset), let text = String(data: data, encoding: .utf8) else { return nil }
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? nil : value
    }

    /// KEK 的 ikm 来源。两个平台共用同一份 `signers.txt`（Android 的证书摘要），
    /// 否则同一份 `core.sealed` 在 iOS 上解不开——这里读它是为了密码学一致性，
    /// **不是**身份判据（iOS 的身份判据是上面的 bundle id）。
    private static func expectedSigner() -> String? {
        guard let data = readAsset(signersAsset), let text = String(data: data, encoding: .utf8) else { return nil }
        for line in text.split(separator: "\n") {
            let value = line.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ":", with: "")
            if !value.isEmpty { return value }
        }
        return nil
    }

    // MARK: - 解封

    private static func open(sealed: Data, signer: Data, salt: Data) -> Data? {
        var offset = 0
        func take(_ count: Int) -> Data? {
            guard offset + count <= sealed.count else { return nil }
            let slice = sealed.subdata(in: offset..<(offset + count))
            offset += count
            return slice
        }

        guard let head = take(2), head[0] == sealedVersion, head[1] >= 1 else { return nil }
        let wrapCount = Int(head[1])
        guard let permKData = take(2), let plainLenData = take(4), take(2) != nil else { return nil }
        let permK = Int(u16(permKData))
        let plainLen = Int(u32(plainLenData))
        let header = sealed.subdata(in: 0..<offset)
        guard let nonceData = take(nonceLength) else { return nil }

        // v2：每个允许的签名各一份包裹。iOS 拿不到自身签名摘要，用 signers.txt[0]
        // 派生 KEK；与它对应的那份包裹能打开，其余打不开。
        guard let kek = deriveKek(salt: salt, signer: signer) else { return nil }
        let wrapAad = header + nonceData

        var cek: Data?
        for _ in 0..<wrapCount {
            guard let wrapLenData = take(2), let wrapped = take(Int(u16(wrapLenData))) else { return nil }
            if cek == nil {
                cek = aesGcmOpen(key: kek, nonce: nonceData, aad: wrapAad, box: wrapped)
            }
        }
        let wrapEnd = offset
        guard let unwrapped = cek,
              let payloadLenData = take(4),
              let payload = take(Int(u32(payloadLenData)))
        else { return nil }
        let payloadAad = sealed.subdata(in: 0..<wrapEnd)
        guard let transformed = aesGcmOpen(key: SymmetricKey(data: unwrapped), nonce: nonceData, aad: payloadAad, box: payload),
              transformed.count == plainLen
        else { return nil }

        // 形态逆变换：plain[(i * k) % n] = transformed[i]
        let n = transformed.count
        var plain = Data(count: n)
        var position = 0
        for index in 0..<n {
            plain[position] = transformed[index]
            position = (position + permK) % n
        }
        return plain
    }

    // MARK: - 密码学

    private static func deriveKek(salt: Data, signer: Data) -> SymmetricKey? {
        let ikm = signer + salt
        return HKDF<SHA256>.deriveKey(
            inputKeyMaterial: SymmetricKey(data: ikm),
            salt: salt,
            info: info,
            outputByteCount: 32
        )
    }

    private static func aesGcmOpen(key: SymmetricKey, nonce: Data, aad: Data, box: Data) -> Data? {
        guard box.count > tagLength,
              let nonceValue = try? AES.GCM.Nonce(data: nonce)
        else { return nil }
        let body = box.prefix(box.count - tagLength)
        let tag = box.suffix(tagLength)
        guard let sealedBox = try? AES.GCM.SealedBox(nonce: nonceValue, ciphertext: body, tag: tag),
              let opened = try? AES.GCM.open(sealedBox, using: key, authenticating: aad)
        else { return nil }
        return opened
    }

    // MARK: - 工具

    /// 读包内资源。`sealed` 是以**文件夹引用**加进 target 的（与 `public` 同样处理），
    /// 所以在 bundle 里是 `App.app/sealed/core.sealed`，要按 "子目录 + 文件名" 取。
    private static func readAsset(_ path: String) -> Data? {
        if let direct = Bundle.main.url(forResource: path, withExtension: nil),
           let data = try? Data(contentsOf: direct) {
            return data
        }
        let full = path as NSString
        let directory = full.deletingLastPathComponent
        let file = full.lastPathComponent as NSString
        guard let url = Bundle.main.url(
            forResource: file.deletingPathExtension,
            withExtension: file.pathExtension,
            subdirectory: directory.isEmpty ? nil : directory
        ) else { return nil }
        return try? Data(contentsOf: url)
    }

    private static func u16(_ data: Data) -> UInt16 {
        data.withUnsafeBytes { $0.loadUnaligned(as: UInt16.self) }
    }

    private static func u32(_ data: Data) -> UInt32 {
        data.withUnsafeBytes { $0.loadUnaligned(as: UInt32.self) }
    }

    private static func hexToData(_ hex: String) -> Data? {
        let clean = hex.replacingOccurrences(of: ":", with: "")
        guard clean.count % 2 == 0 else { return nil }
        var out = Data(capacity: clean.count / 2)
        var index = clean.startIndex
        while index < clean.endIndex {
            let next = clean.index(index, offsetBy: 2)
            guard let byte = UInt8(clean[index..<next], radix: 16) else { return nil }
            out.append(byte)
            index = next
        }
        return out
    }
}
