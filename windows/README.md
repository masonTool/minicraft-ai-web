# Windows 版

Electron 套壳。运行时逻辑与 macOS 共用 [`desktop/`](../desktop/README.md)，本目录只放 Windows 特有的打包配置。

## 出包

见 [`docs/BUILD-GUIDE.md`](../docs/BUILD-GUIDE.md)。一句话：

```bash
npm run build:win     # 未签名 exe
npm run release:win   # 签名 exe（需 CSC_LINK + CSC_KEY_PASSWORD）
```

脚本 `windows/build.sh`；产物在 `dist/windows/`。

> ⚠️ **NSIS 目标不能在 macOS 上出**（需要 wine）。`build:win` 会先检查并在缺失时
> 直接告诉你该去哪跑，而不是甩一堆 wine 堆栈。正式发版走 Windows 机器或 Windows CI。

## 签名判定

签名后把证书指纹填进 `release.config.json` 的 `winCertThumbprint`：

```powershell
(Get-AuthenticodeSignature 'Minicraft.exe').SignerCertificate.Thumbprint
```

判定规则与 macOS 完全一致（见 [`mac/README.md`](../mac/README.md#签名判定)）：
不填就是"未签名能开、带别人签名就拒绝"。

## 文件

| 文件 | 作用 |
| --- | --- |
| `build.sh` | 出包脚本（dev / release，含 wine 检查） |
| `electron-builder.yml` | 打包配置（NSIS、x64、`extraResources` 从 `build/rt` 取密文） |
| `build/icon.png` | 图标（自动转 ico） |
