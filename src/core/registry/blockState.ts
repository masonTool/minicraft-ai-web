/**
 * 方块状态
 *
 * 原版每个方块位置除了方块 id 还存一份"状态"（朝向、上下半、开关等）。
 * 这里用一字节表示，位布局按方块形状族分配（不同族只用自己的位，互不冲突）：
 *
 *   bit0      所有族通用：TOP（上半砖 / 楼梯的上半 / 门的……）
 *   bit1-2    FACING（朝向 0=北 -Z、1=东 +X、2=南 +Z、3=西 -X）
 *   bit3      火把：是否挂在墙上（WALL_MOUNT）；门：是否打开（OPEN）
 *   bit4      门：门轴在左/右（HINGE）
 *   bit5      门：是否为上半（UPPER）
 *
 * 栅栏与墙的"连接方向"**不存状态**，而是在网格化/碰撞查询时按邻居实时计算——
 * 这样放一个邻居方块后，栅栏会自动长出新的一节，不需要额外的状态同步逻辑。
 */

import { PAINTING_VARIANT_LIMIT, paintingName } from './paintings.ts';

/** 朝向：0=北(-Z)、1=东(+X)、2=南(+Z)、3=西(-X) */
export type Facing = 0 | 1 | 2 | 3;

/** 方块的几何形状族 */
export type BlockShape =
  | 'cube'
  | 'slab'
  | 'stairs'
  | 'fence'
  | 'wall'
  | 'door'
  /** 活板门：一块薄板，关时贴地/贴顶、开时竖起来贴在朝向那一侧 */
  | 'trapdoor'
  /** 栅栏门：两根柱子 + 一块可开关的门板，关着时挡路、开着时中间能走过去 */
  | 'fence_gate'
  | 'torch'
  | 'ladder'
  /**
   * 铁轨（批次 481）：平面时是 1/16 的平板（与 `flat` 同几何），
   * 坡道时是 4 段阶梯（`meshBoxes` 按 state 区分）。
   *
   * 为什么要从 `flat` 拆出来：`flat` 还被红石粉/压力板/地毯共用，
   * 而 `meshBoxes(shape, state)` **拿不到方块 id**——不拆就分不出"这是铁轨还是红石粉"。
   */
  | 'rail'
  /**
   * 旗帜（批次 484）：一根杆 + 一面 1/16 厚的布，**占两格高**
   * （下半 + 上半，靠 `BANNER_TOP_MASK` 区分）。没有碰撞——原版能从旗子里走过去。
   */
  | 'banner'
  /**
   * 钟（批次 490）：钟体 + 顶部吊环，立在地上。
   *
   * ⚠️ 只做立地（原版还能挂墙、挂天花板）：挂墙那两向要多两个朝向分支，
   * 而钟在生存里几乎只出现在村庄的立地钟楼上。
   */
  | 'bell'
  /**
   * 盔甲架（批次 492，B51）：一个底座 + 立柱 + 两根横杆 + 一个头部方块。
   *
   * 做成**方块**而不是实体：装备存在一张按坐标的表里（`world/ArmorStands.ts`），
   * 与展示框/告示牌同一条路子——实体那条路要先有"实体序列化"，
   * 而方块表已经有存档通道了。
   */
  | 'armor_stand'
  /**
   * 洞穴藤蔓（批次 496，D23）：从洞顶垂下的一条。
   *
   * 与 `vine`（贴墙的藤）不同：它靠**上方**支撑，而且是"一节串一节"——
   * 所以支撑判定单独一档（`Support.ts` 的 `'ceiling'`）。
   */
  | 'cave_vines'
  /** 堆肥桶（批次 70）：四面板条 + 2/16 桶底，顶面敞口 */
  | 'composter'
  | 'pane'
  /** 十字交叉的两片薄面：草、花、蘑菇、甘蔗这类植物（无碰撞、双面可见） */
  | 'cross'
  /**
   * 珊瑚扇（批次 51）：**一片**薄面，落在方块顶上或贴在方块侧面。
   *
   * 与 `cross` 的差别是"只有一片"（珊瑚扇在原版就是一片扇形，不是十字）+
   * **朝向写在状态里**（贴哪一面 = 火把那一套 `wallMounted` + `facing` 状态位，
   * 见 `blockShapes.ts` 的 `coralFanBoxes`）。无碰撞。
   */
  | 'coral_fan'
  /**
   * 头（批次 115，凋灵骷髅头）：**8/16 的立方体，贴在方块顶面正中**。
   *
   * 与 `cube` 的区别就是这一块：碰撞盒是 8/16 见方、8/16 高（原版能站上去，
   * 也能从旁边走过去而不被挡）——所以它不能复用 `cube`（那是整格）。
   * 目前只有一种头，所以状态里不存朝向（原版会按放置方向转头，
   * 本项目一律朝一个方向，见 TASKS J14 的差异）。
   */
  | 'head'
  /** 仙人掌：四面向内缩 1 像素，且不遮挡邻居（否则贴着的方块会被剔除掉一面） */
  | 'cactus'
  /**
   * 灯笼（批次 200，灵魂灯笼）：**落地的小灯**——6/16 见方、9/16 高，顶上一个小提环。
   *
   * 原版灯笼还能挂在天花板上；这里只做落地那一态（见 `Placement` 的 `case 'lantern'`），
   * 因为"挂顶"要一套新的贴附状态位，而灵魂灯笼最常见的用法就是摆在下界的地上。
   */
  | 'lantern'
  /**
   * 贴地的薄板（红石粉 / 中继器 / 比较器 / 按钮 / 压力板）。
   * 渲染成 1/16 高的一层，**无碰撞**：原版这些方块也确实不挡路（压力板能踩上去）。
   */
  | 'flat'
  /**
   * 睡莲（B16）：水面上的薄叶片，渲染成贴在水面的 1/16 薄板。
   *
   * ⚠️ 与 `flat` 的唯一差别是**有碰撞**：原版是能站在睡莲上的（还能踩着一路过河），
   * 而红石粉/压力板那批是"不挡路"的。形状分开是为了让碰撞由形状驱动，
   * 而不是在物理里特判"这个方块是不是睡莲"。
   */
  | 'lily_pad'
  /**
   * 雪层（B11）：1~8 层，高度 = 层数/8，**层数存在方块状态里**。
   *
   * 与 `slab` 的区别不只是"能叠 8 层"：雪层是**同一格越叠越高**（不是上下半）。
   * 它占的 3 个状态位（bit5-7）与门的"上半格"、台阶的"双层"重合——
   * 沿用本文件开头那条设计：不同形状族不会出现在同一个方块上，所以可以共用位。
   *
   * 为什么"一个方块 + 状态位"，而不是像小麦那样"一个阶段一个 id"：
   * 小麦的贴图按 id 静态查（`blockDef(id).tiles`），而雪层 8 个阶段**共用同一张贴图**，
   * 变的只有几何高度——而几何本来就吃状态（`meshBoxes(shape, state)`）。
   */
  | 'snow'
  /**
   * 锁链（B11）：一根细柱，**轴向存在状态里**（竖直挂着 / 沿 X 横拉 / 沿 Z 横拉）。
   *
   * 为什么需要状态：原木也是"柱状"，但它是整格立方体，朝向只影响贴图、不影响几何；
   * 锁链只有 3/16 粗，轴向会同时改变碰撞盒与渲染盒，所以必须落进状态。
   *
   * 基岩版（本项目的复刻目标）里**锁链可以攀爬**，所以它同时是"可攀爬方块"之一。
   */
  | 'chain'
  /**
   * 藤蔓（B11）：贴在方块某一面（或天花板底下）的薄片，**可以同时挂好几面**。
   *
   * 与原版一致：4 个水平面 + 顶面各占一个状态位，所以"一个藤蔓方块"能同时挂住
   * 相邻的两个墙面——这正是它与梯子的差别（梯子只有 1 个朝向）。
   * 没有碰撞（穿得过去）、能攀爬、会自己往下长也会往旁边蔓延。
   */
  | 'vine'
  /**
   * 营火（H11，批次 47）：7/16 高的一堆柴，**能站上去**（原版可以踩、也可以用它做烟熏架）。
   *
   * 为什么单开一个形状而不是复用 `slab`：它的高度不是 0.5，而且"能不能站上去"
   * 这条物理行为与贴图/碰撞的绑定方式和台阶不一样（台阶还有上下半与双层两个状态位）。
   */
  | 'campfire'
  /**
   * 可可豆荚（批次 49）：挂在原木侧面的一个"豆荚盒"，朝向在状态里。
   * 与藤蔓/梯子同一套朝向语义（`facing` 指向**贴着的那一面**）。
   */
  | 'cocoa'
  /**
   * 蛋糕（批次 52）：半格高的一块蛋糕，**宽度随吃掉的片数变窄**（原版就是越吃越小）。
   *
   * 为什么"一个方块 + 状态位"而不是 7 个 id：蛋糕是**同一个方块被一点点吃掉**，
   * 不是"长大"——7 个 id 会让"吃着吃着换了个方块"这种语义渗透到存档与联机里
   * （白名单里得写 7 行，掉落还要判"剩几片"）。片数放状态里，几何与贴图各读一次即可。
   */
  | 'cake'
  /**
   * 花盆（批次 52）：矮矮的一个盆，里面能种一株小植物。
   *
   * 盆里的**那株植物由状态位记着**（原版是方块实体 + 物品 NBT，本项目没有 NBT，
   * 见 `POTTED_PLANTS`）：索引 0 = 空盆，1..N = 表里的第 N 种植物。
   * 渲染时盆身走盒子、植物走十字薄面（`ChunkMesher` 里那一小段特判）。
   */
  | 'flower_pot'
  /**
   * 脚手架（批次 53）：底部一块薄板 + 四角的柱子，**能站上去、也能攀爬**。
   *
   * 连接方向**不写状态**（与栅栏/墙同一条）：网格化时按邻居实时算——
   * 四角柱子在"相邻两侧都连着脚手架"时会省略，于是连成一片时只剩外圈柱子，
   * 与原版"脚手架连起来是一整块平台"的观感一致。代价是碰撞盒（物理侧拿不到邻居）
   * 固定按 4 根柱子算，与栅栏现在的做法相同。
   */
  | 'scaffolding'
  /**
   * 阳光传感器（批次 54）：一块 6/16 高的板子，**按天光强度输出红石信号**。
   *
   * 两个状态位：`powered`（当前有没有输出，渲染与调试要用）与 `inverted`
   * （反向模式：把 15 − 天光 当输出，也就是"天黑才通电"）。
   * 输出强度本身**不占状态位**——它每次重算时按天光现算（与红石粉强度同一个道理）。
   */
  | 'daylight_detector'
  /**
   * 绊线（批次 55）：贴着地面的一根细线，**踩上去就触发**（本身没有碰撞）。
   *
   * 线沿哪个方向延伸**不写状态**：网格化时按邻居实时算（与栅栏同一套），
   * 东西向有邻居就画一条沿 X 的线、南北向有邻居就画一条沿 Z 的线、都没有就画个小十字。
   * 状态位只放"通电了没"（`powered`）与"被剪断了没"（`disarmed`）。
   */
  | 'tripwire'
  /**
   * 绊线钩（批次 55）：贴在墙上的一个钩子，两根朝向相对的钩子 + 中间的绊线组成一条回路。
   *
   * 朝向沿用本项目那套（`facing` 指向**贴着的那一面墙**，与梯子/藤蔓/珊瑚扇一致）；
   * "线往哪边延伸"是它的**反方向**（原版把朝向记成"线延伸的方向"，
   * 这里为了全项目一套语义反过来记，换算收在 `tripwireWireDirection` 里）。
   */
  | 'tripwire_hook'
  /**
   * 漏斗（批次 58，H14 的第一件容器类功能方块）：上面一个 6/16 高的"碗口"，
   * 往下逐级收窄成 4/16 见方的管子，管子**朝下或朝四个水平方向**（状态里记着）。
   *
   * 几何用一个"逐级收窄的盒子塔"近似原版那个斜面锥体（见 `blockShapes.ts`）：
   * 原版是一个斜的漏斗面，而本项目只画轴对齐盒子——四级台阶式收窄在 16 像素的
   * 尺度上看起来就是漏斗（这也是花盆"盆身 + 植物"那套叠加几何的继续）。
   *
   * 碰撞只算"碗口那一圈"（从 6/16 往上）：管子不挡路，所以**能从漏斗底下走过去**。
   */
  | 'hopper'
  /**
   * 投掷器（批次 59，H14 的第二件容器类功能方块）：一个铁壳正方体 + 朝向那一面的
   * 一个小凸口（4/16 见方、伸出 2/16）。
   *
   * 它的「朝向」是**六向**（朝上 / 朝下 + 四个水平方向），比漏斗多一个"朝上"——
   * 编码与漏斗共用（见下文的 `sixFacingOf` 一段）。
   *
   * ⚠️ 凸口是**几何**上的朝向提示，不是贴图：本项目的网格化器按**面朝向**取贴图
   * （顶/底/侧三张），没有"某一面单独用另一张"的能力——活塞、观察者也是同一个取舍。
   * 所以朝向靠**轮廓**（凸口伸出来的那一小块）来认，界面里另有文字写着朝哪边。
   */
  | 'dropper'
  | 'dispenser'
  /**
   * 床（B13，批次 79）：**横跨两格**的一件家具，9/16 格高，能躺在上面睡觉。
   *
   * 两格分别叫"床脚"（放下去的那一格）与"床头"（床脚沿 `facing` 方向的那一格），
   * 谁是谁写在状态位 `BED_HEAD_MASK` 里——这与门"上下两半"是同一套结构
   * （拆一半必须带走另一半，否则会留下半张床）。
   *
   * 朝向的语义与其它族**一致**：`facing` 指向**床头相对床脚的方向**
   * （原版 bed 的 `facing` 正是"床头朝向"，见 `bedOtherHalf`）。
   */
  | 'bed'
  /**
   * 告示牌（B12，批次 80）：一块**木牌**，能写四行字。
   *
   * 两种站法**同一个方块**（与火把/珊瑚扇同一套状态）：
   *  - **落地牌**（`wallMounted` 为假）：一根 2/16 的立柱 + 上面 8/16 的牌面；
   *  - **挂墙牌**（`wallMounted` 为真）：只有牌面，贴在它靠着的那面墙上。
   *
   * `facing` 记的是**牌面朝外的那一边**（也就是"字朝哪边"、玩家从哪边能读）。
   * 原版落地牌有 16 档旋转，这里用通用的 4 档（差异写进 TASKS B12）。
   *
   * ⚠️ **没有碰撞盒**：原版告示牌本来就不挡路（能从牌子里走过去），
   * 所以 `collisionBoxes('sign')` 返回空——与火把/植物同一档。
   */
  | 'sign'
  /**
   * 避雷针（批次 83）：一根 2/16 见方、从**贴着的那一面**伸出来 6/16 的细杆。
   *
   * 朝向走共享的六向编码（`sixFacingOf` / `withSixFacing`），语义与漏斗/投掷器/木桶一致：
   * **指向"伸出"的那一面**。闪电就打在杆头上——所以 `world/Lightning.ts`
   * 要按这个朝向算落点，而不是简单地"打在这一格的顶上"。
   */
  | 'lightning_rod'
  /**
   * 物品展示框（B14，批次 86）：贴在墙上的一块**中间镂空**的板子，
   * 框里能挂一件物品（挂的是什么存在 `world/ItemFrame.ts` 那张按坐标的表里，
   * 与告示牌上的字同一条路——方块状态只有一个字节，装不下"id + 数量 + 耐久 + 附魔"）。
   *
   * 朝向只用通用 `facing` 两位，语义沿用**梯子/火把那一套**：
   * `facing` 指向**贴着的那一面墙**（贴墙牌那种"指向外面"是另一套，
   * 这里要的几何是"贴在墙上"，所以取贴墙那一套；朝外方向用
   * `outwardFacingOf` 换算，只有一处出处）。
   *
   * 无碰撞（原版能走进去）。
   */
  | 'item_frame'
  /**
   * 画（B14，批次 86）：贴在墙上的**一整面**薄板，贴图就是那幅画。
   *
   * 本项目这一批只做原版 1.18 里 **1×1** 的 7 幅（见 `registry/paintings.ts`），
   * 所以它只占一格、不需要跨格占用那套机制。
   * "哪一幅"放在状态位 bit3-5（3 位，7 幅用不满），朝向同样是"贴着的那一面墙"。
   *
   * 无碰撞（原版画是一层贴图，能穿过去）。
   */
  | 'painting'
  /**
   * 下界疣（批次 92）：长在**灵魂沙**上的作物，4 个生长阶段各占一个 id。
   *
   * 为什么不复用 `cross`：`cross` 的放置判据是"下方是实心方块就行"（花/草/树苗共用），
   * 而下界疣**只认灵魂沙**（原版就是这条）。判据跟着形状走是本项目一贯的做法
   * （可可豆只认丛林原木也是这么开的），在形状上分开之后，
   * `Placement` / `Support` 各写一条 `case` 就够了，不必在物理里特判"这个方块是不是下界疣"。
   *
   * 几何与 `cross` 完全一样（两片交叉薄面），所以两处的盒子表共用同一个 `case`。
   */
  | 'nether_wart'
  /** 流体（水/岩浆）：渲染高度随液面等级变化，无碰撞 */
  | 'fluid';

/** 朝向对应的水平偏移（与 Facing 一一对应） */
export const FACING_OFFSET: readonly (readonly [number, number])[] = [
  [0, -1], // 北
  [1, 0], // 东
  [0, 1], // 南
  [-1, 0], // 西
];

const FACING_MASK = 0b110;
const TOP_MASK = 0b1;
const WALL_MOUNT_MASK = 0b1000;
const DOOR_OPEN_MASK = 0b1000;
const DOOR_HINGE_MASK = 0b10000;
const DOOR_UPPER_MASK = 0b100000;

/**
 * 旗帜的上半格（批次 484）。与门的 `DOOR_UPPER_MASK` 同一位、同一套用法：
 * 两格高的东西必须能分辨"我在上半还是下半"，否则破坏时不知道该带走哪一半。
 * 旗帜与门不会出现在同一格，所以按族复用这一位。
 */
const BANNER_TOP_MASK = 0b100000;

/**
 * 旗帜的**图案**（批次 497；**批次 502 改位**）：3 位存图案编号（0 = 光板）。
 *
 * ⚠️ 原来占 bit0-2，与 `FACING_MASK = 0b110` **撞位**——挂墙旗帜换一次图案，
 * 低位的朝向就跟着被改掉（第一批只在立地旗上验过，挂墙那面会当场转向）。
 * 改用旗帜自己空着的三位：**bit0 / bit4 / bit6**
 * （bit1-2 朝向、bit3 挂墙、bit5 上半、bit7 留给以后的水浸）。
 *
 * 底色不需要状态位——16 色是 16 个不同的方块 id（640~655），
 * 所以状态位只用来表达"烫了哪种图案"。
 */
const BANNER_PATTERN_MASK = 0b1010001;

/** 图案编号 → 名字（渲染与提示共用；0 是光板） */
export const BANNER_PATTERNS: readonly string[] = ['无', '十字', '边框', '斜纹', '横条'];

export function bannerPatternOf(state: number): number {
  return (state & 0b1) | (((state >> 4) & 0b1) << 1) | (((state >> 6) & 0b1) << 2);
}

export function withBannerPattern(state: number, pattern: number): number {
  const clamped = Math.max(0, Math.min(BANNER_PATTERNS.length - 1, Math.floor(pattern)));
  return (
    (state & ~BANNER_PATTERN_MASK) |
    (clamped & 0b1) |
    (((clamped >> 1) & 0b1) << 4) |
    (((clamped >> 2) & 0b1) << 6)
  );
}

/** 右键一次换成下一种图案（0 → 1 → … → 4 → 0） */
export function nextBannerPattern(state: number): number {
  return withBannerPattern(state, (bannerPatternOf(state) + 1) % BANNER_PATTERNS.length);
}

export function isBannerTop(state: number): boolean {
  return (state & BANNER_TOP_MASK) !== 0;
}

export function withBannerTop(state: number, top: boolean): number {
  return top ? state | BANNER_TOP_MASK : state & ~BANNER_TOP_MASK;
}
/**
 * 通用"通电 / 按下 / 开关"标记（bit3）。
 *
 * 与门的 OPEN、火把的 WALL_MOUNT **共用同一位**：它们属于不同的形状族，
 * 同一个方块只会是其中一种，因此不需要各占一位。
 * 红石系统统一用它表示"这个元件当前是否被激活"。
 */
const POWERED_MASK = 0b1000;

/**
 * 台阶的"双层"标记（bit6）。
 *
 * 原版把上下两块台阶合并后变成独立的 double_slab 方块；这里改成**同一方块加一个状态位**，
 * 好处是不用为 12 种台阶各加一个方块 id，网格化与碰撞只需判断这一位就能输出整格。
 * 破坏时按 2 个台阶掉落（见 blocks.ts 的掉落表）。
 */
const SLAB_DOUBLE_MASK = 0b1000000;

// ---------------------------------------------------------------- 蛋糕与花盆（批次 52）
//
// 两者都用**低位**（bit0 起）存自己的"阶段/内容物"：它们的形状族与台阶/门/藤蔓
// 不会同时出现在一个方块上，所以这些位可以重用（见文件开头那条设计）。
// 蛋糕只要 3 位（0~6 片），花盆要 5 位（0 = 空盆 + 最多 31 种植物）。

// ---------------------------------------------------------------- 堆肥桶（批次 70）
//
// 堆肥桶的"内容物"是一个 0~8 的等级（原版 8 级满），用**低 4 位**：
// 与蛋糕片数/花盆植物同一条约定——形状族不会同时在同一个方块上，那些位可以重用。
// 等级 8 = 满，可以收 1 份骨粉；收完清零。

/** 一个堆肥桶要几级才满（原版 8） */
export const COMPOSTER_MAX_LEVEL = 8;

/** 堆肥等级占低 4 位（0~8，够用；8 就是满） */
const COMPOST_LEVEL_MASK = 0b1111;

export function composterLevelOf(state: number): number {
  return state & COMPOST_LEVEL_MASK;
}

/**
 * 写入堆肥等级。
 *
 * ⚠️ 与蛋糕片数同一条：夹到 **0~`COMPOSTER_MAX_LEVEL`**（不是掩码上限 15）——
 * 超过 8 的等级不是一个合法状态，真出现说明有代码忘了在这里拦。
 */
export function withComposterLevel(state: number, level: number): number {
  const clamped = Math.max(0, Math.min(COMPOSTER_MAX_LEVEL, Math.floor(level)));
  return (state & ~COMPOST_LEVEL_MASK) | clamped;
}

/** 满了吗（满了才能收骨粉） */
export function isComposterReady(state: number): boolean {
  return composterLevelOf(state) >= COMPOSTER_MAX_LEVEL;
}

/** 一个蛋糕有几片（原版 7 片：吃满 7 次就没了） */
export const CAKE_SLICES = 7;

/** 蛋糕被吃掉几片（0~6；到 7 就是吃完了、方块消失） */
const CAKE_BITES_MASK = 0b111;

export function cakeBites(state: number): number {
  return state & CAKE_BITES_MASK;
}

/**
 * 写进食掉的片数。
 *
 * ⚠️ 夹到 **`CAKE_SLICES - 1`**（0~6），不是夹到掩码上限 7：
 * "第 7 片"意味着这个方块已经该消失了，它**不该是一个合法的状态**
 * （真出现 7，说明有代码忘了把方块换成空气——那是个 bug，不该在这里被合法化）。
 */
export function withCakeBites(state: number, bites: number): number {
  const clamped = Math.max(0, Math.min(CAKE_SLICES - 1, bites));
  return (state & ~CAKE_BITES_MASK) | clamped;
}

/**
 * 阳光传感器的"反向模式"（批次 54）。
 *
 * 与门的"门轴"共用 bit4：两者属于不同的形状族，同一个方块只会是其中一种
 * （沿用本文件开头那条设计）。
 */
const INVERTED_MASK = 0b10000;

export function isInverted(state: number): boolean {
  return (state & INVERTED_MASK) !== 0;
}

export function withInverted(state: number, inverted: boolean): number {
  return inverted ? state | INVERTED_MASK : state & ~INVERTED_MASK;
}

/**
 * 绊线被"剪断"了（批次 55）。
 *
 * 与门的门轴 / 阳光传感器的反向模式共用 bit4：三者属于不同形状族，
 * 同一个方块只会是其中一种（沿用本文件开头那条设计）。
 * 剪断之后线还在、也还连着，但**踩上去不再触发**（原版用剪刀右键剪断）。
 */
const DISARMED_MASK = 0b10000;

export function isDisarmed(state: number): boolean {
  return (state & DISARMED_MASK) !== 0;
}

export function withDisarmed(state: number, disarmed: boolean): number {
  return disarmed ? state | DISARMED_MASK : state & ~DISARMED_MASK;
}

/**
 * TNT 引信闪烁的"相位"（批次 56）。
 *
 * 与门的门轴 / 阳光传感器的反向 / 绊线的剪断共用 bit4（不同形状族可以重用位）。
 * 引信期间每 0.2 秒翻一次，`stateTiles` 据此在"正常贴图"与"发白贴图"之间换——
 * 这就是原版那种"一闪一闪"（原版是实体渲染时叠白，我们只能换贴图）。
 */
const FLASH_MASK = 0b10000;

export function isFlash(state: number): boolean {
  return (state & FLASH_MASK) !== 0;
}

export function withFlash(state: number, on: boolean): number {
  return on ? state | FLASH_MASK : state & ~FLASH_MASK;
}

/** 绊线钩的"线接上了没有"（bit0；渲染与调试要用，触发判定也要它） */
const TRIPWIRE_ATTACHED_MASK = 0b1;

export function isTripwireAttached(state: number): boolean {
  return (state & TRIPWIRE_ATTACHED_MASK) !== 0;
}

export function withTripwireAttached(state: number, attached: boolean): number {
  return attached ? state | TRIPWIRE_ATTACHED_MASK : state & ~TRIPWIRE_ATTACHED_MASK;
}

/**
 * 绊线钩的"线往哪边延伸"：**朝向的反方向**（本项目的 `facing` 一律指向贴着的那一面墙）。
 * 返回 Facing（0 北 / 1 东 / 2 南 / 3 西）。
 */
export function tripwireWireDirection(state: number): Facing {
  return ((facingOf(state) + 2) & 3) as Facing;
}

/** 花盆里装的是第几种植物（0 = 空盆；对应 `POTTED_PLANTS` 的下标 + 1） */
const POTTED_PLANT_MASK = 0b11111;

export function flowerPotPlant(state: number): number {
  return state & POTTED_PLANT_MASK;
}

export function withFlowerPotPlant(state: number, plant: number): number {
  return (state & ~POTTED_PLANT_MASK) | (Math.max(0, Math.min(POTTED_PLANT_MASK, plant)) & POTTED_PLANT_MASK);
}

// ---------------------------------------------------------------- 流体
//
// 流体独占整格，因此低位可以随便用：
//   低 3 位 = 液面等级（0 = 水源，1~7 越流越薄）
//   第 4 位   = "下落"标记（上方是同一液体，这一格是瀑布的一节）
const FLUID_LEVEL_MASK = 0b111;
const FLUID_FALLING_MASK = 0b1000;

/** 液面等级 */
export function fluidLevel(state: number): number {
  return state & FLUID_LEVEL_MASK;
}

export function withFluidLevel(state: number, level: number): number {
  return (state & ~FLUID_LEVEL_MASK) | (level & FLUID_LEVEL_MASK);
}

export function isFallingFluid(state: number): boolean {
  return (state & FLUID_FALLING_MASK) !== 0;
}

export function withFallingFluid(state: number, falling = true): number {
  return falling ? state | FLUID_FALLING_MASK : state & ~FLUID_FALLING_MASK;
}

/**
 * 流体的渲染高度（0~1）。
 *
 * ⚠️ **水源与下落液体保持满格**，只有"流动中"的液体才变薄。
 * 原版水源其实是 14/16 格高，但那样会让海洋里每一格水都退化成独立的面，
 * 贪心网格化再也合并不了（实测三角形从 100% 涨到 175%）。
 * 换来的收益只是水面低 1 像素，不划算——把"能看出液面高度"这件事
 * 留给真正有意义的流动水。
 */
export function fluidHeight(state: number): number {
  if (isFallingFluid(state)) return 1;
  const level = fluidLevel(state);
  if (level === 0) return 1;
  return Math.max(0.15, 0.9 - level * 0.1);
}

export const DEFAULT_STATE = 0;

// ---------------------------------------------------------------- 朝向 / 上下半（通用）

export function facingOf(state: number): Facing {
  return ((state & FACING_MASK) >> 1) as Facing;
}

export function withFacing(state: number, facing: Facing): number {
  return (state & ~FACING_MASK) | ((facing << 1) & FACING_MASK);
}

export function isTop(state: number): boolean {
  return (state & TOP_MASK) !== 0;
}

export function withTop(state: number, top: boolean): number {
  return top ? state | TOP_MASK : state & ~TOP_MASK;
}

/**
 * "贴在墙上的那一族"的**朝外方向**（B14，批次 86）。
 *
 * 本项目绝大多数贴墙方块（火把 / 梯子 / 藤蔓 / 珊瑚扇 / 绊线钩 / 展示框 / 画）
 * 的 `facing` 都指向**贴着的那一面墙**，而画框这类几何真正需要的是
 * "板子朝哪边露出来"——也就是它的反方向。
 *
 * 换算只有这一处出处（告示牌那批的经验：同一个字段两种含义时，
 * 换算散开写必然有一处写反），并且写起来是 `+2 & 3`（Facing 四向的对面）。
 */
export function outwardFacingOf(state: number): Facing {
  return ((facingOf(state) + 2) & 3) as Facing;
}

/**
 * 贴墙那一族的**支撑格**相对偏移（B14，批次 86）。
 *
 * `facing` 指向贴着的那一面墙，所以支撑就在 `FACING_OFFSET[facing]` 那一格。
 * 与几何（`blockShapes` 的 `wallPlateBox`）、放置规则（`Placement` 里那句
 * `blockAt(-nx, 0, -nz)`）读的是同一个字段，所以"贴在哪一面 / 靠哪一面站住"
 * 不会各说各话。
 */
export function wallSupportOffset(state: number): readonly [number, number] {
  return FACING_OFFSET[facingOf(state)] ?? FACING_OFFSET[0]!;
}

/** 由玩家水平朝向推方块朝向（原版放置时取玩家面朝的相反方向） */
export function facingFromYaw(yaw: number): Facing {
  // yaw=0 → 看向 -Z（北）。换算成 0-3 并取反方向。
  const index = Math.round(-yaw / (Math.PI / 2)) & 3;
  return ((index + 2) & 3) as Facing;
}

// ---------------------------------------------------------------- 台阶双层

export function isSlabDouble(state: number): boolean {
  return (state & SLAB_DOUBLE_MASK) !== 0;
}

export function withSlabDouble(state: number, doubled: boolean): number {
  return doubled ? state | SLAB_DOUBLE_MASK : state & ~SLAB_DOUBLE_MASK;
}

// ---------------------------------------------------------------- 火把

export function isWallMounted(state: number): boolean {
  return (state & WALL_MOUNT_MASK) !== 0;
}

export function withWallMounted(state: number, mounted: boolean): number {
  return mounted ? state | WALL_MOUNT_MASK : state & ~WALL_MOUNT_MASK;
}

// ---------------------------------------------------------------- 红石元件

/** 元件是否处于激活态（拉杆开、按钮按下、压力板被踩、红石灯亮、活塞伸出） */
export function isPowered(state: number): boolean {
  return (state & POWERED_MASK) !== 0;
}

export function withPowered(state: number, powered: boolean): number {
  return powered ? state | POWERED_MASK : state & ~POWERED_MASK;
}

/**
 * 中继器 / 比较器的延迟档位（0~3 → 1~4 红石刻，1 红石刻 = 0.1 秒）。
 * 占 bit4-5：再往下 bit6 是台阶双层、bit7 空闲。
 */
const DELAY_MASK = 0b110000;

export function delayOf(state: number): number {
  return (state & DELAY_MASK) >> 4;
}

export function withDelay(state: number, delay: number): number {
  return (state & ~DELAY_MASK) | ((delay & 0b11) << 4);
}

/**
 * 比较器的**减法模式**（批次 544，原版右键切换）。
 *
 * 占 bit0：比较器不用 TOP（那是台阶/门/雪层的事），facing 占 bits 1-2、
 * 延迟段 bits 4-5 只属于中继器，所以 bit0 是干净的。
 * 关着 = 比较模式（输出背面信号），开着 = 减法模式（背面 − 侧面）。
 */
const COMPARATOR_SUBTRACT_MASK = 0b1;

export function isComparatorSubtract(state: number): boolean {
  return (state & COMPARATOR_SUBTRACT_MASK) !== 0;
}

export function withComparatorSubtract(state: number, subtract: boolean): number {
  return subtract ? state | COMPARATOR_SUBTRACT_MASK : state & ~COMPARATOR_SUBTRACT_MASK;
}

// ---------------------------------------------------------------- 正在燃烧（炉子 / 营火）

/**
 * 这座炉子/营火**是不是正在燃烧**（批次 47）。
 *
 * 与门的 OPEN、拉杆的 POWERED 共用 bit3——沿用本文件开头那条设计
 * （不同形状族不会同时出现在一个方块上）。
 *
 * 为什么需要一个状态位：烧着的时候要换贴图（炉口的火光）并**发光 13**，
 * 而这两件事都只能由"方块状态"驱动（`stateTiles` / `stateLight` 都吃 state）。
 * 这也正是红石灯那套机制的复用：`World#setStateAndUpdate` 会在状态改变后
 * 自动重算光照并重网格化那块方块。
 */
export function isLitState(state: number): boolean {
  return isPowered(state);
}

export function withLitState(state: number, lit: boolean): number {
  return withPowered(state, lit);
}

// ---------------------------------------------------------------- 门

export function isDoorOpen(state: number): boolean {
  return (state & DOOR_OPEN_MASK) !== 0;
}

export function withDoorOpen(state: number, open: boolean): number {
  return open ? state | DOOR_OPEN_MASK : state & ~DOOR_OPEN_MASK;
}

export function doorHinge(state: number): 0 | 1 {
  return ((state & DOOR_HINGE_MASK) >> 4) as 0 | 1;
}

export function withDoorHinge(state: number, hinge: 0 | 1): number {
  return (state & ~DOOR_HINGE_MASK) | (hinge << 4);
}

export function isDoorUpper(state: number): boolean {
  return (state & DOOR_UPPER_MASK) !== 0;
}

export function withDoorUpper(state: number, upper: boolean): number {
  return upper ? state | DOOR_UPPER_MASK : state & ~DOOR_UPPER_MASK;
}

// ---------------------------------------------------------------- 活板门 / 栅栏门
//
// 两者各只需要"朝向 + 开关"，而开关与门的 OPEN **共用同一位**——
// 沿用本文件开头那条既有设计（不同形状族不会同时出现在一个方块上，所以不必各占一位）。
// 仍然给它们各自的取名函数：调用处写 `isTrapdoorOpen(state)` 比 `isDoorOpen(state)` 诚实，
// 也让"门"与"活板门"的代码在搜索时不会互相误伤。

/** 活板门是不是开着（竖起来贴着侧面） */
export function isTrapdoorOpen(state: number): boolean {
  return isDoorOpen(state);
}

export function withTrapdoorOpen(state: number, open: boolean): number {
  return withDoorOpen(state, open);
}

/** 栅栏门是不是开着 */
export function isFenceGateOpen(state: number): boolean {
  return isDoorOpen(state);
}

export function withFenceGateOpen(state: number, open: boolean): number {
  return withDoorOpen(state, open);
}

// ---------------------------------------------------------------- 下界传送门

/**
 * 下界传送门的门面沿哪个水平轴（原版的 `HORIZONTAL_AXIS`）。
 *
 * 与 POWERED / OPEN / WALL_MOUNT 共用 bit3——沿用本文件开头那条既有设计。
 * 这一位只有两处用得上，但两处都离不开它：
 *  1. 传出/传入时要知道往哪个方向把玩家推出去（垂直于门面）
 *  2. 在目的地新建门时要尽量与原门的朝向一致（免得"从东西向的门进去、从南北向的门出来"）
 */
const PORTAL_AXIS_Z_MASK = 0b1000;

/** 门面是否沿 Z 轴展开（false = 沿 X 轴展开，即门面法线是 Z） */
export function portalAxisIsZ(state: number): boolean {
  return (state & PORTAL_AXIS_Z_MASK) !== 0;
}

export function withPortalAxis(state: number, axisZ: boolean): number {
  return axisZ ? state | PORTAL_AXIS_Z_MASK : state & ~PORTAL_AXIS_Z_MASK;
}

/** 门面沿哪个水平轴（'x' = 门面在 X 方向展开，门在 XZ 平面上是南北走向的墙） */
export function portalAxis(state: number): 'x' | 'z' {
  return portalAxisIsZ(state) ? 'z' : 'x';
}

// ---------------------------------------------------------------- 信标（K5，批次 117）

/**
 * 信标选中的**主效果**（bits 4-6）与**生命恢复开关**（bit7）。
 *
 * 为什么把玩家的选择写进**方块状态**、而不是另开一张"坐标 → 效果"的表：
 * 状态跟着区块数据一起存档（箱子的战利品表序号、刷怪笼出的生物都是这个理由），
 * 所以"退出重进之后信标还记得你选了什么"不需要多一条存档通道。
 *
 * 下标 `0` 表示"还没选"，`1~5` 与 `world/Beacon.ts` 的 `BEACON_POWERS` 顺序一一对应
 * ——那两处**必须同序**，`test:beacon` 有一条断言盯着它。
 *
 * ⚠️ bits 4-7 与箱子的"战利品表序号"是同一段：这是允许的——**一格只有一种方块**，
 * 状态字节的含义由"那一格放的是什么"决定（沿用文件头那条"各形状族用自己的位"的约定）。
 */
const BEACON_PRIMARY_SHIFT = 4;
const BEACON_PRIMARY_MASK = 0b111;
/** 生命恢复那一位（bit7）：只有三级以上的金字塔能用它 */
const BEACON_REGEN_BIT = 0b1 << 7;

export function beaconPrimary(state: number): number {
  return (state >> BEACON_PRIMARY_SHIFT) & BEACON_PRIMARY_MASK;
}

export function withBeaconPrimary(state: number, index: number): number {
  const mask = BEACON_PRIMARY_MASK << BEACON_PRIMARY_SHIFT;
  return (state & ~mask) | ((index & BEACON_PRIMARY_MASK) << BEACON_PRIMARY_SHIFT);
}

export function beaconRegen(state: number): boolean {
  return (state & BEACON_REGEN_BIT) !== 0;
}

export function withBeaconRegen(state: number, on: boolean): number {
  return on ? state | BEACON_REGEN_BIT : state & ~BEACON_REGEN_BIT;
}

// ---------------------------------------------------------------- 末地传送门框架（K9，批次 111）

/**
 * 这一格末地传送门框架里**有没有插着末影之眼**（bit0）。
 *
 * 借用 `TOP_MASK`：框架是完整立方体（`cube`），不用"上半"那一位——沿用文件开头
 * 那条约定（不同形状族可以共用位）。
 *
 * 为什么值得单独占一位（而不是"眼睛画在贴图里"）：原版那 12 格框架的贴图**本来就分两种**
 * （空的凹槽 / 亮着的眼睛），而"还差几只眼睛"是玩家站在传送门房前唯一要读的信息。
 * 它同时也是激活判据本身（12 格全为真 → 中间 3×3 亮起来，见 `world/EndPortal.ts`）。
 */
const END_PORTAL_EYE_MASK = 0b1;

export function hasEndPortalEye(state: number): boolean {
  return (state & END_PORTAL_EYE_MASK) !== 0;
}

export function withEndPortalEye(state: number, eye: boolean): number {
  return eye ? state | END_PORTAL_EYE_MASK : state & ~END_PORTAL_EYE_MASK;
}

// ---------------------------------------------------------------- 箱子（结构战利品）

/**
 * 箱子装着哪张战利品表（bits 4-7，0 = 没有表 = 玩家自己放的箱子）。
 *
 * 为什么把"表序号"塞进方块状态，而不是另外传一份"箱子 → 表"的清单：
 *  1. 方块状态**本来就会**跟着区块数据从 Worker 传过来、也会进增量存档，
 *     另开一条通道要同时改 Worker 协议 + 存档格式 + 加载流程，三处都可能漏；
 *  2. 结构生成（Worker 里）只需要知道"这一格放哪张表"，不需要碰容器；
 *     容器在主线程按需创建（`LootFill.ts`），跨线程不需要传物品数组。
 *
 * 箱子当前不使用低位（朝向/开关都没做），所以 bits 4-7 是干净的。
 * ⚠️ 以后要是给箱子加上 facing，务必避开这四位。
 *
 * **批次 459 扩展到 6 位（最多 63 张表）**，做法是"高位放 bits 0-1"：
 * 老存档只写了 bits 4-7、低位恒为 0，所以读出来的表号**完全不变**；
 * 新表号 = 低 4 位 | (高 2 位 << 4)。这样不用迁移存档、也不动已有编码。
 * （表数超过 15 时如果直接把 shift 挪到 0，老存档会集体读错——所以选了"加高位"。）
 */
const CHEST_LOOT_SHIFT = 4;
const CHEST_LOOT_MASK = 0b1111 << CHEST_LOOT_SHIFT;
// 高位只能用 bit0：bits 1-3 是 `facing`（`FACING_MASK = 0b11 << 1`）
const CHEST_LOOT_HIGH_SHIFT = 0;
const CHEST_LOOT_HIGH_MASK = 0b1 << CHEST_LOOT_HIGH_SHIFT;
const CHEST_LOOT_MAX = 31;

/** 箱子带的战利品表序号（0 = 没有） */
export function chestLootIndex(state: number): number {
  const low = (state & CHEST_LOOT_MASK) >> CHEST_LOOT_SHIFT;
  const high = (state & CHEST_LOOT_HIGH_MASK) >> CHEST_LOOT_HIGH_SHIFT;
  return low | (high << 4);
}

export function withChestLoot(state: number, index: number): number {
  const clamped = Math.max(0, Math.min(CHEST_LOOT_MAX, index | 0));
  return (
    (state & ~(CHEST_LOOT_MASK | CHEST_LOOT_HIGH_MASK)) |
    ((clamped & 0b1111) << CHEST_LOOT_SHIFT) |
    (((clamped >> 4) & 0b1) << CHEST_LOOT_HIGH_SHIFT)
  );
}

// ---------------------------------------------------------------- 水浸（批次 469）

/**
 * 水浸（`waterlogged`）：bit7。
 *
 * 只给**非整格形状族**（台阶/楼梯/栅栏/墙/活板门/玻璃板/门/栅栏门/告示牌）用：
 * 这些族的 bit7 是空的（台阶的 bit6 是"双层"、门只用到 bit5、雪层则是 bits5-7 全占）。
 * 整格方块与雪层**不支持**含水，`canBeWaterlogged()` 在方块层再兜一道。
 *
 * 为什么选 bit7：状态字节只剩这一个高位，而且上面列的族都没用它。
 */
const WATERLOGGED_MASK = 0b10000000;

/** 这一格是不是"含水"的（只有 `canBeWaterlogged` 的方块才可能为真） */
export function isWaterlogged(state: number): boolean {
  return (state & WATERLOGGED_MASK) !== 0;
}

/** 写含水标记；其余位原样保留 */
export function withWaterlogged(state: number, on: boolean): number {
  return on ? state | WATERLOGGED_MASK : state & ~WATERLOGGED_MASK;
}

// ---------------------------------------------------------------- 洞穴藤蔓（批次 496）

/** 洞穴藤蔓上有没有浆果（bit0）：有浆果才掉发光浆果 */
const CAVE_VINES_BERRIES_MASK = 0b1;

export function caveVinesHaveBerries(state: number): boolean {
  return (state & CAVE_VINES_BERRIES_MASK) !== 0;
}

export function withCaveVinesBerries(state: number, on: boolean): number {
  return on ? state | CAVE_VINES_BERRIES_MASK : state & ~CAVE_VINES_BERRIES_MASK;
}

// ---------------------------------------------------------------- 雪层（B11）

/**
 * 雪层的层数占 bit5-7（与门的"上半格"、台阶的"双层"共用位，见文件开头的说明）。
 * 存的是 **层数 - 1**：0 表示 1 层（刚放下的那一格），7 表示 8 层（满格高度）。
 */
const SNOW_LAYERS_SHIFT = 5;
const SNOW_LAYERS_MASK = 0b111 << SNOW_LAYERS_SHIFT;

/** 雪层最多 8 层（原版），8 层时高度正好是整格 */
export const MAX_SNOW_LAYERS = 8;

/** 雪层有几层（1~8；状态里存的是层数-1，所以这里要 +1） */
export function snowLayers(state: number): number {
  return ((state & SNOW_LAYERS_MASK) >> SNOW_LAYERS_SHIFT) + 1;
}

/** 设置雪层数（自动夹紧到 1~8） */
export function withSnowLayers(state: number, layers: number): number {
  const clamped = Math.max(1, Math.min(MAX_SNOW_LAYERS, Math.round(layers)));
  return (state & ~SNOW_LAYERS_MASK) | ((clamped - 1) << SNOW_LAYERS_SHIFT);
}

/** 雪层的渲染/碰撞高度（层数 / 8） */
export function snowHeight(state: number): number {
  return snowLayers(state) / MAX_SNOW_LAYERS;
}

// ---------------------------------------------------------------- 锁链：轴向
//
// 用 bit0-1：锁链这一族既不用 TOP 也不用 FACING/WALL_MOUNT，直接借低位即可——
// 与文件开头那条约定一致（**不同形状族可以共用位**，因为一个方块只会属于一族）。

/** 柱状方块的轴向：0 = 竖直（Y）、1 = 沿 X、2 = 沿 Z */
export type Axis = 0 | 1 | 2;

const AXIS_MASK = 0b11;

export const AXIS_NAMES: readonly string[] = ['竖直', '沿 X', '沿 Z'];

export function axisOf(state: number): Axis {
  return (state & AXIS_MASK) as Axis;
}

export function withAxis(state: number, axis: Axis): number {
  return (state & ~AXIS_MASK) | (axis & AXIS_MASK);
}

// ---------------------------------------------------------------- 藤蔓：五个挂面
//
// 位分配：bit0-3 = 北(-Z) / 东(+X) / 南(+Z) / 西(-X)，bit4 = 顶面（挂在天花板底下）。
// 藤蔓这一族不用 TOP/FACING/WALL_MOUNT，所以这 5 位都可以借。
//
// ⚠️ 语义："挂着北面"＝藤蔓贴在格子的北侧（墙在自己的北边），
// 与 `Facing` 的方向语义一致（0=北、1=东、2=南、3=西）。

const VINE_BIT_BY_FACING: readonly number[] = [0b1, 0b10, 0b100, 0b1000];
const VINE_UP_BIT = 0b10000;

export function hasVineSide(state: number, facing: Facing): boolean {
  return (state & VINE_BIT_BY_FACING[facing]!) !== 0;
}

export function withVineSide(state: number, facing: Facing, on = true): number {
  const bit = VINE_BIT_BY_FACING[facing]!;
  return on ? state | bit : state & ~bit;
}

export function hasVineUp(state: number): boolean {
  return (state & VINE_UP_BIT) !== 0;
}

export function withVineUp(state: number, on = true): number {
  return on ? state | VINE_UP_BIT : state & ~VINE_UP_BIT;
}

/** 挂了几个面（0 = 什么都不挂，这样的藤蔓随时该消失） */
export function vineSideCount(state: number): number {
  let count = hasVineUp(state) ? 1 : 0;
  for (const bit of VINE_BIT_BY_FACING) if ((state & bit) !== 0) count++;
  return count;
}

/** 全部水平挂面（渲染与"该不该消失"的判定用） */
export function vineSides(state: number): readonly Facing[] {
  const out: Facing[] = [];
  for (let facing = 0; facing < 4; facing++) {
    if ((state & VINE_BIT_BY_FACING[facing]!) !== 0) out.push(facing as Facing);
  }
  return out;
}

/** 这个状态里有没有"挂着北/东/南/西/顶"其中任意一面 */
export function hasAnyVineSide(state: number): boolean {
  return vineSideCount(state) > 0;
}

// ---------------------------------------------------------------- 漏斗（批次 58）

/**
 * **六向朝向**：朝上 / 朝下 + 四个水平方向（投掷器与发射器用）。
 *
 * 一个状态只有 8 位，而 `FACING` 只占 2 位（4 个方向），所以竖直的两档只能借
 * **bit0（`TOP_MASK`）**——借法与文件开头那条约定一致（不同形状族可以共用位）：
 *
 *   top = 0 + FACING    → 朝北 / 东 / 南 / 西
 *   top = 1 + FACING=0  → **朝下**
 *   top = 1 + FACING=1  → **朝上**
 *   （top = 1 + FACING=2/3 是空闲组合，别用）
 *
 * ⚠️ 漏斗（5 向：没有朝上）**共用这套编码**，它的 `hopperOutput*` 三个函数就是
 * 这里的薄包装——两族方块都借 bit0 表示"朝下"，所以漏斗的存档与状态语义没变。
 * `describeState` 也按这套读，调试面板上看到的是"朝下 / 朝东"而不是"上半"。
 */
export type SixFacing = 'up' | 'down' | Facing;

export function sixFacingOf(state: number): SixFacing {
  if ((state & TOP_MASK) === 0) return facingOf(state);
  return facingOf(state) === 1 ? 'up' : 'down';
}

export function withSixFacing(state: number, facing: SixFacing): number {
  if (facing === 'up') return withFacing(state | TOP_MASK, 1);
  if (facing === 'down') return withFacing(state | TOP_MASK, 0);
  return withFacing(state & ~TOP_MASK, facing);
}

/** 朝向的单位偏移（搬运/射出/几何三处共用，别再各写一份） */
export function sixFacingOffset(facing: SixFacing): readonly [number, number, number] {
  switch (facing) {
    case 'up':
      return [0, 1, 0];
    case 'down':
      return [0, -1, 0];
    case 0:
      return [0, 0, -1]; // 北
    case 1:
      return [1, 0, 0]; // 东
    case 2:
      return [0, 0, 1]; // 南
    default:
      return [-1, 0, 0]; // 西
  }
}

/** 六向朝向的**对面**（侦测器的"眼"与"红点"用得上：看的那面与输出那面） */
export function sixFacingOpposite(facing: SixFacing): SixFacing {
  switch (facing) {
    case 'up':
      return 'down';
    case 'down':
      return 'up';
    case 0:
      return 2;
    case 1:
      return 3;
    case 2:
      return 0;
    default:
      return 1;
  }
}

export const SIX_FACING_NAMES: Readonly<Record<SixFacing, string>> = {
  up: '朝上',
  down: '朝下',
  0: '朝北',
  1: '朝东',
  2: '朝南',
  3: '朝西',
};

/** 竖直两档的判定（投掷器/发射器"往下倒"与"往上抛"是两条不同的落点规则） */
export function isVerticalFacing(facing: SixFacing): boolean {
  return facing === 'up' || facing === 'down';
}

/**
 * 漏斗的输出方向（H14 的第一件容器类功能方块）。
 *
 * 原版有 **5 个**朝向（朝下 + 四个水平方向）——就是上面六向去掉"朝上"，
 * 编码完全共用，所以这里只是把 `up` 折回 `down` 的薄包装。
 * 顺带记着：bit3（`POWERED`）表示被红石**锁定**（通着电的漏斗既不推也不吸）。
 */
export type HopperOutput = 'down' | Facing;

export function hopperOutputOf(state: number): HopperOutput {
  const output = sixFacingOf(state);
  return output === 'up' ? 'down' : output;
}

export function withHopperOutput(state: number, output: HopperOutput): number {
  return withSixFacing(state, output);
}

export function hopperOutputOffset(output: HopperOutput): readonly [number, number, number] {
  return sixFacingOffset(output);
}

export const HOPPER_OUTPUT_NAMES: Readonly<Record<'down' | 0 | 1 | 2 | 3, string>> = {
  down: '朝下',
  0: '朝北',
  1: '朝东',
  2: '朝南',
  3: '朝西',
};

/**
 * 被红石锁定的漏斗（原版行为：通着电就**既不推也不吸**）。
 * 状态位与拉杆/红石灯的 `POWERED` 共用——引擎只负责判定"这里通电了"。
 */
export function isHopperLocked(state: number): boolean {
  return isPowered(state);
}

export function withHopperLocked(state: number, locked: boolean): number {
  return withPowered(state, locked);
}

// ---------------------------------------------------------------- 床（B13，批次 79）

/**
 * 这一格是**床头**还是床脚（bit3）。
 *
 * 与门的 OPEN / 拉杆的 POWERED 共用 bit3：它们是不同的形状族，
 * 同一个方块只会是其中一种（沿用本文件开头那条设计）。
 *
 * 朝向（哪一格是床头）用通用的 `facing` 两位：`facing` 指向**床头那一侧**。
 * 两半共用同一个 `facing`，所以"另一半在哪"只看 `(x,z) + FACING_OFFSET[facing]`
 * 就能算出来——这也是 `bedOtherHalf` 能是纯函数的原因。
 */
const BED_HEAD_MASK = 0b1000;

export function isBedHead(state: number): boolean {
  return (state & BED_HEAD_MASK) !== 0;
}

export function withBedHead(state: number, head: boolean): number {
  return head ? state | BED_HEAD_MASK : state & ~BED_HEAD_MASK;
}

/**
 * 床的"另一半"在哪个格子（纯函数，离线可断言）。
 *
 * 语义：`facing` 指向**床头**那一侧，所以
 *  - 站在床脚上：另一半（床头）在 `facing` 方向；
 *  - 站在床头上：另一半（床脚）在 `facing` 的反方向。
 *
 * 传入脏数据（`state` 里的朝向越界）时按朝北算——注册表里 `facing` 只有 2 位，
 * 越界值只可能来自被改坏的存档，取一个确定的结果好过抛错。
 */
export function bedOtherHalf(
  x: number,
  y: number,
  z: number,
  state: number,
): readonly [number, number, number] {
  const [dx, dz] = FACING_OFFSET[facingOf(state)] ?? FACING_OFFSET[0]!;
  // 床头在 facing 方向：站床头就反着走
  const sign = isBedHead(state) ? -1 : 1;
  return [x + dx * sign, y, z + dz * sign];
}

/** 床脚那一半的坐标（不管传进来的是哪一半） */
export function bedFootPos(
  x: number,
  y: number,
  z: number,
  state: number,
): readonly [number, number, number] {
  return isBedHead(state) ? bedOtherHalf(x, y, z, state) : [x, y, z];
}

// ---------------------------------------------------------------- 画（B14，批次 86）

/**
 * "墙上挂的是哪一幅画"占 **bit3-5**。
 *
 * 借用 bit3（`POWERED` / `WALL_MOUNT`）与 bit4-5：画属于**自己的形状族**
 * （一个方块只会是画，不会同时是门/雪层/红石元件），沿用文件开头那条设计。
 *
 * 7 幅用不满 8 档，但上限按 `PAINTING_VARIANT_LIMIT` 夹住而不是按掩码——
 * 表以后长到第 9 幅时，`withPaintingVariant` 会当场夹回 7，
 * 而不是悄悄把状态溢到别的字段上（那种 bug 表现为"画着画着变成另一幅"）。
 */
const PAINTING_VARIANT_SHIFT = 3;
const PAINTING_VARIANT_MASK = 0b111 << PAINTING_VARIANT_SHIFT;

/** 这一格挂的是第几幅画（0 起的下标，对应 `PAINTING_VARIANTS`） */
export function paintingVariantOf(state: number): number {
  return (state & PAINTING_VARIANT_MASK) >> PAINTING_VARIANT_SHIFT;
}

/** 写"挂第几幅画"（夹到表的合法范围） */
export function withPaintingVariant(state: number, index: number): number {
  const clamped = Math.max(0, Math.min(PAINTING_VARIANT_LIMIT - 1, Math.floor(index) || 0));
  return (state & ~PAINTING_VARIANT_MASK) | (clamped << PAINTING_VARIANT_SHIFT);
}

// ---------------------------------------------------------------- 调试

export function describeState(shape: BlockShape, state: number): string {
  switch (shape) {
    case 'slab':
      return isTop(state) ? '上半' : '下半';
    case 'stairs':
      return `${FACING_NAMES[facingOf(state)]}${isTop(state) ? '·上半' : ''}`;
    case 'torch':
      return isWallMounted(state) ? `挂墙·${FACING_NAMES[facingOf(state)]}` : '落地';
    case 'lantern':
      return '落地';
    case 'ladder':
      return `贴·${FACING_NAMES[facingOf(state)]}`;
    case 'door':
      return `${FACING_NAMES[facingOf(state)]}${isDoorUpper(state) ? '·上' : '·下'}${isDoorOpen(state) ? '·开' : '·关'}`;
    case 'trapdoor':
      return `贴${FACING_NAMES[facingOf(state)]}${isTop(state) ? '·上半' : '·下半'}${isTrapdoorOpen(state) ? '·开' : '·关'}`;
    case 'fence_gate':
      return `${FACING_NAMES[facingOf(state)]}${isFenceGateOpen(state) ? '·开' : '·关'}`;
    case 'snow':
      return `${snowLayers(state)} 层`;
    case 'chain':
      return AXIS_NAMES[axisOf(state)] ?? '';
    case 'vine': {
      const sides: string[] = vineSides(state).map((facing) => FACING_NAMES[facing]);
      if (hasVineUp(state)) sides.push('顶');
      return sides.length > 0 ? `挂${sides.join('/')}` : '悬空（应当消失）';
    }
    case 'cake':
      return `已吃 ${cakeBites(state)} 片`;
    case 'flower_pot': {
      const plant = flowerPotPlant(state);
      return plant === 0 ? '空盆' : `种着第 ${plant} 种植物`;
    }
    case 'daylight_detector':
      return `${isInverted(state) ? '反向（天黑通电）' : '白天通电'}·${isPowered(state) ? '正在输出' : '没有输出'}`;
    case 'tripwire':
      return `${isDisarmed(state) ? '已剪断' : '待触发'}·${isPowered(state) ? '已触发' : '没触发'}`;
    case 'tripwire_hook':
      return `${FACING_NAMES[tripwireWireDirection(state)]}向的线·${isTripwireAttached(state) ? '已接上' : '没接上'}·${isPowered(state) ? '有信号' : '没信号'}`;
    case 'hopper':
      return `${HOPPER_OUTPUT_NAMES[hopperOutputOf(state)]}${isHopperLocked(state) ? '·已锁定' : ''}`;
    case 'dropper':
      // 投掷器没有"锁定"这回事：通电就吐一件，断电什么也不做
      return SIX_FACING_NAMES[sixFacingOf(state)];
    case 'dispenser':
      // 发射器（批次 60）：与投掷器同一套状态（朝向 + 通电位），读法也就一样
      return SIX_FACING_NAMES[sixFacingOf(state)];
    case 'bed':
      return `${isBedHead(state) ? '床头' : '床脚'}·床头朝${FACING_NAMES[facingOf(state)]}`;
    case 'sign':
      // 告示牌（批次 80）：站牌 / 挂墙牌 + 字朝哪边
      return `${isWallMounted(state) ? '挂墙' : '落地'}·字朝${FACING_NAMES[facingOf(state)]}`;
    case 'item_frame':
      // 展示框（B14，批次 86）：贴在朝向那一面墙上
      return `贴${FACING_NAMES[facingOf(state)]}墙`;
    case 'painting':
      // 画（B14）：贴墙 + 挂的是哪一幅
      return `贴${FACING_NAMES[facingOf(state)]}墙·${paintingName(paintingVariantOf(state))}`;
    default:
      return '';
  }
}

const FACING_NAMES = ['北', '东', '南', '西'] as const;

// ---------------------------------------------------------------- 音符盒（批次 173，G9）
//
// 音高是 **0~24 共 25 档**（原版：每档一个半音），存在**低 5 位**里。
// 与堆肥桶的等级同一个套路：一个方块用不着为此开方块实体；
// 而"音高"不是画出来的（贴图不随它变），所以网格化那边完全不用管它。

/** 音符盒的最高音高（原版 24 档，加上 0 一共 25 个音） */
export const NOTE_BLOCK_MAX_PITCH = 24;

/** 音高占低 5 位（0~24，31 够用） */
const NOTE_PITCH_MASK = 0b11111;

export function notePitchOf(state: number): number {
  return state & NOTE_PITCH_MASK;
}

/**
 * 写入音高（夹到 0~24）。
 *
 * ⚠️ 与堆肥桶/蛋糕同一条：夹到**合法范围**而不是掩码上限——超过 24 的音高
 * 不是一个合法状态，真出现说明有代码忘了在这里拦。
 */
export function withNotePitch(state: number, pitch: number): number {
  const clamped = Math.max(0, Math.min(NOTE_BLOCK_MAX_PITCH, Math.floor(pitch)));
  return (state & ~NOTE_PITCH_MASK) | clamped;
}

/** 右键换下一档音高（最高音之后再点回到最低音） */
export function nextNotePitch(state: number): number {
  return (notePitchOf(state) + 1) % (NOTE_BLOCK_MAX_PITCH + 1);
}

/**
 * 音高 → 频率（Hz）。
 *
 * 原版 0 号音是 **F#3 ≈ 185Hz**，之后每一档升一个半音（`2^(1/12)`）——
 * 于是 24 号大概落在 740Hz（F#5）。这个函数是纯的，音符盒与测试共用它。
 */
export function noteFrequency(pitch: number): number {
  const clamped = Math.max(0, Math.min(NOTE_BLOCK_MAX_PITCH, pitch));
  return 185 * Math.pow(2, clamped / 12);
}

// ---------------------------------------------------------------- 炼药锅（批次 176，G13）
//
// 水位是 **0~3 级**（原版炼药锅正好 3 级满），存在**低 2 位**里。
// 与堆肥桶/音符盒同一个套路：不需要方块实体，也不进容器表；
// 贴图按"有没有水"切换（`cauldron_top` / `cauldron_water`），所以网格化那边只认状态位。

/** 炼药锅要几级才满（原版 3） */
export const CAULDRON_MAX_LEVEL = 3;

/** 水位占低 2 位 */
const CAULDRON_LEVEL_MASK = 0b11;

export function cauldronLevelOf(state: number): number {
  return state & CAULDRON_LEVEL_MASK;
}

/** 写入水位（夹到 0~3，不是夹到掩码上限 3——这里正好一样，但语义要统一） */
export function withCauldronLevel(state: number, level: number): number {
  const clamped = Math.max(0, Math.min(CAULDRON_MAX_LEVEL, Math.floor(level)));
  return (state & ~CAULDRON_LEVEL_MASK) | clamped;
}

/**
 * 锅里装的是**岩浆**而不是水（批次 177，G13 收尾）：用第 3 位标记。
 *
 * 为什么不另开一个方块 id：原版岩浆锅就是"同一个锅 + 另一种内容物"，
 * 而我们的状态位本来就只用掉了低 2 位；多开一个 id 会让 `cauldronLevelOf` 这类读法
 * 在两处各写一遍（"这个锅是水的还是岩浆的"要在每个调用点判断）。
 */
const CAULDRON_LAVA_MASK = 0b100;

export function isLavaCauldron(state: number): boolean {
  return (state & CAULDRON_LAVA_MASK) !== 0;
}

export function withCauldronLava(state: number, lava = true): number {
  return lava ? state | CAULDRON_LAVA_MASK : state & ~CAULDRON_LAVA_MASK;
}

/**
 * 锅里装的是**细雪**（批次 559）：用第 4 位标记。
 *
 * 细雪锅是满的（3 级），但**舀不出水瓶**、也不接雨；空桶能把它舀成细雪桶。
 * 与岩浆标记同一条做法：共用方块 id，靠状态位区分内容物。
 */
const CAULDRON_POWDER_SNOW_MASK = 0b1000;

export function isPowderSnowCauldron(state: number): boolean {
  return (state & CAULDRON_POWDER_SNOW_MASK) !== 0;
}

export function withCauldronPowderSnow(state: number, powderSnow = true): number {
  return powderSnow ? state | CAULDRON_POWDER_SNOW_MASK : state & ~CAULDRON_POWDER_SNOW_MASK;
}
