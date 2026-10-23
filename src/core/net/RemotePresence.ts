/**
 * 远端玩家"在哪个维度"的小表（联机3）。
 *
 * 为什么需要它：远端玩家不是实体（不进 `EntityManager`，也不跑物理），
 * 主程序每帧拿一份 `remotePlayers` 直接喂给生物渲染器。而网络消息里的维度
 * 原来被丢掉了——于是队友走进下界之后，你主世界同坐标会站着一个"分身"。
 *
 * 单独成类而不是在主程序里塞一个 Map：可见性判定要能离线断言
 * （`tests/net-remote-dimension.test.ts`），主程序只负责"每帧问一句"。
 */

export class RemotePresence {
  private readonly dimensions = new Map<number, string>();

  set(id: number, dimension: string): void {
    this.dimensions.set(id, dimension);
  }

  remove(id: number): void {
    this.dimensions.delete(id);
  }

  clear(): void {
    this.dimensions.clear();
  }

  dimensionOf(id: number): string | undefined {
    return this.dimensions.get(id);
  }

  /**
   * 这个远端玩家在当前维度该不该画。
   *
   * **没有记录时按"可见"处理**：旧服务端（协议 v0）不带 dimension，
   * 那种情况下"藏起来"会让队友凭空消失；宁可多画一个，也不要静默丢人。
   */
  visible(id: number, dimension: string): boolean {
    const remote = this.dimensions.get(id);
    return remote === undefined || remote === dimension;
  }
}
