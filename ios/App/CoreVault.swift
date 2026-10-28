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
    private static let sealedVersion: UInt8 = 1
    private static let nonceLength = 12
    private static let tagLength = 16
    private static let sealedAsset = "sealed/core.sealed"
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

    /// 当前可执行文件的团队标识是否命中白名单（`signers.txt` 一行一个）。
    static func isSignedByUs() -> Bool {
        guard let expected = expectedSigner().map({ $0.lowercased() }) else { return false }
        guard let team = currentTeamIdentifier()?.lowercased() else { return false }
        return expected == team
    }

    private static func expectedSigner() -> String? {
        guard let data = readAsset(signersAsset), let text = String(data: data, encoding: .utf8) else { return nil }
        for line in text.split(separator: "\n") {
            let value = line.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ":", with: "")
            if !value.isEmpty { return value }
        }
        return nil
    }

    /// 取自身签名信息里的 team identifier；未签名 / 被重签都会在这里体现。
    private static func currentTeamIdentifier() -> String? {
        var code: SecCode?
        guard SecCodeCopySelf([], &code) == errSecSuccess, let selfCode = code else { return nil }
        var staticCode: SecStaticCode?
        guard SecCodeCopyStaticCode(selfCode, [], &staticCode) == errSecSuccess, let stat = staticCode else { return nil }
        var info: CFDictionary?
        let flags = SecCSFlags(rawValue: kSecCSSigningInformation)
        guard SecCodeCopySigningInformation(stat, flags, &info) == errSecSuccess,
              let dict = info as? [String: Any],
              let team = dict[kSecCodeInfoTeamIdentifier as String] as? String
        else { return nil }
        return team
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

        guard let head = take(2), head[0] == sealedVersion, head[1] == 1 else { return nil }
        guard let permKData = take(2), let plainLenData = take(4), take(2) != nil else { return nil }
        let permK = Int(u16(permKData))
        let plainLen = Int(u32(plainLenData))
        let header = sealed.subdata(in: 0..<offset)
        guard let nonceData = take(nonceLength) else { return nil }

        guard let wrapLenData = take(2), let wrapped = take(Int(u16(wrapLenData))) else { return nil }
        let wrapEnd = offset
        let wrapAad = header + nonceData

        guard let kek = deriveKek(salt: salt, signer: signer),
              let cek = aesGcmOpen(key: kek, nonce: nonceData, aad: wrapAad, box: wrapped)
        else { return nil }

        guard let payloadLenData = take(4), let payload = take(Int(u32(payloadLenData))) else { return nil }
        let payloadAad = sealed.subdata(in: 0..<wrapEnd)
        guard let transformed = aesGcmOpen(key: cek, nonce: nonceData, aad: payloadAad, box: payload),
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

    private static func readAsset(_ path: String) -> Data? {
        guard let url = Bundle.main.url(forResource: path, withExtension: nil) else { return nil }
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
