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
 * ⚠️ 首页副标题已于批次 20261024-0223 **删除**（用户要求），首页只留品牌名一行。
 */

/** 品牌名（首页大字、manifest、页面标题、商店标题共用） */
export const BRAND = 'Minicraft';

/**
 * ⚠️ **首页副标题已删**（批次 20261024-0223，用户要求）。
 *
 * 原来的副标题是「基岩版 1.18 · WEB EDITION」：先被要求去掉「基岩版」，这次连
 * `1.18 · WEB EDITION` 一起去掉 —— 首页只留品牌名一行，不再报版本号。
 *
 * 版本号仍然存在于三处（`package.json`、`public/manifest*.webmanifest` 的描述、
 * `docs/store/` 的文案），所以"这是 1.18 的复刻"这件事没有丢，只是不摆在首页最显眼处。
 */
export const BRAND_EDITION = '';
