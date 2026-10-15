# 接手必读 · HANDOFF

> 这是「Minecraft 基岩版 1.18 复刻（Web / WebGL2）」的进度交接文档。
> **换电脑、换会话、换人接手，都先读这一份**，再读 `.codebuddy/auto-continue.md`（推进队列）
> 和 [TASKS.md](./TASKS.md)（长期总表）。会话聊天记录本身不随仓库走，能带走的关键上下文都沉淀在下面。

---

## 0. 新机器 30 秒上手

```bash
git clone <远程地址> && cd minecraft
npm install
npm run agent:setup    # 恢复 AI 记忆到本机 + 自检 hooks / 环境 / 进度（有问题会直接列出来）
npm run dev            # http://localhost:5173
```

然后对 AI 说一句：**「读 HANDOFF.md 与 .codebuddy/auto-continue.md，按队列继续推进。」**
之后 Stop 钩子会自动按队列继续，不需要逐步确认（机制见第 3 节）。

验收门槛：`npm run typecheck` 与 `npm test` 全过，`npm run build` 能出包。

## 1. 当前状态快照

- 时间：2026-10-15 · 提交总数 45（每个功能点一条，可逐条回滚）
- 技术栈：TypeScript（严格模式）+ Vite + Three.js / WebGL2；无第三方运行时依赖（除 three）
- 进度口径：`TASKS.md` 共 170 项 —— 已完成 **76**、进行中 **60**、待办 34；
  其中相当一部分待办是长期大项（附魔、酿造、村民、药水效果等）
  —— **进行中口径以 `.codebuddy/auto-continue.md` 队列为准**，两份文件分工不同，不要只看一份
  —— 2026-10-15 做过一次**逐条核对**（对着 src/tools 的真实实现重判 37 条），
  勾选状态与代码实况已对齐；以后每完成一项顺手改这两份文件，避免再次漂移

已打通并实测过的部分：

| 模块 | 现状 |
| --- | --- |
| 体素引擎 | 区块 16×384×16、`Uint8Array` + 分段非空计数、Worker 池并行生成、按距离调度与卸载 |
| 渲染 | 纹理图集（运行时程序化生成 16px 贴图）、六面剔除、AO、平滑光照、自定义 ShaderMaterial、昼夜 uniform |
| 光照 | 天光列扫描 + 方块光双 BFS、跨区块传播、分帧预算、增量更新（破坏/放置后局部重算） |
| 地形 | 1.18 噪声体系（SplitMix64/Xoroshiro128++、Perlin 16 梯度、多八度、样条）、六维群系最近匹配（实测 10 种群系）、洞穴雕刻（奶酪/意面/细管/峡谷）、8 种矿石 Y 分布、地表规则 |
| 玩家 | AABB 逐轴解析、自动上台阶 0.6、速度对齐原版（走 4.317 / 疾跑 5.612 / 潜行 1.295 / 游泳 2.2 / 飞行 10.9） |
| 交互 | DDA 射线、选中描边、按硬度计时的破坏、命中面放置、快捷栏 1-9、创造/生存模式切换 |
| 物品与容器 | 物品注册表、背包 36+9、2×2 / 3×3 合成、熔炉（燃料与烧炼进度）、箱子 27 格、掉落物实体（重力/拾取/合并/5 分钟消失） |
| 方块内容 | **201 种**（6 族木材、石材家族、16 色羊毛、33 色陶瓦/混凝土、染色玻璃与玻璃板…）、方块状态、非常规形状（台阶/楼梯/栅栏/墙/门/火把/梯子） |
| 移动端 | 触摸操作层（虚拟摇杆、长按破坏）、响应式 UI、PWA 全屏元信息、Pointer Events 统一输入 |
| 地物 | `core/gen/Features.ts`：11 种树 + 花草/蘑菇/甘蔗/南瓜/西瓜/仙人掌，23 群系地物表；跨区块重放 3×3 邻域保证树冠不断 |
| 结构 | `core/gen/Structures.ts`：村庄/废弃矿井/要塞/地牢/沉船/海底神殿/林地府邸，间距+分离度+盐值放置框架 |
| 下界 | `core/gen/NetherGenerator.ts` + `Dimension.ts`：岩浆海 + 洞窟 + 5 个下界群系 + 菌菇树等；`N` 键切维度 |
| 测试 | `npm test` = 13 套离线测试（inventory/crafting/furnace/entity/shapes/biome/aquifer/ore/mesh/survival/mob/spawn/combat/decor/structure/nether），当前全绿 |

下一步的大头（队列与 TASKS.md 都能看到）：含水层、大矿脉、贪心网格化 + 网格化移入 Worker、
生存机制（生命/饥饿/摔落）、生物 AI 与生成、结构生成、红石、存档（IndexedDB）与联机。

## 2. 两条硬性约定（用户要求，必须遵守）

1. **每个独立改动单独提交**：review 变更 → 中文 commit message → `git add` → `git commit` → `git push`，
   全程自动、不等确认；不要攒成一个巨型提交，版本历史要能逐条回溯/回滚。
2. **不停下来等确认**：按 `.codebuddy/auto-continue.md` 队列自己推进；遇到困难自己想办法解决并记录结论，
   而不是把问题抛回给用户。

细节与动机记录在仓库内 `.codebuddy/memory/`（AI 记忆的版本化副本）。

## 3. 自动继续机制（换机器最容易坏在这）

- 钩子脚本：`.codebuddy/hooks/auto-continue.mjs`（Stop / UserPromptSubmit 两个事件）
- 配置：`.codebuddy/settings.json` —— **用相对路径**写命令，换机器才不会失效；
  若你的环境里相对路径不生效（AI 不自动继续），执行 `npm run agent:setup -- --fix-hooks` 自动改成本机绝对路径。
- 紧急刹车：`touch .codebuddy/auto-continue.off`；恢复：`rm .codebuddy/auto-continue.off`
- 单会话次数上限：环境变量 `AUTO_CONTINUE_MAX`（默认 12）
- 排查用日志：`.codebuddy/auto-continue.log`（每轮一行 JSON，能看到 `decision=block` 就说明钩子生效）

**踩过的坑（别重犯）**：Stop 钩子里输出 `{"continue": false}` 会被实现层当成"硬停止"，
表现为 AI 真的停了、不自动继续；正确写法是 `{"continue": true}` + 反馈走 **stderr** + `exit 2`。

## 3.5 本轮（J1/J2/J3）新增的硬性约定

**跨区块地物/结构必须"只依赖世界坐标"**：一棵树的树冠会伸进邻居区块，村庄会横跨好几个区块。
做法是"生成区块 C 时重放 3×3 邻域里各地物的实例，只写入落在 C 的部分"，于是每个地物只属于一个区块。
但这条机制成立的前提是**地物的每个决策都是世界坐标的纯函数**——一旦某处读了本区块的方块数据来做判断，
拥有者与邻居就会得出两种结论，接缝上的树冠只会剩半边。为此：

- `OverworldGenerator.surfaceY(x,z)` 提供"世界坐标 → 地表高度"（4 个粗网格节点求零点再双线性插值）；
- 树干用**强制写入** + 只在拥有者区块里向下补齐（估算高度差 1~3 格时不会悬空）；
- 单列地物（草花蘑菇……）不参与邻域重放，直接用本区块真实地面校准落点；
- 下界的地板高度是解析式，天然满足这条约定。

## 4. 已定论的经验（省时间，别重复踩）

| 症状 | 根因 |
| --- | --- |
| 全场景莫名暗约 45% | 贴图色彩空间：自定义着色器必须按原始数据采样（`NoColorSpace`），标成 sRGB 会被二次处理（E18） |
| 飞到地形之上建造时整片全黑 | 天光初始化只算到"最高非空 section"，地形之上的开放天空没写满级天光（E19） |
| 运行时放置荧石不发光 | 自发光播种被误放进 `opacity<15` 分支，区块生成路径掩盖了它 |
| 方块表错位、`blockDef(id)` 静默返回错误方块 | `BLOCKS` 按数组下标索引，id 必须从 0 开始连续（已加构建期强校验） |
| 地形平坦、群系只剩几种 | 多八度噪声按 `1/Σ|振幅|` 归一化把幅度压小了，样条量纲对不上；须按方差归一化（D1b） |
| 抓 wiki 数据失败 | zh.minecraft.wiki 对脚本抓取返回 403 → 地形参数是"算法结构对齐 + 视觉校准"，不是逐位对齐官方 JSON（已在注释与 TASKS 标注） |
| 地物高度估算与地形差出几十格 | 真实地形是**粗网格取样 + 三线性插值**，不要对密度解析式直接求根；必须在 4×8×4 粗网格的 Y 层上求零点（J2） |
| 花草几乎不生成 | 用估算高度去找"草方块那一格"，命中率极低；单列地物应当用本区块真实数据把落点校准到地面上（J2） |
| 下界"天空"还是蓝色 | `scene.background` 优先于 `renderer.setClearColor`，切维度必须同时改前者（J3） |
| 下界一片纯黑 | 下界没有天光，方块光的传播范围又有限；靠 `VoxelMaterial.setMinBrightness` 抬高亮度下限（下界 0.24）（J3） |
| 下界洞顶漏光 / 被顶穿 | 洞顶高度是噪声函数，偶尔会超出预期范围 → 必须夹紧（`ceilingAt` 上限 `NETHER_CEILING`）（J3） |
| 版权素材 | 官方贴图/音效不随仓库分发；贴图运行时程序化生成，P9 计划支持玩家自备资源包 |

## 5. 待复核的悬案（下次接手优先看）

非完整方块展示平台整体偏暗，而同处探针显示天光已是 15。怀疑**网格在光照收敛前就被烘焙**了。
调试面板已输出两个数：`光照队列`（`World.lightWorkCount` → `LightEngine.pendingCells`）与 `待重刷`
（见 `src/main.ts` 调试面板一行）。复现与判据：站上平台，观察这两个数是否归零、
归零后该区块的网格有没有重新生成；若没重刷，就是队列收敛后缺少"脏区块重新入网格队列"的一步。

## 5.5 打包与发布（K8）

**PWA 已经可用**：`npm run build` 的产物里带 `manifest.webmanifest`、`sw.js`、`icon.svg`，
Service Worker 只在生产模式注册（开发时注册会把 vite 的开发资源缓存住，改代码看不到效果——
这是 PWA 开发最常见的坑）。验收：`sh tools/pwa-check.sh`。
缓存策略：导航请求网络优先、静态资源缓存优先 + 后台更新。

**想套壳成 App 时**（本项目没装这些依赖，按需再加）：

- **Android（Capacitor）**：
  `npm i -D @capacitor/cli && npm i @capacitor/core @capacitor/android` →
  `npx cap init` → `npm run build` → `npx cap add android` → `npx cap sync` → `npx cap open android`。
  注意 `vite.config.ts` 用的是 `base: './'`（相对路径），套壳与 PWA 都能直接用，不必为 `file://` 另做构建。
- **桌面（Electron）**：`npm i -D electron`，主进程 `loadFile('dist/index.html')`；
  存档走 IndexedDB，默认持久化在用户数据目录。
- **手机浏览器直接用**：`npm run dev -- --host` 后用手机访问局域网地址（触控层自动启用），
  真机验收清单见 `TASKS.md` 的 M17。

## 6. 常用命令与调试接口

```bash
npm run dev         # 开发服务器
npm run typecheck   # tsc --noEmit（提交前必过）
npm run build       # 类型检查 + 生产构建
npm test            # 18 套离线测试（含 decor/structure/nether/end/redstone/save/net）
npm run gen:stats   # 地形生成统计（耗时/洞穴占比/矿石产量）
npm run agent:setup # 跨机器自检
```

浏览器控制台 `window.__mc`（`src/main.ts` 末尾挂的 App 实例）：
`connect(url,name)` / `disconnect()` / `netState` / `sendChat(text)` / `saveNow()` /
`clearSaveAndReload()` / `saveStatus` / `openSettings()` / `updateSettings(patch)` /
`blockId(name)` / `simulateFrameTime(ms)` /
`teleport(x,y,z)` / `teleportForce` / `look(yawDeg,pitchDeg)` / `setTimeOfDay(t)` /
`setDimension('overworld'|'nether')` / `toggleDimension()` /
`probe(x,y,z)`（方块 + 天光 + 方块光）/ `probeState` / `column(x,z)` / `sampleColumns(x0,z0,step)` /
`place(x,y,z,blockId,state)` / `dropItem(itemId,count,x,y,z)`，另有 info / 实体列表等。

其它：`tools/pixel-probe.mjs` 直接解码 PNG 取像素亮度，把"看起来偏暗"变成可对比数字。

## 7. 跨机器同步的边界

| 随仓库走（git 跟踪） | 只在本机（已 gitignore） |
| --- | --- |
| `TASKS.md`、`HANDOFF.md`、`README.md`、`src/`、`tools/` | `node_modules/`、`dist/`、`.tmp/`（构建与测试产物） |
| `.codebuddy/auto-continue.md`（推进队列）、`.codebuddy/hooks/`、`.codebuddy/settings.json` | `.codebuddy/auto-continue.state.json`、`.codebuddy/auto-continue.log` |
| `.codebuddy/memory/`（AI 记忆的版本化副本，`npm run agent:setup` 恢复到本机） | 截图 `shot-*.png`、`.codebuddy/auto-continue.off` |

**唯一的外部依赖：git 远程仓库。** 没有远程，代码就只存在当前这台机器上，换电脑拿不到。
查看：`git remote -v`；没有就 `git remote add origin <地址>` 再 `git push -u origin main`。

## 8. 恢复一段会话的正确姿势

1. 新机器按第 0 节跑完，确认 `npm run agent:setup` 结论是「一切就绪」；
2. 打开 AI 会话，第一句给足上下文：
   「读 HANDOFF.md、.codebuddy/memory/MEMORY.md、.codebuddy/auto-continue.md，然后继续推进队列」；
3. AI 会自动：读队列 → 改 `[ ]` 为 `[~]` → 实现 → 自测（typecheck + 实测）→ 每步单独提交推送 → 更新队列；
4. 中途想接管：`touch .codebuddy/auto-continue.off`；想让它继续：删掉该文件。
