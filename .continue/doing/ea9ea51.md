# 队列 · 会话 ea9ea51

> 状态：执行中
> 创建：2026-10-29
> 批次：20261029-1600

- [x] [A22] 多产品目录重排：`src/ index.html public/ vite.config.ts` 迁入 `web/`，`server/android` 迁到 `android/`，补 `ios/ windows/ mac/` 说明 → `npm run check` 全绿 + `build:fast` 出包
  - 做了什么：`git mv` 四个路径进 `web/`、`server/android` 提到根；`tools`/`tests` 的 `../src`、`../public`、`index.html` 引用批量改向；`tsconfig` 两份 include、`vite.config.ts`（`root: WEB_ROOT` + `REPO_ROOT` 锚定 `.tmp`）、`release-check` 的 `DIST`/`index.html`、`capacitor.config.json` 的 `webDir`/`android.path`、Gradle 的 `repoRoot` 与 `capacitor.settings.gradle` 一起改
  - 为什么：一仓多产物，Web 的入口/资源/配置自成一目录；Android 壳不该埋在 `server/` 里（它消费的是 `web/dist`，不是服务端）
  - 验证：`npm run check` 全绿（离线 **181** 套、单测 153 套 1579 条）、`npm run build:fast` 产物落 `web/dist`、`typecheck` + `typecheck:tools` 清洁
  - 批次：20261029-1600
- [ ] [A23] 安卓签名闸门与核心数据封存：`sealed/core.sealed` + 原生解封 + `shouldInterceptRequest` 精确拦截 → 改签包进不去
- [ ] [A23] iOS 侧对等：`ios/` 骨架说明 + Swift scheme handler + 签名校验接入点
- [ ] [A22] 文档落地：`README.md` / `AGENTS.md` / `docs/` 按新目录更新 → `npm run audit:docs` 全绿
