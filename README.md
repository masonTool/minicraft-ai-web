# Bedrock 1.18 Web

Minecraft 基岩版 **1.18** 的 Web 复刻项目（TypeScript + Vite + Three.js / WebGL2）。

## 关于"完全复刻"的说明

基岩版 1.18 是上百人团队十余年迭代的产物（约 800 种方块状态、1300+ 物品、70+ 生物、
60+ 群系，外加红石、附魔、酿造、结构生成与自研渲染管线）。**逐行 1:1 复刻不现实。**

本项目的目标是：**按原版规则实现核心系统，做一个高度还原、可玩的 1.18 沙盒**，
并且每个阶段都交付可运行成果。原版材质受版权保护，项目内的贴图全部在运行时程序化生成；
P9 支持加载玩家自备的资源包（`.mcpack`）。

## 快速开始

```bash
npm install
npm run dev         # 开发服务器 http://localhost:5173
npm run typecheck   # 类型检查
npm test            # 先过 tools 的类型检查，再跑 vitest + 131 套自建离线测试（含可达性审计）
npm run check       # 提交前门禁：`typecheck` + `test` + 三张台账，任一失败即非零退出
npm run check:fast  # 改代码时的内循环：只跑被本次改动命中的那几套离线测试
npm run build       # 生产构建（`npm run build:fast` 是关掉 sourcemap 的快版本）
npm run audit:tasks  # 锚点文档自检（进度口径、编号、README 路线图同步）
npm run audit:coverage # 覆盖度台账：从注册表量出各维度覆盖率并写回 TASKS §1
```

> 用 AI 推进这个仓库时，先读 [`AGENTS.md`](./AGENTS.md)（会话入口 + 该展开哪些文档的索引）。
> 131 套离线测试由 `tools/run-tests.mjs` 聚合跑（一次打包 + 并行执行）；
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
- **联机在 Pages 上默认不可用**：`defaultServerUrl()` 给的是 `ws://<当前域名>:8787`，
  而 Pages 是 HTTPS 页面，浏览器会直接拦掉这种混合内容。要用联机得自己跑
  `npm run server` 并挂一个 `wss://` 反向代理，再在游戏里连：
  控制台执行 `mc.connect('wss://你的域名', '昵称')`（`L` 键是连默认地址）。

## 路线图

> 完整的任务清单见 [TASKS.md](./TASKS.md)（170+ 项，按 A~O 分段）。
> **下表的"状态"列由 `npm run audit:tasks` 从 TASKS.md 自动算出来**，
> 手写会漂（这张表曾经整体停在"未开始"，而实际早已完成大半）。

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| **P0** 工程基建 | 仓库、TS + Vite、渲染管线打通（方块 → 区块 → 网格化 → 图集 → 相机） | 🔶 已完成 44 / 共 57 |
| **P1** 体素引擎核心 | 完整方块注册表、区块调度与流式加载、贪心网格化、Web Worker 生成、光照引擎 | 🔶 已完成 38 / 共 52 |
| **P2** 地形生成 1.18 | 多噪声群系源、7 个密度函数、样条插值、地表规则、洞穴/峡谷、含水层、矿物 Y 分布、地物 | 🔶 已完成 18 / 共 26 |
| **P3** 玩家与交互 | AABB 物理、疾跑/潜行/游泳/摔伤、射线选块、破坏耗时与工具等级、方块掉落 | 🔶 已完成 15 / 共 26 |
| **P4** 物品与合成 | 物品注册表、背包 36 格、2×2 / 3×3 合成、熔炉、箱子 | 🔶 已完成 12 / 共 19 |
| **P5** 生存机制 | 生命/饥饿/饱和度、生物生成、昼夜循环、天气、床与重生 | 🔶 已完成 17 / 共 22 |
| **P6** 实体与生物 | 实体框架、怪物 AI 与寻路、战斗、掉落物、繁殖 | 🔶 已完成 6 / 共 21 |
| **P7** 世界特色 | 村庄/遗迹结构、下界、末地、红石、附魔、酿造 | 🔶 已完成 5 / 共 11 |
| **P8** 存档与联机 | IndexedDB 存档、WebSocket 多人 | 🔶 已完成 1 / 共 5 |
| **P9** UI 与音频 | 主菜单/设置、资源包加载、音效 | 🔶 已完成 19 / 共 35 |

## 目录结构

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
docs/             HANDOFF 的历史归档与"已定论的经验"（按需读，不是每轮必读）
server/           联机用的 Node WebSocket 服务端
tools/            离线测试与自检脚本（每个 test:* 一个）
tests/            vitest 用例（光照、生成、碰撞、资源包）
```

## 性能目标

桌面端 12~16 区块视距稳定 60fps。若 Web 端最终无法满足目标，
备选方案是用 Capacitor 套壳为 Android 应用并切换原生 WebGL 实现。

## 许可

本项目为学习/研究用途，与 Mojang / Microsoft 无关联。
`minecraft` 及相关名称、素材版权归 Mojang Studios 所有。
