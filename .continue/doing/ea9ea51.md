# 队列 · 会话 ea9ea51

> 状态：执行中
> 创建：2026-10-29
> 批次：20261029-1600

- [x] [A22] 多产品目录重排：`src/ index.html public/ vite.config.ts` 迁入 `web/`，`server/android` 迁到 `android/`
  - 做了什么：`git mv` 四个路径进 `web/`、`server/android` 提到根；`tools`/`tests` 的 `../src`、`../public`、`index.html` 引用批量改向；`tsconfig` 两份 include、`vite.config.ts`（`root: WEB_ROOT` + `REPO_ROOT` 锚定 `.tmp`）、`release-check` 的 `DIST`/`index.html`、`capacitor.config.json`、Gradle 的 `repoRoot` 与 `capacitor.settings.gradle` 一起改
  - 为什么：一仓多产物，Web 的入口/资源/配置自成一目录；Android 壳不该埋在 `server/` 里（它消费 `web/dist`，不是服务端）
  - 验证：`npm run check` 全绿（离线 **181** 套、单测 153 套 1579 条）、`build:fast` 产物落 `web/dist`
  - 批次：20261029-1600
- [x] [A23] 安卓签名闸门与核心数据封存
  - 做了什么：新增 `tools/seal-core.ts`（AES-256-GCM 封存 + 与长度互质的形态变换，产物 `android/app/src/main/assets/sealed/{core.sealed,salt.bin,signers.txt}`）、`CoreVault.java`（验签名 → HKDF 派生 KEK → 解 CEK → 解载荷 → 逆变换，失败一律 null）、`CoreVaultPlugin.java`（`CoreVault.read()`，失败 reject）；`hostCore.ts` 先问原生保险柜、拿不到再走静态 URL；Gradle 去掉明文 `copyHostCore`、改为 `checkSealedCore`（缺封存体或残留明文都直接报错）；`release-check` 增加"无明文 / 非 MCTB / 白名单非占位 / 有 salt"四条断言
  - 为什么：明文 41 KB 方块表放 `assets/public` 等于白送；"改签包能不能跑"必须绑在**数据能不能解开**上，而不是一个可被 patch 的布尔判断
  - 验证：`npm run test:sealed` **15/0**（含换签名 / 换盐 / 改字节 / 截断 / 空白名单 5 条负面）；`gen:sealed` 产出 41.2 KB 封存体；`build:app` 在占位白名单上**按预期红**（证明门禁有效）；`npm run check` 全绿（离线 182 套）
  - 批次：20261029-1600
- [x] [A23] iOS 侧对等 + 三端说明文档
  - 做了什么：`ios/App/CoreVault.swift`（CryptoKit 版解封 + Team ID 校验）、`ios/App/CoreVaultPlugin.swift`；`ios/ windows/ mac/` 各一份 README；`docs/CODE-PROTECTION-STATUS.md` 记已落地 / 未做 / 两处偏离
  - 为什么：iOS 与 Android 共用同一份封存格式与同一套"验签名再解封"的顺序，但 Xcode 工程需要 `@capacitor/ios`，本机没装，先把源码与契约落下来
  - 验证：`typecheck` + `typecheck:tools` 清洁；Swift 侧待 Xcode 工程补齐后实测（状态文档已标注）
  - 批次：20261029-1600
