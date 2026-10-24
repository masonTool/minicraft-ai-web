/**
 * 存档验收 · 第一步：改世界 → 保存 → 记住坐标
 *
 * 由 tools/save-check.sh 调用；它会把测试坐标写进 localStorage，
 * 供刷新后的第二步（save-acceptance-verify.js）核对。
 */
(async function saveWritePhase() {
  const mc = window.__mc;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const lines = [];
  const check = (label, ok, detail) => lines.push(`${ok ? '[OK]  ' : '[FAIL]'} ${label}${detail ? `  ->  ${detail}` : ''}`);

  check('save backend available', mc.saveStatus.enabled, `enabled=${mc.saveStatus.enabled}`);

  const p = mc.info.position;
  const x = Math.floor(p[0]) + 6;
  const z = Math.floor(p[2]) + 6;
  const y = mc.column(x, z).ground + 1;

  // 1) 放三种不同性质的方块：普通整块 / 矿石 / 半透明方块
  const id = (name) => mc.blockId(name);
  const REDSTONE_BLOCK = id('redstone_block');
  const DIAMOND_ORE = id('diamond_ore');
  const GLASS = id('glass');
  check('block ids resolved by name', REDSTONE_BLOCK > 0 && DIAMOND_ORE > 0 && GLASS > 0, `${REDSTONE_BLOCK}/${DIAMOND_ORE}/${GLASS}`);

  mc.place(x, y, z, REDSTONE_BLOCK);
  mc.place(x + 1, y, z, DIAMOND_ORE);
  mc.place(x + 2, y, z, GLASS);
  // 2) 挖掉一个**天然地表方块**：这才是真正验证"空气也被保存"的用例
  //    （如果只是"先放石头再挖掉"，那一格本来就是空气，读档后是空气说明不了任何事）
  const dugY = mc.column(x + 3, z).ground;
  mc.place(x + 3, dugY, z, 0);
  // 3) 带状态的方块：拉杆（bit1-2 朝向 + bit3 开关）
  mc.place(x + 4, y, z, id('lever'), 0b000010);

  await sleep(300);
  check('blocks placed', mc.probe(x, y, z).block === 'minicraft:redstone_block', mc.probe(x, y, z).block);
  check('surface block dug out', mc.probe(x + 3, dugY, z).block === 'minicraft:air', mc.probe(x + 3, dugY, z).block);
  check('lever state written', mc.probeState(x + 4, y, z).state === 0b000010, `state=${mc.probeState(x + 4, y, z).state}`);

  // 4) 玩家位置与背包
  mc.teleportForce(x + 0.5, y + 2, z + 0.5);
  mc.look(123, -12);
  mc.inventory.add(1, 42);
  mc.setTimeOfDay(0.7);
  await sleep(200);

  const status = await mc.saveNow('manual');
  await sleep(200);
  const save = mc.saveStatus;
  check('saveNow succeeded', status === true);
  check('edits recorded', save.edits >= 5, `edits=${save.edits}`);
  check('pending cleared after save', save.pendingChunks === 0, `pending=${save.pendingChunks}`);
  check('last save fast (<300ms)', save.lastSaveMs < 300, `${save.lastSaveMs}ms`);

  // 坐标交给 shell 转发给第二步：playwright 的 goto 之间 localStorage 不保留
  // （IndexedDB 是保留的，所以存档本身能跨刷新——这里只影响"测试参数"的传递）
  const handoff = JSON.stringify({ x, y, z, dugY, glass: GLASS, yaw: 123, pitch: -12, edits: save.edits, saveMs: save.lastSaveMs });
  return `${lines.join('\n')}\n  coords=(${x},${y},${z}) dugY=${dugY} edits=${save.edits} saveMs=${save.lastSaveMs}\nsaveInfo=${handoff}`;
})();
