/**
 * 资源包（K4）浏览器验收
 *
 * 由 tools/pack-check.sh 调用：脚本里的 `__PACK_BASE64__` 会被替换成
 * 测试包（tools/make-test-pack.mjs 生成）的内容。
 *
 * 验证方式不只是"返回了统计数字"，而是**直接去图集画布上读像素**：
 * 测试包把 stone 换成红、dirt 换成蓝、grass_block_top 换成黄，
 * 因此画布上应当正好出现 3 个这样的纯色 tile，其余 tile 不受影响。
 */
(async function packAcceptance() {
  const mc = window.__mc;
  const lines = [];
  const check = (label, ok, detail) => lines.push(`${ok ? '[OK]  ' : '[FAIL]'} ${label}${detail ? `  ->  ${detail}` : ''}`);

  const base64 = '__PACK_BASE64__';
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  const file = new File([bytes], '测试材质包.mcpack', { type: 'application/zip' });

  // ---- 先记录导入前的图集像素特征（应当没有纯红/纯蓝/纯黄）
  const atlas = mc.atlas;
  check('atlas canvas accessible', Boolean(atlas?.canvas), atlas?.canvas ? `${atlas.canvas.width}x${atlas.canvas.height}` : 'missing');
  const ctx = atlas.canvas.getContext('2d');
  const TILE = 16;
  const cols = atlas.columns;
  const tileCount = cols * atlas.rows;

  // 记录每个 tile 的中心像素，导入后比对差异——
  // 不能靠"颜色像不像红/蓝"来判断：图集里本来就有红石、红花、水这些相近色
  const snapshotPixels = () => {
    const out = [];
    for (let index = 0; index < tileCount; index++) {
      const x = (index % cols) * TILE + TILE / 2;
      const y = Math.floor(index / cols) * TILE + TILE / 2;
      const data = ctx.getImageData(x, y, 1, 1).data;
      out.push([data[0], data[1], data[2]]);
    }
    return out;
  };
  const before = snapshotPixels();

  const isRed = (r, g, b) => r > 200 && g < 120 && b < 120;
  const isBlue = (r, g, b) => b > 200 && r < 120 && g < 150;
  const isYellow = (r, g, b) => r > 200 && g > 190 && b < 120;

  // ---- 导入
  const result = await mc.loadResourcePack(file);
  check('pack loaded without error', result !== null);

  const state = mc.resourcePackState;
  check('pack name recorded', Boolean(state?.name), state?.name ?? '-');
  check('three tiles replaced', state?.replaced === 3, `${state?.replaced}`);
  check('unknown tile name reported as skipped', state?.skipped === 1, `${state?.skipped}`);

  // ---- 图集像素真的变了：统计"哪些 tile 被重画了"
  await new Promise((resolve) => setTimeout(resolve, 200));
  const after = snapshotPixels();
  const changed = [];
  for (let index = 0; index < tileCount; index++) {
    const a = before[index];
    const b = after[index];
    if (a[0] !== b[0] || a[1] !== b[1] || a[2] !== b[2]) changed.push({ index, pixel: b });
  }
  const redTiles = changed.filter((item) => isRed(...item.pixel));
  const blueTiles = changed.filter((item) => isBlue(...item.pixel));
  const yellowTiles = changed.filter((item) => isYellow(...item.pixel));

  check(`exactly 3 tiles repainted (got ${changed.length})`, changed.length === 3, changed.map((c) => `#${c.index}=rgb(${c.pixel.join(',')})`).join(' '));
  check(`red (stone) tile present`, redTiles.length === 1, `${redTiles.length}`);
  check(`blue (dirt) tile present`, blueTiles.length === 1, `${blueTiles.length}`);
  check(`yellow (grass_top) tile present`, yellowTiles.length === 1, `${yellowTiles.length}`);

  // ---- 坏文件不该崩
  const badFile = new File([new Uint8Array([1, 2, 3, 4, 5])], 'broken.mcpack');
  const badResult = await mc.loadResourcePack(badFile);
  check('broken pack rejected gracefully', badResult === null && mc.resourcePackState?.error === true, JSON.stringify(mc.resourcePackState));

  return lines.join('\n');
})();
