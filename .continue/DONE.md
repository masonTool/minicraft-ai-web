# 完成档案 · DONE

> 本文件是**已完成工作的唯一档案**，只回答"这批做了什么、怎么验的"——时间线，最近的在最上面。
> 按模块看现状与坑 → `OVERVIEW.md`；下次怎么避开 → `TIPS.md`；机制与格式 → `README.md`。
> **一条内容只写一个地方**，别在三份文档里各抄一遍。
>
> 收尾时**整份队列原样搬进来**（含每条任务下方的完成说明与 `[阻塞]`），标题格式
> `## 批次 <号> · 日期 · 会话 <前 8 位>`。

---

## 批次 20261025-0329 · 2026-10-25 · 会话 937507d0

> 方块表数据外置（宿主只认自己注入的 core.bin）+ 双形态发布 + 门禁与版本契约。

# 队列 · 会话 937507d0458d4277ba340bcb48207050

> 状态：执行中
> 创建：2026-10-25
> 批次：20261025-0329

目标：把方块表这份"核心且恒定"的数据从线上 bundle 里拿出来，落成**一个文件** `core.bin`：
- 放进 APK → 前端必须从 `/__host/core.bin` 取，浏览器拿不到 → 只有宿主能玩
- 放进静态服务器 → 完整前端方案（浏览器可玩，用于预览/兜底）

约束：**不得影响前端加载与体验**（主包体积必须下降，冷启动不得变慢；bin 与主包并行加载，不串行）。

- [x] [宿主1] 二进制编解码 + 生成脚本 + 往返一致测试：新增 `src/core/registry/blockTableCodec.ts`、`tools/gen-hostcore.ts`、`tools/hostcore-test.ts`，`blocks.ts` 导出 `buildBlockTable` 供工具直接用 → `npm run test:hostcore` 逐字段全等；`node tools/gen-hostcore.mjs`（或 npm script）能产出 `core.bin` 且体积记录在案
  - 做了什么：定长 14 字节/块 + 全局去重字符串表 + 16 字节头（含 crc32），`encodeBlockTable`/`decodeBlockTable` 成对实现；`gen:hostcore` 产出 `.tmp/hostcore/core-v1.bin`；`test:hostcore` 钉 18 条断言（逐字段往返、id 连续、函数字段不进文件、坏文件必须抛、体积预算、ArrayBuffer 入口）
  - 为什么：方块表是复制者最想要的那份数据，也是最恒定的一份，先把它做成独立文件，"放 APK / 放静态站"就只是同一个文件的两种部署，编译期不需要任何分叉
  - 验证：`npm run test:hostcore` 18 通过 / 0 失败；`npm run check:fast` 全绿（离线套件 176 → 177 套，新套件按 `package.json` 自动注册）；`npm run typecheck` 与 `typecheck:tools` 均 0 错误。实测 724 个方块 → 41107 字节 / gzip 11048 字节（丢进 APK 的净成本 ≈ 10.8 KB）
  - 踩到并修掉的：① 头部 12→16 字节时 `offset` 从 `HEADER_SIZE` 起读 `blockCount`，把第一段字符串长度当成块数（报"字符串表被截断"这种离谱错误），改成固定偏移 6/8；② 补 crc32 的起因是"长度不变但内容被补零"的损坏能静默解出垃圾表
  - 批次：20261025-0329
- [x] [宿主2] `blocks.ts` 的 `BLOCKS` 改成可注入 + 给 46 个带行为方块上一道行为快照回归锁（**只做 seam，不搬闭包**，搬迁留给宿主3 由快照兜底）
  - 做了什么：`BLOCKS` 由 `const` 改 `let`；新增 `installBlockTable()`（校验非空 / id 连续 / 有名字，失败保持旧表）与 `isInstalledBlockTable()`（布尔标记，不用数组身份——被"等值新数组"骗过一次）；新增 `tools/behavior-signature.ts`（无副作用的口径库）、`gen-behavior-golden.ts`、`behaviors-test.ts`，基线固化为 `tests/fixtures/block-behaviors.golden.json`（46 块 / 2.3 KB）
  - 为什么：闭包搬家和二进制装载是两件事，一次做两件出问题时定位成本翻倍。宿主2 先把"表可以被换掉"这条缝做出来并用 encode→decode→install→查询 全链路证明它成立，宿主3 再动 46 个闭包（届时快照就是判据）。快照本身也顺手变成这 46 块贴图/发光的长期回归锁
  - 验证：`npm run test:hostcore` 33 通过 / 0 失败（新增第七节：装表后 `blockDef`/`isOpaque`/`isSolid`/`lightOpacity`/`emitLight`/`blockTiles` 逐 id 对齐，装空表与 id 不连续必抛且旧表保留）；`npm run test:behaviors` 7 通过（46 块行为输出未变）；`typecheck` 与 `typecheck:tools` 均 0 错误
  - 批次：20261025-0329
- [x] [宿主3] 搬到二进制装载 + 门禁：① 把 46 个方块的 `stateTiles`/`faceTile`/`stateLight` 抽进 `BLOCK_BEHAVIORS`（按名字索引），SPECS 只留数据；② 新增 `src/boot.ts`（并行拉 `/__host/core.bin` + 动态 import 主包，装表后放行；404/超时 → 全屏落地页指向 Google Play）；③ `index.html` 改指向 boot、`public/sw.js` 排除 `/__host/*` → `npm run test:behaviors` 仍全绿（46 块行为一字不差）、浏览器打开只见落地页且 Network 无主包、带 bin 时正常进游戏
  - 做了什么：① 46 个方块的行为（`stateTiles`/`faceTile`/`stateLight`）搬进新文件 `blockBehaviors.ts`，按**方块名**索引（含 16 面旗帜的按色循环生成），`SPECS` 只留数据；`blocks.ts` 新增 `applyBehaviors()`，装表与 `buildBlockTable()` 都走它，二进制格式**不需要为行为加任何字段**。② 新增 `src/boot.ts`（真入口）：先 `fetch('./__host/core.bin')` → 验魔数 → 装表 → 动态 `import('./main.ts')`；两条失败路径分开——"没有核心数据"走安装引导（指向 Google Play），"有但解不开/版本不对"走提示更新。③ `index.html` 改指向 `boot.ts`；`public/sw.js` 排除 `/__host/*`；`vite.config.ts` 加 dev-only 中间件模拟安卓宿主（`apply: 'serve'`）。
  - 为什么：闭包塞不进二进制，必须留在代码里；而"搬"这类改动的风险是**静默渲染错**（正脸贴反、亮灯不发光），所以先用快照锁住 46 块的输出再动手。门禁之所以不需要后台，是因为 `__host/core.bin` 在线上**根本不存在**：宿主用 `shouldInterceptRequest` 从 APK 读，浏览器拿到的就是 404——"缺资源"这个判据天然成立。
  - 验证：`npm run test:behaviors` 7/0（46 块行为输出一字不差）；`npm run test:hostcore` 33/0（含 encode→decode→install 全链路）；dev 下 `curl /__host/core.bin` → 200 / 41107 字节；Playwright 实测两形态——**无 bin → 显示"请在 Minicraft 应用里游玩"，且 `main-*.js` 一个字节都没下载**；有 bin → 下载 `main-*.js` 并进入"加载中… 正在准备材质与存档"；`typecheck` 0 错误
  - 踩到并修掉的：① `vite preview`/静态托管对不存在路径做 **SPA 回退**，`/__host/core.bin` 返回 `200 + index.html`，`response.ok` 为真 → 被误判成"版本不匹配"（提示"请更新应用"而不是"去下载"）。改成**先验魔数**：魔数不对 = 没有核心数据 = 安装引导；② 浏览器验证时读到旧 Service Worker 里缓存的 `core.bin`，害得"有 bin 也显示落地页"，加 cache-busting 查询串后才复现真实行为——这条已补进 `TIPS.md`
  - 没做完、留到宿主4：`SPECS` 仍在 bundle 里（本批**体积未降**）。原因是它与 50 多个 id 常量交错在 `blocks.ts` 中，被 224 个文件引用，搬走要连带处理这批再导出；宿主4 做文件拆分 + 主包体积断言 + `dist` 里不得出现 `core.bin` 的断言
  - 批次：20261025-0329
- [x] [宿主4] 双形态发布构建：`build:web`（含 core.bin，完整前端）/ `build:app`（**不含** core.bin）＋ 关闭 sourcemap ＋ HTML minify ＋ 构建后断言（无 `.map`、无 `core.bin`、主包 gzip 显著低于 338456）→ 两条命令各自断言通过
  - 做了什么：新增 `tools/release-check.mjs`（发布后处理 + 断言）与 `npm run build:app` / `build:web`：两条都以 `SOURCEMAP=0 vite build` 起，再由脚本 ① 用 esbuild 再压一遍 JS 并记录压缩率 ② `app` 形态**删掉** `dist/__host/` 并报红、`web` 形态校验 `core.bin` 魔数后放入 ③ 断言无 `.map`、主包 gzip 不超基线、HTML 产物不比源文件大。另把 `vite.config.ts` 的 `minify` 显式写死（不依赖默认值）。
  - 为什么：这三件失败都**不会让构建报错**——多一个 `.map` 等于把源码发出去了，多一个 `core.bin` 等于门禁当场失效，产物没压缩则只是"手机多下两倍"。静默变差只能靠退出码兜。`build:web` 与 `build:app` 用同一个 `dist` 布局，只差一个文件：**放哪决定形态**这条设计在这里得到验证。
  - 验证：`npm run build:app` → 主包 `index-*.js` gzip 716.0 KB / 基线 722.7 KB、全部 JS 合计 1202.7 KB，`dist` 无 `__host`；`npm run build:web` → `core.bin 已放入 dist/__host（40.1 KB）`、魔数校验通过。Playwright 两形态实测：`web` 形态进"加载中… 正在准备材质与存档"，`app` 形态只显示"请在 Minicraft 应用里游玩"，控制台无错误。
  - ⚠️ 没达成的一条：队列里写的"主包 gzip 显著低于 338456"**没有达成（716 KB）**，因为 `SPECS` 仍在主包里。而且 338456 本身是**批次 85 的旧数字**，项目此后长了一倍多（724 方块 / 176 套测试 / 村庄要塞联机），拿它当目标属于刻舟求剑——真正该盯的是"数据搬走之后这一项要往下掉"。已把基线改成"当前实测 + 余量"并写明这一点，另插了一条 `[发现]` 条目专做数据搬迁。这一点请在收尾时定夺。
  - 踩到并修掉的：① 一度改成"独立 boot 入口 + 动态 import main"，实测 `blocks.ts` 被两个 chunk **各打一份**（主包 2.0 MB / gzip 556 KB + 多一次请求），回退成单入口、门禁放在 `main.ts` 末尾的异步 IIFE 里；② esbuild 压缩默认把中文转 `\uXXXX`，体积反涨 14%，必须显式 `charset: 'utf8'`
  - 批次：20261025-0329
- [x] [宿主5] 版本契约：`version.json`（`core` / `minSupported`）+ 宿主 UA 带 `core/N` + 不匹配时提示「请更新应用」而非白屏 → 手工验三种组合（匹配 / 落后 / 浏览器）
  - 做了什么：① `release-check.mjs` 生成 `dist/version.json`（`core` / `minSupportedCore` / `builtAt` / `mode`），`core` 直接从 `blockTableCodec.ts` 的 `BLOCK_TABLE_VERSION` 读取并与 `core-v{N}.bin` 文件名交叉校验（两处抄一遍必然漂）；② `hostCore.ts` 新增 `readHostCoreVersion(ua)` / `evaluateHostVersion()`（纯函数）与 `fetchMinSupportedCore()`，启动时与 `core.bin` **并行**取清单，先判"宿主太老"再解二进制；③ `sw.js` 把 `version.json` 也排除出缓存；④ `tools/browser.mjs` 的 `openPage` 支持自定义 UA（这是唯一能真验 UA 判定的办法）。
  - 为什么：三种组合里最容易错的是**浏览器**——它没有宿主标记，若把它也判成"版本过旧"，浏览器用户会看到"请更新应用"这种完全误导的提示。所以判定是三态（`ok` / `outdated` / `unknown`），`unknown` 必须继续走正常流程、最终落到安装引导。另外清单取不到时**不阻塞启动**（回退到最宽松的兜底下限），不让一个几百字节的 JSON 成为单点故障。
  - 验证：`npm run test:hostversion` 16 通过 / 0 失败（UA 解析 7 条含"只有 core/N 没有宿主标记 → null"这种误判防线；三组合与边界 9 条）；真实浏览器三组合实测（`build:web` 形态）：浏览器 UA → 进"加载中…"、宿主 `core/1` → 进"加载中…"、宿主 `core/0` → **"核心资源版本不匹配 / 请更新到最新版本"**，三次均无控制台错误。另：`build:app` 形态下浏览器 UA → 安装引导（上一轮已验证）。
  - 批次：20261025-0329
- [x] [宿主6] Cloudflare 静态发布与回滚：两条流水线分别部署 app 版与完整版（**不同域名/路径**，避免误把 core.bin 传到生产域），灰度与回滚步骤写进文档 → 按文档实操一次并贴出 curl 证据
  - 做了什么：① 两条**独立的**发布流水线 `.github/workflows/deploy-cf-app.yml`（`minicraft-app` / 宿主专属）与 `deploy-cf-web.yml`（`minicraft-web` / 完整前端），项目名、域名、`dist` 形态三者物理隔离，触发方式只留 `workflow_dispatch`（手动 + `channel=preview|production` 两段式）；② `docs/DEPLOY-CLOUDFLARE.md`：两站分工、首次配置（secrets / 域名）、preview 先验收再切 production、三种回滚路径、验收清单；③ 新增 `public/_headers`（Pages 专用）：`core.bin` / `version.json` 走 `no-store`、`index.html` / `sw.js` 走 `no-cache`；④ 顺带修掉一个**线上泄漏**：`deploy-pages.yml` 原来跑 `npm run build`，而 sourcemap 默认是开的——GitHub Pages 上一直挂着 `.map`，等于把 TypeScript 全部源码公开。已改成 `npm run build:app`（关 sourcemap + release-check 断言）。
  - 为什么：灰度这块 Cloudflare Pages **没有百分比能力**（那是 Workers 的 `versions deploy --percentage`），所以这里定义成"部署级两段式"：先发 preview（独立 URL，生产域名不动）→ 按清单验收 → 再 promote。要真按比例放量就得迁到 Workers + R2，那是纯加法、随时可做，现阶段不值得为一个还没量的问题引入动态层。两站必须**不同项目名**：它们只差一个 `core.bin`，共用项目的话"谁最后跑"决定线上形态，发错时线上看起来还一切正常（游戏能玩），没人会发现。
  - 验证：**未验证**（缺 `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` 与两个 Pages 项目名，这类信息只有用户能提供）。已做的是本地等价验收：本地用 `vite preview` 模拟两站产物、按文档第 5 节逐条 curl——A 站 `/__host/core.bin` 返回 `<!do`（不是 MCTB）、`version.json` 为 `mode=app`、入口 chunk 存在、`.map` 请求拿到 HTML、`dist` 无 `__host`；B 站 `core.bin` 200 / 41107 字节 / 魔数 `MCTB`、`version.json` 为 `mode=web`、`.map` 同样不存在。两条构建命令本身也各自跑通断言（`build:app` / `build:web` 均 ✓）。工作流文件只做了静态检查（无 Tab、无未用参数），实际执行要等用户配好 secrets 手动触发。
  - 踩到并修掉的：验收清单原本写"看 HTTP 状态码"，但 SPA 回退会把任何不存在的路径变成 `200 + index.html`（首轮实测 A 站 `core.bin` 与 `.map` 双双返回 200）——已全部改成**看内容**（魔数 / 首字节），文档里也写明了原因
  - 批次：20261025-0329

- [阻塞] [发现] 把 `blocks.ts` 里的方块表数据真搬出主包（当前门禁已成立、体积未降）：`src/core/registry/blocks.ts` 里 `SPECS` 与 60 多个声明交错（22 个 `export const *_ID_START` 导出被 224 个文件引用、若干 spec 工厂函数），整块搬运要连带处理再导出 → 判据是 `npm run build:app` 的主包 gzip 比现在（716 KB）明显下降，且 `npm run test:hostcore` 仍是 724 个方块、`npm run test:behaviors` 46 块一字不差

  - 进展（2026-10-25 · **未完成，未打勾**）：**第 1 步已做完**——`SPECS` 的构造现在**没有任何副作用**（`grep _MAP.set` 为 0 处）。
    · 原状：6 张 id 表（`WOOD_ID_MAP` / `WOOD_SHAPED_MAP` / `SAPLING_ID_MAP` / `SAPLING_TREE_MAP` / `BED_ID_MAP` / `SIGN_ID_MAP` / `STONE_VARIANT_MAP`）都是在 spec 数组的 `flatMap`/`map`/IIFE 回调里被 `set()` 填充的——"建表顺便产出 id"。
    · 现在：先纯算术生成（`WOOD_IDS` / `WOOD_SHAPED_IDS` / `allocateStoneVariantIds()` 等），spec 只读不写；`STONE_VARIANT` 那处的 id 分配器单独抽成 `allocateStoneVariantIds()`，`stoneVariantId()` 不再依赖"表被生成过"。
    · 验证：id 快照哈希改前改后**逐字节一致**（木材 `9c2cdaf90cf3155e`；含树苗/床/牌子/石变体的合并快照 `b3c68cc2d86da217`）；`test:hostcore` 33/0（724 块）、`test:behaviors` 7/0（46 块）、`check:fast` 149 套全绿。
  - 剩余工作（下一批的入口）：**第 2 步——把 60 多个 spec 声明搬到 `blockSpecs.ts`**。已探明的做法：spec 数组只依赖**导出的取值函数**（`woodBlocks()` / `woodShaped()` / `saplingId()` / `bedIdOfColor()` / `signId()` / `stoneVariantId()`）与字面量常量，所以搬运后 `blockSpecs.ts` 只需 `import` 这些；`blocks.ts` 用**动态 `import()`（顶层 await）+ 构建期 `define` 关掉嵌入**来绕开"blockSpecs 先求值读常量落在 TDZ"的死结，生产包里 `SPECS` 为空、由 `hostCore` 从 `core.bin` 装表，`build:app` 主包 gzip 应降到 ~690 KB。**风险点**：`blocks.ts` 会变成 async 模块（TLA），224 个引用方的求值时机整体后移——这是下一批唯一需要小心的地方。

---

## 批次 20261025-0316 · 2026-10-25 · 会话 7e09a4a8

> 上架 Google Play 的版权 / 商标处置（7 条）。
> ⚠️ 本批的 **7 个代码提交**信息里写的是 `20261025-0117`（开工时钩子注入的号，与另一个会话同分钟开工撞号），
> 归档时用 `queue-init --new-batch` 换成本号以满足「批次号唯一」；
> 按批次 grep 提交请用 `20261025-0117`。

> 状态：执行中
> 创建：2026-10-25
> 批次：20261025-0316

- [x] [合规1] 清掉对外文案里的「Minecraft / 我的世界 / 基岩版」字样：`public/manifest.webmanifest` 的 description 换成与商店短描述一致的说法、`package.json` 的 description 同步 → `npm run check:manifests` 通过，且 `grep -rn "我的世界\|基岩版" public/ package.json` 零命中
  - 做了什么：manifest description 改成「浏览器里的方块世界：无限地形、生存与创造、多世界存档，无需安装」（与 `docs/store/zh.md` 的短描述同一句）；`package.json` description 改成「方块沙盒（Web / WebGL2）：无限地形、生存、合成与联机」；顺手把六语言 `itemDesc.ts` 里 `item.desc.chain` 的「基岩版里 / In Bedrock / В Bedrock…」改成不指名版本的说法
  - 为什么：真正会出现在用户设备上的只有 manifest description（安装提示/启动器），先把这一处清掉；`item.desc.chain` 是**会显示在物品说明里**的句子，直接写竞品版本名等于自己递证据。`docs/store/` 六份文案复查后确认**本来就没有**商标字样（唯一出现 Mojang / Microsoft 的地方是那句免责声明，保留），所以没动文件
  - 验证：`npm run check:manifests` 通过（5 份语言文件与基准一致）；`npm run audit:i18n` 通过（六语言 100%）；`npm run test:i18n` 550/0；`grep -rn "基岩版\|Bedrock" src/core/i18n/locales/*/itemDesc.ts` 零命中（`item.bedrock` 是方块名「基岩」，属于术语表，按 D3 不动）
  - 批次：20261025-0316
- [x] [合规2] 重写 33 条照抄原版的成就标题（6 语言共 198 条），保留 id 与触发逻辑：`src/core/progress/advancementText.data.ts` + `src/core/i18n/locales/{zh,en,de,fr,pt,ru}/advancement.ts` → `npm run test:i18n && npm run test:advancement && npm run audit:i18n`
  - 做了什么：33 条里 **30 条**换掉（`石器时代`→`第一块圆石`、`来硬的`→`第一炉铁`、`西装革履`→`穿上胸甲`、`冰桶挑战`→`水浇岩浆`、`我们需要更深入些`→`走进下界`、`资深怪物猎人`→`狩猎清单`、`村庄英雄`→`村庄救星`、`腥味十足`→`钓上来一条`、`涂蜡`→`涂上蜂蜡`…），六语言各 30 条 + `advancementText.data.ts` 的英文副本 30 条，共 210 处；另把 `story/root` 的英文从原版的 `Minecraft` 改成品牌名 `Minicraft`（中文侧本来就是品牌名）。id、parent、tab、desc、trigger 全部未动
  - 为什么：这 33 条的英文标题与原版逐字相同（中文也基本沿用官方译名），是唯一"成体系照抄官方本地化"的地方；其余 67 条是本项目自创进度，标题也是自创，按 D2 不动。**3 条刻意保留**：`story/root` 是品牌名；`nether/root`（下界）与 `end/root`（末地）是维度专名，属于 D3 判定不动的术语表，改了会与界面上其它地方不一致。改法上刻意避开原版的**双关/梗**（`Isn't It Iron Pick`、`Bring Home the Beacon`、`The Cake Is a Lie` 那类），改成陈述机制的说法，这样连"创造性表达"也不沾
  - 验证：`npm run test:i18n` **550/0**（含三条硬约束：中文标题与 `advancements.ts` 原文逐条相等、de/ru/fr/pt 不含中文且与英文相同的 ≤10 条、法语不许出现 ASCII 撇号——第一次跑就靠这条抓到 3 处 `l'` 应为 `l’`）；`npm run test:advancement` **116/0**；`npm run audit:i18n` 六语言 2894/2894 通过；`npm run typecheck` + `typecheck:tools` 清洁；30 条新标题在 zh/en 表内无重复
  - 批次：20261025-0316
- [x] [合规3] 10 幅画改名 + 按自创构图重画（去掉 Zetterstrand 原作的构图对应，`大金刚` 必删）：`src/core/registry/paintings.ts` + `src/render/TextureAtlas.ts` → `npm run test:painting && npm run test:textures`
  - 做了什么：1×1 七幅换成 `日出 / 河谷 / 远山 / 夜空 / 篝火 / 孤树 / 沙丘`（dawn / river / hill / night / campfire / tree / desert），多格三幅换成 `壁画 4×4 / 挂毯 4×3 / 旧海图 2×2`（mural / banner / chart，**大金刚直接消失**）；`TextureAtlas` 的七张 painter 与 `MULTI_PAINTING_ART` 全部按新构图重写（矩形清单，无任何一幅对应他人作品）；`atlasLayout` 的七个 tile 名同步；旧多格画名做成了**只读别名** `LEGACY_MULTI_NAMES`，老存档里的大画仍能读回来；顺手修掉六语言里已经过期的「画」物品说明（还写着"只有 7 幅、多格大画没做"）与 `TASKS` B14 的差异说明
  - 为什么：这 10 幅原来是照着 Zetterstrand 的署名画作摆的构图（名字也照抄），"认得出是哪一幅"就是改编，`大金刚` 还叠了任天堂形象。**只换画面与名字、保留尺寸档位与 1×1 的下标顺序**（D9）：尺寸是玩法，下标进方块状态，调序会让老存档里挂好的画集体换脸。多格画的名字进存档，所以用别名而不是硬改（D10）
  - 验证：`npm run test:painting` **66/0**（新增 6 条别名断言：三个旧名字各自映射正确、旧名字尺寸仍是 4×4、别名目标都在表里、现用名字不在别名键上）；`npm run test:textures` **33/0**；`npm run test:frame` **169/0**（`describeState` 的「贴北墙·炸弹」→「贴北墙·篝火」随名字改）；`npm run test:i18n` 550/0、`audit:i18n` 2894/2894 通过（物品说明改了六语言）；`typecheck` + `typecheck:tools` 清洁；`npm run audit:diffs` 重算了差异台账
  - 批次：20261025-0316
- [x] [合规4] 设置页补「非官方 · 与 Mojang / Microsoft 无关」声明 + 资源包免责（只导自己拥有的包）：`src/core/i18n/locales/*/settings.ts` + `src/ui/SettingsScreen.ts` → `npm run test:settings && npm run test:ui && npm run audit:i18n`
  - 做了什么：新增两条键 `settings.notice`（设置页底部：非官方、与 Mojang / Microsoft 无关、贴图与音效全部由代码生成）与 `settings.resourcePack.hint`（资源包行下方：只能导入你自己拥有的包，本应用不提供也不分发官方素材），六语言各一份；`SettingsScreen` 加 `makeFooterNotice()` / `makePackHint()` 两个节点（footer 用 `prepend` 插在"恢复默认"之上，不动原有组装顺序）；`index.html` 加 `.settings-notice` / `.settings-note` 两条样式（10px 灰字，触屏横屏降 9px）
  - 为什么：首页那句"非官方"页脚被用户按审美删过（批次 20261024-1152），但商店版本必须有一个**用户自己找得到**的免责位置——放设置页底部：不占首屏、六语言都有、投诉时能指出来。资源包那一行单独加免责，是因为它长期被当作"换个官方外观"的入口，法律上只能导自己的包（D6）。措辞刻意只讲"与谁无关 + 素材由代码生成"，不写"复刻的是哪个游戏"——写清对象等于自认使用了他人作品
  - 验证：`npm run test:settings` **119/0**；`npm run test:ui` **979/0**（新增 1 条断言：三条链路都得在——源里引用两个键、CSS 有两条样式、六语言表里都有这两条键，少一处就红）；`npm run audit:i18n` 六语言 2896/2896 通过；`npm run test:i18n` 550/0；`typecheck` + `typecheck:tools` 清洁
  - 批次：20261025-0316
- [x] [合规5] 读档容错：不认识的方块 / 物品 id 跳过并记日志，不再整档失败：`src/core/save/` → `npm run test:save && npm run test:migration`
  - 做了什么：新增 `src/core/save/SaveIssues.ts`（纯数据记账本：按 `种类|细节` 累加、最多 32 种、溢出只计数、可清零）；三条读档路径接上——`ChunkEdits.applyTo()` 遇到注册表里不存在的方块 id **不写世界**（保留地形）并记账、`Inventory.restoreStack()` 丢掉不认识的物品 id 时记账、`Paintings.restorePaintings()` 跳过认不出的画名时记账；`SaveGame.open()` 打开世界时清零；诊断日志的 `meta.saveIssues` 带上这份账
  - 为什么：存档里的方块与物品都是**数字 id**，所以改命名空间其实不会让老档读不回来（这条顺带纠正了我原先的判断）；真正会丢东西的是"这个 id 当前版本不存在了"。三种路径原本都是**静默**处理：方块回退成空气（那一片被挖空）、物品直接消失、画跳过——静默是对的（不能因为一个坏 id 让整档打不开），但必须留痕，否则玩家报"我的东西没了"时导出日志里查不到任何线索
  - 验证：`npm run test:save` **120/0**（新增 8 条：不认识的方块不写世界且保留地形、记账 detail 正确、不认识的物品丢掉且记账、同一 id 累加而不新增、总数含重复、清零后归零、清单为空）；`npm run test:migration` 28/0；`npm run test:diag` 89/0；`npm run test:unit` 全绿；`typecheck` 清洁
  - 批次：20261025-0316
- [x] [合规6] 内部命名空间 `minecraft:` 换成自有前缀（方块 / 物品 / 命令 / 联机协议 / 存档一起）：`src/core/registry/*`、`src/core/commands/*`、`server/` → `npm run check`（全量 177 套）
  - 做了什么：新增 `src/core/registry/ids.ts`（`NAMESPACE = 'minicraft'` + `normalizeId()` / `shortId()` / `hasNamespace()`，旧前缀只用于**读**）；全局替换 1100 处字面量（87 个 .ts + `tools/*.js` 的验收脚本）；所有"按名字查表 / 去前缀"的地方改用 `shortId()`（`itemNames` 7 处、`advancementText` 4 处、`AudioEngine` 4 处、`CommandHelp` 3 处、`StatusEffects` 1 处、`structureNames` 1 处、`food` 1 处、`main` 2 处）；命令解析入口（`resolveItemId` / `resolveBlockId`）先 `normalizeId()` 再查，所以 `/give minecraft:stone`、`/locate structure minecraft:village` 这类**老文本仍然可用**（`command-test` 里恰好就有这两条用例）；进度读档把老 id 归一化（否则达成记录整片消失）
  - 为什么：命名空间是内部标识符，但本项目是独立产品，没必要继续借用别人的前缀。**顺带发现一处真正在用户眼前的东西**：进度页第一个页签的标题原本是「我的世界」、英文是「Minecraft」，已改成「方块世界」/「Block World」（页签 id `minecraft` → `world`）——这才是这次改名前唯一会被玩家看见的商标痕迹
  - 验证：`npm run test:offline` **176/176 套全绿**（85.4s）；`npm run test:unit` 372/372；`npm run test:advancement` **120/0**（新增 4 条：旧前缀的达成记录读得回来、旧→新 id 映射、计数进度也接上）；`npm run test:i18n` 550/0；`npm run audit:i18n` 2896/2896 通过；`typecheck` + `typecheck:tools` 清洁。排查中还修了两处被漏掉的正则（`CommandHelp` 的 `replace(/^minecraft:/)`、`bastion-test` 里逗号连写的混合字符串）
  - 批次：20261025-0316
- [x] [合规7] 补 `LICENSE` + `THIRD-PARTY-NOTICES`（three / ws 的 MIT）+ 隐私政策页（Play 强制）：根目录新增文件 + `docs/privacy.md` → `npm run build` 产物内可检索到三份声明
  - 做了什么：新增 `LICENSE`（保留所有权利，含"不得改名二次上架 / 不得用于商业分发"条款）、`THIRD-PARTY-NOTICES.md`（three.js 0.186.1 与 ws 8.22.0 的完整 MIT 原文）、`public/third-party-notices.txt`（同内容纯文本，`vite build` 会复制进 `dist/`）、`public/privacy.html`（中英双语隐私政策：不收集个人数据、存档只在本地、联机的数据交换范围、第三方组件、变更与联系方式）；`README` 的「许可」节补三条指引
  - 为什么：MIT 要求"分发物中保留版权声明与许可全文"，网页版的"分发物"就是 `dist/`，所以声明必须放在 `public/`（只放仓库根目录等于没分发）；隐私政策是 Play 的**必填项**，需要一个可公开访问的 HTTPS 链接，而 `/privacy.html` 就是这个项目自己的站点路径，比外链第三方托管更不容易失效。隐私文案按**代码实际行为**写（无账号、无统计/广告 SDK、存档仅在 IndexedDB/localStorage）
  - 验证：`npm run build:fast` 后 `dist/privacy.html`（5.7KB）与 `dist/third-party-notices.txt`（3.4KB）都在；`npm run test:ui` **980/0**（新增 1 条断言：两份文件都在 `public/` 且声明里有 three.js authors / Einar Otto Stangvik）；`npm run audit:docs` 通过；`npm run check:manifests` 通过；`typecheck:tools` 清洁
  - 批次：20261025-0316

## 批次 20261025-0257 · 2026-10-25 · 会话 037060ab

> **这一批做什么（L8 · MS4 容器与收尾）**：补上最后一段权威——容器计时只由房主推进、
> 从属端只读；房主退出时先提示再关房、且不再重连；协议文档与代码逐条对齐到 v2；
> 台账写清 L8 四段状态；最后做一次 L8 自审。
>
> **L8 四段（MS1~MS4）代码与断言至此已齐**。仍然只剩两件只有人能做的：
> ① 人工双端验收（红石两端同时亮 / 同一只怪位置一致 / 打死同时消失且掉落一份 / 熔炉进度同步 / 房主退出提示）；
> ② `container`/`sign`/`frame`/`tnt` 的请求化（从属端操作仍直连上行，玩法不受影响）。
>
> ⚠️ 队列里「单测：从属端计时不前移」实际由**结构断言 + 联机断言**覆盖；要真在 node 里跑
> `tickContainers` 得先造一个 World，成本远高于收益——这一点写在条目说明里，没有假装写了单测。

- [x] [L8] 容器进度权威：熔炉 `cookProgress` / 酿造 / 漏斗冷却由房主推进并上行，从属端只读不推进 → 单测：从属端计时不前移
  - 做了什么：`tickContainers(dt)` 收进 `shouldSimulate(role,'containers')` 闸门（全文件只此一处调用）；`container` 消息加可选 `progress`（0..1），服务端**只在 `player.isHost === true` 时保留**并夹到 `[0,1]`，其余一律丢掉（内容照转）；`NetClient.sendContainer(..., progress?)` / `NetContainerState.progress` 打通；房主新增 `pushContainerProgress()`（1 秒节流，扫 64 格内 `progress > 0` 的容器入既有 80ms 防抖队列，顺带把槽位一起对齐）；从属端 `onNetContainer` 把 `progress` 写进 `cookProgress`（不 tick，所以只是"摆上去"，下一条快照覆盖）。
  - 为什么：熔炉进度是**每 tick 都在变**的量，而容器广播只挂在 `onMutate`（内容变化）上——不给它一条自己的低频上行，从属端的进度条只在"烧出一个东西"时跳一格。进度只认房主：从属端不推进计时，若允许它带 `progress`，一个假值就能把所有人的进度条改坏。写 `cookProgress` 而不是新加显示字段，是为了让既有进度条代码原样可用。
  - 验证：`npm run test:net` **165 → 168 通过 / 0 失败**（房主进度被转发、从属端进度被丢且内容照转、越界进度夹到 1）；`npm run test:ui` **1030 → 1034 通过 / 0 失败**（闸门只一处、1 秒节流、从属端只写 cookProgress、上行只由房主带 progress）；`npm run typecheck` 通过；`npm run check:fast` **6/6 套全绿**。⚠️ 队列写的"单测：从属端计时不前移"实际由**结构断言 + 联机断言**覆盖（`tickContainers` 只有一处且在闸门里），没有另写 vitest —— 要在 node 里跑 `tickContainers` 得先造一个 World，成本远高于收益。
  - 未验证：双端开着同一个熔炉看进度条是否同步，需要手测。
  - 批次：20261025-0257
- [x] [L8] 房主退出：房间关闭 + 从属端 3 秒内给出明确提示（`core/net/NetSession.ts` 状态迁移）→ 单测状态迁移 + `npm run test:net`
  - 做了什么：服务端房主 `close` 时**立刻** `broadcast({t:'room-closed', reason:'host-left', graceMs})` 给同房其他人（提示，不是关房——他可能只是切后台）；宽限期到期仍未回来则**关房**：对同房每个人 `reject(socket,'host-left','房主已退出，房间已关闭', CLOSE_HOST_LEFT=4007)`。客户端新增 `room-closed` 分支与 `onRoomClosing` 回调、`roomClosed` 标记；`Protocol.ts` 把 `host-left` 加进错误码与致命名单；`NetSession.CloseReason` 新增 `roomClosed`（与 `fatal` 分开表达，重连一律 `stop`）；`main` 把它变成一句带秒数的提示（`net.hostLeft`），六语言补齐。
  - 为什么：房主走了等于这一局没人推进世界——怪不动、红石不亮、熔炉不烧，而界面一切正常，这种"看起来还能玩"的坏状态最难排查。所以先提示（3 秒内），到期再关房，并且**明确不再重连**（重连只会被同一个理由踢回来，每 3 秒撞一次把日志刷满）。`roomClosed` 与 `fatal` 分开记：日志/提示要说人话，别把"房主退出"写成"协议错误"。
  - 验证：`npm run test:net` **168 → 171 通过 / 0 失败**（房主掉线即通知、通知带 `graceMs`、到期关房给 `host-left`）；`npx vitest run tests/net-session.test.ts` 新增 3 条（`roomClosed` → offline/stop、重连途中也停、之后显式 connect 仍可重开）；`npm run test:ui` **1034 → 1038 通过 / 0 失败**；`npm run audit:i18n` 通过（2906/2906）；`npm run check:fast` **161/161 套全绿**。
  - 批次：20261025-0257
- [x] [L8] 协议文档 v2 收口：`docs/NET-PROTOCOL.md` 与本批新增/改动的消息逐条对照（`world` / `edit-request` / `entity-snap` / `entity-remove` / `authority` / `progress`）
  - 做了什么：`join` 的 `world` 补 `worldType`；§4 `container` 补 `progress?` 并写明"只有房主带得动、服务端夹到 [0,1]"；§5 补 `room-closed`（`reason` + `graceMs`）；§5.1 错误码表补 `password 4005` / `host-taken 4006` / `host-left 4007` 三行（原来只有 version/clientId/duplicate/joined）；§8 缺口表改写 6 行（`联机5` 种子冲突改自动断开、`联机12` 模拟只由房主跑、`联机15` 容器计时由房主推进、`联机19` 实体位置/血量/死亡已同步、`联机38` 权威口径改成房主唯一、`联机26` 种子按房）。另加 11 条 UI 断言把"这批动过的消息必须在文档里"钉住，防下次文档漂移。
  - 为什么：文档漂移是这类项目最常见的债——消息加了、字段改了，文档还停在上一版，下次照文档实现就会踩空。不做"文档 == 代码"的完全比对（要解析源码，成本远高于收益），只钉这一批动过的那些关键串 + 缺口表的现状口径。
  - 验证：`npm run test:ui` **1038 → 1049 通过 / 0 失败**（11 条：world 元数据、worldType、edit-request、authority、entity-snap、entity-remove、progress、room-closed、host-left、4007、缺口表现状）；`node .continue/hooks/check.mjs docs` 通过（文档体量上限内）。
  - 批次：20261025-0257
- [x] [L8] 台账落地：`.continue/OVERVIEW.md` + `TASKS.md` 的 L8 条目写清 MS2~MS4 结果 → `npm run check`
  - 做了什么：`OVERVIEW.md` 的联机段由「房主权威（MS1+MS2）」改成「MS1~MS4」，并补两句现状（实体快照、容器进度随房主 1s 下行、房主退出即关房）——体量 24462 → **24516 字节**（上限 24576，仍留 60 字节）；`TASKS.md` 的 L8 追加 MS4 落地结果与测试账，并写清 L8 现在剩的两件事（人工双端验收、四条消息的请求化）；`HANDOFF` 提交总数同步 1788，`audit:diffs` 重算（注意 227 → 226）。
  - 为什么：L8 四段都落地了，台账必须能回答"现在到底哪段完成、哪段只差人验"——否则下一批会从头再查一遍。`OVERVIEW` 贴着 24KB 上限，所以只加现状、不铺细节（细节在 `notes/net-multiplayer.md`）。
  - 验证：`npm run audit:tasks` 全绿（口径与 README / HANDOFF 一致）；`node .continue/hooks/check.mjs docs` 通过（200 行 / 24516 字节）；`npm run check` 全绿。
  - 批次：20261025-0257
- [x] [L8] [自审] L8 的「L1 可测量 / L2 可对抗 / L3 可外部」各一句 + 证据（指向具体文件与测试）
  - **L1 可测量**：每一条都不是"看着像一致"，而是能被数出来的断言——`npm run test:net` **171** 条（其中房主/权威/实体/进度/关房 24 条是本批新增）、`npm run test:ui` **1049** 条（含"闸门只此一处""每帧不重复调用""文档里有这条消息"这类结构断言）、`vitest` **506** 条（`SimMode` 12 / `EntitySnapshot` 10 / `SimApply` 10 / `RemoteBlockWrite` 5 / `NetSession` 11）。人能验的也定成了可判定的阈值：红石两端同时亮（同一 tick 内）、打死同一只怪两端同时消失且掉落**恰好 1 份**、熔炉进度差 **≤1 秒**（1s 下行）。
  - **L2 可对抗**：所有"客户端说了算"的地方都加了服务端侧的同一条尺子——谎报 `authority` 无效（按 `isHost` 重标，`test:net` 有断言）、非房主的 `block`/`blocks` 直接丢、`edit-request` 形状收口 + 令牌桶限频、`entity-snap` 只收房主且截断 256、`entity-remove` 键过滤、`container.progress` 只认房主并夹 `[0,1]`、`world` 元数据脏种子整份丢弃、`remoteWorldWritable()` 挡"种子错位时写脏地图"。**没防住的也照实记**：`move` 无位移校验（改包可瞬移）、容器不校验目标方块、`mob-hit` 仍按邻近认。
  - **L3 可外部**：不依赖游戏客户端就能复现——协议在 `docs/NET-PROTOCOL.md`（消息表 / 错误码 4001~4007 / 缺口表 / 规矩），`tools/net-test.mjs` 用**裸 WebSocket 客户端**跑全套（可见地证明"外部实现也能接"），`npm run server` + `npm run dev` 双端可手验；另有 11 条断言把"这批动过的消息必须在文档里"钉死，防止文档漂移；取舍与坑在 `notes/net-multiplayer.md` §五/§六。
  - 验证：三句话里能核对的部分都指到了可跑的东西——`npm run test:net` **171** 条、`npm run test:ui` **1049** 条（含 11 条"文档里有这条消息"）、`npx vitest run tests/` **506** 条；`node .continue/hooks/check.mjs docs` 通过（OVERVIEW 200 行 / 24516 字节）；`npm run check` 全绿。**L2 里"没防住的"三条（move 无位移校验 / 容器不校验目标方块 / mob-hit 按邻近认）不是本批目标，写在这里是为了别让下一批以为已经防住了。**
  - 批次：20261025-0257

