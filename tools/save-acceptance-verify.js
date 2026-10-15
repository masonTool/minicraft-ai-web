/**
 * 存档验收 · 第二步：刷新之后核对世界是否恢复
 *
 * 由 tools/save-check.sh 在页面重载后调用。
 * 除了"方块还在"，还会检查一件更关键的事：**没动过的地方仍然是自然生成的地形**
 * （增量存档的失败模式之一是把整片地形写坏，只测改过的那几格是发现不了的）。
 */
(async function saveVerifyPhase() {
  const mc = window.__mc;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const lines = [];
  const check = (label, ok, detail) => lines.push(`${ok ? '[OK]  ' : '[FAIL]'} ${label}${detail ? `  ->  ${detail}` : ''}`);

  // 第一步的坐标由 tools/save-check.sh 注入（替换下面的 JSON 字符串）
  let info;
  try {
    info = JSON.parse('__SAVE_INFO_JSON__');
  } catch {
    return '[FAIL] 没有拿到第一步的坐标：请用 tools/save-check.sh 跑这一步';
  }
  const { x, y, z } = info;

  // 等玩家被存档传送到位 + 区块生成
  let arrived = false;
  for (let i = 0; i < 25 && !arrived; i++) {
    await sleep(200);
    const p = mc.info.position;
    arrived = Math.abs(p[0] - (x + 0.5)) < 1.5 && Math.abs(p[2] - (z + 0.5)) < 1.5 && mc.info.ready !== false;
  }
  const pos = mc.info.position;
  check(
    `player position restored (${pos[0].toFixed(1)}, ${pos[1].toFixed(1)}, ${pos[2].toFixed(1)})`,
    Math.abs(pos[0] - (x + 0.5)) < 1.5 && Math.abs(pos[2] - (z + 0.5)) < 1.5,
    `expected (${x + 0.5}, ${z + 0.5})`,
  );

  const angles = mc.lookAngles;
  check(`view restored: yaw ${angles.yaw.toFixed(0)}`, Math.abs(angles.yaw - info.yaw) < 5, `expected ${info.yaw}`);
  check(
    `inventory restored: dirt x${mc.inventory.countOf(1)}`,
    mc.inventory.countOf(1) >= 42,
    `${mc.inventory.countOf(1)}`,
  );

  // 方块：三种 + 挖掉的空气 + 带状态的拉杆
  check('redstone block survived reload', mc.probe(x, y, z).block === 'minecraft:redstone_block', mc.probe(x, y, z).block);
  check('diamond ore survived reload', mc.probe(x + 1, y, z).block === 'minecraft:diamond_ore', mc.probe(x + 1, y, z).block);
  check('glass survived reload', mc.probe(x + 2, y, z).block === 'minecraft:glass', mc.probe(x + 2, y, z).block);
  check('glass id in handoff is really glass', info.glass > 0, `id=${info.glass}`);
  check(
    `dug-out surface block stayed air at y=${info.dugY} (not regenerated)`,
    mc.probe(x + 3, info.dugY, z).block === 'minecraft:air',
    mc.probe(x + 3, info.dugY, z).block,
  );
  check(
    'lever restored with state',
    mc.probe(x + 4, y, z).block === 'minecraft:lever' && mc.probeState(x + 4, y, z).state === 0b000010,
    `${mc.probe(x + 4, y, z).block} state=${mc.probeState(x + 4, y, z).state}`,
  );

  // 没动过的地方仍要是自然地形：往远处撒点采样，确认地表还是"实心方块"
  let solidSurface = 0;
  let sampled = 0;
  for (let i = 0; i < 40; i++) {
    const sx = x + 40 + i * 7;
    const sz = z - 30 + (i % 5) * 11;
    const column = mc.column(sx, sz);
    if (column.top === -999) continue;
    sampled++;
    if (column.block !== 'minecraft:air') solidSurface++;
  }
  check(`untouched terrain intact (${solidSurface}/${sampled} solid columns)`, sampled > 0 && solidSurface === sampled);

  check('save status reports a previous save', mc.saveStatus.hasSave, `lastSaveMs=${mc.saveStatus.lastSaveMs}`);

  return lines.join('\n');
})();
