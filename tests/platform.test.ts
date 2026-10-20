import { describe, expect, it } from 'vitest';
import { asDomStorage, readJson, writeJson } from '../src/platform/dom-storage.ts';
import { assertPlatformKind, detectPlatformKind } from '../src/platform/detect.ts';
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
