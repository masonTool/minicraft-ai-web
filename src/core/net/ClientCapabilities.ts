/**
 * 客户端能力位（L9 本批）。
 *
 * 回答的是"这个客户端除了当玩家，还能不能当服务器"。web 版不能：浏览器起不了监听
 * socket、也拿不到局域网广播；安卓/iOS 客户端内建服务器之后才能。
 *
 * 为什么需要它（用户 2026-10-26）：「允许其它人建房」那个开关是**客户端能力**，
 * 不是服务端策略——客户端无权决定服务端允不允许别人开房。能力为 false 的客户端
 * 整项不渲染，免得玩家去点一个永远无效的开关。
 *
 * 接法：原生客户端里把 `localServer` 改 true 即可，面板会自动多出「本机」那一区，
 * 不需要改 UI 代码。
 */

export interface ClientCapabilities {
  /** 能不能在本机起联机服务端（安卓/iOS 客户端内建服务器） */
  localServer: boolean;
}

/**
 * 当前客户端能力。
 *
 * 现在恒为 `false`：仓库里只有 web 版。这里不读 UA、也不做能力探测——"能不能起服务端"
 * 是构建目标决定的，不是运行时能试出来的（试出来之前已经要监听端口了）。
 */
export function clientCapabilities(): ClientCapabilities {
  return { localServer: false };
}
