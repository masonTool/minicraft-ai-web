/**
 * 品牌名的**唯一真值**（批次 20261024-0136）。
 *
 * 为什么单独一个文件：品牌名散在五处互不相干的落点 ——
 * `public/manifest*.webmanifest`（六份）、`index.html` 的 `<title>`、
 * `docs/store/` 六份标题、`README.md` 首行、以及**首页那行大字**（`ui/WorldScreen.ts`）。
 *
 * 改名时改这里 + manifest 基准那一份，其余靠脚本派生或断言兜住：
 *  · manifest 的五份由 `npm run gen:manifests` 从中文那份派生；
 *  · 商店文案 / 页面标题 / README 由 `test:i18n` 的「品牌一致性」断言盯着（跨文件比对同一真值）。
 *
 * ⚠️ 首页那行**不要**接进语言表：品牌名不随界面语言变化（`Minicraft` 在六种语言里都是它）。
 * 副标题（`1.18 · WEB EDITION`）同理 —— 它是版本身份，不是界面文案。
 */

/** 品牌名（首页大字、manifest、页面标题、商店标题共用） */
export const BRAND = 'Minicraft';

/**
 * 首页副标题。
 *
 * ⚠️ 原来这里是「基岩版 1.18 · WEB EDITION」：用户明确要求**去掉「基岩版」字样**
 * （那是 Mojang 的版本命名，本项目是独立的浏览器实现，不该借用）。
 * 版本号 `1.18` 保留 —— 它说明复刻的是哪个版本的规则与内容。
 */
export const BRAND_EDITION = '1.18 · WEB EDITION';
