import { describe, expect, it } from 'vitest';
import { asDomStorage, readJson, writeJson } from '../src/platform/dom-storage.ts';
import { assertPlatformKind, detectPlatformKind } from '../src/platform/detect.ts';
import { decodeChunkEdits, encodeChunkEdits, FileSaveGame } from '../src/platform/file-save.ts';
import { createMemoryFiles, createMemoryStorage } from '../src/platform/memory.ts';

describe('platform detect', () => {
  it('prefers wx over the fake document injected by the adapter', () => {
    const scope = {
      wx: { createCanvas: () => ({}) },
      document: {},
    };
    expect(detectPlatformKind(scope)).toBe('wx');
  });

  it('detects tt before document', () => {
    expect(detectPlatformKind({ tt: { createCanvas: () => ({}) }, document: {} })).toBe('tt');
  });

  it('falls back to web when only document exists', () => {
    expect(detectPlatformKind({ document: {} })).toBe('web');
  });

  it('returns unknown when nothing is available', () => {
    expect(detectPlatformKind({})).toBe('unknown');
    expect(() => assertPlatformKind('unknown')).toThrow();
  });
});

describe('memory storage', () => {
  it('behaves like a small KeyValueStore', () => {
    const storage = createMemoryStorage({ a: '1' });
    expect(storage.get('a')).toBe('1');
    expect(storage.get('missing')).toBeNull();
    storage.set('b', '2');
    expect(storage.keys().sort()).toEqual(['a', 'b']);
    storage.remove('a');
    expect(storage.get('a')).toBeNull();
    storage.clear();
    expect(storage.keys()).toEqual([]);
  });
});

describe('DOM storage adapter', () => {
  it('exposes a Storage-compatible surface over KeyValueStore', () => {
    const store = asDomStorage(createMemoryStorage());
    store.setItem('bedrock-worlds', '[]');
    expect(store.length).toBe(1);
    expect(store.key(0)).toBe('bedrock-worlds');
    expect(store.getItem('bedrock-worlds')).toBe('[]');
    store.removeItem('bedrock-worlds');
    expect(store.length).toBe(0);
    store.setItem('a', '1');
    store.clear();
    expect(store.length).toBe(0);
  });

  it('reads and writes JSON with a safe fallback', () => {
    const store = createMemoryStorage();
    expect(readJson(store, 'settings', { fov: 70 })).toEqual({ fov: 70 });
    writeJson(store, 'settings', { fov: 90 });
    expect(readJson(store, 'settings', { fov: 70 })).toEqual({ fov: 90 });
    store.set('settings', '{broken');
    expect(readJson(store, 'settings', { fov: 70 })).toEqual({ fov: 70 });
  });
});

describe('file save', () => {
  it('round-trips meta and compressed chunk edits', async () => {
    const files = createMemoryFiles();
    const save = await FileSaveGame.open('world-1', files);
    expect(save.hasSave).toBe(false);

    save.addPlayTime(12);
    const meta = save.buildMeta(12345, 7);
    await save.saveMeta(meta);

    const edits = {
      indices: new Uint32Array([1, 2, 3]),
      packed: new Uint32Array([4, 5]),
    };
    await save.saveChunks([{ dimension: 'overworld', cx: 1, cz: -2, edits }]);

    const reopened = await FileSaveGame.open('world-1', files);
    expect(reopened.hasSave).toBe(true);
    expect(reopened.meta?.seed).toBe(12345);
    expect(reopened.meta?.edits).toBe(7);
    expect(reopened.matchesSeed(12345)).toBe(true);
    expect(reopened.matchesSeed(999)).toBe(false);

    const all = await reopened.loadAllChunkEdits();
    expect(all).toHaveLength(1);
    expect([...all[0]!.edits.indices]).toEqual([1, 2, 3]);
    expect([...all[0]!.edits.packed]).toEqual([4, 5]);
    expect(await reopened.listChunkKeys()).toEqual(['overworld|1,-2']);
    expect(await reopened.estimateSize()).toBe(1);

    await reopened.clear();
    expect(reopened.hasSave).toBe(false);
    expect(await reopened.loadAllChunkEdits()).toEqual([]);
  });

  it('rejects malformed chunk buffers', () => {
    expect(decodeChunkEdits(new ArrayBuffer(4))).toBeNull();
    const encoded = encodeChunkEdits({
      indices: new Uint32Array([1]),
      packed: new Uint32Array([2]),
    });
    const decoded = decodeChunkEdits(encoded);
    expect(decoded && [...decoded.indices]).toEqual([1]);
    expect(decoded && [...decoded.packed]).toEqual([2]);
  });
});

describe('memory files', () => {
  it('writes/reads strings and binary data', async () => {
    const files = createMemoryFiles();
    await files.write('world/meta.json', '{"seed":1}');
    const text = await files.read('world/meta.json');
    expect(new TextDecoder().decode(text)).toBe('{"seed":1}');

    const binary = new Uint8Array([1, 2, 3, 4]).buffer;
    await files.write('world/chunks/0.bin', binary);
    const read = new Uint8Array(await files.read('world/chunks/0.bin'));
    expect([...read]).toEqual([1, 2, 3, 4]);
    expect(await files.exists('world/chunks/0.bin')).toBe(true);
    expect(await files.list('world')).toEqual(['world/meta.json', 'world/chunks/0.bin']);

    await files.remove('world/chunks/0.bin');
    expect(await files.exists('world/chunks/0.bin')).toBe(false);
    await expect(files.read('world/chunks/0.bin')).rejects.toThrow();
  });
});
