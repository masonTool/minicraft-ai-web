/**
 * v2 存档 seam 冒烟：平台 FileSaveGame 替代 IndexedDB。
 *
 * 不依赖 wx/浏览器，用内存 FileStore 验证：
 *   open → saveChunks → 重新 open → loadAllChunkEdits
 */

import { FileSaveGame } from '../../src/platform/file-save.ts';
import { createMemoryFiles } from '../../src/platform/memory.ts';
import type { PlayerSave } from '../../src/core/save/SaveGame.ts';

const files = createMemoryFiles();
const save = await FileSaveGame.open('v2-smoke', files);

await save.saveChunks([
  {
    dimension: 'overworld',
    cx: 0,
    cz: 0,
    edits: {
      indices: new Uint32Array([3, 7]),
      packed: new Uint32Array([0x2a, 0x2b]),
    },
  },
]);

const player = {
  x: 1,
  y: 64,
  z: 1,
  yaw: 0,
  pitch: 0,
  dimension: 'overworld',
  flying: false,
  timeOfDay: 1000,
} as PlayerSave;
await save.savePlayer(player);

const reopened = await FileSaveGame.open('v2-smoke', files);
const records = await reopened.loadAllChunkEdits();
const loadedPlayer = await reopened.loadPlayer();

if (records.length !== 1) {
  console.error(`FAIL: expected 1 chunk record, got ${records.length}`);
  process.exit(1);
}
if (records[0]!.edits.indices[0] !== 3 || records[0]!.edits.packed[1] !== 0x2b) {
  console.error('FAIL: chunk edits mismatch');
  process.exit(1);
}
if (loadedPlayer?.x !== 1 || loadedPlayer?.dimension !== 'overworld') {
  console.error('FAIL: player save mismatch');
  process.exit(1);
}

console.log(
  `PASS: chunks=${records.length} edits=${records[0]!.edits.indices.length} player=${loadedPlayer?.x},${loadedPlayer?.y},${loadedPlayer?.z}`,
);
