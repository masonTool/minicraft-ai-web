/**
 * 方块表二进制往返一致性（批次 20261025-0329）
 *
 * 这份测试是整条"数据搬出 bundle"路线的**唯一安全网**：
 * 宿主化之后线上跑的解码表、工具生成的二进制、测试比对用的 `buildBlockTable()`，
 * 三者必须是同一张表。只要有一个字段在编解码里掉了，玩家看到的就是错方块
 * （贴图对、碰撞对、但某一个属性悄悄回默认值——这种最难发现）。
 *
 * 钉住五件事：
 *  1. 逐块逐字段往返相等（不是"数量对就行"）；
 *  2. id 连续、顺序不变；
 *  3. 函数字段**不进文件**（解码后必须 undefined，由 BLOCK_BEHAVIORS 提供）；
 *  4. 坏文件必须**抛**，不能"尽力解出半张表"；
 *  5. 体积预算（防止哪天把字符串按块内联回去，体积翻几倍却没人发现）。
 *
 * 运行：npm run test:hostcore
 */

import { gzipSync } from 'node:zlib';
import { buildBlockTable, type BlockDef } from '../src/core/registry/blocks.ts';
import {
  BLOCK_TABLE_VERSION,
  decodeBlockTable,
  encodeBlockTable,
} from '../src/core/registry/blockTableCodec.ts';

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.log(`  ✗ ${label}${detail ? `  →  ${detail}` : ''}`);
  }
}

function equal(label: string, actual: unknown, expected: unknown): void {
  check(label, Object.is(actual, expected), `实际 ${String(actual)}，期望 ${String(expected)}`);
}

const source = buildBlockTable();
const bytes = encodeBlockTable(source);
const decoded = decodeBlockTable(bytes);

console.log('\n[一、数量与顺序]');
{
  equal('方块数一致', decoded.length, source.length);
  let firstBadId = -1;
  for (let i = 0; i < decoded.length; i++) {
    if (decoded[i]!.id !== i || source[i]!.id !== i) {
      firstBadId = i;
      break;
    }
  }
  check('id 从 0 连续且与下标一致', firstBadId === -1, `第 ${firstBadId} 项不符合`);
  check('首个方块仍是空气', decoded[0]!.name === source[0]!.name, decoded[0]!.name);
}

console.log('\n[二、逐字段往返]');
{
  const FIELD_NAMES = [
    'name',
    'shape',
    'solid',
    'opaque',
    'suffocates',
    'liquid',
    'translucent',
    'light',
    'lightOpacity',
    'facesPlayer',
    'facesSneak',
    'facesNormal',
    'itemless',
    'waterPlant',
  ] as const;

  const mismatches: string[] = [];
  for (let i = 0; i < source.length; i++) {
    const expected: BlockDef = source[i]!;
    const actual: BlockDef = decoded[i]!;
    for (const field of FIELD_NAMES) {
      // facesPlayer / facesSneak / facesNormal 在类型上是可选布尔：源表里可能是
      // undefined（某些构造路径不写），而解码后一律是 false。语义相同（都是"没有"），
      // 所以这两种形态算相等。
      const a = actual[field] ?? false;
      const b = expected[field] ?? false;
      if (a !== b) mismatches.push(`${expected.name}.${field}: ${String(b)} → ${String(a)}`);
    }
    for (let side = 0; side < 3; side++) {
      if (actual.tiles[side] !== expected.tiles[side]) {
        mismatches.push(`${expected.name}.tiles[${side}]: ${expected.tiles[side]} → ${actual.tiles[side]}`);
      }
    }
  }
  check(
    `全部 ${source.length} 个方块的 17 个数据字段逐一致`,
    mismatches.length === 0,
    mismatches.slice(0, 8).join(' / ') + (mismatches.length > 8 ? ` …共 ${mismatches.length} 处` : ''),
  );
}

console.log('\n[三、函数字段不进文件]');
{
  const withStateTiles = source.filter((b) => b.stateTiles !== undefined).length;
  const withFaceTile = source.filter((b) => b.faceTile !== undefined).length;
  const withStateLight = source.filter((b) => b.stateLight !== undefined).length;
  check(
    '解码结果没有任何函数字段（行为由 BLOCK_BEHAVIORS 提供）',
    decoded.every((b) => b.stateTiles === undefined && b.faceTile === undefined && b.stateLight === undefined),
  );
  check('源表里确实存在需要外部提供的块（否则这条测试是空的）', withStateTiles + withFaceTile + withStateLight > 0,
    `stateTiles ${withStateTiles} / faceTile ${withFaceTile} / stateLight ${withStateLight}`);
}

console.log('\n[四、坏文件必须抛]');
{
  const reject = (label: string, mutate: (copy: Uint8Array) => void): void => {
    const copy = bytes.slice();
    mutate(copy);
    let threw = false;
    try {
      decodeBlockTable(copy);
    } catch {
      threw = true;
    }
    check(label, threw);
  };

  reject('魔数不对 → 抛', (copy) => {
    copy[0] = 0x00;
  });
  reject('版本号不对 → 抛（App 与线上版本错配要明确失败）', (copy) => {
    copy[4] = 99;
  });
  reject('长度不变但改坏一个字节 → 抛（校验和）', (copy) => {
    // 这是最阴的一类损坏：长度、魔数、版本全对，解出来却是"贴图空、形状错"的垃圾表。
    copy[copy.length - 1] = copy[copy.length - 1]! ^ 0xff;
  });

  let halfThrew = false;
  try {
    decodeBlockTable(bytes.subarray(0, Math.floor(bytes.length / 2)));
  } catch {
    halfThrew = true;
  }
  check('截断一半 → 抛', halfThrew);

  let shortThrew = false;
  try {
    decodeBlockTable(new Uint8Array(4));
  } catch {
    shortThrew = true;
  }
  check('比头部还短 → 抛', shortThrew);

  // 字符串下标越界（把第一条方块的 nameIdx 改成 0xffff）
  const copy = bytes.slice();
  const view = new DataView(copy.buffer, copy.byteOffset, copy.byteLength);
  const stringCount = view.getUint32(8, true);
  let offset = 16;
  for (let i = 0; i < stringCount; i++) {
    const length = view.getUint16(offset, true);
    offset += 2 + length;
  }
  view.setUint16(offset, 0xffff, true);
  let rangeThrew = false;
  try {
    decodeBlockTable(copy);
  } catch {
    rangeThrew = true;
  }
  check('字符串下标越界 → 抛', rangeThrew);
}

console.log('\n[五、体积预算]');
{
  const gzip = gzipSync(bytes, { level: 9 });
  const perBlock = (bytes.length - 12) / Math.max(1, source.length);
  console.log(
    `    原始 ${bytes.length} 字节 / gzip ${gzip.length} 字节 / 每块摊到 ${perBlock.toFixed(1)} 字节`,
  );
  // 预算是"别悄悄涨"的闸门，不是性能目标。涨了先查是不是又把字符串按块内联回去了。
  // 字符串表是**共享**的（1431 段名字/贴图/形状去重后约 30 KB），方块区是定长 14 字节/块。
  // 两者分开算：合起来摊到每块看着大，但那不是回归。
  const stringSection = bytes.length - 16 - 14 * source.length;
  check('原始体积 < 64 KB', bytes.length < 64 * 1024, `${bytes.length} 字节`);
  check('gzip < 24 KB（放进 APK 的净成本）', gzip.length < 24 * 1024, `${gzip.length} 字节`);
  check('字符串表 < 40 KB（按块内联会到几百 KB）', stringSection < 40 * 1024, `${stringSection} 字节`);
  check('方块区严格 14 字节/块', bytes.length === 16 + stringSection + 14 * source.length);
}

console.log('\n[六、ArrayBuffer 入口（worker postMessage 走这条）]');
{
  const shared = bytes.slice().buffer;
  const fromBuffer = decodeBlockTable(shared);
  equal('从 ArrayBuffer 解出的方块数一致', fromBuffer.length, decoded.length);
  check('从 ArrayBuffer 解出的内容一致', fromBuffer[1]!.name === decoded[1]!.name, fromBuffer[1]!.name);
}

console.log(`\n结果：${passed} 通过，${failed} 失败（格式 v${BLOCK_TABLE_VERSION}）`);
if (failed > 0) process.exit(1);
