# 接手必读 · HANDOFF

> 这是「Minecraft 基岩版 1.18 复刻（Web / WebGL2）」的进度交接文档。
> **换电脑、换会话、换人接手，都先读这一份**，再读 `.codebuddy/auto-continue.md`（推进队列）
> 和 [TASKS.md](./TASKS.md)（长期总表）。会话聊天记录本身不随仓库走，能带走的关键上下文都沉淀在下面。

---

## 0. 新机器 30 秒上手

```bash
git clone <远程地址> && cd <仓库目录>
npm install
npm run agent:setup    # 恢复 AI 记忆到本机 + 自检 hooks / 环境 / 进度（有问题会直接列出来）
npm run dev            # http://localhost:5173
```

> `agent:setup` 走的是 `tools/agent-setup.mjs`。本脚本此前在 `package.json` 里**没有对应的
> script 键**（文档写着 `npm run agent:setup`、实际会报 "Missing script"），已补回；
> 首次在新机器上接手时如又报缺失，先确认这一行还在。

然后对 AI 说一句：**「读 HANDOFF.md 与 .codebuddy/auto-continue.md，按队列继续推进。」**
之后 Stop 钩子会自动按队列继续，不需要逐步确认（机制见第 3 节）。

验收门槛：`npm run typecheck` 与 `npm test` 全过，`npm run build` 能出包。

## 1. 当前状态快照

- 时间：2026-10-16 · 提交总数 148（每个功能点一条，可逐条回滚；`npm run audit:tasks` 会核对这一句）
- 技术栈：TypeScript（严格模式）+ Vite + Three.js / WebGL2；无第三方运行时依赖（除 three）
- 进度口径：`TASKS.md` 共 177 项 —— 已完成 **102**、进行中 **60**、待办 15；
  （`npm run audit:tasks` 会核对这一行与本表，改完条目记得跑一次）
  其中相当一部分待办是长期大项（村民与交易、织布机等功能方块、信标与地图、喷溅/滞留药水等）
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
| 装备外观 | `render/PlayerRenderer.ts` 四个部位共 10 块甲片（分别挂在头/手臂/腿的枢轴上，摆臂摆腿时跟着动）+ `render/HandRenderer.ts` 的胸甲袖套（第一人称只有这个看得见）；甲片颜色取该件图标贴图的平均色（`TextureAtlas.averageColor`），3D 与 2D 同源 |
| 方块内容 | **288 种**（6 族木材、石材家族、16 色羊毛、17 色陶瓦 + 16 色混凝土、染色玻璃与玻璃板…）、方块状态、非常规形状（台阶/楼梯/栅栏/墙/门/火把/梯子） |
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
| 附魔台与附魔表 | `core/registry/enchantments.ts`（38 条对齐原版 1.18）+ `core/crafting/Enchanting.ts`（候选掷点）+ `core/container/EnchantTable.ts`（台面状态）+ 背包界面里的附魔台模式；新方块**附魔台/书架**、新材料**纸/书**；书架加成照抄原版判定（5×5 外圈 + 隔一格空气）上限 15；三个候选槽花费沿用原版 `getEnchantmentCost`、青金石 1/2/3。⚠️ 38 条里已有 13 条真接了效果，其余在候选里带 `*` 标记 |
| 农业与作物 | `Block.FARMLAND` + 小麦 4 个生长阶段（**一个阶段一个 id**，因为贴图是按 id 静态查的）+ 锄头耕地（`canTill`/`tillableTo`）+ 随机刻生长（下方是耕地、光照 ≥ 9、旁边有水概率翻倍）+ 收获（成熟 1 小麦 + 0~3 粒种子，草丛 12.5% 掉种子）+ 小麦种子/小麦/面包三件物品与配方 |
| 被动生物 | **繁殖与幼体**：喂食进入求爱 → 挨到 2.5 格配对 → 生幼体（体型 55%、碰撞盒一起缩小、不掉落不给经验、300 秒长大）；**剪羊毛**（剪刀单独注册，羊毛不剪就没有、精准采集对它无效）；**挤奶**（桶 + 成年牛 → 牛奶桶，喝下清除所有状态效果）；**手持食物吸引跟随**（8 格内跟着走、1.6 格停下） |
| 弹射物与弓 | `core/entity/Arrow.ts`（重力/逐段命中判定/撞墙插住/可拾回/60 秒消失）+ `core/entity/Bow.ts`（拉满 1 秒、15% 阈值、箭速 60 格/秒、伤害线性到 6 点）+ 弓/箭/燧石/线四件物品与配方（燧石来自砂砾 10% 的"概率替换"掉落）。玩家按住右键拉弓、松手放箭；**骷髅改远程**（射程 16、每 2 秒一箭、贴到 5 格内后退），命中的箭走 `'projectile'` 伤害类型 → 弹射物保护有了来源。弓的附魔全部接线：力量/冲击/火矢/无限 |
| 铁砧与改造 | `core/crafting/Anvil.ts` + `core/container/Anvil.ts` + 界面里的铁砧模式：重命名（1 级）、材料修复（每材料修 1/4 上限）、合并同种装备（耐久相加 +12%、附魔取更高）、附魔书（按稀有度计费）；**累积惩罚** `2 × 旧值 + 1`，总价 ≥ 40 判"过于昂贵"。铁砧/铁块为新方块；装备可带自定义名字（提示框标题换成新名字） |
| 酿造台与药水 | `core/registry/potions.ts`（**效果变体表 × 档位**展开成 24 瓶药水）+ `core/crafting/Brewing.ts`（纯逻辑，配方表由变体表展开：水瓶 + 下界疣 → 粗制、粗制 + 材料 → 具体药水、+ 红石粉 → 延长、+ 荧石粉 → 强化、+ 发酵蜘蛛眼 → 腐化）+ `core/container/BrewingStand.ts`（5 格、20 秒、三槽同时推进、一份烈焰粉 20 次）+ 界面里的酿造台模式；**空玻璃瓶对着水右键能装水**（H10 之前漏掉的一环）。三档数值逐条对齐原版（含"缓慢的强化档是 IV 级""抗火/夜视/虚弱没有 II 级"） |
| 经验与等级 | `core/survival/Experience.ts`：原版三段升级曲线（`2L+7 / 5L-38 / 9L-158`）；来源＝击杀生物（5 / 3 / 末影龙 12000）+ 挖矿（只给部分矿石，铁矿金矿不给）+ 熔炉取出（小数攒够 1 点）；经验条在快捷栏正上方、等级数字压在条中间；`/xp add\|set\|query`；死亡掉光、随存档走。⚠️ 经验球实体未做，所以是直接进账、死亡也捡不回来 |
| 食物与进食 | `core/registry/food.ts`：12 种食物（数值保留原版"饥饿点 + 饱和度修饰值"两个数，补量按原版 `hunger × modifier × 2` 换算）；按住使用键 1.6 秒进食、每 0.4 秒咀嚼一次；饥饿满只有金苹果能吃；腐肉 80% / 生鸡肉 30% 给"饥饿"效果。获取：树叶 0.5% 掉苹果、西瓜块掉 5 片西瓜片、4 条生肉 → 熟肉熔炼、8 金锭 + 苹果 = 金苹果 |
| 说明与配方 | `core/registry/itemNames.ts`（**432 件物品全都有中文名**，其中 180 件写了专门说明；装备/食物/药水的文案由数据表生成，不手抄）、`ui/Tooltip.ts`（悬停提示）、`core/crafting/RecipeBook.ts` + `ui/RecipeBook.ts`（配方书与一键合成，**152 条配方 + 12 条熔炼**） |
| 粒子与手持 | `render/ParticleSystem.ts`（池化、单 draw call、六类粒子）、`render/HandRenderer.ts`（独立场景叠画的手持物品与手臂）、`render/ScreenEffects.ts`（水下/岩浆整屏色罩） |
| 测试 | `npm test` = `test:unit`（vitest，4 个文件 8 组：光照引擎 / 生成的确定性 / 存档增量编解码 / 方块形状与碰撞盒 / 区块下标与坐标换算 / 图集 tile 名匹配 / 资源包 zip 解析 / 音效材质映射）+ **38 套**自建离线测试：inventory / crafting / furnace / entity / shapes / biome / aquifer / ore / mesh / survival / mob / spawn / combat / decor / structure / audio / nether / end / endboss / redstone / save / net / render / viewmode / world / settings / recipebook / commands / effects / tick / tool / armor / food / xp / enchant / anvil / projectile / **brewing**，当前全绿；`npm run audit:tasks` 自检锚点文档（进度口径、编号连续性、README 路线图同步、提交总数、离线测试套数） |

下一步的大头（队列与 TASKS.md 都能看到，按依赖顺序）：
**村民与交易**（J11：职业、交易表、铁傀儡、袭击）、
**织布机/制图台/切石机/锻造台等功能方块界面**（H11）、
**喷溅/滞留/药水箭**（K4 的尾巴，需要一套可投掷实体——与雪球/末影珍珠同一块基础设施）、
**信标与地图**（K5 / K7）、成就与 i18n（M7 / M8）、
以及两条"工程债"：离线测试自己的类型检查（O6，当前 144 处）、区块缓冲复用池（N3）。

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
| 模型上"贴盔甲"的取舍 | 这套玩家模型是"方块拼小人 + 逐面明暗"，没有 UV 贴图管线。把带透明边距的 16×16 图标直接贴到方块上会像贴纸，于是改成**取图标平均色当甲片颜色**（`averageColor` 本来就有缓存）：3D 与 2D 图标同源，渲染层也不必认识"盔甲材质"，加一种材质不用改渲染代码（本轮） |
| 甲片挂错父节点会穿帮 | 甲片必须挂在"所属身体部位"的枢轴上：护肩挂手臂枢轴、大腿甲与靴子挂腿枢轴、头盔挂头枢轴。若统统挂根节点，抬手时护肩会留在原地（本轮） |
| 测试里别存 THREE 对象的引用 | `material.color` 是**同一个对象**，下一次 `update()` 会就地改写它。断言"变暗了再恢复"必须先取数值快照，否则新旧值指向同一对象、断言永远成立（本轮踩到） |
| 凡是能算出来的数字都别手写 | 一次文档梳理查出三处漂移：HANDOFF 的"提交总数 48"实际 105、README 路线图整体停在"未开始"、HANDOFF 说"方块 201 种"实际 271。**手写的派生数字迟早会漂**——现在路线图状态列由 `audit:tasks` 从 TASKS.md 重写，提交总数与离线测试套数也进了自检（本轮梳理） |
| 文档里承诺的命令要真能跑 | HANDOFF 让新机器执行 `npm run agent:setup`，但 `package.json` 里**根本没有这个 script 键**（`tools/agent-setup.mjs` 一直在），照着做第一步就 "Missing script"。改文档时顺手把命令跑一遍，别只读文字（本轮梳理） |
| 断言都在比 id，就没人发现名字被顶了 | 染料区 1020~1035 与生物掉落 1030~1035 压在一起，后写的染料把"腐肉/骨头/火药/生牛肉/生猪排/生羊肉"整件覆盖。掉落、合成、背包测试**全是绿的**——因为它们比的都是 `Item.ROTTEN_FLESH` 这个 id，而不比"这件东西叫什么"。现在改成：`register()` 在启动时对重复 id 直接抛错，外加两条断言（id 无重复、每件物品都有中文名）（本轮） |
| 原版 wiki 上那个数不一定是要填的数 | 食物表里两栏很容易写混：wiki 写"恢复 2.4 点饱和度"，而代码要填的 `saturationModifier` 是 **0.3**（= 2.4 ÷ (饥饿 4 × 2)）。第一版就是把 2.4 直接填了进去，苹果一口补 19.2 点饱和度。**把公式写进注释、再拿几组原版数值当断言**，这类"单位不对但量纲看起来对"的错才抓得住（本轮） |
| 新加的贴图/物品不会自己出现在图集里 | 图集顺序表 `TILE_ORDER` 与 `PAINTERS` 是两处独立清单，加物品时**必须两边都加**（`test:armor` / `test:tool` 里都有"每件装备的图标都在图集名单里"的断言兜着）。食物这次照抄了同一套做法（本轮） |
| **离线测试自己从来没被类型检查过** | `tsconfig.json` 只 include `src` 与 `vite.config.ts`，`tools/` 与 `tests/` 只经 esbuild 打包运行——而 esbuild 只剥类型、不做检查。给 `CommandContext` 加了三个方法之后，`tools/command-test.ts` 的桩对象没跟着改，`npx tsc --noEmit` **依然全绿**，跑到那个测试才炸。已加 `tsconfig.tools.json` + `npm run typecheck:tools` 把缺口量化：当前 **144 处**历史错误（TS2345 参数不匹配 51、TS2591 缺 `@types/node` 40、桩对象缺成员 21、重复标识符 12），见 TASKS O6 |
| 「必须用某工具」有两种，影响的地方不同 | 原版"必须用镐"（`requiresCorrectToolForDrops`）会连**破坏耗时**一起变（变成 5 倍慢），而"羊毛必须剪刀"只在**掉落表**里判——徒手拆羊毛仍是正常的 1.2 秒，只是什么都不掉。前者进 `REQUIRED_TOOL`，后者只能进 `EFFICIENT_TOOL` + 掉落判定，放错表手感直接变差（本轮） |
| 上下文里别存"每帧会变的值" | 实体上下文是建好之后缓存的，`heldItemId: 玩家手上的物品` 这种**传值**写法会永远停在建它那一帧——"手上换成苹果却怎么也不跟过来"。凡是每帧可能变的东西都传**函数**（本轮） |
| 测试里的边界值要刻意避开判定边界 | 把初始距离正好设成 8.0，而判定是 `distance < 8`（左开），于是"应该跟过来"的断言失败、看起来像功能没生效。写测试时距离/时间都要离边界留一点余量（本轮） |
| 注册表与"数据表"互相引用必然成环 | `items.ts` 要 import `potions.ts` 来批量注册药水，而 `potions.ts` 又 import `items.ts` 拿 `Item.POTION_*` → 环。表现不是编译错误（类型上过得去），而是**运行时报 `Cannot read properties of undefined`**。规矩：**id 定义在下游那张表里，注册表单向引用它**（与 `tools.ts` 的剪刀 id 同一个套路）（本轮） |
| 先搜再写 | `Item.BUCKET` 与 `StatusEffects.clear()` 其实**早就存在**，我重复定义时是 `tsc` 的 TS1117/TS2393 拦下来的——类型系统能挡住的就交给它，挡不住的（同名不同义）只能靠先搜一遍（本轮） |
| 概率掉落有两种语义，别混一张表 | "额外掉一份"（树叶 0.5% 掉苹果）与"顶替原掉落"（砂砾 10% 掉燧石）在代码上长得几乎一样，混在一张表里迟早搞错。分成 `RARE_DROPS` / `REPLACE_DROPS` 两张表，破坏路径里的顺序也写成一行注释（精准采集 → 替换 → 常规 → 额外）（本轮） |
| 射程要在"发现范围"之内 | 测"射程外会靠近"时把玩家放到 20 格外没问题，放到 40 格就失败——因为 `followRange`（24）先一步让骷髅**根本没发现玩家**，它去游荡了。两个半径的关系（followRange > range）是这类"没反应"的第一嫌疑（本轮） |
| 实体层报伤害类型用字面量联合 | 箭要传 `'projectile'` 才能让"弹射物保护"生效，但实体层不该 import 生存模块的 `DamageCause`。用 `EntityDamageCause`（子集字面量联合）既不断层，又能让 `typecheck` 挡住拼错（本轮） |
| 失败原因要"从最具体排到最笼统" | 铁砧的提示最初把"完好的镐 + 钻石"报成"过于昂贵"——玩家会以为是自己等级不够，其实是根本不需要修。把所有失败原因按"具体 → 笼统"排序后，每种情况都能给出真正有用的那句话（本轮） |
| 累积惩罚不能拿"两件之和"再算一遍 | 产物的惩罚是 `2 × max(左, 右) + 1`。写成 `2 × (左 + 右) / 2 + 1` 看着差不多，实际会让惩罚翻倍增长，第三次上铁砧就爆表——这类"看着像等价变形"的代数错误最难靠肉眼发现（本轮） |
| 附魔"表里登记了"和"效果生效了"是两件事 | 38 条附魔一次性登记很容易，但每条效果要改的地方差得远（挖掘速度在 `tools.ts`、掉落数量在破坏路径、减伤在 `armor.ts`、攻击伤害在近战入口）。**先做扎实 6 条，其余在候选里带 `*` 并在界面写明"效果未接"**——比 38 条都"看起来能附"但 32 条毫无作用要诚实得多（本轮） |
| 附魔的 `+1` 是有条件的 | 效率的原版式子是 `if (level > 0) speed += level² + 1`——那个 `+1` **只在有附魔时才加**。写成 `speed + level² + 1` 会让所有工具凭空快 1 点，而不带附魔的回归断言恰好能抓住它（已经在 `test:enchant` 里守着）（本轮） |
| 伤害公式写在主循环里就没法测 | 锋利加多少（每级 +0.5，且**有一级就再 +0.5**，所以 I 级是 +1.0 而不是 +0.5）这种数最容易记错。把式子抽成 `meleeDamage(attack, enchants)` 之后才有断言可写（本轮） |
| 公式"每段都对"不等于"整条曲线对" | 升级曲线 `2L+7 / 5L-38 / 9L-158` 三段分别取点都对，但分段边界最容易写错。真正的验证是拿一个公认的整体量去对：**练到 30 级共需 1395 点**。单点对拍很便宜，也最容易放过边界错误（本轮） |
| **数据表做完了，链子也未必通** | 24 瓶药水、酿造台容器、界面都做完之后才发现：**水瓶只能在创造模式里拿**——"空玻璃瓶对着水右键装水"这一环一直没做，于是整条酿造链在生存模式下根本走不到。一条链收尾时要问一句"**第一件原料从哪来**"，并用**可达性断言**钉住它（`test:brewing` 从水瓶出发做 BFS，24 瓶必须全部可达；补上装水交互之后仍然全绿）。同类隐患：全量搜过 `Item.WATER_BOTTLE` 在 `main.ts` 里一次都没出现（本轮） |
| 能生成的就别手抄 | 24 瓶药水的**名字、说明、贴图颜色**全部由 `potions.ts` 的变体表生成，而不是再抄 24 遍：手抄时"改了表的时长、忘了改文案"这类漂移没人能发现。同理"贴图按 `POTIONS` 生成"顺手保证了"加了新药水不会漏画贴图"，而漏画的表现只是"背包里一瓶空白"（本轮） |
| 同名函数可能两种口径 | `StatusEffects.romanLevel` 吃的是 **amplifier**（0 → I、3 → IV），`enchantments.romanLevel` 是 **1 起始**的。药水名该用前者，写成后者会让"力量 II"显示成 III、缓慢 IV 显示成 V——而断言写成 `endsWith('II')` 时 `'III'` 也会通过。**同名不同义时，在调用处写明口径，断言写全等而不是前缀/后缀**（本轮，两次都踩到） |

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
