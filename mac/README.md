# macOS 版

Electron 套壳。运行时逻辑与 Windows 共用 [`desktop/`](../desktop/README.md)，本目录只放 macOS 特有的打包配置。

## 出包

见 [`docs/BUILD-GUIDE.md`](../docs/BUILD-GUIDE.md)。一句话：

```bash
npm run build:mac     # 未签名 dmg（本地自用）
npm run release:mac   # 签名 dmg（需 CSC_LINK + CSC_KEY_PASSWORD）
```

脚本 `mac/build.sh`；产物在 `dist/mac/`（arm64 + x64 两个 dmg）。

## 签名判定

把 Team ID 填进 `release.config.json` 的 `macTeamId` 之后才有意义：

| 配置 | 签名 | 结果 |
| --- | --- | --- |
| 没填 | 没签（本地自用） | ✅ 能开 |
| 没填 | 有别人的签名 | ❌ 拒绝（等于改包重签） |
| 填了 | 没签 | ❌ 拒绝（正式包被剥了签名） |
| 填了 | 一致 | ✅ 正常 |

拒绝的表现是**拿不到核心数据**（停在"请去应用里玩"），不是弹窗。

因此 `build:mac` 会主动关掉签名自动发现（`--config.mac.identity=null`）：
本机若装了自己的开发者证书，自动签名反而会造出"没配置却带签名"的组合。

## 文件

| 文件 | 作用 |
| --- | --- |
| `build.sh` | 出包脚本（dev / release） |
| `electron-builder.yml` | 打包配置（`extraResources` 从 `build/rt` 取密文） |
| `entitlements.mac.plist` | hardened runtime 例外 + 联机网络权限 |
| `build/icon.png` | 图标（electron-builder 自动转 icns） |
