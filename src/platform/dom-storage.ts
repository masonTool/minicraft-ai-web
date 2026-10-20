import type { KeyValueStore } from './types.ts';

/**
 * 把平台 `KeyValueStore` 适配成现有代码认识的 `Storage` 形状。
 *
 * 现有 `WorldRegistry` 的构造参数是 `Storage | null`；小游戏没有 DOM Storage，
 * 用这个适配器就能原样复用，不必为了平台化去改主线 core 文件。
 */
export function asDomStorage(store: KeyValueStore): Storage {
  return {
    get length(): number {
      return store.keys().length;
    },
    clear(): void {
      store.clear();
    },
    getItem(key: string): string | null {
      return store.get(key);
    },
    key(index: number): string | null {
      return store.keys()[index] ?? null;
    },
    removeItem(key: string): void {
      store.remove(key);
    },
    setItem(key: string, value: string): void {
      store.set(key, value);
    },
  } as Storage;
}

/** 读 JSON；缺失或损坏时回退默认值（与小游戏/浏览器同一口径） */
export function readJson<T>(store: KeyValueStore, key: string, fallback: T): T {
  const raw = store.get(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** 写 JSON；写入失败会让异常冒泡，由调用方决定是否忽略 */
export function writeJson(store: KeyValueStore, key: string, value: unknown): void {
  store.set(key, JSON.stringify(value));
}
