# 接手必读 · HANDOFF

> 这是「Minecraft 基岩版 1.18 复刻（Web / WebGL2）」的进度交接文档。
> **换电脑、换会话、换人接手，都先读这一份**（整份读完再按需展开，不用挑），
> 再读 `.codebuddy/auto-continue.md`（推进队列）和 [TASKS.md](./TASKS.md)（长期总表）。
> 会话聊天记录本身不随仓库走，能带走的关键上下文都沉淀在下面。
>
> 大块历史正文已经拆出去按需读，见 §1 的索引表（`docs/HANDOFF-ARCHIVE.md` /
> `docs/EXPERIENCE.md`）——**不要一开始就把它们全读进来**。

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

然后对 AI 说一句：**「读 AGENTS.md、HANDOFF.md 与 .codebuddy/auto-continue.md，按队列继续推进。」**
之后 Stop 钩子会自动按队列继续，不需要逐步确认（机制见第 3 节）。

验收门槛：`npm run check` 全过（= `typecheck` + `npm test` + 三张台账），`npm run build` 能出包。

> **改代码时的内循环别用 `check`**（那是提交前的全量），用这两条：
> `npm run check:fast`（typecheck + 单测 + **只跑被改动命中的那几套离线测试**）、
> `npm run build:fast`（关掉 sourcemap 的构建，只验"能不能出包"，产物内容与正式构建一致）。

## 1. 当前状态快照

- 时间：2026-10-20 · 提交总数 1051（每个功能点一条，可逐条回滚；`npm run audit:tasks` 会核对这一句）
- 技术栈：TypeScript（严格模式）+ Vite + Three.js / WebGL2；无第三方运行时依赖（除 three）
- 进度口径：`TASKS.md` 共 288 项 —— 已完成 **196**、进行中 **79**、待办 13 条（其中 55 条是需求审计新补的**整组**缺口，逐组明细见 `docs/HANDOFF-ARCHIVE.md` 的「需求审计」一节）；
  （`npm run audit:tasks` 会核对这一行与本表，改完条目记得跑一次）
  其中相当一部分待办是长期大项（村民与交易、织布机等功能方块、信标与地图、喷溅/滞留药水等）
  —— **进行中口径以 `.codebuddy/auto-continue.md` 队列为准**，两份文件分工不同，不要只看一份
  —— 2026-10-15 做过一次**逐条核对**（对着 src/tools 的真实实现重判 37 条），
  勾选状态与代码实况已对齐；以后每完成一项顺手改这两份文件，避免再次漂移
- ⚠️ **批次编号冲突（本轮）**：另一条会话在同一时间段占用了 **272~283**。本轮 7 条用户反馈的
  8 个提交正式编号是 **284~291**；旧 commit message 里写的 272~279 是当时撞号，
  以后引用/回滚请按下面的新号或 commit hash（历史不重写，避免动已推送的分支）。
- 批次 439（内容）：**磨制玄武岩 + 蓝冰**（复用玄武岩/浮冰贴图，不新画）。
  方块 **671 → 673（96%）**、配方 **700 → 702（70%）**；`test:crafting` 95 → **100 条**。
- 批次 440（内容）：**蜜脾块**（4 蜜脾 2×2 → 1，纯装饰，无行为）。
  方块 **673 → 674（96%）**、配方 **702 → 703（70%）**；`test:crafting` 100 → **103 条**。
- 批次 441（内容）：**蛛网**（能穿过、水平速度 ×0.25）。`PhysicsWorld` 新增可选钩子
  `isCobweb`，`World.isCobweb` 一次查表；拆了掉**线**（原版用剪刀掉蛛网本身，
  本项目没有剪刀）；矿井还没撒蛛网，所以它进了可达性白名单（缺口 17 → 18 条）。
  方块 **674 → 675（96%）**；`test:physics` 69 → **73 条**。
- 批次 442（内容）：**矿井里挂蛛网**，蛛网因此从可达性白名单里**删掉**（缺口 18 → 17）。
  生成来源表同步补 `Block.COBWEB`（审计靠这张表）；`test:structure` 44 → **46 条**。
- 批次 443（内容）：**六种剥皮原木 + 斧头剥皮交互**（`stripResult` 映射 + `stripLog`）。
  可达性闭包**新增一条交互型来源**（拿到原木就等于拿到剥皮原木）——
  不然六块只能塞白名单，那是给"审计没建模的东西"记黑账。
  方块 **675 → 681（97%）**；`test:reach` 61 → **62 条**（闭包 904 → 910）。
- 批次 444（内容）：**五种木材的按钮 / 压力板（10 块）**。前置是**重构**
  `RedstoneEngine`：5 处 `case Block.OAK_BUTTON` 收敛成 `isButtonId` / `isPlateId`；
  "电源强度"那段改成**先判后 switch**（写成 case 会让新方块落进 default，
  表现是"压力板通电了但旁边电路没反应"）。
  方块 **681 → 691（99%）**、物品 **1067（97%）**、配方 **713（71%）**；
  `test:crafting` **114 条**、`test:redstone` **135 条**。
  ⚠️ 清单里剩下六个（海绵/蜜块/蛛网/磁石/重生锚/湿海绵）**都要行为**，不是加方块。
- 批次 445（持久化）：**实体寄存补齐幼体 / 状态效果 / 掉落物附加数据**（J2 第三刀）。
  `EntityParking` 的记录新增 `baby` / `growSeconds` / `effects[]` / `extras`；
  `Mob.makeBaby()` 可接剩余成长秒数（否则快长大的幼体读档后从头再等 20 分钟）；
  写存档时白板物品不写 `extras` 键，避免每条记录都挂一个空对象。
  `test:entity` 169 → **178 条**（9 条：三类字段往返、JSON 往返、脏数据清洗）。
  仍未做：繁殖/求爱计时、马鞍、羊驼的箱子、**跨维度转移**（下一批）。
- 批次 446（联机）：**掉落物可见同步**（L7 第一刀）。本地每 100ms 扫实体表，
  新增/消失各发一条；服务端用 `owner + localId` 当键、owner 由连接身份拼装
  （客户端伪造删不掉别人的），离线时清掉他名下那一批；新玩家 `welcome` 带 `items` 快照。
  镜像标 `ItemEntity.ghost`：不跑物理、不拾取、不合并、不写存档。
  ⚠️ 远端那一堆**拿不到**——拾取仲裁留给下一刀。`test:net` 21 → **28 条**。
- 批次 447（物理）：**水流推动**（F9 收口）。新模块 `core/world/FluidFlow.ts`（纯函数）：
  从液面等级推流向（朝更薄的水格），水柱额外向下按；静水不推。
  接进 `PlayerPhysics` 时折进**目标速度**（每帧加增量会被 `approach` 拉回去）。
  只接玩家；`waterlogged` 仍未做。`test:physics` 73 → **81 条**。F5/F9 勾掉（188 → 190）。
- 批次 448（红石）：**投掷器 / 发射器的 4 tick 延迟**（0.2 秒）。上升沿只登记
  `dispenserTimers`，到点在 `tick` 里才调 `onDispense`；延迟期间方块被拆掉则取消。
  这是 B33 差异台账里"立即吐"那一条的收口。`test:dropper` 108 / `test:dispenser` 130 条。
- 批次 449（内容）：**海绵 + 湿海绵**（B54 里"要行为"的四件之一）。
  `core/world/Sponge.ts` 纯函数：半径 3 的 7×7×7、上限 **65 格**、按距离近到远吸；
  放下时吸到水就变湿海绵（`main.absorbWithSponge`），湿海绵只能熔炉烤干（Smelting +1 条）；
  海底神殿加了 6 块湿海绵（唯一来源，`GenerationSources` 已登记）。
  方块 **691 → 693（99%）**；新增 `test:sponge` 18 条，套数 **133 → 134**。
- 批次 450（内容）：**蜂蜜块**（B54 里"要行为"的第二件）。三条行为都挂在
  `PhysicsWorld.isHoney` 上：站在上面**跳不起来**（连自动跳跃一起取消）、
  贴着侧面下滑限速 **1.2 格/秒**；摔落减伤走 `PlayerStats.honeyFallDistance`
  （缩的是门槛以上那一段：`3 + (d-3)×0.2`，不缩会把 3 格免伤一起吃掉）。
  配方 4 蜂蜜瓶 2×2（蜂蜜瓶来自 J21 的蜂巢）。`test:physics` 81 → **85**、
  `test:survival` **83 条**、配方 **670**。
- 批次 451（内容）：**16 色潜影盒**（B54 的"16 色族"缺口）。无色 482 保持原 id
  （存档里存着它），16 色接 **697~712**；每色三张贴图（顶/底/侧，48 张，基色取
  `DYE_COLORS` 与羊毛同色）；容器/掉落带内容/活塞推不动三处特判收敛成
  `isShulkerBox(id)`；配方 16 条（无色 + 染料）。方块 **694 → 710**、配方 **686**，
  `test:crafting` 114 → **124**。
- 批次 452（口径）：`npm run audit:blocks` 的两处**假缺口**修正——
  ① `wall_sign` 6 种：本仓库用 `sign` + `wallMounted` 状态位表达（火把同一套路），
  `blockShapes` / `Placement` 都已支持挂墙牌，不需要独立 id，已移出缺口表；
  ② `stripped_log` 6 种：已有，审计只认 `oak_stripped_log` 而实际叫
  `stripped_oak_log`（这就是 B54 记的命名坑）。修完审计只剩
  `mud`（1.19 不做）+ `lodestone` + `respawn_anchor`。
- 批次 453（内容）：**磁石**。绑定坐标记在**物品**上（`ItemStack.lodestone`，
  四处数据链路一起补：`restoreStack` / `stackExtras` / `sameExtras` / 深拷），
  手持指南针右键磁石即绑定，HUD 改指磁石（跨维度按"指不到"处理）。
  配方 8 雕纹石砖 + 1 下界合金锭。方块 **710 → 711**、配方 **687**，
  `test:inventory` 77 → **89**。
- 批次 454（内容）：**重生锚**（B54 的最后一件，勾掉后整条清零）。充能 0~4 存在
  状态位低 3 位（`world/RespawnAnchor.ts`），发光随档位（`stateLight` = 档位×3）；
  荧石右键充能、空手/其他物品右键**设重生点并消耗 1 档**；充能耗尽或方块被拆 →
  重生点作废（`resolveRespawnPoint` 里与床共用同一条 `bedSpawn`）。
  配方 6 哭泣的黑曜石 + 3 荧石。方块 **711 → 712**、配方 **688**，
  新套件 `test:anchor` 21 条，套数 **134 → 135**。`audit:blocks` 只剩 `mud`（1.19）。
- 批次 455（结构）：**村庄布局拼图化**（`core/gen/VillageLayout.ts`，纯函数）。
  水井 + 四条街 + 沿街两侧槽位（住宅/农场/铁匠铺/图书馆），门一律**朝街**；
  不重叠判据用"清地半宽 5"而不是"占地半宽 4"（否则中心距 8 的两栋会互相 clear）；
  每圈实际只排得下 4 个（十字街的邻街槽位互相打架），所以最多铺 3 圈。
  实测 **2 → 8 栋/村庄**（3 个村庄 24 栋、床 48 格、工作站 33）。
  顺带修两处覆盖：铁匠铺的烟熏炉压掉床头、图书馆书架堵门口（都是 `test:village` 抓到的）。
  `test:structure` 46 → **54 条**（新增布局 8 条）。
- 批次 456（M23 收尾两件）：**记分板存档 + 侧边栏 HUD**。
  `SaveGame` 第 8 个对象仓 `scoreboard`（DB_VERSION 5 → 6，老存档自动补建）；
  `Scoreboard.sidebarView()` 给出"标题 + 降序 + 最多 15 行"的纯数据，
  `ui/ScoreboardHud.ts` 只负责画（右上角、内容不变不动 DOM、手机再缩一号）。
  `test:save` **新增 19 条**。M23 只剩队伍（仍是 `[~]`）。
- 批次 457（结构）：**"结构 → 生物"通道**（补齐"结构只有壳子"那条根）。
  `gen/StructureCreatures.ts` 锚点表 + `Structures.structureCreatureSpawnsAt()`
  （区块加载时按种子重算，**不新增数据通道**）+ 主线程 `populateStructureMobs`
  （同类 32 格去重）+ `nearbyStandingSpot`（半径 3 内由近到远找可站格）。
  覆盖主世界 4 种：神殿 1 远古守卫者 + 6 守卫者、府邸 1 唤魔者 + 2 卫道士、
  前哨 3 掠夺者、村庄 1 铁傀儡。`test:structure` 54 → **73 条**。
  ⚠️ 下界（猪灵/猪灵蛮兵）与末地（潜影贝）待接，各自的实例入口是下一批。
- 批次 458（结构）：**下界与末地接上结构生物通道**。堡垒遗迹（1 猪灵蛮兵 + 2 猪灵）、
  下界要塞（2 凋灵骷髅；烈焰人仍归刷怪笼）、末地城（2 潜影贝）各有自己的
  `*CreatureSpawnsAt`（reach 与相交判定沿用各自的生成器）；主线程按维度分支，
  落点/去重/造实体与主世界共用 `spawnStructureCreatures`。
  `test:bastion` 97 → **99**、`test:fortress` **105**、`test:end` 32 → **36**
  （都含"真实生成后锚点 3 格内有空气"）。
- 批次 459（结构内容）：**战利品表 15 → 20**。新增 `igloo` / `ruined_portal` /
  `buried_treasure` / `nether_bridge` / `stronghold_corridor`；雪屋、废弃传送门、
  埋藏宝藏从"借用别的表"改成自己的，要塞走廊与下界要塞**新增箱子**（后者此前
  一个都没有）。箱子状态位 4 → **5 位**（低 4 位 bits 4-7、高 1 位 bit0，
  老存档不变），上限 31 张。`test:loot` 74 → **79**。
- 批次 460（结构）：**废弃矿井拼图化**（结构"拼图"的第二刀，第一刀是村庄）。
  新模块 `gen/MineshaftLayout.ts`（纯函数）：节点占 8 格网格、**只占一次**（走廊不会
  穿模）、广度优先扩展（没有走不到的孤岛），零件是走廊段 + 十字口 + 房间。
  `buildMineshaft` 从"递归随机分叉"改成按零件画；柱子/蛛网/火把/箱子/洞穴蜘蛛刷怪笼
  的写法照旧。`test:structure` 73 → **87 条**（树结构 / 连通性 / 不重叠 / 确定性 /
  真实生成里木板 > 300、蛛网、矿井表的箱子）。
  ⚠️ 批次 460 仍是**单层**——这一条在 461 补掉了（见下）。
- 批次 461（结构）：**矿井多层**。约 30% 的分支带 ±4 层差，段上多一个 `rise` 字段；
  画法把地面按 `stepY = y + rise×i/len` 线性抬升（每 2 格 1 格，玩家直接走上去）；
  同列上下两层必须差 ≥ 4（走廊 3 高 + 地面 1），否则上下打穿——布局侧直接拒绝。
  `test:structure` 87 → **91 条**（层差只有 0 与 ±4 / 换种子能排出多层 /
  同列层差 ≥ 4）。
- 批次 462（结构）：**要塞拼图化**（第三刀）。新模块 `gen/StrongholdLayout.ts`：
  房间落在 12 格网格上、只占一次、广度优先 → 全部连通；六种房间
  （走廊 / 十字口 / 图书馆 / 喷泉房 / 牢房 / 传送门房），**传送门房永远在离入口
  最深的叶节点**。`buildStronghold` 重写成"按零件画"。
  `test:structure` 91 → **109 条**（房间不重叠 / 树结构 / 连通性 / 传送门在最深层 /
  特殊房间配额 / 确定性 + 真实生成里石砖 > 1500、框架 12 格、图书馆 2 箱、蠹虫笼）。
- 批次 463（结构）：**林地府邸拼图化**（第四刀，也是"大结构拼图"这条线的收尾）。
  新模块 `gen/MansionLayout.ts`：每层独立广度优先，房间 8 格网格、只占一次；
  层间楼梯固定放每层 (0,0) 房间、**垂直对齐**；外壳按该层房间的包围盒自动收进。
  七种房间（大厅/书房/卧室/餐厅/图书馆/监狱/储藏）+ 各自家具。
  `test:structure` 109 → **125 条**（每层连通 / 楼梯对齐 / 种类多样 +
  真实生成里木板 > 800、门、窗、府邸表箱子 ≥ 2）。
- 批次 464（命令）：**`/locate structure <结构名>`**。`Structures.nearestStructure()`
  按该结构的 spacing 枚举周围单元、重算候选点（结构与地形一样是纯函数，
  **不需要 Worker 的生成器**——此前 K11 记的"卡在主线程拿不到生成器"其实是个误判）。
  默认向外 2 个单元：村庄 ±1000 格、要塞 ±3000 格。
  `test:structure` 125 → **132**、`test:commands` **184** 条。
  ⚠️ 只做主世界——**批次 465 补齐了**：`nearestBastion` / `nearestFortress` /
  `nearestEndCity`（末地按 256 格外岛单元），main 按维度分派。
  `test:bastion` **103**、`test:fortress` **109**、`test:end` **41** 条。
- 批次 466（结构内容）：**雪屋地下室**。地面下 5 格的 7×5×3 石室 + 竖井梯子 +
  酿造台 + 第二只箱子（`igloo` 表）；**僵尸村民走结构生物通道**（igloo 锚点 dy = -4），
  这样"关在里面的那只"与神殿守卫者共用同一套机制。
  `test:structure` 132 → **139 条**（梯子 ≥ 5 / 酿造台 1 / 箱子 ≥ 2 / 地下室是空的 /
  锚点高度对）。
- 批次 467（命令）：**`/scoreboard players operation`**（9 种运算）。`Scoreboard.operate`
  是纯方法：两边缺分数按 0、除数为 0 时保持不变（原版行为）、`><` 先读后写；
  命令层支持两边都是选择器（笛卡尔积）。`test:commands` 184 → **199 条**。
- 批次 468（M23 收尾）：**队伍**。`world/Teams.ts`（建队 / 删队 / 入队 / 退队 /
  **一人只能在一个队** / 颜色 / 友好伤害开关）+ `/team` 六个子命令 +
  `SaveGame` 第 9 个对象仓（DB_VERSION 6 → 7）。命令覆盖 32 → **33**（83%）；
  `test:commands` 199 → **218**、`test:save` **108**。
  ⚠️ 队友免伤 / 碰撞开关 / 名字颜色三项还没接（缺"伤害来源"与"名字渲染"），
  `Teams.sameTeam()` 已把判定入口留好。
- 批次 469（方块状态）：**水浸（waterlogged）行为层**。状态位取 **bit7**（只给非整格
  形状族：台阶/楼梯/栅栏/墙/活板门/玻璃板/门/栅栏门/告示牌；雪层的 bits5-7 被层数占了，
  所以它天然排除）。放置时落点是水 → 打标记；破坏时含水方块 → 变回水。
  判定抽成 `blocks.ts` 的两个纯函数（`waterloggedPlacementState` / `blockAfterBreak`），
  主程序只负责读落点、写方块。新套件 `test:waterlogged` **30 条**，套数 **136**。
  **渲染也接了**：网格化的逐格通道为含水方块额外输出一层整格的水（半透明通道，
  6 面 12 个三角形），邻居是水/含水方块时跳过那一面。`test:mesh` **13 条**。
- 批次 471（实体）：**伤害来源链路**。`Mob.hurt()` 多了可选的第 7 个参数
  `HurtSource`（`'player' | 'mob' | 'environment'`），三处"用任意伤害近似"的行为
  一并修正：**记仇**（蜘蛛/末影人）、**群体激怒**（僵尸猪灵）、**末影人挨打瞬移**
  现在只认"真的被打"；摔伤/着火/爆炸/闪电/龙息按环境伤害算，不再凭空翻脸。
  玩家近战/横扫/荆棘/箭/三叉戟都传了来源。`test:entity` 178 → **186**，
  `test:enderman` **57** / `test:spider` **62** / `test:piglin` **64**（原有断言按新语义补上来源）。
- 批次 472（实体/玩法）：**铁傀儡的两条生成路径**（J24 的前半）。
  ① 4 铁块 + 南瓜摆成一竖一横 → 召唤（`core/world/GolemSummon.ts` 纯函数判定形状，
  支持沿 X/Z 两个方向；main 清掉 5 格并生成傀儡）；
  ② 村庄里 3 个村民 + 无傀儡 → 派一只守卫（半径 48 格、已有一只不再放）。
  新套件 `test:golem` **19 条**，套数 **136 → 137**。
  ⚠️ 批次 472 时还不会打架，这一条在 474 补掉了（见下）。
- 批次 474（实体 AI）：**铁傀儡会打架了**（J24 收尾）。`core/world/GuardAI.ts`
  是纯函数：半径 16、最近优先、**并列按 `type.id` 定序**（不按遍历顺序，否则守卫会在
  两只僵尸之间来回抖）、按水平距离算。`Mob.guardToward(x, z)` 只下"朝哪走"的指令，
  不往 `Mob.tick` 那套"追玩家"的分支里塞（那套为玩家写死了视线/隐身/宠物/求偶/拴绳）；
  main 在 `entities.update` **之前**跑 `tickGuardians`，走近 2.2 格按 1.2 秒冷打击 7 点。
  `test:golem` 19 → **27 条**。
- 批次 475（玩法）：**村庄袭击**（J24 主干）。`core/world/Raid.ts` 是纯状态机：
  带不祥之兆进村触发 → 3 波（3/4/4，第三波带唤魔者）→ 清空隔 5 秒下一波 →
  三波全清给村庄英雄 + 进度 stage 2；4 分钟没打完算失败。
  生成从村庄边缘 32~40 格来；**放不下的那几只直接记成已击杀**（否则状态机卡死）。
  不祥之兆用"击杀掠夺者 10%"近似（原版是队长旗帜，本项目没有队长）。
  新套件 `test:raid` **34 条**，套数 **137 → 138**。
- 批次 476（玩法）：**掠夺者巡逻队**（J24 收口）。`core/world/Patrol.ts` 是纯判据：
  每 90 秒尝试一次、玩家周围 24~48 格的地表、3~5 只掠夺者（25% 夹卫道士排最后、
  组长是第一只）；三条"不"（和平难度 / 已有巡逻队 / 间隔未到）。
  **不祥之兆改回原版来源**：击杀巡逻队队长必掉（其余掠夺者留 3% 兜底）。
  新套件 `test:patrol` **24 条**，套数 **138 → 139**。J24 勾掉（完成 192 → **193**）。
- 批次 477（命令）：**命令方块**（M5 最后一块）。方块 715 + `world/CommandBlocks.ts`
  （按坐标存一行命令、上限 128 字、去开头斜杠、坏条目跳过）+ `ui/CommandBlockEditor.ts`
  （一行输入框）+ 红石上升沿回调（与投掷器同一分工）。
  执行与聊天框同一个入口；挖掉方块清命令；存档第 10 仓（DB_VERSION 8）。
  新套件 `test:commandblock` **26 条**，套数 **139 → 140**。
  ⚠️ 只做脉冲方块（循环/连锁、条件/保持开启没做）。
- 批次 478（G12）：**铁轨平面弯道**。`world/RailShape.ts` 是纯逻辑：六种形状
  （2 直 + 4 弯）存在 bit0-2、`powered` 仍在 bit3；老存档 state=0 读成南北直轨。
  放置时按四邻铁轨自动接（3 个以上退回直轨，原版也没有十字轨）；矿车每帧把速度
  掰到弯道出口（出口取"与速度点积较大"的边，天然稳定不抖）。
  只有普通铁轨做了五张形状贴图。新套件 `test:rail` **40 条**，套数 **140 → 141**。
- 批次 479（命令）：**`/data get entity|block`**。只做 get——实体的坐标/类型/名字、
  方块注册名 + 状态位；`merge`/`modify` 明确拒绝（本项目数据是强类型字段，
  没有可写的 NBT 树）。`test:commands` 218 → **227 条**，命令覆盖 **33 → 34（85%）**。
- 批次 480（命令）：**`/damage` 与 `/loot give`**。`/damage` 走同一个选择器解析、
  逐个调 `ctx.damageEntity`（环境伤害，所以不会让生物记仇）；`/loot give <表> [数量]`
  用现有 `rollLoot` 掷点、按 **id** 直接塞背包（`ctx.giveById`）。
  `test:commands` 227 → **236 条**，命令覆盖 **34 → 36（90%）**。
- 批次 481（G12）：**铁轨坡道**。形状扩到十种（6 平面 + 4 坡道），编码改成
  **bit0-2 + bit4**（bit3 是 `powered`；老存档 bit4=0 所以编号不变）。
  铁轨从 `flat` 拆出独立的 `rail` 形状——`meshBoxes(shape, state)` 拿不到方块 id，
  不拆就分不出"铁轨还是红石粉"。坡道画成 **4 段阶梯**（逐段抬高 1/4）。
  放置时按"某一侧地面高一格"自动铺坡道；矿车按格内位置被抬到坡面。
  `test:rail` 40 → **77 条**。
- 批次 482（G12 收口）：**三种特殊铁轨的形状贴图**（动力/探测/激活 × 东西向 + 四弯，
  共 15 张）；通电仍用统一的 `*_on` 亮轨。`test:rail` 77 → **89 条**
  （含"四种铁轨 × 十种形状的贴图都在图集名单里"）。**G12 勾掉**（完成 193 → **194**）。
- 批次 483（世界生成）：**世界类型 3 → 5**（D22）。`caves` 的密度场直接由
  "三维噪声等值面附近"决定（±0.16 的壳是岩壁、其余是空气），最下面 4 层强制实心；
  `floating_islands` 在默认地形之上叠一层"团块"（同一噪声 + 按离地高度衰减）。
  标签 / 说明 / 地表基准一起补齐，创建界面自动多两项。
  新套件 `test:worldtype` **30 条**。**D22 勾掉**（完成 194 → **195**）。
- 批次 484（E21）：**旗帜做成真正的旗面**。16 色旗帜（id 640~655，方块本来就有）
  从 `cross` 形状（两片交叉薄片、一格高）改成 **`banner` 形状**：一根杆 + 一面
  12/16 宽、1/16 厚的布，**占两格高**（靠 `BANNER_TOP_MASK` 区分上下半）；
  放置一次放两格（上方被占就拒绝）、破坏 `breakBannerPair` 带走两半、无碰撞。
  新套件 `test:banner` **26 条**，套数 **141 → 142**。
  ⚠️ 图案、挂墙、刷怪笼迷你生物仍未做（E21 仍是 `[~]`）。
- 批次 485（世界生成）：**caves 跳过地物与结构**。那个世界没有地表，树会长在洞腔里、
  村庄会埋在岩壁间——在 `generateChunkBlocks` 里与超平坦同一位置提前返回。
  `test:worldtype` 30 → **34 条**（含"默认世界有地表植被"的负对照、
  "浮空岛的地物与默认世界一致"）。
- 批次 486（E21）：**旗帜挂墙**。与火把同一套 `wallMounted` + `facing`；
  ⚠️ `facingFromNormal` 给的是"指向墙"的方向，旗帜要 +2 取反（第一版四面旗全朝墙里）；
  几何按朝向四选一（杆贴墙、布朝外）。`test:banner` 26 → **42 条**。
  E21 只剩"图案"与"刷怪笼迷你生物"。
- 批次 487（E21 收尾）：**刷怪笼里旋转的迷你生物**。`world/SpawnerDecor.ts`（纯函数）
  从已登记的笼子收集"该画什么"（笼子被挖掉后 `defFor` 返回 null → 不画，避免幽灵模型）；
  `MobRenderer.setDecorations()` 与实体**共用同一套实例缓冲**，位置在笼子正中、绕 Y 匀速转、
  缩到 0.45、相位按坐标错开。样板只用来生成外观，不进实体表。
  新套件 `test:spawnerdecor` **19 条**，套数 **142 → 143**。**E21 勾掉**（完成 195 → **196**）。
- 批次 473（结构内容）：**战利品表 20 → 22**。新增 `stronghold_crossing`
  （要塞十字口）与 `ocean_ruins`（海底废墟，原先借用沉船补给表——物品池对不上）；
  要塞十字口与海底废墟各放了箱子，堡垒遗迹桥面也加了一只 `bastion_other`
  （宝库是通关奖励，桥面是路过补给）。`test:loot` 79 → **81**。
- ⚠️ **批次编号冲突（第二次）**：并发会话占用了 **295-1~295-4**。本轮两个提交正式编号是
  **297（容器暂停）/ 298（目标框界面）**；旧 commit message 里的 295/296 是撞号。
- ⚠️ **批次编号冲突（第三次）**：并发会话占用了 **303**。本轮正式编号 **304**；
  旧 commit message 里的 303 是撞号。
- 批次 191 及更早（167~191，共 25 条）：已搬到 `docs/HANDOFF-ARCHIVE.md` 的
  「§1 批次流水」各节——那部分是"当时怎么做"的查阅材料，不再是"现在什么状态"。
  **本文件只保留最近 6 批**（由 `npm run docs:trim` 自动归档，上限 340 行），
  让每次会话的开头仍然是"现在该干什么"；更早的记录 `git log --grep="批次 NNN"` 可查。

**批次 101 做过一次上下文瘦身**：这一节后面原先挂着约 900 行的"已打通模块表 + 需求审计 +
逐批流水"，另外 §4 还挂着约 330 行的经验表——**每轮会话都要读一遍纯粹是浪费**，
已经拆到下面两份文件里（内容一字未改，只是挪了位置）：

| 想查什么 | 读哪一份 |
| --- | --- |
| 某个模块（光照 / 网格化 / 容器 / 生物 / 结构…）当时是怎么做的 | [`docs/HANDOFF-ARCHIVE.md`](./docs/HANDOFF-ARCHIVE.md) |
| "这个坑踩过了，结论是什么" | [`docs/EXPERIENCE.md`](./docs/EXPERIENCE.md) |
| 下一步做什么（**唯一的"进行中"口径**） | [`.codebuddy/auto-continue.md`](./.codebuddy/auto-continue.md) |
| 长期总表 / 覆盖率 / 与原版的差异 | [`TASKS.md`](./TASKS.md)（三张派生表都由脚本生成，不要手抄） |

**派生数字一律不要手抄**：`npm run audit:tasks` 会核对本文件的进度口径与提交总数，

> **CI 门禁（批次 199）**：`.github/workflows/check.yml` 在推送与 PR 上跑**和本地同一条**
> `npm run check` + `npm run build:fast`。它在别处跑会有两个坑，都写在那个文件头里：
> ① `checkout` 必须 `fetch-depth: 0`（台账要数提交数，浅克隆会算出 1）；
> ② 与"发布"分成两个工作流（门禁红了不该把线上卡在旧版本）。
`npm run audit:coverage` / `npm run audit:diffs` 会重写 TASKS 里的两张表——手抄过的都漂过。
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

**已拆到 [`docs/EXPERIENCE.md`](./docs/EXPERIENCE.md)**（约 330 行：色彩空间、天光初始化、
地形尺度、断言怎么写、生物 AI 的"该共享原语而不是策略"、掉落概率的两个掷点……）。

动到渲染 / 光照 / 地形 / 界面 / 生物 AI 之前，先去那里搜一眼相关的行再动手——
那张表里每一条都是**已经付过代价**的结论。

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

**GitHub Pages 已经接好**（2026-10-16）：线上地址
`https://masontool.github.io/minicraft-ai-web/`，工作流 `.github/workflows/deploy-pages.yml`
在推 `main` 时自动 `npm ci` + `npm run build` + 发布 `dist`。
仓库侧只需做**一次**设置：`Settings → Pages → Build and deployment → Source = GitHub Actions`
（不改这一步的话工作流会跑完但不生效，线上 404——这是最常踩的一处）。
三条与"能不能在子路径下跑起来"有关的约定：
`vite.config.ts` 的 `base` 必须是相对值 `'./'`（Pages 上项目位于 `/<repo>/`）、
`index.html` 与 `manifest.webmanifest` 里的路径同样全是相对的、
项目没用 `SharedArrayBuffer` 因此不需要 Pages 无法自定义的 COOP/COEP 响应头。
⚠️ **联机在 Pages 上默认不可用**：`defaultServerUrl()` 给的是 `ws://<当前域名>:8787`，
而 Pages 是 HTTPS 页面，浏览器会直接拦掉这种混合内容；要玩联机得自己跑 `npm run server`
并挂 `wss://` 反向代理，再在控制台 `mc.connect('wss://你的域名', '昵称')`。

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
npm run dev                # 开发服务器
npm run check              # 【提交前】typecheck + 单测 + 145 套离线测试 + 三张台账（全过才提交）
npm run check:fast         # 【改代码时】typecheck + 单测 + 只跑被改动命中的套件（秒级）
npm run build              # 类型检查 + 生产构建（带 sourcemap，发布用）
npm run build:fast         # 只验"能不能出包"（SOURCEMAP=0，产物 hash 与正式构建一致）
npm test                   # typecheck:tools + vitest + 145 套离线测试
npm run test:offline:changed  # 只跑与本次 git 改动相关的离线套件
npm run audit:tasks        # 任务清单自检（编号重复/跳号 + 本文件进度口径是否过期）
npm run gen:stats          # 地形生成统计（耗时/洞穴占比/矿石产量）
npm run agent:setup        # 跨机器自检
```

**这些是一条链**：`npm run check` = `typecheck` + `test` + 三张台账。
`test` = `typecheck:tools` + `test:unit`（vitest）+ `test:offline`
（`tools/run-tests.mjs`：**一次 esbuild 打包全部入口 + 多进程并行**，
32s → 9s，见 TASKS A13）。单套调试仍可直接 `npm run test:reach` 这类老命令。

`npm test` 那一层共 **145 套**自建离线测试（清单的唯一来源是 `package.json` 的 `test:*` 脚本，
不在文档里另抄一份——`npm run audit:tasks` 会核对这个数）；
另有 `tools/mobile-check.sh` / `tools/ui-check.sh` / `tools/net-check.sh` 等**真浏览器验收脚本**，
它们要 dev server，不在 `npm test` 里。

浏览器控制台 `window.__mc`（`src/main.ts` 末尾挂的 App 实例）：
`connect(url,name)` / `disconnect()` / `netState` / `sendChat(text)` / `saveNow()` /
`saveStatus` / `openSettings()` / `updateSettings(patch)` / `setCameraMode()` / `cycleCameraMode()` /
`toggleRecipeBookForTest()` / `hoverHotbarForTest()` / `runCommand(text)` / `openChatForTest()` /
`blockId(name)` / `simulateFrameTime(ms)` / `bedState`（批次 79：`sleeping` / `sleepSeconds` /
`respawn`——验收脚本读重生点不必猜）/ `signState`（批次 80：`stored` / `visible` / `editing`）/
`signLinesAt(x,y,z)`（读某块牌子上的字）/
`frameState`（批次 86：`stored` / `visible`）/ `frameItemAt(x,y,z)`（读某格里展示框挂着的东西）/
`debugState.advancements`（批次 87：`open` / `rows` / `earned` / `total` / `ids`）/
`debugState.trade`（批次 88：`open` / 最近村民的 `profession` `level` `offers`）/
`villagerNearby()` / `openTradeNearbyForTest()` / `tradeNearbyForTest(i)` / `employNearbyVillagerForTest(id)`（村民验收用）/
`nearestVillageForTest()`（批次 89：最近的村庄在哪——村庄每 512 格才有一个，
手机上按它给的坐标 `/tp` 过去就能看到村民）/
`nearestStrongholdForTest()`（批次 114：最近的**要塞**在哪——末影之眼飞向的就是它，
要塞间距 96 区块 = 1536 格，靠走是走不到的）/
`summonWitherForTest()` / `witherState`（批次 116：直接放一只凋灵出来 / 它的
`health` `phase` `shielded`）/ `buildWitherAltarForTest()`（摆好 4 块灵魂沙 + 3 颗头
并**走玩家那条判定**召唤——走一遍真流程要先凑齐 3 颗头，自动化等不起）/
`buildBeaconForTest(level)` / `beaconStateAt(x,y,z)` / `beaconDebug`（批次 117：
在旁边搭一座 N 级金字塔 + 信标、读某座信标的等级与选择、看索引与光柱的现状）/
`nearestStrongholdForTest()`（批次 114，见上）/
`toggleAdvancementsForTest()` / `grantAdvancementForTest(id)` / `resetAdvancementsForTest()`（验收用）/
`fishingState`（批次 81：`phase` / `timer` / `waitFor` / `bobber`）/
`forceBite()`（把浮标直接推到咬钩，省掉 5~30 秒的等待）/
`teleport(x,y,z)` / `teleportForce` / `look(yawDeg,pitchDeg)` / `setTimeOfDay(t)` /
`setDimension('overworld'|'nether'|'end')` / `toggleDimension()` /
`__worldMenu`（主菜单：`fillNewWorldForm()` / `submitNewWorld()` / `render()` /
`setView('home'|'worlds'|'create')` —— 批次 108 起主菜单是分层的）/
`endPortalState`（批次 111：`inPortal` / `ticks`）/
`buildEndPortalForTest()`（批次 111：在**面前北边 6 格**搭一座已经点亮的末地传送门，
返回圈心坐标——走一遍真流程要"找要塞 + 翻 12 颗珍珠 + 合成 12 只眼睛"，
自动化验收等不起；这一段是唯一需要人工看的地方）/
`probe(x,y,z)`（方块 + 天光 + 方块光）/ `probeState` / `column(x,z)` / `sampleColumns(x0,z0,step)` /
`place(x,y,z,blockId,state)` / `dropItem(itemId,count,x,y,z)`，另有 info / 实体列表等。

其它：`tools/pixel-probe.mjs` 直接解码 PNG 取像素亮度，把"看起来偏暗"变成可对比数字。

## 7. 跨机器同步的边界

| 随仓库走（git 跟踪） | 只在本机（已 gitignore） |
| --- | --- |
| `TASKS.md`、`HANDOFF.md`、`AGENTS.md`、`README.md`、`docs/`、`src/`、`tools/` | `node_modules/`、`dist/`、`.tmp/`（构建与测试产物，含 `*.tsbuildinfo`） |
| `.codebuddy/auto-continue.md`（推进队列）、`.codebuddy/auto-continue-archive.md`（批次 1~95 的历史）、`.codebuddy/hooks/`、`.codebuddy/settings.json` | `.codebuddy/auto-continue.state.json`、`.codebuddy/auto-continue.log` |
| `.codebuddy/memory/`（AI 记忆的版本化副本，`npm run agent:setup` 恢复到本机） | 截图 `shot-*.png`、`.codebuddy/auto-continue.off` |

**唯一的外部依赖：git 远程仓库。** 没有远程，代码就只存在当前这台机器上，换电脑拿不到。
查看：`git remote -v`；没有就 `git remote add origin <地址>` 再 `git push -u origin main`。

## 8. 恢复一段会话的正确姿势

1. 新机器按第 0 节跑完，确认 `npm run agent:setup` 结论是「一切就绪」；
2. 打开 AI 会话，第一句给足上下文：
   「读 AGENTS.md、HANDOFF.md、.codebuddy/memory/MEMORY.md、.codebuddy/auto-continue.md，然后继续推进队列」；
3. AI 会自动：读队列 → 改 `[ ]` 为 `[~]` → 实现 → 自测（`check:fast` 内循环、`check` 提交前）→
   每步单独提交推送 → 更新队列；
4. 中途想接管：`touch .codebuddy/auto-continue.off`；想让它继续：删掉该文件。
