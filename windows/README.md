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

## 签名的实际作用

和 macOS 一样：**代码签名只影响系统信任（少一次 SmartScreen 拦截），不参与解密。**

桌面端的钥匙来自 `Resources/rt/signers.json`，与 Authenticode 证书无关。
早期版本里的 `winCertThumbprint` 判定已经随 `core-vault.mjs` 一起下线，
`release.config.json` 里不再有该字段。

## 文件

| 文件 | 作用 |
| --- | --- |
| `build.sh` | 出包脚本（dev / release，含 wine 检查） |
| `electron-builder.yml` | 打包配置（NSIS、x64、`extraResources` 从 `build/rt` 取密文） |
| `build/icon.png` | 图标（自动转 ico） |
