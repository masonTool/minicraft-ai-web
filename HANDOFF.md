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

- 时间：2026-10-15 · 提交总数 47（每个功能点一条，可逐条回滚）
- 技术栈：TypeScript（严格模式）+ Vite + Three.js / WebGL2；无第三方运行时依赖（除 three）
- 进度口径：`TASKS.md` 共 173 项 —— 已完成 **95**、进行中 **57**、待办 21；
  （`npm run audit:tasks` 会核对这一行与本表，改完条目记得跑一次）
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
| 工具与武器 | `core/registry/tools.ts`：25 种工具（木/石/铁/金/钻石 × 镐/斧/锹/锄/剑），等级 0-3、速度、耐久、攻击伤害全落到物品上；**采集等级校验**（石镐挖钻石矿＝挖得动但一无所获）、挖掘耗时按工具加速、工具耐久随存档走（`ItemStack.damage`，归零整件消失）；配方 25 条、中文名与说明自动生成 |
| 盔甲与防御 | `core/registry/armor.ts`：20 件盔甲（皮革/锁链/铁/金/钻石 × 头/胸/腿/靴），护甲值满套 7/12/15/11/20、韧性只有钻石有；**1.9 之后那条减伤公式**（高伤害压到"护甲值 × 0.2"的保底线）；摔落/溺水/饿死/虚空/窒息/中毒无视护甲；受击每件掉 `max(1, ⌊伤害/4⌋)` 点耐久。减伤挂在 `PlayerStats.damage` 统一入口，所以岩浆/仙人掌也自动减伤；背包 36-39 号槽真正能穿（部位校验 + 空槽提示字），护甲 HUD 只在有甲时出现 |
| 方块内容 | **201 种**（6 族木材、石材家族、16 色羊毛、33 色陶瓦/混凝土、染色玻璃与玻璃板…）、方块状态、非常规形状（台阶/楼梯/栅栏/墙/门/火把/梯子） |
| 移动端 | 触摸操作层（虚拟摇杆、长按破坏）、响应式 UI、PWA 全屏元信息、Pointer Events 统一输入 |
| 地物 | `core/gen/Features.ts`：11 种树 + 花草/蘑菇/甘蔗/南瓜/西瓜/仙人掌，23 群系地物表；跨区块重放 3×3 邻域保证树冠不断 |
| 结构 | `core/gen/Structures.ts`：村庄/废弃矿井/要塞/地牢/沉船/海底神殿/林地府邸，间距+分离度+盐值放置框架 |
| 下界 | `core/gen/NetherGenerator.ts` + `Dimension.ts`：岩浆海 + 洞窟 + 5 个下界群系 + 菌菇树等；`N` 键切维度 |
| 命令与规则 | `core/commands/Commands.ts`（16 条命令，解析层不碰 DOM）+ `ui/ChatInput.ts`（消息栏与输入行）、`core/world/Rules.ts`（难度与六条游戏规则） |
| 状态效果 | `core/survival/StatusEffects.ts`（30 种，影响移速/跳跃/挖掘/伤害/氧气/视觉/HUD） |
| 破坏反馈 | `render/BlockOverlay.ts`（10 阶段破坏裂纹 + 命中面高亮）、图集里的 `destroy_stage_*` 贴图 |
| 水面动画 | `VoxelMaterial` 的 `uTime` / `uFluidTiles`（按贴图起点识别流体，顶点做波浪、片元滚动贴图） |
| 随机刻与流体 | `core/tick/RandomTicks.ts`（随机刻行为表 + 计划刻队列）、`core/world/Fluids.ts`（液面等级、无限水源、水火相遇） |
| 人称与世界 | `core/viewMode.ts`（相机摆位纯函数）、`render/PlayerRenderer.ts`（玩家模型）、`core/save/WorldRegistry.ts`（世界清单）、`ui/WorldScreen.ts`（主菜单）、`core/gen/WorldType.ts` + `FlatGenerator.ts`（超平坦/放大化） |
| 说明与配方 | `core/registry/itemNames.ts`（366 条中文名 + 说明）、`ui/Tooltip.ts`（悬停提示）、`core/crafting/RecipeBook.ts` + `ui/RecipeBook.ts`（配方书与一键合成，135 条配方） |
| 粒子与手持 | `render/ParticleSystem.ts`（池化、单 draw call、六类粒子）、`render/HandRenderer.ts`（独立场景叠画的手持物品与手臂）、`render/ScreenEffects.ts`（水下/岩浆整屏色罩） |
| 测试 | `npm test` = vitest（光照/碰撞/生成/存档/资源包/音效）+ **23 套**自建离线测试：inventory / crafting / furnace / entity / shapes / biome / aquifer / ore / mesh / survival / mob / spawn / combat / decor / structure / sound / nether / end / endboss / redstone / save / net / render / view / world / settings / recipebook / tool / **armor**，当前全绿；`npm run audit:tasks` 自检锚点文档 |

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
| 手臂 / 色罩颜色偏成橙褐色 | `new THREE.Color(hex)` 会做一次 sRGB→线性（0.86→0.72），而自定义 ShaderMaterial 是**原样写进帧缓冲**的 → 平色一律用 `render/srgb.ts` 的 `srgbColor()`；连 `getHex()` 读出来也要加 `NoColorSpace`（E15） |
| 手持物品的位置 / 大小怎么摆 | 别纯靠投影公式推：先用洋红把整只手染色，扫截图里洋红像素的包围盒，再按"差多少像素就是差多少格"反推（E15） |
| 面板被遮罩/死亡界面盖住 | 面板的 z-index 只在**同一个层叠上下文**里比较。挂在 `#app` 里的话，DOM 更靠后的 `#overlay` / `#death` 永远在它上面 → 所有面板一律挂 `<body>`（用 `document.elementFromPoint` 定位是谁盖住了谁）（本轮） |
| 设置滑块调了没反应 | "滑块存在"不等于"接线了"：灵敏度曾经就是这样（一直用常量）。加设置项时把**消费它的每一条路径**都搜出来（鼠标/触摸/手柄/渲染器）（本轮） |
| 界面里冒出英文 id | 新增方块/物品时中文名表不会自动跟上。用"每个方块都有中文名"这条断言把缺口暴露出来（`missingBlockNames()`），比等人发现强（本轮） |
| 加了世界类型但地形没变 | 生成器是**按种子缓存**的（`generators` Map），世界类型必须进缓存键，否则同一种子的两种世界会串（本轮） |
| 随机刻"什么都没发生" | 384 格高度里纯随机取点，命中地表的概率极低（实测 400 次抽样 0 格变化）→ 必须先在所有**非空 section** 里挑段再段内随机（`sectionCounts`）（本轮） |
| 水体把贪心网格化废掉 | 水源按原版做成 0.875 格高会让海洋每格水退化成独立面，三角形 28648 → 65538 → **水源保持满格**，只有流动的水才按等级变薄；"整格判定"要抽成共用函数（`isFullBlockShape`），连测试的逐面基准值也用它，否则基准与实际实现会悄悄跑偏（本轮） |
| 放下的水永远不流动 | 唤醒流体时必须连**自己**一起排进计划刻：刚放的那格四周还是空气，只唤醒邻居谁都不会被唤醒（`wakeFluidAt`）（本轮） |
| 死亡率相关规则"没对象可控" | 加规则前先看它管的是什么：`mobGriefing` 在苦力怕会爆炸之前根本没有意义 → 先补上引信与爆炸（本轮） |
| 加了新设置/新字段没人用 | 滑块存在 ≠ 接线（灵敏度曾是个摆设），难度/规则也要"随世界存 + 读档回退默认 + 脏数据逐项校验"，否则老存档一读就崩（本轮） |
| 叠加层"在某个面看不见" | 顶点绕序写反的面会被 `FrontSide` 背面剔除。症状很迷惑："裂纹在顶面看不见、别的面却看得见"，而顶面恰恰最常挖。判定：`cross(c1-c0, c2-c0)` 必须与面的外法线同向（已加 `facesWithInwardWinding()` 断言）（本轮） |
| 动画"看不出在动" | 贴图要是纯噪声，滚动起来像素差只有 1~3。要让流动看得出来，**贴图本身得有条纹**（水贴图加了 ±16% 斜向波纹后，1 秒内像素差到 4~6）（本轮） |
| 给着色器传"编译期常量" | GLSL ES 1.0 的数组长度与循环上界必须是字面量 → 用 `${CONST}` 插值进 shader 字符串，并且那个常量必须定义在字符串**之前**（`const` 有 TDZ，写在后面会直接 ReferenceError）（本轮） |
| 第二遍 render 把世界清掉 | 叠画手持物品 / 色罩之前必须 `renderer.autoClear = false` + `clearDepth()`，画完再改回来（E15/E16） |
| 版权素材 | 官方贴图/音效不随仓库分发；贴图运行时程序化生成，P9 计划支持玩家自备资源包 |
| 新加的"加速工具表"漏掉了橡木 | `Wood` 表只装了 5 种**追加**木材，橡木是基础方块（id 5/6/7 与台阶 80/楼梯 84），不在表里。凡是"遍历 `Object.values(Wood)` 批量注册"的地方都要显式补上橡木——否则会出现"砍云杉有加速、砍橡木没有"这种半残状态（本轮） |
| 工具耐久放在哪 | 放 `ItemStack.damage`（可选字段）而不是每种损耗各占一个物品 id：存档、取出、交换都天然跟着走。代价是 `Inventory.moveTo` 要改——`maxStack 1` 的物品不能走"合并"分支，否则两把同款工具互拖会变成"什么都没发生"（本轮） |
| 两条完全一样的配方必然撞车 | 锁链盔甲在原版的材料（铁锭）与图案都与铁盔甲**逐格相同**，一旦给它写配方，配方表里只会留下先注册的那一条，另一条永远合不出来（`matchRecipe` 取首个匹配）。原版干脆不给它配方——**照抄原版反而是唯一自洽的做法**。写"批量生成配方"的代码时，先想清楚两张表会不会生成重复项（本轮） |
| 减伤挂在哪个入口 | 挂在 `PlayerStats.damage` 这一条统一路径上，而不是每个伤害来源（生物攻击/爆炸）各写一遍：摔落、岩浆、仙人掌这些伤害是在 `PlayerStats.tick` 内部产生的，只挂外部入口会漏掉；顺带拿到的收益是"哪些伤害无视护甲"只用写一张表（本轮） |
| 盔甲接口为什么不放 armor.ts | `ArmorAbsorber` 声明在**消费方** `PlayerStats.ts`，`armor.ts` 结构上满足它即可。否则 `survival` 会反向依赖 `registry`，armor → items → Inventory → armor 还会绕成一个环（本轮） |

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
npm test            # 23 套离线测试（含 tool/armor/decor/structure/nether/end/redstone/save/net/render/view/world/settings/recipebook）
npm run audit:tasks # 任务清单自检（编号重复/跳号 + 本文件进度口径是否过期）
npm run gen:stats   # 地形生成统计（耗时/洞穴占比/矿石产量）
npm run agent:setup # 跨机器自检
```

浏览器控制台 `window.__mc`（`src/main.ts` 末尾挂的 App 实例）：
`connect(url,name)` / `disconnect()` / `netState` / `sendChat(text)` / `saveNow()` /
`saveStatus` / `openSettings()` / `updateSettings(patch)` / `setCameraMode()` / `cycleCameraMode()` /
`toggleRecipeBookForTest()` / `hoverHotbarForTest()` / `runCommand(text)` / `openChatForTest()` /
`blockId(name)` / `simulateFrameTime(ms)` /
`teleport(x,y,z)` / `teleportForce` / `look(yawDeg,pitchDeg)` / `setTimeOfDay(t)` /
`setDimension('overworld'|'nether'|'end')` / `toggleDimension()` /
`__worldMenu`（主菜单：`fillNewWorldForm()` / `submitNewWorld()` / `render()`）/
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
