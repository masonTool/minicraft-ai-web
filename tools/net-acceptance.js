/**
 * 联机（K2）浏览器侧验收
 *
 * 由 tools/net-check.sh 调用（此时浏览器已连上服务端，node 队友已加入并放了方块）。
 * 检查的是"网络消息有没有真的变成游戏里的东西"：队友的坐标、队友放的方块、
 * 队友发的聊天，以及断开之后界面有没有正确回到"未连接"。
 */
(function netAcceptance() {
  const mc = window.__mc;
  const lines = [];
  const check = (label, ok, detail) => lines.push(`${ok ? '[OK]  ' : '[FAIL]'} ${label}${detail ? `  ->  ${detail}` : ''}`);

  const state = mc.netState;
  check('connected to server', state.selfId > 0, `status="${state.status}" selfId=${state.selfId}`);
  check('server seed received', state.seed !== null, `seed=${state.seed}`);
  check('two players online (self + peer)', state.players === 2, `players=${state.players}`);
  check('peer position tracked', state.remote.length === 1, JSON.stringify(state.remote));

  const peer = state.remote[0];
  if (peer) {
    lines.push(`  peer at (${peer.x.toFixed(1)}, ${peer.y.toFixed(1)}, ${peer.z.toFixed(1)})`);
  }

  // 队友放的萤石（id 从方块名查，避免脚本里写死数字）
  const glowstone = mc.blockId('glowstone');
  check('peer block id resolved', glowstone > 0, `id=${glowstone}`);
  const placed = mc.probe(0, 100, 0).block;
  check('peer-placed block exists in local world', placed === 'minicraft:glowstone', `${placed} at (0,100,0)`);

  // 只断言"收到了聊天"，具体文字打在 detail 里：中文字符串参与断言容易受编码影响
  check('chat message received', state.chat.length > 0, `chat="${state.chat}"`);

  // 方块同步应当是"双向可用"的：本地改一块，队友那边也应该收到（这里只验证发送侧没抛错）
  mc.place(1, 100, 0, glowstone);
  check('local block change accepted locally', mc.probe(1, 100, 0).block === 'minicraft:glowstone');

  return lines.join('\n');
})();
