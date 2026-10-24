# 完成档案 · DONE

> 本文件是**已完成工作的唯一档案**，只回答"这批做了什么、怎么验的"——时间线，最近的在最上面。
> 按模块看现状与坑 → `OVERVIEW.md`；下次怎么避开 → `TIPS.md`；机制与格式 → `README.md`。
> **一条内容只写一个地方**，别在三份文档里各抄一遍。
>
> 收尾时**整份队列原样搬进来**（含每条任务下方的完成说明与 `[阻塞]`），标题格式
> `## 批次 <号> · 日期 · 会话 <前 8 位>`。

---

## 批次 20261024-2156 · 2026-10-24 · 会话 167f6a14

- [x] [修33] 手持武器改成"按图标轮廓挤出的 3D 像素模型"：`src/render/itemModel.ts`（新）+ `HandRenderer` + `PlayerRenderer` + `TextureAtlas.readTile()` → `test:render` 272 通过
  - 做了什么：正反两片按图标的不透明像素逐个出四边形（每片取自己那一格的 UV）；侧壁只在"不透明像素挨着透明像素"的边上生成，厚度跟着轮廓走；掩码先跑两遍 Scale2x（EPX）到 4× 把斜边台阶抹平；侧壁按朝向压暗；四边形绕序按期望法线自动纠正。第一人称挤出 0.035 屏高、第三人称 0.06 格，方块仍是立方体。读不到像素时退回原来的薄盒子。
  - 为什么：用户："手里拿的那个武器能有 3D 的效果、分辨率再高一点、同时增加一点厚度"。旧的 0.52×0.52×0.03 薄盒子只有一块板的厚度，侧看是一条边；手写绕序那版有一半侧壁被背面剔除，画面上是一圈带缺口的"毛刺"。
  - 验证：`npm run test:render` 272 通过（断言改成挤出的实体：顶点数、厚度、内容尺寸、每面单格 UV、侧壁压暗、顶点色与 aShade 同源）；`npm run check` 全绿。**按用户要求，改完不再做浏览器截图自测**，观感由用户手测。
  - 批次：20261024-2156
- [x] [修34] **推翻上一版的几何挤出，改成"烘好的 2.5D 贴图"**：`src/render/heldSprite.ts`（新）+ `HandRenderer` + `PlayerRenderer`（删 `itemModel.ts`）→ `check:fast` 全绿（`test:render` 267）
  - 做了什么：图标按 6 倍（96px）双线性放大 → 平滑边缘；同一张图的纯色剪影沿右下错位叠 22 层（逐层变暗）→ 厚度 ≈ 0.12 屏高；放大后的图标盖在最前。第三人称同源（74px / 10px 厚度）。几何降回一个四边形 + 118×118 小贴图，按物品缓存，切物品只换 `uMap`。
  - 为什么：用户："搞得太丑了……指的是尽量边缘平滑，3D 效果厚一点，不要搞得那么薄、那么单细"。按轮廓挤出在斜视下会让 1/4 像素格的台阶变成一圈毛刺，且厚度受几何精度限制。第一人称手里的东西相对镜头固定，厚度烘进贴图与真几何看不出区别，画布抗锯齿还能给出真平滑。
  - 验证：`npm run check:fast` 全绿（`test:render` 267）；**按用户要求不再做浏览器自测**，观感由用户手测。
  - 批次：20261024-2156

## 批次 20261024-2122 · 2026-10-24 · 会话 167f6a14

- [x] [修31] 第三人称手持物变成"交叉的剑"：`src/render/PlayerRenderer.ts` → 前后两种视角逐件截图 + 新增 1 条渲染断言
  - 做了什么：把第三人称手持物的材质从 `side: DoubleSide` 改回默认的 `FrontSide`，并在测试里钉一条断言（`side === THREE.FrontSide`）。顺带把这段坑写进源码注释。
  - 为什么：薄盒子的**正反两面都贴了同一张图标**，开双面渲染之后，从正面看时背面的那张**镜像图标**会透过正面的透明区显出来 —— 斜向的剑于是变成"两把剑交叉"（另一件的面包则变成蝴蝶结）。第一人称那份材质一直是默认单面，所以只有第三人称出问题。
  - 验证：`node .tmp/tp-shot.mjs diamond_sword bread` 在 `third-back` / `third` 两套视角重截：剑是**单刃**、面包是**完整一块**，两侧看都正常；`node .tmp/tp-probe.mjs` 确认物品的世界朝向在两套视角下完全一致（`up`/`fwd` 同一组数），差异只来自镜像；`npm run check` 全绿（`test:render` 270 → **271**）。
  - 批次：20261024-2122
- [x] [修32] 台账：`DONE.md` / `notes/batches.md` / `OVERVIEW.md` 补这条修正 → `npm run check`
  - 做了什么：新增 2122 一节、批次索引一行；OVERVIEW 的手持物条目补一句"第三人称手持物必须单面渲染"。
  - 为什么：这条错误的观感很具体（"交叉的剑"），但根因（透明贴图 + 双面渲染 + 正反同贴）不写下来下次还会犯。
  - 验证：`npm run check` 全绿。
  - 批次：20261024-2122

## 批次 20261024-2101 · 2026-10-24 · 会话 167f6a14

- [x] [修27] 挥手改成"输入驱动"：点一下挥一次、按住快速连挥：`src/main.ts` → 浏览器里数挥动次数（点一下=1、连点两下=2、按住 1.2s=4）
  - 做了什么：新增 `updateArmSwing(dt)` 与 `tapSwingRequest` / `armSwingCooldown` 两个字段（`ARM_SWING_INTERVAL = 0.3`）。桌面端 `mousedown`（左键、非建造模式）置位 `tapSwingRequest`；触摸端在 `onTap` 里置位（长按走 `onBreakStart` → `leftDown`）；每帧：点了就挥一次，按住则按 0.3s 节拍继续挥；UI 打开/建造模式不挥。
  - 为什么：以前挥动只挂在"真的打到/挖到/放下了东西"上——对着空气点一下，或者按下与松开落在同一帧里（快速点击），手完全不动（用户："基本上点一下就应该挥一下手"）。攻击/挖掘/放置各自也会调 `hand.swing()`，而 `swing()` 在挥动中不重开，两条路叠加不会抖手。
  - 验证：`node .tmp/hand-swing.mjs`（真鼠标 + 指针锁）：静止 600ms 挥 0 次 ✓、点一下 1 次 ✓、连点两下 2 次 ✓、按住 1.2s 挥 4 次（3.3 次/秒）✓、松手后 0 次 ✓；控制台无报错。
  - 批次：20261024-2101
- [x] [修28] 手里的东西放大一档，并按用户的基岩版截图重排构图：`src/render/HandRenderer.ts` → 9 组视口×视野的投影包围盒 + 逐件截图对照
  - 做了什么：`SPRITE_SIZE` 0.40 → **0.52**（投影约占屏高 58%，与用户给的截图同一量级）、`BLOCK_SIZE` 0.34 → **0.37**（约 60%）、`SPRITE_THICKNESS` 0.016 → **0.03**（侧看有一道看得见的厚度边，不再像纸片）；方块偏移跟着收（`BLOCK_OFFSET` x 0.10 → 0.05、y −0.10 → −0.09），放大之后右缘仍落在 94%、上缘 59%，不被画面切掉。
  - 为什么：用户给了基岩版截图做对照，说"角色拿的物品要再大一点、精细度高一点"。截图里剑约占屏高 6 成，而旧值只有 4.5 成；放大之后单个 texel 也更"实"，厚度给到 0.03 才能看出这是一块有厚度的东西。
  - 验证：`node .tmp/hand-verify.mjs` **99 组几何测量 0 失败**（3 视口 × fov45/60/90 × 11 件物品；石头 bbox 0.63×0.77 屏高、右缘 94%）；逐件截图（桌面 1280×720 + 手机 844×390）核对构图；`test:render` 同步更新尺寸断言。
  - 批次：20261024-2101
- [x] [修29] 第三人称也能看到角色手里那件东西：`src/render/PlayerRenderer.ts` + `src/main.ts` + `src/render/atlasMesh.ts` → 后视/前视各截一张 + 新增 10 条渲染测试
  - 做了什么：`PlayerRenderer` 收一个可选 `atlas`，在**右臂末端**加主手挂点 `mainhandGroup`，`setHeldItem(id)` 按物品建几何（完整立方体 = 立方体；其余 = 薄盒子，正反贴图标、厚度面取最外一列）；方块与图标各一份材质（带 `map`/`alphaTest`/`vertexColors`），并跟着环境亮度一起变暗；`main.ts` 每帧与 `hand.setItem` 同步调用。为此把第一人称那份"厚度面取边缘列"的 UV 逻辑抽到 `atlasMesh.applySpriteFaceUvs`，两边共用；`applyBoxFaceShade` 增加可选的逐面亮度参数（图标正反面要满亮度）。
  - 为什么：用户："在第三人称时，也应该能看到角色手拿的物品"。之前第一人称藏手之后，切第三人称就是空着两只手。第一版把图标绕 Y 转 90°（想"让刀身侧对镜头"），实测第三人称是**前/后视角**，侧对镜头等于把剑看成一条线；改成转 30°、往前下方挪出身体，前后视角都能看出刀形。
  - 验证：`test:render` 260 → **270 通过 / 0 失败**（新增 10 条：空手/拿起/几何类型/尺寸/厚度面 UV 同源/切回空手/重复设置不重建/没图集时安全降级）；`node .tmp/tp-shot.mjs` 在 `third-back` 与 `third` 两种视角逐件截图核对（剑、镐、石头、面包都清晰可见，且不在身体里）。
  - 批次：20261024-2101
- [x] [修30] 台账：`DONE.md` / `notes/batches.md` / `OVERVIEW.md` / `TASKS.md` 记这一批 + 决策 D6 → `npm run check`
  - 做了什么：新增 2101 一节与批次索引一行；OVERVIEW 的手持物条目补"尺寸 0.52/0.37、厚度 0.03、第三人称手里有东西、挥动按输入驱动"；TASKS 队列落地补一行。
  - 为什么：这批改的是"手持物的尺寸与手感"三个可直接感知的点，不写进 OVERVIEW 下一轮调尺寸又会从旧数字出发。
  - 验证：`npm run check` 全绿（`audit:docs` 体量、`audit:tasks` 台账、`test:render` 270）。
  - 批次：20261024-2101

## 批次 20261024-1910 · 2026-10-24 · 会话 167f6a14

- [x] [修25] 手部视角钉死在"视图模型视野"，并把这轮自测脚本化（用户："请自测验证，自己核查是否正常"）：`src/render/HandRenderer.ts` + `tools/render-test.ts` → 跑 3 视口 × 3 视野 × 11 件物品的投影包围盒矩阵 + 像素级差异，全部在合理区间
  - 做了什么：① `update()` 不再把世界视野灌进手部相机，手用固定的 `VIEWMODEL_FOV = 70`（只同步宽高比）；② 双臂长度常量从"世界格"改成屏幕比例（`ARM_UNITS = 0.5`），摆动的 `bob` 也归到屏幕比例里；③ 渲染测试新增/改写三条断言（世界视野变化时手的 scale 与 position 必须**完全不变**、手的相机 fov 不跟世界 90° 走）。
  - 为什么：上一版让手跟着世界 fov 换算"屏幕占比"，自测矩阵当场抓到 —— 同一块石头在 fov60 是 0.57×0.66 屏高，fov90 变成 0.97×0.81 屏高、右缘 118%（右半块出画）。根因是"尺寸 ∝ 屏幕占比 × 深度"而"透视强度 ∝ 尺寸/深度"，想让屏幕占比固定，尺寸/深度比就必然随 k 上涨，方块近角被推得更远。原版手是"视图模型"，本来就不该跟世界视野一起变形。
  - 验证：`npm run check` 全绿（`test:render` 260 通过）；另跑 `node .tmp/hand-verify.mjs`（本批新增的临时验收脚本）**99 组几何测量 + 全部功能项 0 失败**——1280×720 / 844×390 / 390×844 三个视口 × fov 45/60/90 × 空手+10 件物品，逐项判 nearZ>0.3、物品宽高/位置在右下象限、右缘不超出 0.34 屏高；像素级（藏手 vs 显示手，剔除云噪声）确认画出来的像素 99% 以上落在几何包围盒内（厚度边假影若回来会在这里崩）；挥动 7 帧、拉弓 3 档、第三人称 0 px、午夜亮度 36%（变暗但仍可见）、控制台无报错。
  - 批次：20261024-1910
- [x] [修26] 台账：把本批记进 `DONE.md` / `notes/batches.md` / `OVERVIEW.md` / `TASKS.md`，并更正 1726 那条里"深度跟着 k 走"的旧描述 → `npm run check`
  - 做了什么：新增 1910 一节与批次索引一行；1726 的 OVERVIEW/TASKS 行改成"手固定用自己的 `VIEWMODEL_FOV`，不跟世界视野"；新增决策 D5。
  - 为什么：1726 收尾时写的是"深度跟着 k 缩放"，1910 换成了更强的做法（视角固定），旧描述留着会误导下一轮。
  - 验证：`npm run check` 全绿（`audit:docs` 体量门禁、`audit:tasks` 台账核对）。
  - 批次：20261024-1910

## 批次 20261024-1726 · 2026-10-24 · 会话 167f6a14

- [x] [修23] 重做第一人称手持物品/手臂的骨架（用户："手持物品的显示还是有很大的问题，参照正版效果调整"）：`src/render/HandRenderer.ts` + `src/render/TextureAtlas.ts` → 用临时截图脚本量各类物品的屏幕包围盒，对照原版构图收进合理区间
  - 做了什么：① 整只手改成**屏幕比例口径**（`syncRig()` 每帧按 `fov`/`aspect` 把"握点屏幕比例 + 屏幕高单位"换算成相机空间），常量集中在文件头（`GRIP_SCREEN_*` / `BLOCK_SIZE` / `SPRITE_SIZE` / `ARM_*`）；② 空手手臂改成"从屏幕右下角伸进来、末端一块略粗的拳头"，根部退到画面外（实测最近处 0.10 格 → 0.57 格）；③ 扁平物品的厚度面改成只取图标**最外一列/行**（六面同贴整张 = 彩带，填纯色 = 空气里一条孤线，两种都实测复现过）；④ 对齐口径改成"图标里不透明那块的底边中点落在握点"（新增 `TextureAtlas.contentBounds()`，面包/苹果不再浮在手心上方）；⑤ 只有完整立方体才画立方体，火把/花草/台阶等改画图标（之前火把被渲染成一根细长条）；⑥ 挥动改成绕肩部支点的小角度旋转 + 手腕前压（原来 0.9 弧度会把物品整个甩出画面）。⚠️ 本条的"屏幕比例"口径当场又修了一轮（同日晚些的 1910）：**手不再跟世界视野换算**，而是钉死在视图模型视角 —— 跟着世界 fov 走时 90° 下同一块石头会大 1.7 倍并右缘出画。
  - 为什么：用户报"还是有很大的问题"。先量化取证：空手手臂包围盒 x 72%~346%、y 75%~514%（一块贴着屏幕的褐色墙），手持方块 y 47%~118%（顶到画面中间），钻石剑 x 61%~109%、y 31%~90% 且翻出两条彩带。三条根因分别是"手臂根部贴到近裁面被透视放大""厚度面拉伸图标""尺寸是世界格数、和握点深度不匹配"。
  - 验证：`npm run check` 全绿（含 `test:render` **260 通过 / 0 失败**，新增"换宽高比握点跟着投影走""视野变宽整只手跟着缩放""挥到一半物品仍在画面内""厚度面只取图标最外一列""按内容底边对齐握点"等断言）；另外用 `playwright-core` 起真实浏览器进创造模式逐件截图核对：1280×720 与手机横屏 844×390、FOV 60/90 下空手 / 石头 / 原木 / 玻璃 / 钻石剑 / 铁镐 / 铁斧 / 面包 / 苹果 / 火把，以及挥动中间帧（物品不再被甩出画面、无游离线条）。实测包围盒：空手手臂 x 69%~114%、y 74%~146%（最近处 0.57 格）；石头 x 64%~96%、y 62%~128%；钻石剑 x 61%~90%、y 42%~86%。
  - 批次：20261024-1726
- [x] [修24] 台账：把这一批记进 `DONE.md` / `notes/batches.md` / `OVERVIEW.md` / `TASKS.md` → `npm run check`
  - 做了什么：新增 1726 一节与批次索引一行；OVERVIEW「渲染」那条把手持物的口径换成"屏幕比例 + 厚度面取边缘列 + 只有完整立方体才画方块"；TASKS 的「队列落地 · 当场任务」补一行。
  - 为什么：这批把"手持物的尺寸口径"整个换掉了，不写进 OVERVIEW 的话下一轮还会有人往 `HandRenderer` 里塞世界格数常量。
  - 验证：`npm run check` 全绿（含 `audit:docs` 体量门禁与 `audit:tasks` 的台账核对）。
  - 批次：20261024-1726

## 批次 20261024-2015 · 2026-10-24 · 会话 723564b3

- [x] [修26] 修上一批"填满面板"的副作用：创造栏没拿到确定高度 → 滚动条消失、列表也滚不动：`index.html`（`.inv-creative-section` 补 `align-self: stretch / height: 100% / max-height: 100%`）→ `npm run test:ui`
  - 做了什么：把生存分类栏那三行（`align-self: stretch; height: 100%; max-height: 100%`）照抄到 `.inv-panel.pocket-ui.pocket-dual .inv-creative-section`，并写清"三行缺一不可"的原因。
  - 为什么：`.inv-body` 是 `align-items: start` 的网格，格子里的元素默认**不拉伸**，创造栏的高度因此是"内容高度"。上一批把网格改成 `flex: 1 1 auto` 之后，网格就跟着撑到内容那么高 → `scrollHeight - clientHeight = 0`：自绘滚动条判 `max > 1` 不成立→整根隐藏，同时也没有可滚的余量，多出来的行直接被 `overflow: hidden` 裁掉（用户："滚动条不见，列表也不能滚动了"）。生存分类栏早就有这三行（同一个坑），创造栏一直没有。
  - 验证：`npx tsx tools/ui-test.ts` **977 通过 / 0 失败**（新增 1 条：创造栏与分类栏两条都得有 `align-self: stretch` + `height: 100%`，缺一条就红）。
  - 批次：20261024-2015
- [x] [修27] 台账：`DONE.md` / `notes/batches.md` / `OVERVIEW.md` / `TASKS.md` → `npm run check`
  - 做了什么：新增 2015 一节、批次索引一行、TASKS 队列落地一行；OVERVIEW 那条"创造网格填满剩余高度"补上"必须同时给栏 `align-self: stretch`，否则滚动条和滚动一起消失"。
  - 为什么：这是"改一半就反向"的典型——只给网格 `flex: 1` 不给父级高度，症状从"留空白"变成"不能滚"，文档里必须成对写。
  - 验证：`npm run check` 全绿。
  - 批次：20261024-2015

## 批次 20261024-1723 · 2026-10-24 · 会话 723564b3

- [x] [修21] 创造物品栏把面板填满（列表下面的空白去掉）：`index.html` 五处 `.inv-creative` 高度上限改成 `flex: 1 1 auto; min-height: 0; max-height: none` → `npm run test:ui`
  - 做了什么：把创造网格的固定上限全部换成"吃掉剩余高度"——`.inv-panel.creative-ui.pocket-ui .inv-creative`（原 `min-height: min(38vh,200px)` / `max-height: min(42vh,220px)`）、`body.touch-mode` 同名那条、横屏矮屏那条（原 34/38vh）、`.inv-panel.creative-ui .inv-creative`（原 `min(58vh,420px)`）、双栏 `.inv-panel.pocket-ui.pocket-dual .inv-creative`（原 174px）、`body.touch-mode ...pocket-dual` 那条（原 174px）、`body:not(.touch-mode) ...pocket-dual`（原 `min(58vh,430px)`）。
  - 为什么：面板高度是固定的 `--inv-pocket-h`（矮横屏就是 318px），网格用 `vh` 封顶就只占一半，下面自然空一大片。面板/内容区/创建区三层都是 `flex: 1 1 auto; min-height: 0`，网格只要也 `flex: 1 1 auto` 就会把剩下的高度全部吃掉（多出来的高度就是能多看见的行）。
  - 验证：`npx tsx tools/ui-test.ts` **976 通过 / 0 失败**（新增 1 条：两条主规则都是 `flex: 1 1 auto` 且不再出现 `max-height: 174px;` / `max-height: min(42vh…;` 这些声明——注意断言认"带分号的声明"，规则块里的注释会提到旧值）。
  - 批次：20261024-1723
- [x] [修22] 台账：`DONE.md` / `notes/batches.md` / `OVERVIEW.md` / `TASKS.md` 记这一批 → `npm run check`
  - 做了什么：新增 1723 一节、批次索引一行、TASKS 队列落地一行、OVERVIEW「界面与音频」补"创造网格填满剩余高度，别再按 vh 封顶"。
  - 为什么：面板是固定高度这一点不写在台账里，下一轮又会有人给网格加 `max-height: 42vh` 之类的"保险"。
  - 验证：`npm run check` 全绿（含 `audit:tasks` 的提交总数核对）。
  - 批次：20261024-1723

## 批次 20261024-1706 · 2026-10-24 · 会话 723564b3

- [x] [修18] 创造物品栏：点非"搜索"分类时搜索行整条收掉（列表上移，不被搜索框占位）：`src/ui/InventoryScreen.ts` `syncCreativeSearch()` + `index.html` 一条 CSS → `npm run test:ui`
  - 做了什么：`syncCreativeSearch()` 里除了藏输入框，再按"分类按钮还在不在这一行里"给 `.inv-creative-controls` 加/去 `search-hidden`；CSS 用 `.inv-panel .inv-creative-controls.search-hidden { display: none !important; }` 收掉整行（`!important` 是因为 `.inv-panel.creative-ui.pocket-ui .inv-creative-controls` 的 `display: flex` 有 4 个类，压不过）。
  - 为什么：双栏那条 `.inv-panel.pocket-ui.pocket-dual .inv-creative-controls { min-height: 32px }` 会在输入框藏掉之后继续占 32px + 6px 行距，物品列表被顶下去一截——用户："物品的列表应该向上平移，不要被搜索框占位"。分类按钮在左轨时整行本来就没用，可以整条收；按钮仍在这一行里的布局（非 pocket）只藏输入框，否则分类按钮会一起消失。
  - 验证：`npx tsx tools/ui-test.ts` **975 通过 / 0 失败**（新增 1 条：`tabsInRow` 判据 + 类名切换 + CSS 收行）。
  - 批次：20261024-1706
- [x] [修19] 创造物品栏只剩一根滚动条（原生那条 = "滑块下面的小滚动条 / 底下小黑块"），并且只许纵向滚：`index.html` → `npm run test:ui`
  - 做了什么：① 把 `.inv-panel.creative-ui.pocket-ui .inv-creative` 从旧的"原生滚动条要看得见"那段（`scrollbar-width: thin` + 8px `::-webkit-scrollbar` + `#b9b9b9` 槽 + `#6f6f6f` 块）里删掉，那段只留给嵌入版配方网格；新增 `.inv-panel .inv-grid.inv-creative { scrollbar-width: none; }` + `::-webkit-scrollbar { display:none; width:0; height:0 }`（带 `.inv-panel` 才压得过那 4 个类的旧规则）。② 创造网格（基础 + 双栏）补 `overflow-x: hidden`。
  - 为什么：创造栏早就换成自绘那根（`.inv-creative-section .inv-category-scrollbar`），旧的原生那条一直没真被关掉——`.inv-grid.inv-creative { scrollbar-width: none }` 只有 2 个类，输给 `.inv-panel.creative-ui.pocket-ui .inv-creative` 的 `scrollbar-width: thin`。于是两根并排：原生 8px 槽 + 深色块压在 6px 自绘滑块下面，滚起来就是"滑块下面的小滚动条"和小黑块。另外 `overflow-y: auto` 单独写会让 `overflow-x` 变成 auto，多 1px 就在底部画一条横向滚动条。
  - 验证：`npx tsx tools/ui-test.ts` 975 通过（新增 2 条：创造栏不再出现原生滚动条声明（thin 与 `::-webkit-scrollbar` 两处都查）、基础与双栏两条网格都是 `overflow-x: hidden; overflow-y: auto`）。
  - 批次：20261024-1706
- [x] [修20] 台账：`DONE.md` / `notes/batches.md` / `OVERVIEW.md` / `TASKS.md` 记这一批 → `npm run check`
  - 做了什么：新增 1706 一节与批次索引一行；OVERVIEW「界面与音频」补"创造栏只有自绘一根滚动条（`scrollbar-width: none` 必须写成 `.inv-panel .inv-grid.inv-creative`，否则被 4 个类的旧 `thin` 规则压住）+ 非搜索分类要收整条搜索行"；TASKS 队列落地补一行。
  - 为什么：`scrollbar-width: none` 写了却无效这件事，只看片段看不出来，下次还会踩；所以坑写进 OVERVIEW 那一行摘要里（`TIPS.md` 已到 500 行上限，按"宁可少写"不新增条目）。
  - 验证：`npm run check` 全绿（含 `audit:docs` 体量门禁）。
  - 批次：20261024-1706

## 批次 20261024-1652 · 2026-10-24 · 会话 723564b3

- [x] [修16] 那颗键改成"可合成物品状态"的纯开关（亮灭 = 状态本身），只保留一条特殊逻辑：仓库里 + 关着 → 打开状态并跳到搜索分类：`src/ui/InventoryScreen.ts` → `npm run test:ui`
  - 做了什么：① click 只有两件事——仓库（`pane === 'items'`）且 `!showUnowned` → `showUnowned = true` + `openPocketCategory('all')`；其余一律 `showUnowned = !showUnowned` + 重排（左栏不跳页）。② 两处 `active` 判据（背包 / 工作站）都改成 `this.showUnowned`，不再掺"左栏在哪一页"。
  - 为什么：上一批把 `active` 写成 `leftPane === 'category'`，结果"分类页里亮着关不掉（点一下状态灭了、按钮还亮）"和"仓库里永远灰着（状态开着也不亮）"两个都错。用户口径是：按钮亮灭 = 状态本身、由用户完全控制、所有分类同一逻辑；只有"仓库里 + 关着"这一条会顺手跳到搜索页。所以亮灭判据必须与点击所翻的那个位是同一个人（`showUnowned`），特殊逻辑只额外做"跳页"。
  - 验证：`npx tsx tools/ui-test.ts` **972 通过 / 0 失败**（4 条断言重写：不碰配方书、正常逻辑取反且不跳页、特殊逻辑 `pane==='items' && !showUnowned` → 置真 + `openPocketCategory('all')`、两处 `active` 都是 `this.showUnowned` 且不再出现 `leftPane === 'category'` / `showCategory` 版本）。
  - 批次：20261024-1652
- [x] [修17] 台账跟口径：`DONE.md` / `notes/batches.md` / `OVERVIEW.md` / `TASKS.md` / `TIPS.md` 里"亮着 = 左栏在可合成视图里"的说法改成"亮着 = 状态本身"；`HANDOFF.md` 提交总数同步 → `npm run check`
  - 做了什么：1636 那节补更正行、新开 1652 一节；OVERVIEW 里那颗键的一句话口径重写；TASKS 里 1636 那条标注被 1652 推翻、并补 1652 一行；TIPS 那条改成"亮灭判据必须就是点击所翻的那个位"。
  - 为什么：这条口径已经连错两轮（"开书" → "跟视图走"），文档里留着错的说法下一轮还会照做。
  - 验证：`npm run check` 全绿（含 `audit:tasks` 的提交总数核对）。
  - 批次：20261024-1652

## 批次 20261024-1636 · 2026-10-24 · 会话 723564b3

> **更正（批次 20261024-1652）**：本批把 `active` 改成"左栏在可合成视图里"仍然是错的——那样在分类页里
> 亮着关不掉、在仓库里永远灰着。正确口径见 1652：亮灭 = 状态本身（`showUnowned`），特殊逻辑只有
> "仓库里 + 关着 → 打开并跳到搜索分类"。


- [x] [修14] 澄清后改回："可合成物品"键只是左栏视图的开关——不打开配方书，且**按钮不会自己灭**：`src/ui/InventoryScreen.ts`（click 分支回退 + `active` 判据改成 `leftPane === 'category'`，工作站那条同口径）→ `npm run test:ui`（断言：click 里没有 `onOpenRecipes`/`onCloseRecipes`；`active` 只看视图、两处都不再带 `showUnowned`）
  - 做了什么：① 撤掉上一批给那颗键加的 `onOpenRecipes('all')` / `isRecipesOpen` 分支，回到"仓库→`openPocketCategory(lastRecipeTab)`、已在分类页→切 `showUnowned`"。② `active` 从 `leftPane === 'category' && this.showUnowned` 改成 `leftPane === 'category'`；工作站分支 `showCategory && this.showUnowned` 同样改成 `showCategory`（`showCategory` 本身就是"左栏在分类页"）。③ title 回到 209 那套（描述再点一下切哪种筛选）。
  - 为什么：用户澄清"没有所谓的配方书页面，配方相关的东西全走可合成物品这颗键"——上一批把"会自动关闭"读成了"配方书被关"，实现方向错了。"按钮自己灭"的真实原因是 `active` 绑在**红底筛选**上：从仓库点进来的第一次 `showUnowned` 还是 false，于是视图开了、按钮是灭的，看起来像自动关掉、得再点一下（那一下才把 `showUnowned` 打开）。
  - 验证：`npx tsx tools/ui-test.ts` **971 通过 / 0 失败**（把上一批那 3 条"那颗键开书"的断言换回"只切视图、不碰配方书"，`active` 那条改成只看视图且覆盖工作站分支）。
  - 批次：20261024-1636
- [x] [修15] 台账改口径：`DONE.md` / `notes/batches.md` / `OVERVIEW.md` / `TASKS.md` 里"那颗键打开配方书"的说法全部改成"可合成物品视图开关 + 亮着跟着视图" → `npm run check`
  - 做了什么：1609 那批的 DONE 条目补一行"更正"，本批次另开一节；OVERVIEW「物品栏与合成」、TASKS 队列落地、批次索引都改成正确口径（滚动条那部分不动）。
  - 为什么：文档里留一句错的因果，下一轮还会把同一个误解再实现一遍。
  - 验证：`npm run check` 全绿（编号 / 覆盖度 / 差异 / 文档体量四条台账 + 全部离线套件）。
  - 批次：20261024-1636

## 批次 20261024-1609 · 2026-10-24 · 会话 723564b3

> **更正（批次 20261024-1636）**：本批 `[修11]` 的"那颗键打开配方书"是**误解**——用户澄清没有"配方书页面"，
> 那颗键是可合成物品视图的开关；已在 1636 改回。`applyInventoryChrome` 里不关配方书那条仍然保留
> （它修的是"R 键在容器/工作站界面里开的书被重排关掉"，与本条无关）。滚动条那两条（修12/修13）不受影响。


- [x] [修11] 标题栏"配方书"键真的能打开配方书，且**不再自动关闭**：`src/ui/InventoryScreen.ts`（按钮 click 分支 + 把 `applyInventoryChrome` 里两处 `onCloseRecipes()` 挪到 `openWith` 的换面板处）→ `npm run test:ui`（断言：仓库里点它＝左栏切"全部/搜索"并调 `onOpenRecipes('all')`；重排函数里不再有 `onCloseRecipes`；换成别的面板时才关书）
  - 做了什么：① 那颗键改三分支——书开着→关；左栏已在分类页→切"列出未拥有（红底）"（保留 1531 口径）；左栏在仓库→`openPocketCategory('all')` + `onOpenRecipes('all')`（容器/工作站两类不弹书，没有可摆的合成格）。② `applyInventoryChrome()` 里容器分支与工作站分支那两行 `onCloseRecipes()` 删除，"换面板就收书"并进 `openWith()` 的 `mode/容器变了` 块与 `openTrade()`；`openWith` 末尾那条只在 inventory/crafting 生效的窄条件一并去掉。③ 那颗键"亮着"的判据加上 `bookOpen`，title 改成"点下去会发生什么"。
  - 为什么：根因是 `openRecipeBook()` 先 `show()` 再 `syncRecipePane()`，而 sync 走的就是 `applyInventoryChrome`，容器/工作站两条分支无条件 `onCloseRecipes()` → 书刚打开就被自己关掉（用户报的"配方书会自动关闭"）。关书是玩家意图（✕/R/换界面），不该是布局副作用。另外 1531 的 B 口径让手机彻底没有配方书入口（当时记成已知缺口），本轮反馈说明要的是书本身。
  - 验证：`npx tsx tools/ui-test.ts` **971 通过 / 0 失败**（本批新增 8 条、改 3 条旧断言：开书 2 条、重排不关书 / 收书位置 2 条、滚动条槽位与黑色滑块 4 条；旧断言里"只切分类、不碰 `onOpenRecipes`"两条与"`active` 只看 `showUnowned`"一条按新口径重写）。
  - 批次：20261024-1609
- [x] [修12] 左栏滚动条与物品留出间距、滑块改成黑色：`index.html`（分类/创造网格 `padding-right` 预留槽位、列宽可缩、滑块 `#1c1c1c`）+ `src/ui/InventoryScreen.ts`（`scrollbarContentLeft` 的 clamp 不再把轨道推到物品上）→ `npm run test:ui`
  - 做了什么：分类网格 `repeat(7, 40px)` → `repeat(7, minmax(0, 40px))`、`padding-right: 5px` → `15px`（= 8px 间距 + 7px 轨道），`.inv-category .inv-slot` 改 `width:100% / aspect-ratio:1 / max 40px`；双栏创造栏同样处理（`padding-right: 14px` = 8 + 6）；滑块 `#c2c2c2 → #1c1c1c`（按下 `#3a3a3a`）；`scrollbarContentLeft()` 的夹紧上限从 `容器宽 - 轨道 - 1` 收到 `容器宽 - 轨道`。PC 那套 48px 规则同步（`minmax(0,48px)` + `padding-right: 15px`）。
  - 为什么：5px 的预留装不下"8px 间距 + 7px 轨道"，JS 的 `Math.min(…)` 就把轨道按回容器右缘、直接压在最后一列上——用户说的"应该与物品有一定间距"；浅灰滑块和浅灰面板同色，所以要求黑色。窄屏左栏只有 ~257px 而 7×40 要 286px，列宽不给收缩余地时最后一列本来就会被裁掉，滚动条更没地方站。
  - 验证：`npx tsx tools/ui-test.ts` 971 通过（新增 4 条：分类预留 15px = 8+7、双栏创造预留 14px = 8+6、夹紧上限不再 `- 1`、滑块为 `#1c1c1c` 且不再出现 `#c2c2c2`）。
  - 批次：20261024-1609
- [x] [修13] 断言与台账：`tools/ui-test.ts` 改掉旧断言 → `npm run check`
  - 做了什么：删/改 3 条旧断言（"那颗键只切物品分类（不碰 onOpenRecipes）"、"标题栏那颗键只切物品分类"、"`toggle('active', leftPane === 'category' && this.showUnowned)`"），补 8 条新断言；决策写进 `doing/723564-decision.md`（D1 恢复开书、D2 重排不关书、D3 间距靠 CSS 预留槽位）。
  - 为什么：这几条断言钉的正是本轮推翻的口径，留着会红（也会把回归锁死成旧行为）。
  - 验证：`npm run check` 全绿（typecheck + 全部离线套件 + 三张台账 + 文档体量），`ui-test` 971 通过 / 0 失败。
  - 批次：20261024-1609

## 批次 20261024-1531 · 2026-10-24 · 会话 3da8ce2b

- [x] [修8] 手持刀剑显示：锚点移到**柄**（贴图底边中心当握把），并给扁平物品**厚度**（薄盒子 + 侧面压暗，避免图标被拉成彩带）：`render/HandRenderer.ts` → `npm run test:render`（断言：sprite 用薄盒子且 depth ∈ [0.03,0.08]；几何包围盒底边在锚点（min.y≈0），方块仍居中；侧面亮度低于正反面）
  - 做了什么：扁平物品改回薄盒子 `BoxGeometry(0.44, 0.44, SPRITE_THICKNESS=0.05)`，六面同图标；新增 `SPRITE_SHADE = [.62,.62,.86,.62,1,1]`（正反满亮度、厚度边压暗）取代方块那套 `FACE_SHADE`；几何体 `translate(0, ITEM_SIZE/2, 0)` 让**底边落在挂点上**（手握柄）；新增 `SPRITE_HOLD_ROTATION = [0.1,-0.55,-0.32]` 与 `BLOCK_HOLD_ROTATION` 分开，方块仍握中间。顺手把 1455 那份只为"双面面片"存在的 `spriteMaterial` 删了（薄盒子正反面都是真实几何，两份材质只会漏改亮度）。
  - 为什么：用户要三件事——柄在手里（底边贴锚点）、有厚度（0.05）、别把图标拉成彩带（侧面压暗到 0.62，让它读作"边的暗面"而不是再来一遍图标）。
  - 验证：`npx tsx tools/render-test.ts` **254 通过 / 0 失败**（把 1455 的 5 条改成 6 条：薄盒子厚度区间、尺寸 0.44、`min.y≈0 且 max.y≈0.44`、方块仍居中、侧面 0.62 / 正面 1、两套握持姿态各自成立）；`npm run typecheck` 通过。
  - 批次：20261024-1531
- [x] [修9] 空装备槽只保留部位图标，**去掉点击后的介绍文案**：`ui/InventoryScreen.ts` 删 `armorSlotPartName` 与提示分支、六个语种删 `inventory.armorEmptyHint` → `npm run test:ui` + `npm run test:i18n`（断言：不再有 `armorEmptyHint` 键与提示分支，槽位仍画图标）
  - 做了什么：删掉 `handleSlotClick` 里那条"点空装备槽给提示"的分支、`armorSlotPartName()` 方法与 `ARMOR_PART_KEYS` 常量；六个语种同步删 `inventory.armorEmptyHint`（表回到 2864 键）。空槽里那五枚部位剪影图标**保持不变**。
  - 为什么：用户："装备空槽有了，只需要显示放置什么就可以了，不用介绍。" 图标本身已经说明这一格放什么，再弹一句等于把说明写两遍。
  - 验证：`npx tsx tools/ui-test.ts` **964 通过 / 0 失败**（把 1455 那 2 条"要有提示"改成 1 条"不弹介绍、图标仍在"）；`i18n-test` 547 通过、`audit:i18n` 六语言 2864/2864；`typecheck` 通过。
  - 批次：20261024-1531
- [x] [修10] 配方书与左栏滚动条按用户确认的口径恢复（**口径待确认**：见回复里的 A/B 选项）→ `npm run test:ui`（按选定口径写断言）
  - 做了什么：① 配方书按用户选的 **B** 恢复：标题栏那颗键回到"只切物品分类"——在仓库里 → `openPocketCategory(lastRecipeTab)`（首次是"全部/放大镜"），已在分类栏 → 切"列出未拥有（红底）/ 只看能做的"；那颗键**完全不碰配方书**（书仍只能由 R 键或自己的 ✕ 手动开关，且是整屏那一层）。② 滚动条按用户选的 **A** 拆回两栏各自一套：`syncCategoryScrollbar` 贴内容右缘（`SCROLLBAR_CONTENT_GAP = 8`、7px 宽），`syncCreativeScrollbar` **不写 left**、交给 CSS 新增的 `.inv-creative-section .inv-category-scrollbar { right: 2px; width: 6px; }`；两者都保留 1455 那次修正的"rect 相减定位"与 24px 滑块下限（`offsetTop` 取决于 offsetParent，正是创造栏错位的根因）。
  - 为什么：用户确认"那颗键只切分类、不弹书"（B）与"回到两栏各自一套"（A）。保留 rect 定位是因为"各自一套"指的是**位置/宽度口径**分开，不是把已知会错位的算法抄回来。
  - 验证：`npx tsx tools/ui-test.ts` **964 通过 / 0 失败**（改 5 条：那颗键只切分类且不碰 `onOpenRecipes`、分类栏里切 `showUnowned`、R 键仍独自开关书、两栏各自一套 + 创造栏交给 CSS `right: 2px`、创造栏不写 left、两处 rect 定位）；`typecheck` 通过。
  - 副作用（按用户口径接受）：手机上配方书没有入口了（只剩 PC 的 R 键），与改动之前一致。
  - 批次：20261024-1531
- [x] [自审] 审这一批的三层（L1 可测量 / L2 可对抗 / L3 可外部）→ 写 `- L1：` / `- L2：` / `- L3：` 各一句 + 证据
  - L1：3 条各自都有会红的断言——手持刀剑 6 条（薄盒子厚度区间、尺寸、**底边贴锚点**（包围盒 min.y≈0）、方块仍居中、侧面压暗/正面满亮、两套握持旋转各自成立）、空槽去介绍 1 条（不再有 `armorEmptyHint` 与提示分支，图标仍在）、配方书+滚动条 6 条（那颗键只切分类且不碰 `onOpenRecipes`、分类栏切 `showUnowned`、R 键独自开关书、两栏各自一套、创造栏交给 CSS `right: 2px`、创造栏不写 left）+ 滚动条 2 条（两处 rect 定位、JS/CSS 滑块下限同为 24）。`render-test` 253 → **254**、`ui-test` 964。
  - L2：本批做了**两次故意破坏**并确认变红——① 删掉 `geometry.translate(0, ITEM_SIZE/2, 0)`（让物品回到"捏在图标正中"）→ "扁平物品的底边贴在挂点上" 立刻红（实测 `y ∈ [-0.220, 0.220]`）；② 上一批已验过的"删 `spriteMaterial` 亮度那行"在本批重构里被合并成一份材质，旧的"两份材质同时变暗"断言已随材质合并一起删除（不再有可破坏点，属于**减少**而不是漏测）。两次都已还原（`git status` 只有文档）。
  - L3：3 条全部来自用户实测原话（"恢复配方书和滚动条"→ 已用弹窗确认到 B/A；"手应该拿到柄的位置""刀剑也应该有厚度"；"空槽只要显示放置什么，不用介绍"）。我自己定的只有实现参数——厚度 0.05、侧面亮度 0.62、握持旋转 `[0.1,-0.55,-0.32]`、创造栏 2px/6px。其中**握持旋转**是唯一没法离线验证的（要看实际视角弧度），已在注释里标明来源，如果手感不对只需改这一个常量。
  - 排除记录（找过但不算问题）：① 手机上配方书没有入口——这是 B 口径的必然结果，写进 decision D2 并告知用户；② 方块仍握在中间而不是"底边贴手"——用户只说刀剑要握柄，方块握中间才符合原版观感；③ 创造栏滚动条不写 `left` 会不会在 PC 上错位——PC 那条 `body:not(.touch-mode)` 规则已在 1455 删除，现在两栏共用同一套 `right` 兜底。
  - 批次：20261024-1531

