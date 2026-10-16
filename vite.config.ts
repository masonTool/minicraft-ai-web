import { defineConfig } from 'vite';

export default defineConfig({
  // 相对 base：产物不写死 `/assets/...`，因此在域名根目录（自建服务器）和
  // 子路径（GitHub Pages 的 `/<repo>/`、任意静态托管的子目录）下都能直接跑。
  // ⚠️ 别改成 '/'，否则 Pages 上会去根域找 JS 而 404。
  base: './',
  server: {
    host: true,
    port: 5173,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  worker: {
    format: 'es',
  },
});
