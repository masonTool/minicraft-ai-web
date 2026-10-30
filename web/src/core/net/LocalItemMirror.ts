/**
 * 掉落物镜像的"被捡走"处理（联机 21 的客户端侧）。
 *
 * ## 背景
 *
 * 掉落物分两种，各存一张表：
 *   · `localNetItems`：**自己**生成的堆（`ItemEntity → localId`），本地权威；
 *   · `remoteItems`：**别人**生成的堆的镜像，键是 `ownerId:localId`。
 *
 * 别人捡走**我**那堆时，服务端会 `broadcast(item-remove)` 给房里所有人（**含我**）。
 * 客户端以前只查 `remoteItems`，自己那份在 `localNetItems` 里查不到就直接 return——
 * 于是本机仍看得见那堆、还能再捡一次，两边各得一份（2026-10-30 用户报的物品重复）。
 *
 * ## 为什么抽成纯函数
 *
 * 这段逻辑藏在 `App` 这个几千行的类里，只能靠两台设备手工复现。抽出来之后
 * `tests/local-item-mirror.test.ts` 能直接断言"命中即删表 + 标记死亡"，
 * 而"删表"这一步是必须的——只 `dead = true` 不摘表的话，`syncNetItems`
 * 会发现"这堆不见了"又回发一条 `item-remove`（服务端会忽略，但白跑一趟）。
 */

/** 只要能标记死亡就够了：不依赖 `ItemEntity`，测试里给个最小对象即可 */
export interface KillableItem {
  dead: boolean;
}

/**
 * 按 `localId` 找到自己那堆并标记死亡。
 *
 * @returns 找到并处理掉的那个实体；没找到返回 `null`
 */
export function killLocalItemByLocalId<K extends KillableItem>(
  items: Map<K, number>,
  localId: number,
): K | null {
  for (const [entity, id] of items) {
    if (id !== localId) continue;
    // 先摘表再置 dead：顺序反过来的话，扫描逻辑会把它当成"刚消失的本地堆"再广播一次
    items.delete(entity);
    entity.dead = true;
    return entity;
  }
  return null;
}
