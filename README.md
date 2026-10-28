# Minicraft

浏览器里的方块沙盒（TypeScript + Vite + Three.js / WebGL2）：无限地形、生存与创造、
合成与红石、多世界存档与联机。

## 关于这个项目

这是一个从零开发的方块沙盒：地形生成、光照、渲染管线、合成表、生物 AI、界面与存档
都是本项目自己实现的，**不依赖任何外部素材**——贴图与音效全部在运行时由代码生成，
P9 另支持加载玩家自备的资源包（`.mcpack`）。

每个阶段都交付可运行成果；长期清单在 [`.continue/TASKS.md`](./.continue/TASKS.md)。

## 快速开始

```bash
npm install
npm run dev         # 开发服务器 http://localhost:5173
npm run typecheck   # 类型检查
npm test            # 先过 tools 的类型检查，再跑 vitest + 183 套自建离线测试（含可达性审计）
npm run check       # 提交前门禁：`typecheck` + `test` + 三张台账，任一失败即非零退出
npm run check:fast  # 改代码时的内循环：只跑被本次改动命中的那几套离线测试
npm run build       # 生产构建（`npm run build:fast` 是关掉 sourcemap 的快版本）
npm run audit:tasks  # 锚点文档自检（进度口径、编号、README 路线图同步）
npm run audit:coverage # 覆盖度台账：从注册表量出各维度覆盖率并写回 TASKS §1
```

> 用 AI 推进这个仓库时，先读 [`AGENTS.md`](./AGENTS.md)（会话入口 + 该展开哪些文档的索引）。
> 183 套离线测试由 `tools/run-tests.mjs` 聚合跑（一次打包 + 并行执行）；
> 单套仍可直接 `npm run test:reach` 这样跑。

操作：`W/A/S/D` 移动 · `Space` 跳跃/上升 · `Shift` 潜行/下降 · `Ctrl` 疾跑 ·
鼠标左键挖掘/攻击 · 右键放置/使用 · `1`-`9` 切快捷栏 · `E` 背包 · `R` 配方书 ·
`T`（或 `/`）聊天与命令 · `F` 切换飞行 · `V` 切人称 · `N` 切维度 · `L` 连/断联机 ·
`J` 成就 / 进度 · `Esc` 暂停菜单（内含设置与成就）。触摸端另有虚拟摇杆与按钮
（`ui/TouchControls.ts`），成就的入口在背包标题栏上。

## 发布（GitHub Pages）

线上地址：**https://masontool.github.io/minicraft-ai-web/**

推送 `main` 即自动构建并发布，配置见 [`.github/workflows/deploy-pages.yml`](./.github/workflows/deploy-pages.yml)。
仓库侧只需做一次设置：

```
Settings → Pages → Build and deployment → Source = GitHub Actions
```

之后在 Actions 页面手动跑一次 `Deploy to GitHub Pages`（或随便推一个提交）即可上线。
工作流跑完但线上 404，几乎都是这一步没改——Pages 仍停在默认的 "Deploy from a branch"。

几个已经踩平的坑，改代码时注意别退回去：

- **路径**：`vite.config.ts` 的 `base` 必须是相对值 `'./'`，否则产物会去域名根目录找
  `assets/*.js`（Pages 上本项目位于 `/<repo>/` 子路径）。
- **PWA**：`index.html` 与 `manifest.webmanifest` 里的路径同样全是相对的；
  Service Worker 按作用域注册在 `/<repo>/`，跨子路径不会串味。
- **不用配 COOP/COEP**：项目没用到 `SharedArrayBuffer`，因此也不需要 Pages
  无法自定义的响应头。
- **联机在 Pages 上要自己挂服务端**：`defaultServerUrl()` 现在按页面协议分流——https
  页面给 `wss://<同源>/ws`（配合一条反代），http 页面给 `ws://<hostname>:8787`；
  页面地址带 `?server=wss://你的域名/ws` 时可以显式覆盖。部署步骤（Dockerfile / nginx
  反代 / 健康检查 `/healthz` / 环境变量 / 备份）见
  [`.continue/notes/multiplayer-ops.md`](./.continue/notes/multiplayer-ops.md)。

## 路线图

> 完整的任务清单见 [.continue/TASKS.md](./.continue/TASKS.md)（294 项，按 A~O 分段；这个数由 `npm run audit:tasks` 核对）。
> **下表的"状态"列由 `npm run audit:tasks` 从 `.continue/TASKS.md` 自动算出来**，
> 手写会漂（这张表曾经整体停在"未开始"，而实际早已完成大半）。

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| **P0** 工程基建 | 仓库、TS + Vite、渲染管线打通（方块 → 区块 → 网格化 → 图集 → 相机） | ✅ 全部完成（73 项） |
| **P1** 体素引擎核心 | 完整方块注册表、区块调度与流式加载、贪心网格化、Web Worker 生成、光照引擎 | 🔶 已完成 51 / 共 52 |
| **P2** 地形生成 1.18 | 多噪声群系源、7 个密度函数、样条插值、地表规则、洞穴/峡谷、含水层、矿物 Y 分布、地物 | ✅ 全部完成（26 项） |
| **P3** 玩家与交互 | AABB 物理、疾跑/潜行/游泳/摔伤、射线选块、破坏耗时与工具等级、方块掉落 | ✅ 全部完成（31 项） |
| **P4** 物品与合成 | 物品注册表、背包 36 格、2×2 / 3×3 合成、熔炉、箱子 | ✅ 全部完成（19 项） |
| **P5** 生存机制 | 生命/饥饿/饱和度、生物生成、昼夜循环、天气、床与重生 | ✅ 全部完成（22 项） |
| **P6** 实体与生物 | 实体框架、怪物 AI 与寻路、战斗、掉落物、繁殖 | ✅ 全部完成（22 项） |
| **P7** 世界特色 | 村庄/遗迹结构、下界、末地、红石、附魔、酿造 | 🔶 已完成 10 / 共 11 |
| **P8** 存档与联机 | IndexedDB 存档、WebSocket 多人 | 🔶 已完成 31 / 共 33 |
| **P9** UI 与音频 | 主菜单/设置、资源包加载、音效 | 🔶 已完成 34 / 共 36 |

## 目录结构

**一个仓库、五个产物**，按产物分目录（2026-10-29 重排）：

```
web/              Web 端：游戏本体的唯一源码与构建入口（产物 web/dist）
  src/            游戏代码（下面这份明细就是 web/src 的结构）
  index.html      页面外壳（设计令牌、布局规则都在这里）
  public/         PWA 清单、Service Worker、隐私政策等静态文件
  vite.config.ts  产品级构建配置（root 自锚定到本目录）
android/          Android 壳（Capacitor）：消费 web/dist，负责签名闸门与核心数据解封
ios/              iOS 壳：与 android/ 对等（CoreVault 解封 + 签名身份校验）
server/           服务端与原生库：node/（Node 版）· rust/（Rust 版）· ios/（iOS 静态库）
desktop/          桌面端运行时（Electron，Windows / macOS 共用一份 main.mjs）
windows/          Windows 打包：NSIS 配置 + 图标
mac/              macOS 打包：dmg 配置 + entitlements + 图标
tools/            离线测试与自检脚本（每个 test:* 一个）
tests/            vitest 用例（光照、生成、碰撞、资源包）
docs/             设计方案与发布说明（按需读）
host/             核心数据基线（明文只允许出现在这里与 .tmp/）
```

`web/src` 内部：

```
  src/
  core/
    registry/     方块 / 物品 / 工具 / 盔甲注册表，中文名与说明
    world/        区块与世界存储（光照、流体、计划刻）
    gen/          地形生成（1.18 噪声体系、群系、洞穴、地物、结构）
    mesh/         区块贪心网格化
    light/        光照引擎（天光 + 方块光 BFS）
    physics/      玩家 AABB 物理
    interaction/  射线选块、实体射线
    container/    背包、箱子、熔炉容器
    crafting/     配方表、合成网格、配方书、熔炼
    survival/     生命/饥饿/氧气、状态效果
    entity/       实体框架、生物 AI、掉落物
    redstone/     红石电路引擎
    save/         IndexedDB 存档（增量编解码）
    audio/        程序化音效
    commands/     聊天命令
    resourcepack/ 资源包（.mcpack）加载
    tick/         计划刻/随机刻调度
  render/         渲染（体素材质、图集、区块/实体/手部/玩家模型、粒子、天空天气）
  ui/             界面（背包、配方书、悬浮提示、设置、聊天、虚拟摇杆、状态 HUD、主菜单）
  game/           入口层的非类代码（调参常量、开发期初始物资）
  net/            WebSocket 多人（客户端）
  worker/         区块生成与网格化的 Worker
  main.ts         应用入口（纯入口 + `App` 类；**按段落名 grep 定位，不要整份读**）
```

## 性能目标

桌面端 12~16 区块视距稳定 60fps。若 Web 端最终无法满足目标，
备选方案是用 Capacitor 套壳为 Android 应用并切换原生 WebGL 实现。

## 许可

本项目为学习/研究用途，代码与运行时生成的素材均由本项目自己产出。

- 授权范围（保留所有权利）见 [`LICENSE`](./LICENSE)；
- 分发的第三方库（three.js / ws，均 MIT）见 [`THIRD-PARTY-NOTICES.md`](./THIRD-PARTY-NOTICES.md)，
  构建产物里另有一份纯文本副本 `third-party-notices.txt`；
- 隐私政策（上架应用商店用）见 [`web/public/privacy.html`](./web/public/privacy.html)。
