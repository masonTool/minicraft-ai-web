/**
 * 移动端长跑采样（M17 的一部分）：一次采样，由 tools/mobile-soak.sh 定时调用
 *
 * 为什么要在意"长跑"：真机验收里最难代替的一项就是"长时间游玩后会不会越来越卡/吃内存"。
 * 发热与耗电只能在真机上量，但**内存泄漏**可以在桌面浏览器里用同一套代码路径复现——
 * 只要让它连续跑十几分钟并定期采样堆大小与帧率，就能看出趋势。
 */
(function soakSample() {
  const mc = window.__mc;
  const memory = performance.memory;
  const info = mc.info;
  const settings = mc.settingsState;
  // 输出 key=value 而不是 JSON：playwright-cli 的返回是转义过的 JSON 字符串，
  // 在 shell 里用 grep 提取很别扭，换成 key=value 直接就能读
  const status = mc.saveStatus;
  return [
    `heap=${memory ? (memory.usedJSHeapSize / 1048576).toFixed(1) : 'n/a'}MB`,
    `fps=${info.fps}`,
    `chunks=${info.chunks}`,
    `tri=${info.triangles}`,
    `ent=${info.entities}`,
    `view=${settings.viewDistance}`,
    `edits=${status.edits}`,
    `editChunks=${status.editedChunks}`,
    `pending=${status.pendingChunks}`,
    `pos=${info.position.map((value) => Math.round(value)).join('/')}`,
  ].join(' ');
})();
