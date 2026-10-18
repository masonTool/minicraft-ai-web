/**
 * 构建期注入的全局常量（由 `vite.config.ts` 的 `define` 替换）。
 * 声明放这里，`src` 下的 TS 才认这两个标识符。
 */
declare const __BUILD_COMMIT__: string;
declare const __BUILD_TIME__: string;
