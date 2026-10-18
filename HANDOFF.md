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

- 时间：2026-10-19 · 提交总数 652（每个功能点一条，可逐条回滚；`npm run audit:tasks` 会核对这一句）
- 技术栈：TypeScript（严格模式）+ Vite + Three.js / WebGL2；无第三方运行时依赖（除 three）
- 进度口径：`TASKS.md` 共 287 项 —— 已完成 **181**、进行中 **76**、待办 30 条（其中 55 条是需求审计新补的**整组**缺口，逐组明细见 `docs/HANDOFF-ARCHIVE.md` 的「需求审计」一节）；
  （`npm run audit:tasks` 会核对这一行与本表，改完条目记得跑一次）
  其中相当一部分待办是长期大项（村民与交易、织布机等功能方块、信标与地图、喷溅/滞留药水等）
  —— **进行中口径以 `.codebuddy/auto-continue.md` 队列为准**，两份文件分工不同，不要只看一份
  —— 2026-10-15 做过一次**逐条核对**（对着 src/tools 的真实实现重判 37 条），
  勾选状态与代码实况已对齐；以后每完成一项顺手改这两份文件，避免再次漂移
- 批次 226（用户追问："我也挖了两层，没有看到蜘蛛，那个蜘蛛离我有多远？"）：
  225 修了判据，但**导出里根本没有攻击者的坐标**，只能回答"水平一直 ≤ 2 格"，
  竖直距离只能拿地形去推。现在 `EntityContext.hurtPlayer` 多了可选的 `sourceY`
  （实体层报自己的 `y`；`Mob` / `Phantom` / `EndBoss` / `Arrow` / `Throwable` 都传），
  `PlayerStats.damage` 把它记进伤害流水，`survival/damage` 事件因此多了三项：
  `sourceY`、**`dy`（攻击者比玩家脚底高多少格）**、玩家 `pos`。
  **只进诊断，不参与任何结算**。顺手用种子复算了现场地形（见 auto-continue 226）：
  地表 y=64/65、玩家在 y=61.1、周围 6 列内没有洞穴——所以那只蜘蛛在**头顶约 3 格的地面上**。
  门禁：`test:survival` 50 → **52**、`test:ui` 655 → **656**。
- 批次 225（用户："我在一个区域里一直掉血，提示是受到蜘蛛伤害，但是完全看不到蜘蛛"）：
  导出的诊断里 13 次 `source: "蜘蛛"` 的**水平距离全是 0~1.9 格**，而竖直方向从没查过——
  `updateAi` 的近战判据只有 `dx² + dz² < 4`（`flyAi` 同理，只有水平 2.5）。
  于是**地板下面地窖里的蜘蛛、墙背后的僵尸照样每一下都打中**：玩家看得见的那一侧什么都没有，
  提示却一直在报。修法是把判据收进 `deliverMelee(ctx, reach)`（两个调用点各写一遍必定漏一条）：
  **水平距离 + 竖直间隙 ≤ 1 格 + 视线**（`opaque` 挡住就够不着，玻璃/水/树叶不算，
  与原版 `canSee` 同口径）。⚠️ 仍按纯水平距离的只剩**苦力怕的引信**（它有 1.5 秒点火与音效，
  不属于"看不见的攻击"，先留着）。门禁：`test:spider` 56 → **62**（地窖 / 玻璃竖井 / 墙后
  三条 + "空地上同样距离照打""高一格台阶照打"两条对照）。
- 批次 224（用户："吃肉的触发时间还是稍有一点延迟，不然我拿肉、滑动视角都会触发吃肉动作"）：
  219 把"按住使用"的门槛设成 0ms 之后，**按下到越过 12px 拖动阈值的那 1~3 帧已经被当成使用**——
  表现是拿着肉滑视角会先咬一口（晃手 + 咀嚼声 + 进度条闪）。判据改成
  **漂移 ≤ 6px（`USE_MOVE_SLOP`）且静止 ≥ 100ms（`TOUCH_USE_STILL_MS`）**：100ms 低于
  "即时响应"的感知阈值（≈100~150ms），而真拖动 20~40ms 就会漂过 6px，两头都占住。
  顺带记下这条结论：**一个手势无法同时表达"转视角"和"按住用"**——这是原版手机的固有折中；
  要真正 0 延迟只有加独立的"使用"键（仍未做）。门禁：`test:ui` 两条断言钉住两个门槛值。
- 批次 223（用户："聊天信息持续的时间稍久一点，持续 3 秒吧"）：把批次 220 的 **1 秒**
  放宽到 **3 秒**——`LINE_LIFETIME` 700 → **2200**、`FADE_AFTER` 300 → **800**，
  CSS `transition: opacity` `.3s → .8s`（仍在移出 DOM 前走完，不会"淡一半被摘掉"）。
  只改这两个常量 + 一条过渡，历史消息与 `.peek` 点击逻辑都不受影响。
  门禁：`test:ui` 648（断言同步改成"2.2s + 0.8s"）。
- 批次 222（状态栏重排 + 仙人掌"画面一直抖"）：用户要求"生命值和饥饿值放在快捷栏两端、
  不要挡住进度按钮"，并问"撞到仙人掌持续向前走画面一直抖正不正常"。
  ① **状态栏拆成两列**（`VitalsHud`）：左列＝护甲 + 生命、右列＝气泡 + 饥饿，两列底边对齐，
  `#vitals` 宽度取 `--hotbar-w`（新变量，与 `#hotbar` 共用槽位/间隙/内边距）→ 正好贴住
  快捷栏两端；中间空出来给经验条与等级数字。第 10 颗心/鸡腿与快捷栏边缘同一条竖线。
  窄屏（<760px，背包键只能挂在快捷栏右上角）整行再抬 48px，避免叠在按钮上。
  ② **仙人掌接触伤害以前根本没接线**（`survivalEnvironment()` 里 `onCactus` 恒为 `false`，
  注释还停在"仙人掌还没进方块表"）：新增纯函数 `core/world/Cactus.ts#touchesCactus()`，
  带 0.1 的**横向**容差（玩家被整格钳制挡在 14/16 碰撞盒外，直接判相交永远为假；
  竖向不放大，站在顶上不算贴着），每 0.5 秒 1 点 `cactus` 伤害。
  ③ **抖动**：全项目没有任何"受伤 → 镜头抖动"的代码，能周期性改变相机位置的只有
  **自动跳跃**（默认开，会把 1 格高的仙人掌当台阶：跳上去 → 走空/被挡 → 再跳）。
  `PhysicsWorld` 新增可选 `isHazardous()`，`World` 按形状表实现（`shape === 'cactus'`），
  `canAutoJump` 遇到危险方块直接不跳；同时 `PlayerPhysics.autoJumped` 暴露给主程序，
  每跳一次记一条 `input/autoJump`（真机再抖时导出日志就能确认是不是它）。
  门禁：`test:physics` 33 → **37**（危险方块不跳 / 普通台阶照跳 / autoJumped 只在起跳帧）、
  `test:survival` 46 → **50**（贴住/隔一格/站顶上/完整方块）、`test:ui` 640 → **648**
  （几何变量共用、两列布局、经验条在上、仙人掌接线与诊断）。
- 批次 221（用户："信息要再完善一点点，把天气变化的信息也提示一下"）：天气变化进消息栏。
  ① 文案与"下雪还是下雨"的判据做成纯函数 `weatherNotice(previous, next, snowy, seconds)`
  （`core/world/WeatherState.ts`）：转雨/雪带预计分钟数、转雷暴用 `warning` 色、放晴分
  "雨停了 / 雪停了 / 雷暴过去了"；没变化返回 `null`，所以每帧调用也不产噪音；
  ② 主程序只留一个播报入口 `App.announceWeather(previous)`，三条路径都汇进去——
  主循环里的自然转换（记 update 前的种类）、睡醒放晴、`/weather` 与调试 `setWeather()`；
  ③ **下界 / 末地不播报**：换维度时那边会把天气重置成晴，那不是玩家感知到的变化；
  同时顺手把播报写进诊断日志（`world/weather`：from/to/秒数/是否雪原）；
  ④ `/weather` 回执从英文原值改成中文（`天气已切换为 雷暴`），可离线断言。
  门禁：`test:weather` 46 → **58**（+12 播报文案/语气/分钟下限）、
  `test:commands` 101 → **103**（三档中文回执）、`test:ui` 638 → **640**（三条路径共用入口）。
- 批次 220（聊天 HUD 三条 + 场景亮度 + 诊断入口精简，用户一次提了四条）：
  ① **聊天字号 13px → 8px**（`index.html` 的 `--chat-font-size` 一个变量；打开翻历史时回到 11px）
  ——字面"小一倍"是 6.5px，手机上读不清，取 8px 折中，改一个变量就能整体缩放；
  ② **消息 1 秒后彻底消失**：`LINE_LIFETIME` 10s → **0.7s** + `FADE_AFTER` 4s → **0.3s**，
  CSS 淡出 `.8s → .3s`（原来 0.8s 根本淡不完就被移除了）；历史不丢，打开仍能翻最近 120 行；
  ③ **显示期间点一下直接进聊天**：`renderLog` 在"未打开且有可见行"时给根节点挂 `.peek`
  （CSS：`#chat.peek .chat-log { pointer-events: auto }`，缝隙/空白处照常转视角）；
  `openWith(prefill, { focus: false })` **不聚焦输入框**，手机不弹键盘，想打字再点输入框。
  消息全部过期 → 自动摘 `.peek`，左上角不会留一块看不见的点击陷阱；
  ④ 新增设置项**场景亮度**（外观组，50%~200%，默认 100%）：`main.applySceneBrightness()`
  把 `filter: brightness()` 写在渲染画布上——光照已经烘进顶点色/贴图/天空盒/粒子/手持/色罩，
  逐材质乘一遍要动 6+ 个着色器且必漏；100% 时不写 filter（零合成开销），HUD 与面板不受影响；
  ⑤ 诊断日志按用户要求**只留「导出」**：去掉"记录问题"（插 mark）与"复制"（时间线进剪贴板）
  ——导出 JSON 本来就带整条时间线，三颗按钮只是让"点哪个"变成一道选择题；
  `diagnosticsRuntime` 的 `mark()/copy()` 保留（离线测试与控制台 `__mc.diag` 还在用）。
  门禁：`test:settings` 63 → **69**（+6 亮度默认/范围/往返/脏值）、
  `test:ui` 634 → **638**（+4 字号/寿命/点击进入/不聚焦；诊断断言改成"只有导出"）；
  `npm run check` 与 `npm run build:fast` 全绿。
- 批次 219（用户："手拿肉，点了比较久才开始吃"）：把"按下 → 咽下"从 **1.88 秒压到 1.0 秒**。
  ① **触摸端不再等 280ms**：`usingItem` 原来要求 `leftDown`（长按判定才置位），现在读
  `TouchControls.holding`（`lookPointer !== null && !lookDragged`）——按住且没划动就算"使用"；
  挖掘/攻击仍要 280ms，不会误触（举盾、拉弓顺带变跟手）。那 280ms 本来就是"没有使用键"的补丁成本。
  ② 新增设置项**快速进食**（默认开 1.0 秒；关掉回到原版 1.6 秒）：`food.ts` 两个常量 +
  `eatSecondsFor()`，咀嚼节奏按比例缩、一份食物仍是 4 口。
  ③ 顺手堵一个老洞：`updateEating` 原来只判"准星没对着**方块**"，于是**按住打怪会边打边吃**
  （原来要 1.88 秒才咽下，提速后更容易撞上）——现在准星对着生物时不算"使用"。
  ④ 新增 `#eat-progress`（与 `#break-progress` 同一套视觉、上移一格）：那 1 秒里画面上终于有反馈。
  门禁：`test:food`（两个时长常量 + `eatSecondsFor`）、`test:settings`（默认开 / 显式关 / 脏值）、
  `test:ui`（`holding` 的读法、进度条的 DOM 与 86px 位置）各补断言。
- 批次 218（"一直掉血到死，提示没有记录到来源"）：用户导出诊断日志并补充"站在草地上、
  头上有树、没打任何东西"。日志里 `damage / health / hurt / death` **全文件零命中**——
  不是日志损坏，而是根本没有生命值这一路，只能读代码。查出四个问题，各自一条提交：
  ① `EntityContext.hurtPlayer → damagePlayer` 的桥接箭头只接了 4 个参数，**第 5 个 `source`
  被静默丢掉**（实体层明明传了生物名）→ 所有生物/箭矢/末影水晶/火球伤害都退化成
  `generic` 的兜底文案"受到伤害（没有记录到来源）"，甚至被误报成"着火"；
  ② `tickEffects` 把非中毒的效果伤害一律按 `'generic'` 上报，而 `DamageCause` 里**没有"凋零"**
  —— 凋零能致死，是另一条会打出这句文案的路（顺手把 `damage + damageCause` 拆成
  `damageHits: [{ amount, cause }]`：两者同挂时原来会合并，凋零被当中毒卡在 1 点血）；
  ③ 诊断日志新增 `survival` 类（掉血 / `damage.unlogged` / 死亡（带坐标）/ 重生 / 挂效果），
  下次导出能直接读出"第几秒、被谁、掉了多少"；④ 窒息判据原来读 `opaque`，而树叶为了
  剔除相邻面是 `opaque: true` → **钻进树冠里会持续扣血**（原版不掉血），改读新的 `suffocates`
  （默认跟 `opaque` 一致，6 种木材的树叶显式 `false`）。门禁：`test:ui` 629、`test:effects` 68、
  `test:diag` 62、`test:decor` 237、`test:wither`/`test:armor`/`test:survival`/`test:mob` 全绿。
- 批次 217（光照队列涨到 820 万格 → 12fps）：用户给的真机日志（792×360 / dpr 3）最后一段
  只有 12fps、`frameAvgMs` 123ms、`heapMb` 1020，而 `view` 已经到地板 4、`res` 0.75、`decor` 2
  —— 策略已经把能降的全降了，说明不是"画得多"。真凶在 `LightEngine.compact()`：
  **判据是"已消费了多少"（`head > 24576` = 8192 格），却不看"还剩多少"**。队列一涨到几百万格，
  就变成每 2~3 帧把整个数组 `slice` 一遍。实测一次 24.6M 元素的 slice = **41ms**（桌面），
  手机 60~74ms —— 与日志里 `phases.chunks` 从 0.2ms 涨到 74ms 完全对上；堆 1GB 也是它。
  ① `COMPACT_TAIL`：只在**剩下的不足 4096 格**时才回收前缀（拷贝恒定 12k 个数字、一轮只搬一次，
  实测 0.02ms）；② 队列的源头也顺手收紧——`seedBorder` 原来**无条件**把邻区整列塞进队列
  （"邻格 - 1 都不比对面亮"时扩散注定什么都不写），现在按这个判据过滤；
  ③ 加了"谁在灌"的累计计数（`self` / `border` / `change` / `readded`），积压超过 2 万格时
  每 5 秒记一条 `perf/light`——这份日志只能证明"队列很大"，判断不了是加载播种还是改方块重扩散。
  `tests/light.test.ts` 8 条（+2：边界过滤既不漏灌、也不滤掉真该流过去的跨区块渗光）。
- 批次 216（画质优先：抬背板、收视距、治横向抖动）：用户给了新一份真机日志（792×360 / dpr 3），
  诉求很明确："画质不要降低；性能吃紧时第一保帧率、第二保画质，视野可以让"。日志读出三件事：
  ① `res` 恒 1、`pixelRatio` 恒 1.5、`buffer` 恒 1188×540 —— 一直在**一半线性分辨率**上渲染，
  而 UI 是 dpr 3 的 DOM，"物品边缘发虚"就是这么来的；
  ② 13 分钟里 `view-down`/`view-up` 各 **40 多次**，全是 7 ↩ 8：8 档 `frameAvg` 22~29ms（判卡 → 降 7）、
  7 档 16.6ms（判有余量 → 升 8），而 **16.6ms 是 60Hz 的刷新下限**——只要能满帧，"升档条件"
  永远成立，光靠冷却挡不住；每次换视距都要按新范围重算一圈区块，这就是"时不时卡一下"；
  ③ `cpu` 7~23ms、`phases.render` 8~21ms，`drawn` 225（视距 8）比 177（视距 7）多 2~10ms
  —— 8 档是**CPU 侧提交**在拖，不是 GPU 填充。
  改法：**手机背板 1.5 → 2**（0.64M → 0.89M 像素）、**视距上限 8 → 6、开局 6 → 5**
  （省下的预算全给画质）、**"降过的档位封 90 秒"**（`VIEW_RAISE_BLOCK_SECONDS`；同一档第二次
  掉帧才封，第一次留给加载期与偶发长帧）；图标背板 2 → 3（3 倍屏上 32~36px 图标原来被插值糊一圈）；
  顺手修 `perf/sample` 的 `calls/tris`（一帧 `render()` 三次、`info` 每次重置，之前永远读到 1 call / 12 tris）。
  `test:perfpolicy` 131 → 141（+10）、`test:settings` 60（改 2 条）、`test:ui` 625 → 626；
  `sh tools/feedback181-check.sh` 28/28。
- 批次 215（"靠近水域 / 视野调大就卡"）：用户问"水一定要流动吗"。答案是**流动本身几乎不花钱**——
  逻辑是计划刻（水 5 tick，且只有被扰动才跑；海洋/湖泊是水源，根本不动），
  视觉上的波纹是着色器里 `uTime` 的 UV 滚动 + 顶点正弦位移，一帧只改一个 uniform。
  真正贵的是**半透明层**：水/玻璃是 `transparent + depthWrite:false`（没有 early-z，
  覆盖多少像素就混合多少次），而材质是 `DoubleSide` —— 等于把同一片水面**再画一遍**。
  双面只在"从水里往抬头"时必需（水面顶面正面朝上，水下看到的是背面，单面会看穿），
  所以主循环按**摄像机是否在液体里**切：`translucentMaterial.setDoubleSided(...)`，
  岸上单面省一半水面填充率。⚠️ 不设 `needsUpdate`（`side` 是 GL 状态不是宏，设了每次切换重编译）。
  第二件事：**视野（FOV）也有代价** —— 72°→110° 可视范围约 1.97 倍，而自适应管不到 FOV。
  手机上封 **90°**（`MOBILE_FOV_MAX` / `fovCapFor` / `clampFovFor`），滑块旁加一行说明
  （`.settings-note`，用户要的"给点提示"）。顺手修：相机是按硬编码 72° 建的，
  存档里的视野**重启后从来没生效过**（要进设置动一下），现在构造时落一次。
  `test:perfpolicy` 131 条（+10）、`test:render` 111 条（+5）、`test:ui` 625 条（+4）。
- 批次 214（透明恢复无效 → 回到"隐身开关背包"）：用户反馈批次 208 的透明层**压不住**
  "切游戏模式 → 返回 → 视角卡住"。用他上次那份日志把复现挖出来了：**8 组坐标全 0
  异常，8/8 都紧跟在一个 `ui.close` 之后**（0.8~3 秒内的第一次触摸；`client/screen/page`
  三个来源**同时**为 0）；切模式只是让他频繁进出设置。同一份日志还证明老办法有效——
  自动开关背包之后，下一次触摸是 `684,180`，视角立刻能转。
  结论：**"层存在"≠"层被画出来"**。透明 div（无子节点、透明背景、`opacity:.01`）
  根本没被绘制，浏览器的触摸坐标映射不会重算。所以：
  ① 删掉 `TouchControls#recoverDeep` 与 `#touch-recover`；
  ② 恢复回到 `runInventoryRecovery(ghost)`：**同一条 `openWith/close` 路径**，
  只是给面板挂 `#inventory-screen.inv-ghost { opacity: .004; pointer-events: none }`
  ——布局、子节点、滑入滑出动画、`body.inv-pocket-open`、触摸层收起约 520ms 全保留，
  只是肉眼看不见（`opacity` 不用 0：0 可能被跳过绘制）；`finishClose` / `dispose` 强制摘类；
  ③ 档位：1 = ghost 背包（无感）、2 = 可见背包 + 提示卡（兜底）；日志 `autoRecover.ghost`；
  ④ 回到前台 / 全屏切换退回轻量 `recover()`——它们紧跟着会打开暂停菜单，
  再叠一个背包会让 `uiOpen` 交接算错。
  `test:ui` 620 条；`sh tools/feedback181-check.sh` **28/28**（新增"切模式→关设置→还能转视角"）。
- 批次 210（真机日志"cpu/phases 从来没进过日志"）：用户给了一份 22 分钟的真机诊断
  （792×360 / dpr 3），问"掉帧时视距没缩、反而像降了分辨率"。查数据先发现**日志本身缺字段**：
  `sanitizeData` 把每个 `data` 对象裁到 **16 个键**，而 `perf/sample` 有 29 个——排在末尾的
  `calls/tris/heapMb`（批次 202）与 `cpu/phases`（批次 205）被**静默丢掉**，所以"卡在 CPU
  还是 GPU"查了两批都没答案。① 上限 16 → 32 + 两条"末尾字段必须还在"的断言；
  ② `perf/sample` 补 `mobs/items/xp`（真机里 `entities` 到过 550，生物走 AI、掉落物只是飘着，
  代价差一个数量级）；③ 每次真调档记 `perf/policy`（`action/frameAvg/view/decor/res`）——
  以前只有 `console.info`，导出的诊断里看不到。
  同一份日志的结论（留底）：`res` 恒 1、`pixelRatio` 恒 1.5、`buffer` 恒 1188×540 →
  **分辨率一次都没降过**（"糊"是 1.5 倍背板 + 雾的常驻观感）；`view` 全程 5~8、多数时间 7/8，
  还会在 7↔8 之间弹（降档阈值 22ms≈45fps，而用户体感掉的 43~50fps 正好在阈值上面）。
  `test:diag` 60 条（+3）。
- 批次 208（视角卡住的自动恢复改成无感）：⚠️ **已被批次 214 推翻并删除**——那层透明 div
  根本没被绘制，救不回来。下面留着是记录"为什么当时的判断错了"。
  批次 201 的兜底是"自动开关一次背包"，
  面板滑进滑出在手机上很显眼。拆开看，那次开关里真正起作用的是**一个刚显示出来的
  全屏固定定位层**（逼浏览器重算 visual viewport 与触摸坐标映射），面板只是载体。
  ① 新增 `TouchControls#recoverDeep(reason, holdMs = 200)`：临时插入 `#touch-recover`
  （`position: fixed; inset: 0`、透明、`pointer-events: none`、独立合成层）→ 收起触摸层
  **两帧**（这一步看得见，压到最短）→ 读布局 → 透明层撑 200ms 后**摘掉**（两次 reflow
  正好对上"开面板 / 关面板"）；日志 `gesture/pointer.recover.deep`。
  ② `handlePointerAnomaly` 改成**档位**：4 秒内
  两次异常 → 第 1 档透明层（无面板、无 HUD 变化、也不弹提示卡）；10 秒内又出问题 →
  第 2 档才退回真开关背包（`autoRecover.uiCycle` + 提示卡；无感那一档记 `autoRecover.deep`）。
  ③ 从后台回来 / 全屏切换也升到重档——这两处正是后面坐标异常的上游。
  `test:ui` 605 → 607（`npm run check` 全绿）。
- 批次 213（返回层级 + 进世界落地）：
  ① **返回的顺序**：先让游戏暂停，再把"请横屏游玩"**盖在暂停菜单上层**
  （90 > 50）。删掉 `body.pause-open .rotate-hint { display:none }`——
  那一句会让暂停页顶在最上面，玩家看到的是"返回没让我横屏"。点一下提示 →
  全屏 + 横屏 → 提示随横屏消失，正好看到「游戏已暂停」。
  ② **进世界一定落在地面**：读档恢复的坐标 / 重生点可能悬空、在水里、被方块埋住。
  新增 `requestGroundSettle` + `settlePlayerOnGround`：等区块加载好后复核脚底
  （脚/头卡实心、脚下无支撑、脚在水/岩浆都算不安全），先 `findSafeSpawn`，
  再环形找最近的自然地面；期间冻结物理与生存结算（最多 10 秒）。
  `naturalGroundNear` 只扫玩家高度 ±48，不从世界顶翻整列；`NATURAL_FLOORS`
  补上地狱岩/灵魂沙/黑石/末地石/黑曜石，下界与末地也能校正。
  `test:ui` 618、`test:world` 60（`npm run check` 全绿）。
- 批次 212（返回键 + 悬空雪）：
  ① **掉出全屏 = 补开暂停**（恢复 206 的思路、保留 209 的"不强制全屏"）：
  `fullscreenchange` 检测到从全屏掉出且没有面板 → 160ms 后 `openSettings()`；
  同一手势若也派发 `popstate`，那边先取消计时器，一次返回只处理一次。
  `SettingsScreen.show()` 重新挂 `body.pause-open`，竖屏提示（z-index 90）让位给暂停菜单。
  ② **"请横屏游玩"整屏可点**：点击监听改挂在 document 捕获阶段（任意位置、任意子元素），
  只有暂停菜单把它 `display:none` 时才跳过，避免抢暂停按钮的点击。
  ③ **悬空雪**：雪原地面是 `SNOW_BLOCK`，`isGround` 只认草/土/沙 → `surfaceAbove`
  永远失败、回退到**近似高度**（允许 1~3 格误差），雪就挂在半空。新增
  `snowSurfaceAbove`：从期望高度 ±6 格内找"上方可放雪、下方是实心方块"的真实地表，
  并跳过树干/树叶（不在树顶铺雪）。
  `test:ui` 616、`test:decor` 234（`npm run check` 全绿）。
- 批次 211（背包操作手感三条 + 提示条）：
  ① **点材料区不再清空配方预览**：`showRecipeGhost` 不再把合成格里的实物倒回背包；
  空手点材料格保持预览（只弹名称），只有"手里拿着东西去点"才收掉预览、开始摆放。
  ② **配方开关关着时的列表**：不再记录"看过的"，改为"**用过的**"（真正取出产物才算）；
  = 当前能合成的 + 用过的（现在缺料就红底）。
  ③ **按住滑动看配方**：分类格按下只做**预览**（不动背包、不重建列表），滑到哪一格就
  预览哪一格；列表纵向滚动时按落点继续跟随；抬手且没滑动才真正把材料摆进合成格。
  `touch-action: pan-y`：纵向仍是滚动，横向拖动交给 JS。
  ④ **提示条点一下立刻消失**：`#inv-pick-toast`（背包内）与 `#hud-toast`（游戏内）
  都可点，点了直接隐藏，不再等 2 秒淡出。
  `test:ui` 615（`npm run check` 全绿）。
- 批次 209（用户第二轮七条反馈）：
  ① **返回键回退**：删掉批次 206 的 `fullscreenchange → 暂停` 与"继续游戏强拉全屏"，
  只保留 `popstate`（局内无面板 → 暂停菜单）。真机上那套"掉全屏也算返回"体验更差。
  ② **聊天**：输入行移到最上面、固定不压缩（键盘不再把 `#chat` 压扁——横屏只有 390px 高，
  原来减 `--kb-inset` 会把输入框挤没，看起来就是"闪一下不见了"）；打开 Chat 不再收起
  触摸层；"点外面关闭"忽略打开它的那笔手势（350ms）与顶部聊天键本身。
  ③ **消息顺序**：新消息在上、旧消息在下（DOM 倒序），停在顶部时自动跟随新消息。
  ④ **配方书开关回到原语义**：开 = 列出该分类**全部物品**；关 = 只列现在能合成的 +
  之前看过的缺料（红底）。颜色与开关无关：白 = 材料够且**当前格子放得下**。
  ⑤ **红底变白**：根因是手机 `:hover` 黏在点过的格子上，把 `.locked` 的红底盖成灰白；
  `:hover` 限定到真鼠标，并给 `.locked:hover` 保底。分类格一律只给 `.tapped` 缩放。
  ⑥ **白底却做不了**：3×3 配方在 2×2 背包里不再算"可合成"；同一产物多条配方时选
  **放得下且材料够**的那条；`fillCraftingGrid` 的材料判断改为**背包 + 合成格合并**。
  ⑦ **丢弃**：快捷栏 dock 的空白处不再豁免（用户习惯点快捷栏左右两侧丢东西）。
  ⑧ **雪层**：原来按列哈希生成 1~3 层，统一为 1 层（原版自然雪也是同高）。
  ⑨ **灵敏度**：上限 ×2 → ×4（读取与滑块同步）。
  `test:ui` 613、`test:settings` 60、`test:recipebook` 144、`test:decor` 233（`npm run check` 全绿）。
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
