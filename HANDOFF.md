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

- 时间：2026-10-18 · 提交总数 614（每个功能点一条，可逐条回滚；`npm run audit:tasks` 会核对这一句）
- 技术栈：TypeScript（严格模式）+ Vite + Three.js / WebGL2；无第三方运行时依赖（除 three）
- 进度口径：`TASKS.md` 共 287 项 —— 已完成 **181**、进行中 **76**、待办 30 条（其中 55 条是需求审计新补的**整组**缺口，逐组明细见 `docs/HANDOFF-ARCHIVE.md` 的「需求审计」一节）；
  （`npm run audit:tasks` 会核对这一行与本表，改完条目记得跑一次）
  其中相当一部分待办是长期大项（村民与交易、织布机等功能方块、信标与地图、喷溅/滞留药水等）
  —— **进行中口径以 `.codebuddy/auto-continue.md` 队列为准**，两份文件分工不同，不要只看一份
  —— 2026-10-15 做过一次**逐条核对**（对着 src/tools 的真实实现重判 37 条），
  勾选状态与代码实况已对齐；以后每完成一项顺手改这两份文件，避免再次漂移
- 批次 207（把"为什么掉血"写清楚）：
  ① **伤害走一条带原因的队列**：`PlayerStats.damage(amount, cause, source)` 记 `damageLog`，
  主循环每帧 `takeDamageLog()` 取走（取完即清）。一帧里挨两下（僵尸 + 岩浆）也不会
  把账都算到最后一下头上——以前只有 `lastDamage`，原因会张冠李戴。
  ② **具体来源**：生物近战带 `type.name`（"被僵尸攻击"），箭矢/三叉戟/火球/凋灵骷髅头/
  末影水晶、世界边界、末影龙吐息、`/kill` 都带上来源；环境伤害由 `DamageNotice.ts`
  的表给出"碰到岩浆/头卡在方块里"这类可执行的原因。
  ③ **文案统一成"现象 + 原因"**：掉血 `受到 3 点伤害：被僵尸攻击（3 点）· 生命 17/20`，
  回血/饥饿/氧气/着火/低血量/饿死都补了原因与建议；死亡卡片下方多一行死因。
  `test:survival` 46 条、`test:ui` 605 条（`npm run check` 全绿）。
- 批次 206（用户八条实机反馈：物理 / 返回 / HUD / 背包）：
  ① **雪地抖跳**：竖直落地解算原来用 `floor(y)+1`（只对整格成立），雪层 1/8、台阶 1/2
  被顶到整格再掉回来；新增 `AABB.resolveVertical` 二分求真实碰撞面，玩家与实体共用。
  ② **自动跳跃**：设置「控制」组新增开关（默认开），`PlayerPhysics` 前方一格高的坎
  自动起跳；0.6 格内仍走上台阶、两格墙不原地蹦。
  ③ **返回键**：安卓全屏里返回常常只退出全屏（没有 popstate）→ 方向锁失效、竖屏提示
  盖住暂停菜单；现在监听 `fullscreenchange`，掉出全屏且无面板时打开暂停菜单，
  `body.pause-open` 让竖屏提示让位，「继续游戏」顺手要回全屏+横屏；
  两个事件同时到达时用 160ms 计时器去重（否则一次返回会退两个层级）。
  ④ **HUD 重排**：聊天与玩家信息搬到**左上角**（新增 damage/gain/warning 三类消息），
  性能信息 `#debug` 搬到**右上角**（与状态效果同列）；聊天消息不再 14 秒后删除，
  打开输入框铺最近 120 行、可触屏滑动翻历史；主循环对比生命/饥饿/氧气/着火播报
  受伤（带来源）、回血、饥饿增减、低血量、饥饿耗尽、缺氧/溺水、着火。
  ⑤ **背包分类改口径**（用户澄清）：左栏列的是"**仓库材料能合成什么**"，不是"我有
  什么"；材料够的配方正常显示，之前点过、现在缺料的留在列表里（红底），搜索同此。
  ⑥ **不再选中**：生存模式点分类项不把手上的成品拿走（无 `.selected`），只把配方画到
  右栏；材料够就真实填入、结果槽可取，不够则材料红底 + **结果槽也画出产物**（只读预览）。
  ⑦ **丢弃**：面板空白与窗外暗色区域都算"界面外"，整叠丢出（右键 1 个）；以前点面板内
  空白是"原位退回"，手机上几乎点不到真正的窗外，所以玩家一直觉得"丢弃没做"。
  ⑧ **3×3 工作台**：分类栏与 3×9 仓库在双栏网格里占同一格，工作台例外导致两层叠在一起
  （"多一个浮层"）；现在分类显示时仓库一律隐藏，切左下"物品栏"页签才回到 3×9。
  `test:physics` 33 条、`test:settings` 58 条、`test:ui` 599 条（`npm run check` 全绿）。
- 批次 205（把"卡在哪"变成可测的）：接上一批 —— 知道"渲染不跟视距"之后，仍然不知道
  "越玩越卡"的根因在哪。这一批只做**测量**，两件事：
  ① `dt` 拆成两条：物理/动画继续用夹紧到 100ms 的 `dt`（一步 0.6 秒会穿模），
     而**测量**改用真实帧间距 `frameSeconds`（上限 2 秒，后台回来那一下不算"一帧卡了 3 分钟"）。
     以前两者共用夹紧值，掉到 9fps 时诊断里永远只看到 100ms。
  ② 帧内分段计时 `FramePhaseMeter`（放在 `PerfPolicy.ts`，纯逻辑可断言）：
     主循环用 `mark = this.lap('sim'|'env'|'io'|'chunks'|'ent'|'part'|'render'|'hud', mark)`
     记 8 段，每 5 秒的 `perf/sample` 里带 `frameAvgMs`（窗口真实平均帧间距）、
     `cpu`（各段之和）与 `phases`（每段毫秒）。
     判据：**`cpu` 远小于 `frameAvgMs` → 卡在 GPU/合成；两者接近 → 卡在 CPU**，
     再看 `phases` 是哪一段涨了。`test:perfpolicy` 121 条（+11）。
- 批次 204（"降了视距为什么还是卡"）：用户看了真机现象后问"卡的时候视距好像还很大，
  是不是自适应视距没生效"。查下来**策略本身是生效的**（降 1 格/4 秒，从 8 到地板 4 约 16 秒），
  但**渲染根本不受视距约束**——两个原因叠在一起：
  ① `World.update` 卸载时留 `keepRadius = 半径 + 2` 的缓冲圈，这些区块**仍然画**；
  ② `cameraFarFor` 取"视距×16+32"与天空穹顶（180+32=212 ≈ 13 区块）的**较大者**，
     手机视距 4~8 时远裁面永远是 212，远裁面一个区块都裁不掉。
  于是"视距 8→4"只让加载圈变小，画面里的 draw call 与三角形几乎不掉 → 玩家看到的还是大范围。
  修法：`ChunkRenderer.applyViewDistance` 每帧按区块中心到玩家的水平距离切 `.visible`
  （不动几何体、不重新上传，441 个区块 = 几百次平方距离比较）。诊断加 `drawn`（画/留），
  HUD 改成 `已渲染: 画/留`。`test:render` 106 条（+8）。
  顺带（用户同意）：设置里的「视野」并进「控制」，**「视频」组随之删除**（组数 5 → 4）。
- 批次 203（设置瘦身：性能项不再让玩家配）：用户的原话是"性能相关的设置可以不用让用户去设置，
  我们给到用户最好的决策就够了"。于是**图形组只剩「视野」**，删掉四行：
  视距滑块 / 自适应分辨率 / 自适应视距（全是性能调参，已由 `PerfPolicy` 全权接管，
  玩家的手动值还会和策略打架）、天气效果（雨量已由装饰层档位自动控制）。
  加上批次 185 删掉的云 / 粒子 / 帧率上限，性能类入口已经清零。
  ⚠️ `viewDistance` / `weatherEffects` / `adaptiveResolution` / `adaptiveViewDistance`
  **字段全部保留**（删字段会让 `loadSettings` 把老存档整份回退），值改由主程序定死：
  进世界时 `adaptive* = true`、`viewDistance = defaultViewDistanceFor(设备)`
  （手机上限 8 / 桌面 12，忽略存下来的旧值——没有滑块之后旧值只会是"以前在别的设备上拖的数"）。
  顺带修一个潜伏 bug：`viewDistanceNow` 原来是 `min(viewDistance, startupRamp.radius)`，
  而 ramp 涨完就冻结在开局值（手机 6）→ 自适应把视距还回 8 时**实际一点没变**；
  现在 `done` 之后只认 `viewDistance`。`test:settings` 56 条、`test:ui` 589 条（+4）。
- 批次 202（真机掉帧 + "恢复默认"失效）：用户给了一份真机诊断（792×360 / dpr 3），现象是
  "有缓存的浏览器打开后一直卡、无痕模式稳 60 帧、设置里恢复默认也没用"。**日志先证伪了"缓存"**——
  同一份包开局 5 分钟仍是 60 帧（背包开着时 60、40~63 秒真的在走也在 60），到 331 秒才开始
  48 → 32 → 27 → 22，最后 9。真凶是两处**写回去没夹设备上限**的代码：
  ① `applySettings` 直接 `this.viewDistance = settings.viewDistance`——手机的"最多 8"只在策略侧
  （`perfPolicyStep`）生效，改任意一项设置 / 点恢复默认都会把 12 原样吃下去，`World.update`
  按半径 12 请求 **489** 个区块（常驻最多 841）；② `resetDefaults` 只覆盖 `GameSettings`，
  碰不到自适应记的分辨率倍率 / 装饰层档位，于是"点了恢复默认画面还是糊的"。
  另修：视距没变不再 `refreshWorld(force)`（拖音量滑块不该重算区块范围）；
  补 `perf/sample`（每 5 秒：帧时间 / 分辨率 / 视距 / 区块·网格·光照队列 / draw call / 三角形 /
  实体 / 粒子 / 堆占用）与导出 `meta.perf` / `meta.gpu`——**这份日志里一条性能数据都没有**，
  这是"只能看出什么时候卡、看不出卡在哪"的直接原因。`test:settings` 56 条、`test:ui` 585 条。
  ⚠️ 遗留：越玩越卡的**根因仍未定**，等下一份带采样的日志再判。
- 批次 201（视角卡死复现后续）：批次 183 只处理了"**按下时**坐标全 0"，真机仍有残留——
  异常会发生在**拖动中途**，而且单帧重排不足以让浏览器重新映射坐标。现在补三条：
  ① 拖动中 `clientX/Y` 变 0 → **保留已累计位移、中途换到 screen/page 继续**，不再丢弃
  （丢弃就会"手指在动、视角不动"）；② `nudgeLayout` 升级成和"开关背包"等价的完整路径
  （`body.inv-pocket-open` + 失焦 + 隐藏两帧 + 整页 reflow）；③ 4 秒内连续两次异常 →
  **自动真的开关一次背包**（120ms，带 HUD 提示），把用户手动的恢复动作自动化，
  日志记 `input/autoRecover.uiCycle`。专项验收 23 条（新增中途换源 −11.7°、自动恢复）。
- 批次 200（B20 灵魂火把 / 灵魂灯笼）：新方块 id **576/577**（接在炼药锅之后——558~573 是
  混凝土粉末、574/575 是音符盒与炼药锅），亮度都是 **10**（比火把暗一档）。
  灵魂火把复用 `torch` 形状、蓝焰贴图；**灵魂灯笼**用了**新形状 `lantern`**
  （6/16 见方 + 提环，碰撞只有灯身，只落地不挂顶）。配方：灵魂火把 4 条
  （煤/木炭 × 灵魂沙/灵魂土 → 4 个）、灵魂灯笼 1 条（8 铁粒 + 1 火把）。
  `test:soul` 41 条；配方表 551 → 556；离线套数 129 → **130**；B20 从 `[ ]` 变 `[~]`。
- 批次 199（CI 门禁）：新增 `.github/workflows/check.yml`——推送与 PR 上跑**和本地同一条**
  `npm run check` + `npm run build:fast`，门禁不再只靠本地自觉。两处坑写在文件头：
  `fetch-depth: 0`（台账要 `git rev-list --count`）、与发布工作流分开（门禁红了不该卡发布）。
- 批次 198（流程自检）：① **AGENTS.md 的"套数"纳入自检**——它写着 109（实际 129）却一直没人发现，
  因为 `audit:tasks` 只查 README 与 HANDOFF；现在三处一起核对。② **两份长文档再瘦身**：
  `HANDOFF.md` §1 只留最近 6 批（435 → 256 行，167~191 搬去归档）、
  `.codebuddy/auto-continue.md` 只留最近 3 批 + 流程清单（3710 → **144 行**，96~194 搬去归档，
  条目数 1406 = 1406 一条没丢）。③ `docs/EXPERIENCE.md` 补了 188~197 的七条经验
  （四处链路 / 四角探针 / 白名单 / 配方产物带数据 / 数据粒度 / 迁移拒绝 / 数字查三处）。
- 批次 197（F3 收口：潜行防掉落 + 冲刺跳）：`PlayerPhysics.update` 在移动前用**四角探针**判断
  新位置脚下有没有支撑，哪一轴没有就清哪一轴速度（沿着坑边横着挪仍然可以，半空潜行不会被钉住）；
  起跳那一帧沿输入方向补 `SPRINT_JUMP_BOOST = 2.2` 格/秒（普通跳没有）。
  差异：潜行停在"脚尖还在台上"，原版允许身体探出去一点。`test:physics` 19 条；
  离线套数 128 → **129**；F3 从 `[~]` 变 `[x]`。
- 批次 196（H16 / K7 地图）：空地图（8 纸 + 1 指南针）右键**绑定到脚下**（中心钉住，
  覆盖 512×512 格 = 32×32 区块），之后**走到哪记到哪**（跨区块时扫一遍背包），
  右键打开阅读界面（`ui/MapScreen.ts`：绿 = 去过、米色 = 没去过、红三角 = 你、✦ = 中心）。
  数据在 `ItemStack.map`（中心 + **128 字节 base64 位图**，一格 = 一个区块），走四处链路。
  差异：一格一个区块（原版按方块像素）、不画地形、没有制图台、中心不移动。
  `test:map` 54 条；配方表 550 → 551；离线套数 127 → **128**。K7 从 `[ ]` 变 `[~]`。
- 批次 195（B19 指南针 / 时钟）：两件物品（1490 / 1491）+ 两条配方（4 金/4 铁 + 1 红石）+
  右下角读数表盘 `ui/ToolHud.ts`（**只在主手拿着时出现**，不接指针事件）。
  指南针指向**世界出生点**、下方显示距离；时钟按 `timeOfDay` 转（正午在顶、午夜在底）。
  角度换算全在 `core/items/Navigation.ts`（纯函数）：相对玩家朝向的指南针角、表盘角、
  距离、时段文字。`test:navigation` 74 条；配方表 548 → 550；离线套数 126 → **127**。
- 批次 194（B18 盾牌）：`core/items/Shield.ts`（三个纯判据：能挡哪些伤害 / 是不是正面 / 磨损多少）
  + 物品 1493（耐久 336、铁砧用木板修）+ 配方（6 木板 + 1 铁锭）。
  举盾 = 按住"使用"，主手或副手都算；挡下时正面 ±90° 的近战与弹射物伤害归零、
  耐久按 `1 + ⌊伤害/5⌋` 磨损、退半步、播新音效 `shield_block`；碎掉与工具同一条处理。
  差异：没有斧头破防、举盾不减速、不挡爆炸。`test:shield` 49 条；配方表 547 → 548；
  离线套数 125 → **126**。
- 批次 193（C8 存档迁移框架）：`core/save/SaveMigrations.ts` 把迁移收成**按版本号串起来的链**
  （v1→v2，每条只做一步、纯函数）。`SAVE_VERSION` 升到 **2**；第一条规则收掉批次 181 散在
  读档流程里的 `flying → gameMode`。`SaveGame.open` 的判断也改了：**比程序新**仍按新世界处理
  （硬读一半会把存档写坏），**比程序旧**保留 meta、读档时逐级升级，成功后把 `meta.version`
  提到最新（下次自动保存就写新版本）。链断、规则抛异常、版本为负/NaN → `null`，
  调用方按"读不出玩家"处理。`test:migration` 28 条；离线套数 124 → **125**。
- 批次 192（H16 烟花）：`ItemStack.firework`（`{ flight, colors }`，四处链路一起补）。
  两件物品：**烟火之星**（火药 + 16 色染料 → 颜色即染料）、**烟花火箭**（纸 + 火药 ×1~3 定档位，
  加一颗星带颜色）；火箭颜色**取自摆进去的那颗星**，所以这条落在 `CraftingGrid.recompute`
  （配方表只按 id 匹配）。发射走新实体 `core/entity/Firework.ts`：匀速 10 格/秒上升，
  引信 1.0 / 1.4 / 1.8 秒，炸开时按颜色出粒子、按距离衰减伤生物（5/6/7）、**不炸地形**。
  `test:firework` 73 条；配方表 525 → 547；离线套数 123 → **124**。H16 只剩旗帜图案与地图数据。
- 批次 191 及更早（167~191，共 25 条）：已搬到 `docs/HANDOFF-ARCHIVE.md` 的
  「§1 批次流水（167~191，批次 198 搬迁）」一节——那部分是"当时怎么做"的查阅材料，
  不再是"现在什么状态"。**本文件只保留最近 6 批**（192~197），让每次会话的头 200 行
  仍然是"现在该干什么"。

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
npm run check              # 【提交前】typecheck + 单测 + 130 套离线测试 + 三张台账（全过才提交）
npm run check:fast         # 【改代码时】typecheck + 单测 + 只跑被改动命中的套件（秒级）
npm run build              # 类型检查 + 生产构建（带 sourcemap，发布用）
npm run build:fast         # 只验"能不能出包"（SOURCEMAP=0，产物 hash 与正式构建一致）
npm test                   # typecheck:tools + vitest + 130 套离线测试
npm run test:offline:changed  # 只跑与本次 git 改动相关的离线套件
npm run audit:tasks        # 任务清单自检（编号重复/跳号 + 本文件进度口径是否过期）
npm run gen:stats          # 地形生成统计（耗时/洞穴占比/矿石产量）
npm run agent:setup        # 跨机器自检
```

**这些是一条链**：`npm run check` = `typecheck` + `test` + 三张台账。
`test` = `typecheck:tools` + `test:unit`（vitest）+ `test:offline`
（`tools/run-tests.mjs`：**一次 esbuild 打包全部入口 + 多进程并行**，
32s → 9s，见 TASKS A13）。单套调试仍可直接 `npm run test:reach` 这类老命令。

`npm test` 那一层共 **130 套**自建离线测试（清单的唯一来源是 `package.json` 的 `test:*` 脚本，
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
