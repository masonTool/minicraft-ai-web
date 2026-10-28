# Windows 版

Electron 套壳，运行时逻辑与 macOS 共用 [`desktop/`](../desktop/README.md)；
本目录只放 **Windows 特有的打包配置与资源**。

## 出包

```bash
npm run win:dist
# = gen:sealed → build:app（含发布检查）→ electron-builder --win
# → dist/windows/Minicraft Setup 0.1.0.exe
```

> macOS 上也能出 NSIS 安装包（electron-builder 会自动下载 wine），
> 但**产物没在 Windows 上跑过**。正式发版请走 Windows 机器或 Windows CI。

| 文件 | 作用 |
| --- | --- |
| `electron-builder.yml` | 打包配置（NSIS、x64、资源拷贝） |
| `build/icon.png` | 应用图标（自动转 ico） |

## 签名

```bash
export CSC_LINK=~/keys/minicraft-win.pfx
export CSC_KEY_PASSWORD='…'
npm run win:dist
```

签名后把证书指纹填进 `release.config.json` 的 `winCertThumbprint`：

```powershell
(Get-AuthenticodeSignature 'Minicraft.exe').SignerCertificate.Thumbprint
```

再跑 `npm run gen:sealed`。判定规则与 macOS 一致（见 [`mac/README.md`](../mac/README.md#签名)），
不填就是"未签名能开、带别人签名就拒绝"。

## 已验证 / 未验证

- ✅ 能在 macOS 上完整生成 `Minicraft Setup 0.1.0.exe`（79 MB），`resources/` 里有 `app.asar` / `web` / `sealed`；
- ❌ 未在 Windows 上安装运行过——`app://` 协议、IndexedDB 存档、WebGL2 这几条都需要实机确认。
