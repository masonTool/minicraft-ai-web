import Compression
import CryptoKit
import Foundation

/// 整包解密：`libmcrt.so`（伪装成原生库的加密包）→ 内存里的"路径 → 字节"表。
///
/// 与 `tools/pack-bundle.ts`、Android 的 `BundleVault.java`、桌面端的 `desktop/bundle.mjs`
/// 是**同一份格式**：
///
///     假 ELF 头(8) | 版本/编码/包裹数(4) | 盐(32) | nonce(12)
///     | N × (长度 + 包裹的 CEK) | u32 密文长度 | 整段密文
///
/// ⚠️ iOS 的结构性短板：**没有公开 API 能读到自己安装包的签名**（`SecCodeCopySelf` 是
/// macOS 的）。所以这里只能用打包时写进 `signers.json` 的摘要——它是公开信息，
/// 读懂代码的人可以离线解出内容。iOS 真正的防线是系统签名 + App Store 审核，
/// 客户端补不了这一层。
enum BundleVault {

    private static let fakeElf: [UInt8] = [0x7f, 0x45, 0x4c, 0x46, 0, 0, 0, 0]
    private static let info = Data("minicraft/bundle/v1".utf8)
    private static let version: UInt8 = 1
    private static let codecGzip: UInt8 = 1
    private static let tagLength = 16
    private static let nonceLength = 12

    /// 解不开就返回 nil：调用方一律按"没有游戏内容"处理，没有降级分支。
    static func open() -> [String: Data]? {
        guard let pkgURL = Bundle.main.url(forResource: "libmcrt", withExtension: "so"),
              let pkg = try? Data(contentsOf: pkgURL),
              let signer = configuredSigner()
        else { return nil }
        return decrypt(pkg: pkg, signerHex: signer)
    }

    /// 打包时写入的签名摘要（`signers.json` 的第一条）
    private static func configuredSigner() -> String? {
        guard let url = Bundle.main.url(forResource: "signers", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let list = object["signers"] as? [String],
              let first = list.first
        else { return nil }
        return first
    }

    private static func decrypt(pkg: Data, signerHex: String) -> [String: Data]? {
        guard pkg.count > 128 else { return nil }
        guard Array(pkg.prefix(8)) == fakeElf else { return nil }

        var cursor = 8
        let head = pkg.subdata(in: cursor..<(cursor + 4))
        cursor += 4
        guard head[head.startIndex] == version, head[head.startIndex + 1] == codecGzip else { return nil }
        let wrapCount = Int(head[head.startIndex + 2])
        guard wrapCount >= 1 else { return nil }

        let salt = pkg.subdata(in: cursor..<(cursor + 32)); cursor += 32
        let nonce = pkg.subdata(in: cursor..<(cursor + nonceLength)); cursor += nonceLength
        let wrapAad = head + salt + nonce

        guard let kek = deriveKek(salt: salt, signerHex: signerHex) else { return nil }

        var cek: Data?
        for _ in 0..<wrapCount {
            guard cursor + 2 <= pkg.count else { return nil }
            let length = Int(u16(pkg, cursor)); cursor += 2
            guard length >= tagLength, cursor + length <= pkg.count else { return nil }
            if cek == nil {
                cek = aesGcmOpen(key: kek, nonce: nonce, aad: wrapAad, box: pkg.subdata(in: cursor..<(cursor + length)))
            }
            cursor += length
        }
        guard let unwrapped = cek, cursor + 4 <= pkg.count else { return nil }

        let bodyLength = Int(u32(pkg, cursor))
        let bodyStart = cursor + 4
        guard bodyLength > tagLength, bodyStart + bodyLength <= pkg.count else { return nil }

        // AAD 覆盖头部与全部包裹（不含假 ELF 头），与打包端一致
        let payloadAad = pkg.subdata(in: 8..<(bodyStart - 4))
        guard let compressed = aesGcmOpen(
            key: SymmetricKey(data: unwrapped),
            nonce: nonce,
            aad: payloadAad,
            box: pkg.subdata(in: bodyStart..<(bodyStart + bodyLength))
        ) else { return nil }

        guard let container = gunzip(compressed), container.count > 6 else { return nil }
        guard container.prefix(4) == Data("MCB1".utf8) else { return nil }

        let count = Int(u16(container, container.startIndex + 4))
        var q = container.startIndex + 6
        var paths: [String] = []
        var offsets: [Int] = []
        var lengths: [Int] = []
        for _ in 0..<count {
            let pathLength = Int(u16(container, q)); q += 2
            guard q + pathLength <= container.count else { return nil }
            paths.append(String(decoding: container.subdata(in: q..<(q + pathLength)), as: UTF8.self))
            q += pathLength
            offsets.append(Int(u32(container, q))); q += 4
            lengths.append(Int(u32(container, q))); q += 4
        }
        let dataStart = q

        var files: [String: Data] = [:]
        for index in 0..<count {
            let from = dataStart + offsets[index]
            let to = from + lengths[index]
            guard from >= dataStart, to <= container.count else { return nil }
            files[paths[index]] = container.subdata(in: from..<to)
        }
        return files
    }

    // MARK: - 密码学

    private static func deriveKek(salt: Data, signerHex: String) -> SymmetricKey? {
        guard let signer = hexToData(signerHex) else { return nil }
        let ikm = signer + salt
        return HKDF<SHA256>.deriveKey(
            inputKeyMaterial: SymmetricKey(data: ikm),
            salt: salt,
            info: info,
            outputByteCount: 32
        )
    }

    private static func aesGcmOpen(key: SymmetricKey, nonce: Data, aad: Data, box: Data) -> Data? {
        guard box.count > tagLength else { return nil }
        do {
            let sealed = try AES.GCM.SealedBox(
                nonce: AES.GCM.Nonce(data: nonce),
                ciphertext: box.dropLast(tagLength),
                tag: box.suffix(tagLength)
            )
            return try AES.GCM.open(sealed, using: key, authenticating: aad)
        } catch {
            return nil
        }
    }

    // MARK: - gzip

    /// 手工跳过 gzip 头，再用 `COMPRESSION_ZLIB`（raw deflate）解压。
    /// 不用系统 gzip 封装是因为 Foundation 没有公开的一行式 API。
    private static func gunzip(_ data: Data) -> Data? {
        let bytes = [UInt8](data)
        guard bytes.count > 18, bytes[0] == 0x1f, bytes[1] == 0x8b, bytes[2] == 0x08 else { return nil }
        let flags = bytes[3]
        var offset = 10
        if flags & 0x04 != 0 {
            guard offset + 2 <= bytes.count else { return nil }
            let extra = Int(bytes[offset]) | (Int(bytes[offset + 1]) << 8)
            offset += 2 + extra
        }
        if flags & 0x08 != 0 {
            while offset < bytes.count, bytes[offset] != 0 { offset += 1 }
            offset += 1
        }
        if flags & 0x10 != 0 {
            while offset < bytes.count, bytes[offset] != 0 { offset += 1 }
            offset += 1
        }
        if flags & 0x02 != 0 { offset += 2 }
        guard offset < bytes.count - 8 else { return nil }
        let payload = Data(bytes[offset..<(bytes.count - 8)])
        return inflateRaw(payload)
    }

    private static func inflateRaw(_ data: Data) -> Data? {
        // 输出大小未知：按压缩比的常见上限逐步放大，`0` 表示缓冲区不够
        var capacity = max(data.count * 8, 1 << 20)
        for _ in 0..<4 {
            var output = Data(count: capacity)
            let written = output.withUnsafeMutableBytes { out -> Int in
                guard let base = out.bindMemory(to: UInt8.self).baseAddress else { return 0 }
                return data.withUnsafeBytes { src -> Int in
                    guard let input = src.bindMemory(to: UInt8.self).baseAddress else { return 0 }
                    return compression_decode_buffer(base, capacity, input, data.count, nil, COMPRESSION_ZLIB)
                }
            }
            if written > 0 { return output.prefix(written) }
            capacity *= 2
        }
        return nil
    }

    // MARK: - 工具

    private static func u16(_ data: Data, _ offset: Int) -> UInt16 {
        let base = data.startIndex + offset
        return UInt16(data[base]) | (UInt16(data[base + 1]) << 8)
    }

    private static func u32(_ data: Data, _ offset: Int) -> UInt32 {
        let base = data.startIndex + offset
        return UInt32(data[base])
            | (UInt32(data[base + 1]) << 8)
            | (UInt32(data[base + 2]) << 16)
            | (UInt32(data[base + 3]) << 24)
    }

    private static func hexToData(_ hex: String) -> Data? {
        let clean = hex.replacingOccurrences(of: ":", with: "")
        guard clean.count == 64 else { return nil }
        var data = Data(capacity: 32)
        var index = clean.startIndex
        while index < clean.endIndex {
            let next = clean.index(index, offsetBy: 2)
            guard let byte = UInt8(clean[index..<next], radix: 16) else { return nil }
            data.append(byte)
            index = next
        }
        return data
    }
}
