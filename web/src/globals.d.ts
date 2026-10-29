/**
 * 构建期注入的全局常量（由 `vite.config.ts` 的 `define` 替换）。
 * 声明放这里，`src` 下的 TS 才认这两个标识符。
 */
declare const __BUILD_COMMIT__: string;
declare const __BUILD_TIME__: string;

/**
 * 构建期注入：页面是否**必须**从宿主取 `core.bin` 才能跑（批次 20261025-1032）。
 *
 * - `build:app`（分离形态）：`true` —— 包里没有方块表，必须由安卓宿主注入，浏览器因此打不开；
 * - `build:web`（自足形态）：`false` —— 数据编进包里，不需要 `core.bin`、也不看版本清单。
 */
