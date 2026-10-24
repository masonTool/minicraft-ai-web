# Cloudflare Pages 发布手册（宿主专属形态 / 完整前端形态）

> 批次 20261025-0329 · 宿主6
>
> 一句话：**同一个 `dist`，只差一个文件 `__host/core.bin`。**
> 没它 → 只有安卓宿主能玩（浏览器看到"去应用里玩"）；有它 → 浏览器也能玩。
> 两种形态必须发到**两个不同的 Pages 项目**，不许共用。

---

## 1. 两站分工

| | A 站（主入口） | B 站（预览 / 兜底） |
| --- | --- | --- |
| Pages 项目名 | `minicraft-app` | `minicraft-web` |
| 域名（示例，按实际改） | `game.example.com` | `demo.example.com` |
| 构建命令 | `npm run build:app` | `npm run build:web` |
| `dist/__host/core.bin` | **没有** | **有**（40 KB） |
| 浏览器打开 | 只显示"请在 Minicraft 应用里游玩" | 直接进游戏 |
| 流水线 | `.github/workflows/deploy-cf-app.yml` | `.github/workflows/deploy-cf-web.yml` |

**为什么必须物理隔离**：两站的区别只有一个文件。共用一个项目的话，"谁最后跑"决定线上形态——
某次手滑用 `build:web` 发到 A 站，整套门禁当场作废，而且**线上看起来一切正常**（游戏能玩），
没人会发现。项目名分开之后，发错的可能性只剩"改错 workflow 里的 `--project-name`"，
而那个字符串在两条流水线里各出现一次、写死、review 时一眼能看见。

---

## 2. 首次配置（一次性，需要 Cloudflare 账号）

1. **建两个 Pages 项目**：Workers & Pages → Create → Pages → 选 "Direct Upload"（本项目不走 Git 集成，产物由 Actions 上传）。
2. **配仓库 secrets**（Settings → Secrets and variables → Actions）：
   - `CLOUDFLARE_API_TOKEN`：权限至少 `Account.Cloudflare Pages:Edit`
   - `CLOUDFLARE_ACCOUNT_ID`
3. **绑域名**：A 站绑 `game.example.com`，B 站绑 `demo.example.com`。
   ⚠️ 别给 B 站绑任何被写进 APK 的域名——APK 里写的是 A 站。
4. `public/_headers` 已经跟着产物发布，负责把 `core.bin` / `version.json` / `index.html` 设成
   `no-store` / `no-cache`（Pages 默认会缓存 HTML，不设就会出现"更新了但线上还是旧的"）。

---

## 3. 发布流程（灰度 = preview 先验收，再切 production）

Cloudflare Pages **没有百分比灰度**（那是 Workers 的 `versions deploy --percentage` 能力），
所以这里的"灰度"是**部署级的两段式**：

```
① 手动跑 workflow，channel = preview
   → 得到一个独立的 <hash>.minicraft-app.pages.dev 地址，生产域名一动不动
② 在那个地址上按第 5 节验收
③ 验收通过 → 再跑一次 workflow，channel = production（或去 Dashboard 把这个部署 Promote to production）
```

`--branch` 决定 Pages 把它当 preview 还是 production：与项目设置的生产分支（`main`）同名才是正式部署，
其它名字都生成独立 URL。两条流水线就是靠这个做两段式。

**要真正的百分比灰度**（比如先给 10% 用户）就得换成 Workers（`wrangler versions deploy --percentage 10`），
代价是从"纯静态托管"变成"Worker 里读 R2 / 私有资源"。**本阶段选择不做**：现阶段用户量小、
且两段式已经能挡掉"发出去才发现白屏"这类事故；等真的需要按比例放量再迁移，迁移是纯加法（不影响现有门禁）。

---

## 4. 回滚（三种，按响应速度排序）

| 场景 | 做法 | 生效时间 |
| --- | --- | --- |
| 刚发完发现问题 | Dashboard → 该项目 → Deployments → 找到上一个正常部署 → **Rollback to this deployment** | ~秒级 |
| 想用 CLI 重发旧版本 | `git checkout <旧提交> && npm ci && npm run build:app && npx wrangler pages deploy dist --project-name=minicraft-app --branch=main` | 一次构建时间 |
| 只是某个文件坏了（如 core.bin 版本错了） | 改 `BLOCK_TABLE_VERSION` / 重新 `npm run gen:hostcore` → 重跑流水线 | 一次构建时间 |

⚠️ 回滚 A 站**不会**回滚已经装出去的 APK：用户的壳还是那个壳。所以线上任何"要求更高
`minSupportedCore`"的变更，都必须先在 APK 侧把新 core 铺开（否则老用户会被版本闸门挡在门外，
看到"请更新应用"——这正是闸门存在的意义，但别滥用）。

---

## 5. 验收清单（每次发布都跑，别只看"部署成功"）

```bash
# ⚠️ 别用 HTTP 状态码判断"文件在不在"：带 SPA 回退的静态托管（本地 `vite preview` 就是）
#    对任意路径都回 200 + index.html，`curl -o /dev/null -w '%{http_code}'` 会骗人。
#    下面一律**看内容**：是不是 4 字节魔数、第一行是不是 <html。

# A 站：门禁必须成立
curl -s https://game.example.com/__host/core.bin | head -c 4            # 期望不是 MCTB（通常是 "<!do"）
curl -s https://game.example.com/version.json                            # 期望 core / minSupportedCore
curl -s https://game.example.com/ | grep -c 'assets/index-'              # 期望 >0（入口是有的）
# 浏览器打开：应当只有"请在 Minicraft 应用里游玩 / 前往 Google Play 下载"，且不出现 3D 画面

# B 站：完整前端必须能玩
curl -s https://demo.example.com/__host/core.bin | head -c 4            # 期望 MCTB
curl -s -o /dev/null -w '%{size_download}\n' https://demo.example.com/__host/core.bin   # 期望 ~41107
# 浏览器打开：应当进入"加载中… 正在准备材质与存档"

# 两站都不能有 sourcemap（有就等于把 TS 源码公开了）
ENTRY=$(curl -s https://game.example.com/ | grep -o 'assets/index-[^"]*\.js' | head -1)
curl -s "https://game.example.com/${ENTRY}.map" | head -c 32            # 期望是 HTML 或空，不是 JSON
```

最后一条其实由构建期断言兜住了（`build:app` / `build:web` 都会检查 `dist` 里没有 `.map`），
线上再验一次是防止"有人手工传了一份 `vite build` 的产物上去"。

---

## 6. 与 GitHub Pages 的关系

`.github/workflows/deploy-pages.yml` 仍然存在，但它现在跑的是 **`npm run build:app`**：

- 之前它跑 `npm run build`，而 `vite.config.ts` 的 `sourcemap` 默认是**开的**——
  也就是说线上一直挂着 `.map`，等于把全部 TypeScript 源码公开。这一条在本批次一并修掉。
- 修完之后 GitHub Pages 上就是 A 站形态（浏览器只见落地页）。想在浏览器里玩请用 B 站，
  **不要**把 B 站的东西发到 GitHub Pages（那是同一个域名，等于把门禁拆了）。

如果之后完全迁到 Cloudflare，删掉 `deploy-pages.yml` 即可，其余不受影响。
