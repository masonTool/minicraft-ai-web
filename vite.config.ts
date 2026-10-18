import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { defineConfig } from 'vite';

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
    // sourcemap 比产物本身还大、构建时间也接近翻倍。
    // 内循环（`npm run build:fast`，只验"能不能出包"）用 `SOURCEMAP=0` 关掉；
    // 默认开启——发布到 Pages 的产物要靠它排错。
    sourcemap: process.env.SOURCEMAP !== '0',
  },
  worker: {
    format: 'es',
  },
});
