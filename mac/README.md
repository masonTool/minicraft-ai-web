# macOS 版

Electron 套壳。运行时逻辑与 Windows 共用 [`desktop/`](../desktop/README.md)，本目录只放 macOS 特有的打包配置。

## 出包

见 [`docs/BUILD-GUIDE.md`](../docs/BUILD-GUIDE.md)。一句话：

```bash
npm run build:mac     # 未签名 dmg（本地自用）
npm run release:mac   # 签名 dmg（需 CSC_LINK + CSC_KEY_PASSWORD）
```

脚本 `mac/build.sh`；产物在 `dist/mac/`（arm64 + x64 两个 dmg）。

## 签名的实际作用（别想多了）

**macOS 的代码签名只管"系统信不信任这个 app"，不参与解密。**

桌面端的钥匙来自安装包里的 `Resources/rt/signers.json`（打包时写入的公开摘要），
`desktop/bundle.mjs` 拿它派生 KEK 解开整包——和开发者证书完全无关。

所以：

| 想达到的效果 | 靠什么 |
| --- | --- |
| 用户双击不被 Gatekeeper 拦 | `CSC_LINK` 签名 + （可选）公证 |
| 防止别人改包后还能拿到内容 | **做不到**。摘要写在包里，改包的人照样能解 |

这也是文档里把桌面端强度标成"中"的原因（见 [`docs/CODE-PROTECTION.md`](../docs/CODE-PROTECTION.md) §3）。

> 早期版本曾用 Team ID 做过身份判定，那套逻辑（`core-vault.mjs`）已被
> `bundle.mjs` 的签名摘要方案取代，`release.config.json` 里的 `macTeamId` 字段也一并删除。

## 文件

| 文件 | 作用 |
| --- | --- |
| `build.sh` | 出包脚本（dev / release） |
| `electron-builder.yml` | 打包配置（`extraResources` 从 `build/rt` 取密文） |
| `entitlements.mac.plist` | hardened runtime 例外 + 联机网络权限 |
| `build/icon.png` | 图标（electron-builder 自动转 icns） |
