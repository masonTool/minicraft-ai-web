/**
 * Android 返回键 / 侧滑返回 = 关界面（批次 96，对齐基岩版）
 *
 * 手机上**没有 Esc 键**：原来关界面只有"点空白处"一条路（见 M-mobile 的说明），
 * 而系统级的手势/返回键会直接**退出页面**（PWA 里等于退出游戏）——想关个背包
 * 反而把游戏关了，这是手机玩家最容易被劝退的一处。
 *
 * 做法：界面打开时往历史里压一条状态（这样"返回"先落到我们手里），
 * 收到 `popstate` 就关掉**最上面那一层**界面；如果下面还有界面开着，就再压一条
 * （于是"连按返回"是逐层退出界面），全部关完之后才把守卫撤掉——那时再按返回
 * 才是浏览器该干的事（退出页面）。
 *
 * ⚠️ 浏览器历史只能注入（`pushState` / `back` 两个回调）：Node 里没有 `window.history`，
 * 而"逐层退出"这条逻辑**必须能离线断言**——它对用户是"按错了就退出游戏"，
 * 靠手测太贵。
 */

export interface BackButtonHost {
  /** 往历史里压一条状态（`history.pushState`） */
  pushState: () => void;
  /** 退回一格（`history.back`） */
  back: () => void;
  /**
   * 关掉最上面那一层界面；返回"关掉之后**还有没有**界面开着"。
   *
   * 返回布尔值而不是让调用方自己再查一遍：中间的判断（哪一层在上面）只有它知道。
   */
  closeTopUi: () => boolean;
}

export class BackButton {
  /** 我们压过一条状态、还没弹掉 */
  private guarded = false;
  /** 上一帧对账时的"有没有界面开着"（只在**变化**时动手） */
  private lastSynced = false;

  constructor(private readonly host: BackButtonHost) {}

  /**
   * 每帧对一次账（主循环调用）。
   *
   * 为什么用对账而不是在"每个面板的打开/关闭处各调一次"：面板有六个
   *（告示牌 / 聊天 / 配方书 / 成就 / 背包 / 设置），而它们的关闭路径更多
   *（点空白、点按钮、切换物品、被别处挤掉）。**漏掉一处就是"返回键突然失灵"**，
   * 而轮询只有一个调用点（与 `VillagePopulation`/`SignText` 那两处"定期对账"同一个理由）。
   */
  sync(uiOpen: boolean): void {
    if (uiOpen === this.lastSynced) return;
    this.lastSynced = uiOpen;
    if (uiOpen) {
      if (this.guarded) return;
      this.guarded = true;
      this.host.pushState();
      return;
    }
    if (!this.guarded) return;
    // 界面是玩家自己关的（点空白/点按钮）→ 把我们压的那条状态收回去，
    // 否则历史里会攒下一堆"假条目"，玩家以后再按返回会发现"按好几下才退得出去"
    this.guarded = false;
    this.host.back();
  }

  /** 浏览器的返回键 / 侧滑返回 */
  onBrowserBack(): void {
    if (!this.guarded) return; // 没界面开着 → 不拦，交给浏览器（= 退出页面）
    const stillOpen = this.host.closeTopUi();
    if (stillOpen) {
      // 下面还有界面（例如"背包里点开了配方书"）→ 继续守着，让下一次返回还能用
      this.host.pushState();
      this.lastSynced = true;
      return;
    }
    this.guarded = false;
    this.lastSynced = false;
  }

  /**
   * 离开世界时把我们压的那条历史收回去（批次 181）。
   *
   * 不做这一步的话，回到主菜单后玩家按返回会先退到一条"假记录"，
   * 看着像"返回键没反应"——而那条记录本来是给局内面板用的。
   */
  reset(): void {
    if (!this.guarded) return;
    this.guarded = false;
    this.lastSynced = false;
    this.host.back();
  }

  /** 现在有没有压着一条守卫状态（调试与断言用） */
  get isGuarded(): boolean {
    return this.guarded;
  }
}
