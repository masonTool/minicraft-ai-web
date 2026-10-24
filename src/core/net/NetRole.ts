/**
 * 联机角色：`solo` / `host` / `client`（L8 房主权威）
 *
 * 为什么单独一个文件：这一批之后**世界只由一个人模拟**——房主。于是"我该不该跑
 * 红石、实体 AI、容器计时"全部退化成同一个问题："我是什么角色"。这个判断必须是
 * 唯一一处（`SimMode` 直接读它），散在二三十个 `if` 里就一定会有一处漏掉，
 * 表现是"某一端某样东西还在自己动"，而这种 bug 只能靠两个人对着屏幕看半天才发现。
 *
 * 这里只放**身份**，不放行为：谁是房主由服务端在 `join` / `welcome` 里说了算
 * （`server/index.mjs` 的 `hosts`），客户端不自己猜。具体"什么角色跑什么"
 * 收敛在 `core/net/SimMode.ts`。
 *
 * 三个角色：
 *   · `solo`   —— 没连服务器（单机）。**行为必须与加这一批之前完全一致**；
 *   · `host`   —— 联机里唯一模拟世界的人；
 *   · `client` —— 联机里只渲染：本地生成地形，但不推进模拟。
 *
 * ⚠️ 玩家位置**不**参与角色判定：位置仍然各端自跑（用户已拍板，房主不替别人跑物理）。
 * 角色只决定"世界模拟"，不决定"我这个身体怎么动"。
 */

/** 联机角色 */
export type NetRole = 'solo' | 'host' | 'client';

/**
 * 角色迁移事件。
 *
 * 只留两个：**连上**（`welcome` 已经到了，身份确定）与**离开**（退回单机）。
 * 重连不单列——重连成功后仍然是一条 `joined`，`isHost` 用服务端给的那份，
 * 客户端不保留"上次我是房主"这种本地记忆（房主位可能已经让给别人了）。
 */
export type RoleEvent = { type: 'joined'; isHost: boolean } | { type: 'left' };

/** 初始角色：没进联机会话之前一律按单机算（单机行为是这一批的回归基线） */
export const INITIAL_ROLE: NetRole = 'solo';

/**
 * 状态迁移（纯函数，不改入参）。
 *
 * 刻意做成"任何角色 + 任何事件都有结果"的表：`host` 直接 `joined` 成 `client`
 * （比如重新加入别人的房间）是合法迁移，不需要先回 `solo`——现实中它就是这样发生的。
 */
export function nextRole(role: NetRole, event: RoleEvent): NetRole {
  switch (event.type) {
    case 'joined':
      return event.isHost ? 'host' : 'client';
    case 'left':
      return 'solo';
    default:
      return role;
  }
}

/**
 * 把 `welcome` 里的房主标记读成角色。
 *
 * **严格等于 `true`**：服务端用的也是 `message.host === true`，两边的宽松度要一致；
 * 把 `'false'` / `1` / 缺字段当成"我是房主"会让两端同时模拟——正是这一批要消灭的
 * 那种不一致，而且它不会报错，只会悄悄多算一遍世界。
 */
export function roleFromWelcome(welcome: { isHost?: unknown } | null | undefined): NetRole {
  return welcome?.isHost === true ? 'host' : 'client';
}
