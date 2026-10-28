import { configDefaults, defineConfig } from 'vitest/config';

/**
 * 单测（`tests/`）的配置。
 *
 * 为什么不复用 `web/vite.config.ts`：那份配置的 `root` 指向 `web/`（产品根），
 * 而 `tests/` 在仓库根。2026-10-29 目录重排后 `vitest` 在根目录找不到任何配置，
 * 于是**这里的规则全部失效**——表现是工作树里的同名测试也被一起跑、缓存开关也没生效。
 * 单测与"打包 Web 产物"本来就是两件事，各用一份配置最省心。
 */
export default defineConfig({
  test: {
    // 并行会话的工作树里有同名 tests/，vitest 不看 .gitignore，会各跑一遍
    exclude: [...configDefaults.exclude, '**/.continue/**'],
    /*
     * 关掉磁盘缓存：
     * · `cache`：结果缓存，多次重跑才会用到，这里 4 秒就跑完；
     * · `fsModuleCache`（vitest 5 默认开）：会把转译结果写进 `node_modules/.vitest-cache`，
     *   每次重跑前先 `fs.rm` 那个目录（几百个文件）——宿主环境的批量删除守卫拒绝删除
     *   >500 个文件，整套单测会在**启动阶段**失败，而报错看起来像"测试挂了"。
     */
    cache: false,
    fsModuleCache: false,
  },
});
