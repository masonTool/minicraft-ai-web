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

- 时间：2026-10-18 · 提交总数 590（每个功能点一条，可逐条回滚；`npm run audit:tasks` 会核对这一句）
- 技术栈：TypeScript（严格模式）+ Vite + Three.js / WebGL2；无第三方运行时依赖（除 three）
- 进度口径：`TASKS.md` 共 287 项 —— 已完成 **179**、进行中 **75**、待办 33 条（其中 55 条是需求审计新补的**整组**缺口，逐组明细见 `docs/HANDOFF-ARCHIVE.md` 的「需求审计」一节）；
  （`npm run audit:tasks` 会核对这一行与本表，改完条目记得跑一次）
  其中相当一部分待办是长期大项（村民与交易、织布机等功能方块、信标与地图、喷溅/滞留药水等）
  —— **进行中口径以 `.codebuddy/auto-continue.md` 队列为准**，两份文件分工不同，不要只看一份
  —— 2026-10-15 做过一次**逐条核对**（对着 src/tools 的真实实现重判 37 条），
  勾选状态与代码实况已对齐；以后每完成一项顺手改这两份文件，避免再次漂移
- 批次 192（H16 烟花）：`ItemStack.firework`（`{ flight, colors }`，四处链路一起补）。
  两件物品：**烟火之星**（火药 + 16 色染料 → 颜色即染料）、**烟花火箭**（纸 + 火药 ×1~3 定档位，
  加一颗星带颜色）；火箭颜色**取自摆进去的那颗星**，所以这条落在 `CraftingGrid.recompute`
  （配方表只按 id 匹配）。发射走新实体 `core/entity/Firework.ts`：匀速 10 格/秒上升，
  引信 1.0 / 1.4 / 1.8 秒，炸开时按颜色出粒子、按距离衰减伤生物（5/6/7）、**不炸地形**。
  `test:firework` 73 条；配方表 525 → 547；离线套数 123 → **124**。H16 只剩旗帜图案与地图数据。
- 批次 191（J25 讲台）：新增 `core/container/Lectern.ts`——一格（摊着的那本书）+ 一个页码，
  进 `BlockEntityStore` / `ContainerSave`（第 5 处登记）/ `CONTAINER_BLOCKS` / `containerOfBlockAt`。
  右键把书与笔或成书**放上去**（创造不消耗）、再右击**翻开**（从上次那页接着读）、
  **潜行右击收回**（背包满就掉在台前，掉的是带页与书名的原栈）。
  页码夹在 `0 ~ 页数-1`：换书、读档、脏数据都不会出现"第 37 / 2 页"。
  阅读界面复用 `BookScreen`（新增 `startPage` + `onPageChange`）。
  `test:lectern` 54 条；离线套数 122 → **123**。J25 只剩织布机。
- 批次 190（H16 第一片：书与笔 / 成书）：`ItemStack` 多了 `pages`（每页 256 字、最多 50 页）
  与 `title` 两个可选字段，四处链路（`restoreStack` / `stackExtras` / `sameExtras` /
  `Transfer.cloneExtras`）一起补；物品是 `书 + 墨囊 + 羽毛 → 书与笔`，写完「署名」→ **成书**
  （id 换掉、书名记下、从此只读，空白书不让署名）。界面 `ui/BookScreen.ts`：一页一个文本框 +
  翻页 + 完成/署名 + 只读阅读，面板高度封顶（手机横屏不挤没）、文本区自己滚、按钮固定底部；
  举着书右击就打开（对着空气也行）。`test:book` 63 条；配方表 524 → 525；离线套数 121 → **122**。
  H16 从 `[ ]` 变 `[~]`（剩烟花 / 旗帜图案 / 地图数据）。
- 批次 189（鱿鱼 → 墨囊 → 黑色/灰色染料）：**O14 白名单又短了一截**。
  新增**鱿鱼**（10 血、1~3 个墨囊、只在四种海洋群系的水里刷；`MobType.aquatic` 让它在水里
  不受重力、上岸 10 秒后窒息；被动刷怪器新增"水里那条路"，岸上那条改为只挑陆生生物）+
  **墨囊**（`Item.INK_SAC`，id 1499；鱿鱼蛋用显式 id 1498，因为顺序区间已被水桶占住）+
  `墨囊 → 黑色染料`、`黑 + 白 → 灰色染料（2）`。黑/灰两色的羊毛、地毯、床、染色玻璃与
  玻璃板、陶瓦、混凝土粉末**整族接通**：物品侧缺口 4 → **2 条**，方块侧 33 → **25 条**。
  `test:squid` 46 条；离线套数 120 → **121**。
- 批次 188（H15 砂轮）：**砂轮终于有界面了**。右键打开后三格（要洗的物品 / 同种装备 / 产物）：
  ① 单件带附魔 → **洗掉全部附魔**（含诅咒），按"权重 × 等级"折算成经验**返还**，
  累积惩罚归零、自定义名保留；② 两件同种装备 → 剩余耐久相加 + **5%**（铁砧是 12%），附魔一起洗掉；
  ③ 附魔书 → 洗完变成普通书。产物仍然是"两格算出来"的，取走才扣输入，经验球冒在**砂轮上方**。
  逻辑在 `core/crafting/Grindstone.ts`（纯函数）、容器在 `core/container/Grindstone.ts`、
  界面是 `InventoryScreen` 的 `grindstone` 模式（复用铁砧那套 `anvil-row` 布局）；
  容器按坐标存、随存档走、进 `CONTAINER_BLOCKS` 与 `containerOfBlockAt`（拆掉时东西会还给你）。
  顺手修掉一个**刷物品的口子**（铁砧 / 锻造台一直有）：拆方块倒空时把"算出来的产物槽"也倒了，
  放两把附魔剑再拆铁砧就能白拿一把洗过附魔的剑——现在 `Transfer.isComputedResultSlot()` 跳过这三台。
  `test:grindstone` 63 条；离线套数 119 → **120**；H15 收口（锻造台早做完、制箭台原版无界面）。
- 批次 187（角色创建最小版）：设置新增「外观」页（肤色/上衣/裤子各 6 档 + 披风），
  `game/appearance.ts` 存**档位下标**（坏值回退默认），第三人称模型、背包 3D 预览、2D 兜底
  三处共用同一套配色；默认档 = 原配色，老存档不换人。`feedback185-check` 32 条全 OK。
- 批次 186（收尾 + 角色）：① 返回键层级改成"暂停菜单 → 保存回主菜单 → 再返回退出页面"；
  ② 成就入口搬到背包右轨（合成/盔甲上面）；③ 潜行有姿态（下沉/前倾/摆幅减半）；
  ④ 设置删「云」「粒子效果」；⑤ 背包预览换成**可旋转 3D 小人**（`ui/PlayerPreview3D.ts`，
  拖动转一圈，WebGL 失败退回 2D），新增「披风」开关（第三人称与预览共用），
  副手有东西时左臂挂一块板。真浏览器验收 `feedback185-check` 扩到 31 条全 OK。
  **仍未做**：完整角色创建器（肤色/发型/衣物）——需要先定选项与是否新增物品。
- 批次 185（用户第二轮反馈，三个提交）：① **竖屏浮层改成整屏不透明**（点它全屏+锁横屏，
  横过来自动收），并提到 boot 最前面；② 触摸攻击改成"点哪打哪"（屏幕点反投影射线，
  从相机发出，第三人称也对；`ATTACK_RANGE` 内点到生物就攻击）；③ 玩家手挖方块后补
  `wakeFluidsAround`（水/岩浆旁的方块挖掉后终于会流）。背包侧：创造 3×3 工作台左轨分类
  恢复、切分类回顶、分类底部统计、非搜索分类不留搜索位；3×3/熔炉配方在箭头旁点亮工作台/
  熔炉图标；红底物品只闪不选中；关闭动画未完成时可重开；箱子格改正方形；删「销毁」格；
  设置加「恢复默认」并删「帧率上限」。**真浏览器验收** `tools/feedback185-check.sh`
  25 条 OK（844×390 + 360×732 两段）。仍未做：潜行姿态、角色预览旋转/披风、角色创建、
  成就入口位置（见 auto-continue 批次 185 的"待确认"）。
- 批次 184（用户一轮六条反馈，六个独立提交）：① 竖屏**点任意区域**都再试一次全屏+锁横屏
  （`armPresentOnTap`，不是一次性）；切后台记一笔，回前台先落暂停菜单 + 不透明
  `#resume-gate`（「游戏已暂停 · 点击任意处继续」），点它 = 请求全屏+锁横屏+关遮罩/菜单。
  ② 新建世界表单：窄屏不再把标签与输入框拆两行，说明挪到最后，横屏 390 高可一屏放完。
  ③ 背包左轨改回**单列竖排**（按钮按可用高度均分，11 颗也不换列/截断），关闭键与配方键
  缩到 24×20、标题栏 34→18px。④ 配方开关关着时空分类栏**留白**（不再写"你还没有东西…"）。
  ⑤ 输入框：viewport 改 `interactive-widget=resizes-visual`（键盘不缩布局），
  `ui/Keyboard.ts` 用 `--kb-inset` 让聊天/告示牌自行避让，并在捕获阶段"点别处先 blur"
  （按住按钮时 `preventDefault` 会阻止失焦，键盘才会反复弹回来）。⑥ 红底"我没有的"物品
  不再套选中态，只给 220ms 缩放反馈；名称仍弹、配方仍摆进合成格。`test:ui` 553 条全绿。
- 批次 180（背包图标）：**方块物品改成等轴立方体图标** —— 新增 `ui/BlockIcon.ts`：按 `BlockDef.tiles`
  的 [顶, 底, 侧] 三张**面**贴图，在 34×34 离屏画布上拼一个 2:1 等轴立方体（逐面明暗：顶 0% /
  左 18% / 右 32%，实心面先垫平均色盖住交界细缝）。形状各有盒子：整块 / 台阶 / 楼梯 / 栅栏 / 墙 /
  漏斗 / 蛋糕 / 床 / 脚手架…… 门、活板门、火把、梯子、玻璃板、告示牌、植物等 22 种形状**保持平面**
  （原版物品栏里也是精灵图）。仍然零素材、零版权风险：贴图还是运行时程序化生成的那一套。
  性能：热路径仍是**一次 `drawImage`**（图标按 blockId 缓存，34×34≈4.6KB，上限 512 个），
  冷启动一页背包 <1ms。顺带给 `TextureAtlas` 补 `revision` + `markTextureChanged()`
  （资源包换贴图后图标缓存、平均色缓存一起作废，否则背包里还是旧材质）与 `tileOpacity()`
  （带透明洞的贴图不垫底色，否则玻璃/树叶会变成实心方块）。`test:ui` 489 → 490 条
- 批次 183（真机日志定位的两处）：**双血条 + 视角卡死**。
  ① 双血条/双经验条是"应用内回菜单"的副作用：`VitalsHud` / `XpHud` 挂在静态容器
  （`#vitals` / `#hud`）上，重进世界时 new 了新实例却没有清旧节点。现在构造函数先清、
  拆局也 `dispose()`；专项验收在"退出→再进入"之后数 `#vital-health` / `#xp-bar` 必须各 1。
  ② 视角卡死的根因是 **PointerEvent 的 `clientX/Y` 偶发双双为 0**（用户日志里连续 20 多次
  `look.down x=0 y=0`，拖动增量恒 0；摇杆也会拿原点算方向）。新增
  `core/input/PointerPoint.ts`：client 不可用时退 screen/page，一次手势锁定同一来源；
  三组全 0 则判手势无效并**强制触摸层隐藏一帧再显示**（等价于用户摸索出的"开关一次背包"）；
  回到前台 / 全屏切换也会 `recover()`。日志新增 `pointer.anomaly`（含 pointerType /
  screen / page / visualViewport）与 `stick.reset` 原因，下次再犯能直接定位。
  `test:pointer` 9 条；专项验收 21 条（含 client=0 时 screen 兜底仍能转视角）。
- 批次 182（首页版本信息）：**首页页脚显示"构建时间 + 提交标题"**（`src/game/buildInfo.ts`）。
  两个值由 `vite.config.ts` 用 `execFileSync('git', ['log','-1','--format=%h%x20%s'])` 在构建/启动时注入
  （`define` → `__BUILD_COMMIT__` / `__BUILD_TIME__`，声明在 `src/globals.d.ts`）；
  时间按**看页面那台设备的本地时区**显示，构建环境没有 git 时回退 `unknown`，绝不出现 `Invalid Date`。
  首页那行可选中复制（方便排查时贴给 AI）。`test:buildinfo` 12 条；`ui-check` 三视口各加一条首页断言。
- 批次 181（用户手机反馈）：**启动/输入/背包/HUD 收口**。
  ① 诊断日志（`game/diagnostics*.ts`，环形 4000 条、500KB 落盘预算、设置里有记录/导出/复制，
  `__diag` 与 `__mc.diag` 给自动化）——"切模式后摇杆反向"这类问题以后靠它复现；
  ② 退出世界改**应用内回菜单**（`App.dispose()` 全量拆局 + AbortController 解绑），不再 reload、不丢全屏；
  竖屏提示从整屏黑幕改成底部横条；返回键分层（游戏内无面板 → 暂停菜单）；
  ③ 触摸手势只留一个 280ms 阈值：点=交互/攻击/放置，按=破坏；`resetInput()` 在切模式/开关界面/失焦时清手势；
  ④ `gameMode` 与 `flying` 拆开，新建世界/暂停菜单可选模式，双击跳只切飞行；
  ⑤ 背包左栏统一 7 列 40px、状态收成一个 `pane`、配方预览只读、关界面孤品归位、丢弃有提示；
  ⑥ 顶部三键（暂停/视角/聊天）、准星下方目标名称、2 秒提示浮窗；
  ⑦ 世界类型写明"超平坦没有树/村庄/矿石"，下拉深色主题。
  新增 `test:diag`（57）、`test:mode`（18）、`test:worldtype`（19），离线套数 114 → **117**。
  真浏览器：`ui-check` 149 条 OK（三视口）、`mobile-check` 14 条 OK（844×390）、新增 `feedback181-check` 16 条 OK。
- 批次 179（TASKS N10 收尾）：**地形正常化** —— 山、岸、海底一起变正常。
  三条根因：① `peaksAndValleys()` 的输入**没夹紧**，weirdness 超出 ±1.1 时折叠值能到
  **-2.8**，`pv × factor × 40` 于是给出 **-110 格**（这才是"海床深到世界底"的真凶，
  `offset × 96` 反而是干净的）；② 起伏项**没有海陆门控**，海底与陆地被同一套峰谷甩；
  ③ `detail3d` 系数里的 **0.5 常数项**让"最平坦"的地方也带 ±13 格三维起伏。
  改法：夹紧输入 + 加海陆门控（水下 0.12）+ 细节系数去常数项并夹到 ±0.45 +
  把噪声能量从小尺度挪到大尺度。实测（448×448）：陆地相邻高差 **16.03 → 1.10**、
  海底 **13.72 → 1.19**、海岸落差 **40.25 → 2.70**、世界最低点 **-64 → 34**、
  每列实心段数 **1.56 → 1.00**、可落地 **45.3% → 95.0%**、尺度谱 **1.79 → 15.7**；
  三角面 15214 → 11296、生成 11.0 → 10.0ms/区块。新增 `test:terrain:normal`（43 条
  "正常度"判据，**元素占比有下限**——不许靠"全调平"作弊）。顺带修掉 4 个被照出来的老 bug：
  村庄道路会清掉房屋的门、`test:structure` 门成对断言写反且一直没执行、
  矿脉母岩清单漏了粗铁块、`test:village` 漏数跨区块的床
- 批次 178（TASKS M20 最后一条）：**音量分组**——`AudioEngine` 四组（方块/生物/玩家/界面与环境），
  映射表是**穷尽映射**（忘分组 = 编译期报错），分组增益与主音量相乘；设置"音频"组五条滑杆，
  默认全是 1。`test:audio` 45 条、`test:settings` 48 条。M20 至此只剩"语言"（归 M8）与
  "难度"（属世界状态，刻意不做成设备偏好）
- 批次 177（TASKS G13 收尾之二）：**岩浆锅**（同一个锅 + 状态位标记：倒岩浆桶灌满、舀空前清标记、
  岩浆舀不成瓶子、**站在里面等同泡岩浆**、顶面换贴图）与**下雨自动接水**（接进**随机刻**：
  没满 + 天光 15 + 正下雨 → 按 `CAULDRON_RAIN_CHANCE` 涨一级）。`test:bucket` 40 → 53 条。
  只剩"细雪锅"（细雪本身没做）与"洗染色装备"（要先有物品染色数据）
- 批次 176（TASKS G13 主干）：**桶装水**——水桶/岩浆桶（只能装**水源**，流水不行）、
  对着地面倒出**源头**液体；**炼药锅**（水位 0~3 存状态位，形状借堆肥桶）：一桶灌满、
  空桶只能舀满锅、**玻璃瓶每瓶掉一级**（水瓶在生存里的第二条路）。7 铁锭配方，`test:bucket` 40 条。
  仍缺：装岩浆/细雪的锅、洗染色装备、下雨自动接水（判据已就位，缺"降水刻"去摇骰子）
- 批次 175（TASKS K12）：**世界边界**——`core/world/WorldBorder.ts`（纯函数：夹取/越界距离/伤害曲线/
  读档容错）+ `render/BorderRenderer.ts`（四道半透明蓝墙，**每帧按玩家位置摆**，边长 ≥10 万时不画）。
  `/worldborder get|set|center`，越界 `1 + floor(超出/5)` 点/秒，**软区 5 格 + 硬墙**（原版只伤害不推回，
  这是刻意的差异：手机上"一直往外走只掉血"会让人以为边界没生效）。进存档 `PlayerSave.border`。
  `test:border` 51 条；顺带修掉 `test:entity` 里一条**自带随机性**的断言（经验球合并用默认随机初速）
- 批次 174（TASKS J17）：**刷怪蛋 21 枚**——手机上再也不用敲 `/summon` 才能看一只生物。
  对着一格方块右击生成（创造不消耗）；贴图是一副蛋形按该生物自己的 `bodyColor`/`accentColor`
  参数化画出来的；**只给物种做蛋**（史莱姆/岩浆怪各一枚中号）、两个 boss 没有蛋。
  它们是**创造专属**：可达性审计改由 `ItemDef.spawnEgg` **显式排除**，并额外断言
  "每一枚都真的没有任何配方/掉落/战利品来源"（不是拿"创造模式能拿"当理由）
- 批次 173（TASKS G9）：**音符盒**落地——右击演奏、**潜行右击**换音高（0~24，每档半音，
  频率 = 185Hz × 2^(n/12)），音高存在方块状态低 5 位（不需要方块实体，贴图也不随音高变）；
  音频新增 `AudioEngine.playNote(hz)`（三角形波 + 二次谐波，25 个音高共用一条音色）。
  ⚠️ 踩到一个"规则与实现打架"的点：主循环里**潜行右键一律走放置**，所以音符盒那个
  "潜行右键换音高"必须**特判在那道判断之前**，否则音高永远换不了
- 批次 172（TASKS M20）：设置里补两项——**天气效果**（关掉只停"画出来的雨雪与雨花"，
  天气本身照旧）与**自动保存间隔**（30/60/120 秒，不提供关闭）。顺带修掉一个从批次 130
  潜伏下来的真 bug：循环按钮拿**数字**去比**字符串**档位（`values.includes(30)` 恒假），
  于是"帧率上限"永远显示第一档、点一次之后再也换不动——现在收成
  `cycleValue` / `nextCycleValue` 两个纯函数，5 条断言盯着
- 批次 171（TASKS E22）：粒子补四类——**爆炸闪光**（`explodeAt` 里与灰烟一起撒）、
  **气泡柱**（眼睛在水里时持续冒泡）、**雨滴溅落**（露天淋雨时脚边地面上的水星，雪地是白的）、
  **红石尘**（开关拉杆/按钮时掉红粉）。每类只是 `KINDS` 里一行参数 + 一个入口。
  音符粒子（音符盒方块没做）与附魔台字符（缺方块实体环境粒子通道）留待其它批次
- 批次 170（TASKS I16）：**经验球实体**落地——挖矿/击杀/熔炉/钓鱼/死亡全部改成**掉球**
  （`splitXpOrbs` 按原版档位拆：10 → 7+3），8 格内自动飞向玩家、0.9 格结算、
  0.5 格内的球互相合并、5 分钟消失；玩家死亡按 `min(等级×7, 100)` 掉（之前是直接清零）。
  渲染用 `Sprite` + canvas 径向渐变（不进图集，与信标光柱同一取舍）
- 批次 169（TASKS B53）：**锁链甲三件终于拿得到了**——盔甲匠（职业早就在，一直只卖铁块）
  在 L3/L4/L5 各卖一件（头盔 5 / 护腿 7 / 靴子 4 绿宝石，价格是本项目定的）；
  **仍然没有配方**（原版差异不抹平）。`test:reach` 的缺口白名单 7 → **4 条**，
  `test:villager` 的口径改成"收货要能拿到、卖的不必另有来源"（商店本身可以是唯一来源）
- 批次 168（TASKS J18）：**掉落物会被岩浆与火焰销毁了**——`ItemEntity.burnAway()` 读脚所在那一格，
  岩浆当场销毁、火方块里连续 1.5 秒销毁（离开火焰清零）；下界合金一族走
  `isFireproofItem()`（按物品名派生，`netherite_*` + `ancient_debris`）豁免，
  于是 K8 那条"下界合金不会被火烧掉"真正成立。`test:entity` 43 → 53 条
- 批次 167（首页/设置界面收口，用户一轮四条反馈）：① 加载遮罩从写死的 DOM 改成
  `ui/LoadingOverlay.ts` 按需创建——**首屏不再出现"正在生成世界…"**，只有点进世界那一刻才挂；
  ② 主菜单三视图（首页/世界列表/新建世界）与设置**共用 `--panel-w/--panel-h`** 一个固定盒子
  （点「游戏」与点「设置」是同一个框，不再一大一小）；首页按用户要求**不加框**，
  主按钮列 320px 居中；③ 设置分组改**两列栅格**（`auto-fit 230px`，窄屏退回一列）、
  滑杆/文件选择跨满两列、行高压到 30~34px，横屏 343px 高也一屏放完；新建世界表单同样两列；
  ④ 打开即全屏：boot 立刻尝试（PWA / 微信 X5 内核里成立）+ `visibilitychange` 补一次 +
  一次性手势网挂到 **document 捕获阶段**，并新增 `ui/InstallHint.ts`（没装 PWA 时引导一次
  "添加到主屏幕"——标签页里唯一零点击全屏的路径）。`--panel-h` 同时改用 `dvh`
- 最新批次 158（手机画质与帧率）：掉帧时的降级顺序反转成 **视距 → 装饰层 → 分辨率**
  （分辨率是全局的、会把近处一起糊掉，所以排到最后一档）；手机视距独立封顶 8、
  分辨率兜底只到 0.75、开局不再预折。雾改成**滞后于**视距的连续量（收缩快、扩张要等远处画好），
  地形于是"从雾里浮出来"而不是逐块弹出；新增装饰层档位（云 / 粒子 / 雨量）与音效并发节流
- 批次 156：携带版生存 / 创造背包统一为“左物品或配方、右合成或装备”的双栏；
  左侧五个分类/搜索入口和左下箱子独立控制左栏，右下工作台/人物键只切右栏。
  生存缺料配方改红底；不可放置槽与面板内空白会取消选中并安全退回，窗口外仍丢弃。
  844×390 实测了生存、配方、装备与物品移动/拒绝/取消路径。
- 批次 155：手机打开即横屏全屏（manifest / 微信 X5 / 第一次点击锁方向）；
  视距没涨完时不再按桌面的 12 万步光照走，手机背板上限 1.5、开局分辨率 0.8、视距 6。
  否则帧时间过不了 22ms，渐进视距停住，启动期预算就永远不停。
- 批次 154：手机渲染稳定性收口——区块异步重建改为新旧网格原子替换；动态分辨率改为
  设备 DPR 的相对倍率（DPR=3 的 0.9 档实际为 1.8，不再骤降到 0.9）；启动雾墙随渐进视距
  外推，物品图标统一按 CSS 实际显示尺寸分配像素背板，转屏也复用同一套 DPR 同步。
  高 DPR 手机模拟与 110 套离线门禁均通过。

### 历史详情（**按需读**，不要一开始就全读）

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
npm run check              # 【提交前】typecheck + 单测 + 124 套离线测试 + 三张台账（全过才提交）
npm run check:fast         # 【改代码时】typecheck + 单测 + 只跑被改动命中的套件（秒级）
npm run build              # 类型检查 + 生产构建（带 sourcemap，发布用）
npm run build:fast         # 只验"能不能出包"（SOURCEMAP=0，产物 hash 与正式构建一致）
npm test                   # typecheck:tools + vitest + 124 套离线测试
npm run test:offline:changed  # 只跑与本次 git 改动相关的离线套件
npm run audit:tasks        # 任务清单自检（编号重复/跳号 + 本文件进度口径是否过期）
npm run gen:stats          # 地形生成统计（耗时/洞穴占比/矿石产量）
npm run agent:setup        # 跨机器自检
```

**这些是一条链**：`npm run check` = `typecheck` + `test` + 三张台账。
`test` = `typecheck:tools` + `test:unit`（vitest）+ `test:offline`
（`tools/run-tests.mjs`：**一次 esbuild 打包全部入口 + 多进程并行**，
32s → 9s，见 TASKS A13）。单套调试仍可直接 `npm run test:reach` 这类老命令。

`npm test` 那一层共 **124 套**自建离线测试（清单的唯一来源是 `package.json` 的 `test:*` 脚本，
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
