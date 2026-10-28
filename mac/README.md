# macOS 版

Electron 套壳，运行时逻辑与 Windows 共用 [`desktop/`](../desktop/README.md)；
本目录只放 **macOS 特有的打包配置与资源**。

## 出包

```bash
npm run mac:dist
# = gen:sealed → build:app（含发布检查）→ electron-builder --mac
# → dist-mac/Minicraft-0.1.0-arm64.dmg · dist-mac/Minicraft-0.1.0.dmg
```

| 文件 | 作用 |
| --- | --- |
| `electron-builder.yml` | 打包配置（appId / 目标 / 资源拷贝 / dmg 布局） |
| `entitlements.mac.plist` | hardened runtime 必需的三项例外 + 联机所需网络权限 |
| `build/icon.png` | 应用图标（1024×1024，electron-builder 自动转 icns） |

## 签名

```bash
export CSC_LINK=~/keys/minicraft-mac.p12
export CSC_KEY_PASSWORD='…'
npm run mac:dist
```

签名后把 Team ID 填进 `release.config.json` 的 `macTeamId`，再跑一次
`npm run gen:sealed`（`mac:dist` 会自己跑）。**不填的后果**：

| 情况 | 结果 |
| --- | --- |
| 未填 + 未签名（本地自用） | 能开（没证书也要能开发） |
| 未填 + 有签名 | 拒绝——没配置却带着别人的签名，就是改包重签 |
| 填了 + 未签名 | 拒绝——正式包被剥掉签名 |
| 填了 + 签名一致 | 正常 |

拒绝的表现是**拿不到核心数据**（方块表解不开 → 停在"去应用里玩"），不是弹窗。

## 公证（可选）

直分发不上架 App Store 时，未公证的包首次打开要右键「打开」。
要免这一步就配置 `notarize`（需要 Apple ID 应用专用密码 / API Key），
并在 `electron-builder.yml` 里把 `notarize: false` 改掉。

## 已验证 / 未验证

- ✅ 打包产物 `Minicraft.app` 冒烟通过：页面加载 + 通过 `app://minicraft/__host/core.bin` 解出 41107 B 方块表；
- ✅ 包内 `Resources/sealed/` 有封存体，`Resources/web/` 只有 JS（无明文方块表，探针 `minicraft:amethyst_cluster` 为 0）；
- ❌ 未做签名/公证后的真机安装验证（本机没有 Apple Developer 证书）。
