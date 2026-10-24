import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import type { Plugin } from 'vite';
import { configDefaults, defineConfig } from 'vitest/config';

/**
 * 读当前 HEAD 的"短 hash + 提交标题"（批次 182）。
 *
 * 首页要显示"这是哪一版"，这样手机上打开线上页面时不用翻 git 就能确认。
 * 用 `execFileSync` 而不是 `execSync`：提交标题里可能有空格、引号、`$`，
 * 走 shell 会被二次解释。构建环境没有 git（源码压缩包）时静默回退。
 */
function gitSummary(): string {
  try {
    return execFileSync('git', ['log', '-1', '--format=%h%x20%s'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

const buildCommit = gitSummary() || 'unknown';
/** 构建时刻；同时给首页显示与排错时对照 */
const buildTime = new Date().toISOString();

/**
 * ⚠️ 环境变量走**显式导入** `node:process`，而不是全局 `process`：
 * 主 `tsconfig.json` 刻意写了 `"types": []`（应用侧不该看见 Node 全局，
 * 否则"浏览器里没有 process"这类错要等到运行时才发现）。
 * 只有这一处例外——构建配置本来就跑在 Node 里。
 *
 * sourcemap 用环境变量而不是 `--mode`：`--mode` 会连带改 `NODE_ENV`
 * 与 `import.meta.env.PROD/DEV`，那样"快构建"和"正式构建"产物就不一样了，
 * 检查也就失去意义。这里**只差 sourcemap 一项**。
 */
/**
 * 开发服务器上模拟安卓宿主（批次 20261025-0329 · 宿主3）。
 *
 * `src/boot.ts` 启动时要取 `/__host/core.bin`——线上那个路径只由安卓宿主拦截提供，
 * 真机上永远不该存在这个文件。开发时没有它，页面就会一直停在"去应用里玩"的落地页，
 * 等于整个 dev 内循环都废了。
 *
 * 所以**只在 `apply: 'serve'`**（即 `npm run dev`）挂一个中间件，把 `gen:hostcore`
 * 生成的产物吐出来；构建产物里不会包含它，发布路径不受影响。
 */
function hostCoreDev(): Plugin {
  return {
    name: 'hostcore-dev',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__host/core.bin', (_req, res) => {
        try {
          const body = readFileSync(resolve('.tmp/hostcore/core-v1.bin'));
          res.setHeader('Content-Type', 'application/octet-stream');
          res.setHeader('Cache-Control', 'no-store');
          res.end(body);
        } catch {
          res.statusCode = 404;
          res.end('core.bin 未生成：先跑 npm run gen:hostcore');
        }
      });
    },
  };
}

export default defineConfig({
  // 相对 base：产物不写死 `/assets/...`，因此在域名根目录（自建服务器）和
  // 子路径（GitHub Pages 的 `/<repo>/`、任意静态托管的子目录）下都能直接跑。
  // ⚠️ 别改成 '/'，否则 Pages 上会去根域找 JS 而 404。
  base: './',
  // 构建期注入（`src/globals.d.ts` 有声明、`src/game/buildInfo.ts` 负责展示）
  define: {
    __BUILD_COMMIT__: JSON.stringify(buildCommit),
    __BUILD_TIME__: JSON.stringify(buildTime),
  },
  server: {
    host: true,
    port: 5173,
  },
  build: {
    target: 'es2022',
    /**
     * 显式写 `minify`（宿主4）。
     *
     * 之前没写，靠默认值。实测当前版本（Vite 8 / rolldown）的产物**已经是压缩态**
     * （用 esbuild 再压一遍收益 0%），所以这一行目前不改变体积；写它的理由只有一个：
     * 构建器默认值会随版本变，而"某次升级后产物突然变成未压缩"不会让任何检查报错，
     * 只会让手机上多下两倍体积。这种静默变差不该靠默认值兜。
     * 真正的兜底在 `tools/release-check.mjs`：它对发布产物再压一遍并记录收益，
     * 一旦哪天这里失效，那里会显示出一大截压缩率。
     */
    minify: true,
    // sourcemap 比产物本身还大、构建时间也接近翻倍。
    // 内循环（`npm run build:fast`，只验"能不能出包"）用 `SOURCEMAP=0` 关掉；
    // 默认开启——发布到 Pages 的产物要靠它排错。
    sourcemap: process.env.SOURCEMAP !== '0',
  },
  worker: {
    format: 'es',
  },
  plugins: [hostCoreDev()],
  /**
   * 单测的收文件范围（联机32）。
   *
   * 并行会话的工作树建在 `.continue/doing/.worktree/<名字>/` 下，里面有**同名**的
   * `tests/` 与 `src/`。vitest 默认只按测试文件名找文件、不看
   * `.gitignore`，于是主树的 23 套会连同工作树的副本各跑一遍：计数虚高一倍
   * （169 → 332），更要紧的是**工作树里的红会让主树门禁变红**，而与这边的改动无关。
   *
   * 用 `configDefaults.exclude` 打底再追加，避免把默认的 `node_modules`/`dist`
   * 排除项一起覆盖掉（`--exclude` 命令行参数是覆盖语义，踩过）。
   */
  test: {
    exclude: [...configDefaults.exclude, '**/.continue/**'],
    /*
     * 关掉磁盘缓存：vitest 的缓存目录有上千个文件，IDE 的**安全删除守卫**（删 >500 个
     * 文件要人工确认）会拦住它的自动清理，于是整套测试**启动即失败**
     * （`SAFE_DELETE_BULK_CONFIRM_REQUIRED`，本地实测过）。
     * 这套测试本身 1 秒内跑完，缓存省下的时间不值得引入这种"换台机器就起不来"的失败。
     */
    cache: false,
  },
});
